import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

// ── Schema ─────────────────────────────────────────────────────

export const VisionItemSchema = z.object({
  categoryName: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().min(1),
  sourceItems: z.array(z.string().min(1)).min(1),
  expiryDate: z.string().optional(),
  quantityUnclear: z.boolean().default(false),
  bogoDetected: z.boolean().default(false),
});

export const VisionResultSchema = z.object({
  items: z.array(VisionItemSchema),
});

export type VisionItem = z.infer<typeof VisionItemSchema>;
export type VisionResult = z.infer<typeof VisionResultSchema>;

// ── Supported image media types ───────────────────────────────
export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

// ── Prompt ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `\
你是超市收據與購物袋辨識助手。
使用者會傳來一張圖片（收據、食品包裝照片，或購物後的商品群組照）。
請辨識所有品項，按品類合併後以純 JSON 格式回覆，結構如下：

{
  "items": [
    {
      "categoryName": "品類名稱（例：蔬菜、麵包、可口可樂330ml）",
      "quantity": 數字,
      "unit": "單位（瓶/包/袋/罐/盒/個/kg/g/L 等）",
      "sourceItems": ["收據原始文字1", "收據原始文字2"],
      "expiryDate": "YYYY-MM-DD",
      "quantityUnclear": false,
      "bogoDetected": false
    }
  ]
}

合併規則：
- 同一品類的商品合併為一筆，sourceItems 列出所有原始品名，quantity 為總數
  例：「履歷油菜」和「履歷水耕A菜250g」→ categoryName「蔬菜」，sourceItems: ["履歷油菜", "履歷水耕A菜250g"]
  例：多款麵包 → categoryName「麵包」，sourceItems 列出每款麵包名稱
- 品牌或用途差異大的品項保持獨立（例：可口可樂 vs 礦泉水 vs 洗碗精）

買一送一（BOGO）規則：
- 若看到「BOGO」、「買一送一」或同商品出現兩次（一次正價一次免費），合併為一筆
- quantity 設為用戶實際拿到的總數（例：買 1 送 1 → quantity 2），bogoDetected 設為 true
- sourceItems 列出所有相關收據行（含 BOGO 那行）

單位規則：
- unit 填包裝單位（瓶/包/袋/罐/盒/個/kg/g/L），不要填產品規格中的容量數字
- 錯誤示範：「可口可樂330ml」的 unit 填「ml」→ 應填「瓶」或「罐」
- 若收據行有數量（例：6 瓶），以此為準

數量不確定規則：
- 若收據上數量不清楚或無法辨識，quantity 填 1，quantityUnclear 設為 true

其他規則：
- expiryDate 只在包裝上有明確到期日時填入（YYYY-MM-DD），否則完全省略此欄位
- 只輸出 JSON，不要任何說明、標題或 markdown 圍籬`;

// ── Pure helpers ──────────────────────────────────────────────

/**
 * Parse the raw text response from Claude Vision into a VisionResult.
 * Exported for unit testing without a real API call.
 */
export function parseVisionResponse(raw: string): VisionResult {
  const json = raw
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/im, '')
    .trim();

  try {
    const parsed: unknown = JSON.parse(json);
    return VisionResultSchema.parse(parsed);
  } catch {
    return { items: [] };
  }
}

/**
 * Apply known ReceiptMapping entries to resolve categoryNames to canonical item names.
 * Checks all sourceItems for a mapping match; uses the first hit.
 */
export function applyMappings(
  items: VisionItem[],
  mappings: Array<{ receiptName: string; item: { id: string; name: string } }>,
): Array<VisionItem & { resolvedName: string; mappedItemId?: string }> {
  const map = new Map(mappings.map((m) => [m.receiptName, m]));
  return items.map((item) => {
    const mapping = item.sourceItems.map((n) => map.get(n)).find(Boolean);
    return {
      ...item,
      resolvedName: mapping ? mapping.item.name : item.categoryName,
      mappedItemId: mapping?.item.id,
    };
  });
}

// ── Service class ─────────────────────────────────────────────

export class VisionService {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async recognizeReceipt(
    imageBase64: string,
    mediaType: ImageMediaType = 'image/jpeg',
  ): Promise<VisionResult> {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: imageBase64 },
            },
            { type: 'text', text: '請辨識這張圖片中的所有物品。' },
          ],
        },
      ],
    });

    const raw = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    return parseVisionResponse(raw);
  }
}
