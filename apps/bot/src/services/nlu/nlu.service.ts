import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../../lib/logger.js';
import { NluResultSchema, type NluResult } from './schema.js';

const SYSTEM_PROMPT = `你是「居家生活小幫手」LINE Bot 的自然語言理解模組。
你的任務是解析使用者傳入的訊息，辨識意圖並萃取結構化實體資料。

## 意圖分類

| 意圖 | 說明 | 範例 |
|------|------|------|
| QUERY_INVENTORY | 查詢庫存 | 「白米還有多少」、「查一下調味料的存量」 |
| RECORD_CONSUMPTION | 記錄消耗 | 「今天煮飯用了白米 2 杯」、「用掉橄欖油半瓶」 |
| RESTOCK | 補充庫存 | 「今天買了青菜 3 包」、「剛買了沙拉油 2 瓶，到期 2026/12」 |
| QUERY_PURCHASE_LIST | 查詢採購清單 | 「我這週要買什麼」、「採購清單給我看」 |
| START_ONBOARDING | 開始初始建檔 | 「開始盤點」、「重新整理庫存」 |
| RESET_ITEM | 重置單品庫存 | 「醬油重新盤點為 3 瓶」、「白米現在有 5kg」 |
| PARTIAL_RESET | 重置指定多項物品庫存 | 「重置庫存 牛奶 可樂」、「牛奶和可樂重新盤點」、「清空白米跟橄欖油」 |
| CONFIRM_YES | 確認/肯定 | 「確認」、「是的」、「OK」、「對」 |
| CONFIRM_NO | 取消/否定 | 「取消」、「不是」、「不對」 |
| SET_CONFIG | 設定或查看排程偏好 | 「每週五早上 9 點提醒採購」、「查看排程」、「查看設定」、「目前設定是什麼」、「設定」 |
| REVERT_OPERATION | 撤銷最近操作 | 「撤銷」、「復原」、「我要撤銷」、「取消剛才」、「顯示最近操作」 |
| PURGE_EXPIRED | 清理過期或即將到期物品 | 「清理過期」、「清除過期品」、「丟掉過期的東西」、「清掉快到期的」 |
| UNKNOWN | 無法辨識 | 任何其他訊息 |

## 實體萃取規則

- items[].name: 物品名稱，如「白米」、「橄欖油」
- items[].quantity: 數字（float），如 2、0.5；若使用者輸入負數（如 -10），原樣保留負號，不可轉為正數
- items[].unit: 單位，如「杯」、「瓶」、「包」、「kg」
- items[].expiryDate: 到期日，轉為 ISO 日期字串（YYYY-MM-DD），如「2026/12」→「2026-12-01」
- items[].expiryDays: 使用者以「N天」表示的有效天數
- items[].unitMismatch: 布林值；當使用者指定的單位對該物品在語意上不合理時設為 true，否則設為 false
  - 判斷原則：考慮現實生活中如何購買或測量該物品
  - 例子（mismatch=true）：可樂「張」、牛奶「平方公尺」、白米「公里」、衛生紙「毫升」
  - 例子（mismatch=false）：可樂「罐/瓶/ml」、牛奶「盒/瓶/ml」、白米「kg/g/杯」、衛生紙「包/抽」
- items[].suggestedUnit: 當 unitMismatch=true 時，填入對該物品最常見、合理的單位（如「罐」、「瓶」、「kg」）；否則設為 null
- category: 品類名稱，如「調味料」、「食材」
- targetDate: 查詢的目標日期
- config.cronKey: SET_CONFIG 意圖時必填，依功能分類：
  - DAILY_CONFIRM_PUSH — 每日消耗確認推送（如「每天晚上十點提醒消耗確認」）
  - EXPIRY_ALERT — 每日到期提醒（如「每天早上七點發到期提醒」）
  - WEEKLY_PURCHASE — 每週採購清單（如「每週五早上九點發採購清單」）
  - 若無法判斷功能，設為 null
- config 排程模式（二擇一，不可同時設定）：
  【時間模式】
  - config.hour: 小時（0-23），24 小時制，從中文轉換（「下午三點」→ 15、「早上八點」→ 8）
  - config.minute: 分鐘（0-59），未提及時設為 0
  - config.weekdays: 星期陣列，0=日、1=一、2=二、3=三、4=四、5=五、6=六
    - 未提及星期（每天）→ null 或 []
    - 「每週五」→ [5]
    - 「每週一三五」→ [1, 3, 5]
    - 「每週一到五」→ [1, 2, 3, 4, 5]
  【間隔模式】（僅在明確指定「每 N 秒/分/小時」時使用，hour/minute/weekdays 保持 null）
  - config.intervalSeconds: 每隔 N 秒，如「每 10 秒」→ 10
  - config.intervalMinutes: 每隔 N 分鐘，如「每 5 分鐘」→ 5
  - config.intervalHours: 每隔 N 小時，如「每 2 小時」→ 2

## 輸出格式

嚴格輸出 JSON，不要加任何說明文字。格式如下：
{
  "intent": "<INTENT>",
  "entities": {
    "items": [
      {
        "name": "<string>",
        "quantity": <number> | null,
        "unit": "<string>" | null,
        "expiryDate": "<YYYY-MM-DD>" | null,
        "expiryDays": <number> | null,
        "unitMismatch": <true|false>,
        "suggestedUnit": "<string>" | null
      }
    ] | null,
    "category": "<string>" | null,
    "targetDate": "<ISO date>" | null,
    "config": {
      "cronKey": "DAILY_CONFIRM_PUSH" | "EXPIRY_ALERT" | "WEEKLY_PURCHASE" | null,
      "hour": <number> | null,
      "minute": <number> | null,
      "weekdays": [<number>, ...] | null,
      "intervalSeconds": <number> | null,
      "intervalMinutes": <number> | null,
      "intervalHours": <number> | null
    } | null
  },
  "rawText": "<原始輸入>",
  "confidence": <0.0-1.0>
}`;

export class NluService {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async parse(text: string): Promise<NluResult> {
    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          // Enable prompt caching — the system prompt is static and large
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: text }],
    });

    const block = response.content[0];
    if (!block || block.type !== 'text') {
      logger.warn({ text }, 'NLU: unexpected response format');
      return this.unknownResult(text);
    }

    const raw = block.text.trim();

    // Strip markdown code fences if present, then replace JS `undefined` with JSON `null`
    const jsonText = raw
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '')
      .replace(/:\s*undefined/g, ': null');

    try {
      const parsed = JSON.parse(jsonText) as unknown;
      const result = NluResultSchema.parse(parsed);
      logger.debug({ intent: result.intent, confidence: result.confidence }, 'NLU parsed');
      return result;
    } catch (err) {
      logger.warn({ err, raw }, 'NLU: failed to parse response');
      return this.unknownResult(text);
    }
  }

  private unknownResult(text: string): NluResult {
    return {
      intent: 'UNKNOWN',
      entities: {},
      rawText: text,
      confidence: 0,
    };
  }
}
