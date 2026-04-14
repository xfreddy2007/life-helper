import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

// ── Schema ─────────────────────────────────────────────────────

export const VisionItemSchema = z.object({
  receiptName: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().min(1),
  expiryDate: z.string().optional(), // YYYY-MM-DD if visible on packaging
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
請辨識所有品項並以純 JSON 格式回覆，結構如下：

{
  "items": [
    {
      "receiptName": "品項原始名稱（使用圖片上的文字）",
      "quantity": 數字（購買或拍到的數量，無法辨識時預設 1）,
      "unit": "單位（瓶/包/袋/罐/盒/kg/g/L/ml 等）",
      "expiryDate": "YYYY-MM-DD"
    }
  ]
}

規則：
- receiptName 直接使用圖片上的原始文字，不要翻譯或改寫
- expiryDate 只在包裝上有明確到期日時填入，否則完全省略此欄位
- 只輸出 JSON，不要任何說明、標題或 markdown 圍籬`;

// ── Pure helpers ──────────────────────────────────────────────

/**
 * Parse the raw text response from Claude Vision into a VisionResult.
 * Exported for unit testing without a real API call.
 */
export function parseVisionResponse(raw: string): VisionResult {
  // Strip markdown code fences if present
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
 * Apply known ReceiptMapping entries to resolve receiptNames to canonical item names.
 * Items without a mapping keep their receiptName as the resolvedName.
 */
export function applyMappings(
  items: VisionItem[],
  mappings: Array<{ receiptName: string; item: { id: string; name: string } }>,
): Array<VisionItem & { resolvedName: string; mappedItemId?: string }> {
  const map = new Map(mappings.map((m) => [m.receiptName, m]));
  return items.map((item) => {
    const mapping = map.get(item.receiptName);
    return {
      ...item,
      resolvedName: mapping ? mapping.item.name : item.receiptName,
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

  /**
   * Send a base64-encoded image to Claude and return structured recognition results.
   */
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
