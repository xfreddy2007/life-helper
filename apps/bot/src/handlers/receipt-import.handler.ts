import {
  findOrCreateItem,
  getDefaultCategory,
  addStock,
  findMappingsByReceiptNames,
  upsertReceiptMapping,
} from '@life-helper/database/repositories';
import type { VisionItem } from '../services/vision.service.js';
import { applyMappings } from '../services/vision.service.js';
import { getSession, setSession, clearSession, newSession } from '../services/session.js';
import type { ReplyMessage } from './intent-router.js';

// ── Session data shape for RECEIPT_IMPORT flow ─────────────────

export interface PendingReceiptItem {
  categoryName: string;
  resolvedName: string;
  mappedItemId?: string;
  quantity: number;
  unit: string;
  expiryDate?: string;
  sourceItems: string[];
  quantityUnclear: boolean;
  bogoDetected: boolean;
}

interface ReceiptImportData {
  pendingItems: PendingReceiptItem[];
}

// ── Step 0: Image received, items recognised ──────────────────

export async function handleReceiptImageResult(
  visionItems: VisionItem[],
  sourceId: string,
): Promise<ReplyMessage[]> {
  if (visionItems.length === 0) {
    return [
      {
        type: 'text',
        text: '😕 無法辨識圖片中的商品，請確認照片清晰並重新嘗試，或直接傳文字補貨（例：「買了白米 2 袋」）',
      },
    ];
  }

  // Flatten all sourceItems for mapping lookup (many-to-one support)
  const allSourceNames = visionItems.flatMap((i) => i.sourceItems);
  const mappings = await findMappingsByReceiptNames(allSourceNames);
  const resolved = applyMappings(visionItems, mappings);

  const pendingItems: PendingReceiptItem[] = resolved.map((r) => ({
    categoryName: r.categoryName,
    resolvedName: r.resolvedName,
    mappedItemId: r.mappedItemId,
    quantity: r.quantity,
    unit: r.unit,
    expiryDate: r.expiryDate,
    sourceItems: r.sourceItems,
    quantityUnclear: r.quantityUnclear,
    bogoDetected: r.bogoDetected,
  }));

  const session = newSession('RECEIPT_IMPORT');
  const data: ReceiptImportData = { pendingItems };
  session.data = data as unknown as Record<string, unknown>;
  await setSession(sourceId, session);

  return [{ type: 'text', text: formatReceiptPreview(pendingItems) }];
}

// ── Step 0.5: User sends a quantity correction ─────────────────

/**
 * Parses a correction message like "可口可樂330ml 6瓶" and updates the pending item.
 * Returns null if text doesn't look like a correction or the item isn't found.
 */
export async function handleReceiptCorrection(
  text: string,
  sourceId: string,
): Promise<ReplyMessage[] | null> {
  const session = await getSession(sourceId);
  if (session?.flow !== 'RECEIPT_IMPORT') return null;

  // Pattern: "<name> <number><unit>" — e.g., "可口可樂330ml 6瓶"
  const match = text.trim().match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*([^\d\s]+)$/);
  if (!match) return null;

  const [, namePart, qtyStr, unitPart] = match;
  const quantity = parseFloat(qtyStr!);
  const name = namePart!.trim();
  const unit = unitPart!.trim();

  const data = session.data as unknown as ReceiptImportData;
  const { pendingItems } = data;

  const idx = pendingItems.findIndex((i) => i.resolvedName === name || i.categoryName === name);
  if (idx === -1) return null;

  pendingItems[idx] = { ...pendingItems[idx]!, quantity, unit, quantityUnclear: false };
  session.data = { pendingItems } as unknown as Record<string, unknown>;
  await setSession(sourceId, session);

  return [{ type: 'text', text: formatReceiptPreview(pendingItems) }];
}

// ── Step 1: User confirms or cancels ─────────────────────────

export async function handleReceiptConfirmation(
  isConfirmed: boolean,
  sourceId: string,
): Promise<ReplyMessage[] | null> {
  const session = await getSession(sourceId);
  if (session?.flow !== 'RECEIPT_IMPORT') return null;

  await clearSession(sourceId);

  if (!isConfirmed) {
    return [{ type: 'text', text: '已取消，購物清單未匯入。' }];
  }

  const data = session.data as unknown as ReceiptImportData;
  const { pendingItems } = data;

  if (!pendingItems || pendingItems.length === 0) {
    return [{ type: 'text', text: '沒有待匯入的品項。' }];
  }

  const category = await getDefaultCategory();
  if (!category) {
    return [{ type: 'text', text: '❌ 找不到預設分類，無法匯入。' }];
  }

  const results: string[] = [];

  for (const pending of pendingItems) {
    const { item } = await findOrCreateItem(pending.resolvedName, category.id, [pending.unit]);

    await addStock(item.id, {
      quantity: pending.quantity,
      unit: pending.unit,
      expiryDate: pending.expiryDate ? new Date(pending.expiryDate) : undefined,
    });

    // Persist mapping for every source receipt name → same canonical item
    for (const sourceName of pending.sourceItems) {
      await upsertReceiptMapping(sourceName, item.id);
    }

    const expStr = pending.expiryDate
      ? `（到期：${new Date(pending.expiryDate).toLocaleDateString('zh-TW', {
          timeZone: 'Asia/Taipei',
        })}）`
      : '';
    results.push(
      `✅ ${pending.resolvedName} +${pending.quantity}${pending.unit} ${expStr}`.trimEnd(),
    );
  }

  return [
    {
      type: 'text',
      text: `🛍️ 補貨完成！\n─────────────────\n${results.join('\n')}`,
    },
  ];
}

// ── Format helper (pure) ──────────────────────────────────────

export function formatReceiptPreview(items: PendingReceiptItem[]): string {
  const lines = ['📸 辨識結果如下：', '─────────────────'];
  let hasUnclear = false;
  let hasBogo = false;

  for (const item of items) {
    const nameLabel =
      item.resolvedName !== item.categoryName
        ? `${item.categoryName} → ${item.resolvedName}`
        : item.resolvedName;

    const qtyStr = item.quantityUnclear ? '❓' : String(item.quantity);
    const bogoTag = item.bogoDetected ? ' 🎁' : '';

    const expStr = item.expiryDate
      ? `（到期：${new Date(item.expiryDate).toLocaleDateString('zh-TW', {
          timeZone: 'Asia/Taipei',
        })}）`
      : '';

    // Show source items in parentheses only when multiple were grouped
    const sourcesStr = item.sourceItems.length > 1 ? `（${item.sourceItems.join('、')}）` : '';

    lines.push(`• ${nameLabel}：${qtyStr}${item.unit}${bogoTag} ${expStr}${sourcesStr}`.trimEnd());

    if (item.quantityUnclear) hasUnclear = true;
    if (item.bogoDetected) hasBogo = true;
  }

  lines.push('─────────────────');
  if (hasUnclear) lines.push('❓ 數量不確定的品項請回覆修正，例如：「可口可樂330ml 6瓶」');
  if (hasBogo) lines.push('🎁 買一送一數量已計入，如未收到贈品請修正數量');
  lines.push('傳「確認」全部加入庫存，或傳「取消」放棄');

  return lines.join('\n');
}
