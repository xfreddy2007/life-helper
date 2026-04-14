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
  receiptName: string; // original text from vision
  resolvedName: string; // after mapping, or same as receiptName
  mappedItemId?: string; // existing item id if a mapping was found
  quantity: number;
  unit: string;
  expiryDate?: string; // ISO date string
}

interface ReceiptImportData {
  pendingItems: PendingReceiptItem[];
}

// ── Step 0: Image received, items recognised ──────────────────

/**
 * Called from the webhook when an image message arrives.
 * Stores recognised + mapped items in the session and returns a preview.
 */
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

  // Apply known receipt-name → item-name mappings
  const receiptNames = visionItems.map((i) => i.receiptName);
  const mappings = await findMappingsByReceiptNames(receiptNames);
  const resolved = applyMappings(visionItems, mappings);

  const pendingItems: PendingReceiptItem[] = resolved.map((r) => ({
    receiptName: r.receiptName,
    resolvedName: r.resolvedName,
    mappedItemId: r.mappedItemId,
    quantity: r.quantity,
    unit: r.unit,
    expiryDate: r.expiryDate,
  }));

  // Save to session (step 0 = waiting for user confirmation)
  const session = newSession('RECEIPT_IMPORT');
  const data: ReceiptImportData = { pendingItems };
  session.data = data as unknown as Record<string, unknown>;
  await setSession(sourceId, session);

  return [{ type: 'text', text: formatReceiptPreview(pendingItems) }];
}

// ── Step 1: User confirms or cancels ─────────────────────────

/**
 * Handles CONFIRM_YES / CONFIRM_NO during an active RECEIPT_IMPORT session.
 * Returns null if there's no active RECEIPT_IMPORT session.
 */
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

  const results: string[] = [];
  const category = await getDefaultCategory();

  if (!category) {
    return [{ type: 'text', text: '❌ 找不到預設分類，無法匯入。' }];
  }

  for (const pending of pendingItems) {
    const { item } = await findOrCreateItem(pending.resolvedName, category.id, [pending.unit]);

    await addStock(item.id, {
      quantity: pending.quantity,
      unit: pending.unit,
      expiryDate: pending.expiryDate ? new Date(pending.expiryDate) : undefined,
    });

    // Persist the receipt-name → item mapping for next time
    await upsertReceiptMapping(pending.receiptName, item.id);

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

/**
 * Build the confirmation preview message shown to the user before stock is added.
 * Exported as pure function for testing.
 */
export function formatReceiptPreview(items: PendingReceiptItem[]): string {
  const lines = ['📸 辨識結果如下：', '─────────────────'];

  for (const item of items) {
    const nameLabel =
      item.receiptName !== item.resolvedName
        ? `${item.receiptName} → ${item.resolvedName}`
        : item.resolvedName;
    const expStr = item.expiryDate
      ? `（到期：${new Date(item.expiryDate).toLocaleDateString('zh-TW', {
          timeZone: 'Asia/Taipei',
        })}）`
      : '';
    lines.push(`• ${nameLabel}：${item.quantity}${item.unit} ${expStr}`.trimEnd());
  }

  lines.push('─────────────────');
  lines.push('傳「確認」全部加入庫存，或傳「取消」放棄');

  return lines.join('\n');
}
