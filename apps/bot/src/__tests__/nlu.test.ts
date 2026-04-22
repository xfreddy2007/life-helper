import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NluService } from '../services/nlu/nlu.service.js';
import { NluResultSchema } from '../services/nlu/schema.js';

// Mock the Anthropic SDK to avoid real API calls in unit tests
vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
    __mockCreate: mockCreate,
  };
});

function makeTextResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
  };
}

describe('NluService', () => {
  let service: NluService;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    service = new NluService('sk-test-key');
    // Access the mock through the module
    const mod = await import('@anthropic-ai/sdk');
    // @ts-expect-error — accessing mock helper
    mockCreate = mod.__mockCreate as ReturnType<typeof vi.fn>;
    mockCreate.mockReset();
  });

  it('parses QUERY_INVENTORY intent', async () => {
    const response = {
      intent: 'QUERY_INVENTORY',
      entities: { category: '調味料' },
      rawText: '查一下調味料的存量',
      confidence: 0.95,
    };
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));

    const result = await service.parse('查一下調味料的存量');

    expect(result.intent).toBe('QUERY_INVENTORY');
    expect(result.entities.category).toBe('調味料');
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('parses RECORD_CONSUMPTION with item entities', async () => {
    const response = {
      intent: 'RECORD_CONSUMPTION',
      entities: {
        items: [{ name: '白米', quantity: 2, unit: '杯' }],
      },
      rawText: '今天煮飯用了白米 2 杯',
      confidence: 0.92,
    };
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));

    const result = await service.parse('今天煮飯用了白米 2 杯');

    expect(result.intent).toBe('RECORD_CONSUMPTION');
    expect(result.entities.items?.[0]?.name).toBe('白米');
    expect(result.entities.items?.[0]?.quantity).toBe(2);
    expect(result.entities.items?.[0]?.unit).toBe('杯');
  });

  it('parses RESTOCK with expiry date', async () => {
    const response = {
      intent: 'RESTOCK',
      entities: {
        items: [{ name: '醬油', quantity: 2, unit: '瓶', expiryDate: '2026-08-01' }],
      },
      rawText: '買了醬油 2 瓶，到期 2026/08',
      confidence: 0.88,
    };
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));

    const result = await service.parse('買了醬油 2 瓶，到期 2026/08');

    expect(result.intent).toBe('RESTOCK');
    expect(result.entities.items?.[0]?.expiryDate).toBe('2026-08-01');
  });

  it('strips markdown code fences from response', async () => {
    const response = {
      intent: 'CONFIRM_YES',
      entities: {},
      rawText: '確認',
      confidence: 0.99,
    };
    const fencedResponse = '```json\n' + JSON.stringify(response) + '\n```';
    mockCreate.mockResolvedValueOnce(makeTextResponse(fencedResponse));

    const result = await service.parse('確認');
    expect(result.intent).toBe('CONFIRM_YES');
  });

  it('returns UNKNOWN intent on malformed response', async () => {
    mockCreate.mockResolvedValueOnce(makeTextResponse('not valid json {{{'));

    const result = await service.parse('gibberish');
    expect(result.intent).toBe('UNKNOWN');
    expect(result.confidence).toBe(0);
  });

  it('returns UNKNOWN intent on unexpected response format', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'image' }] });

    const result = await service.parse('test');
    expect(result.intent).toBe('UNKNOWN');
  });

  it('NluResultSchema validates correct structure', () => {
    const valid = {
      intent: 'QUERY_INVENTORY',
      entities: {},
      rawText: '查庫存',
      confidence: 0.9,
    };
    expect(() => NluResultSchema.parse(valid)).not.toThrow();
  });

  it('NluResultSchema rejects invalid intent', () => {
    const invalid = {
      intent: 'INVALID_INTENT',
      entities: {},
      rawText: 'test',
      confidence: 0.5,
    };
    expect(() => NluResultSchema.parse(invalid)).toThrow();
  });

  it('parses SHOW_FEATURES intent', async () => {
    const response = {
      intent: 'SHOW_FEATURES',
      entities: {},
      rawText: '有什麼功能',
      confidence: 0.95,
    };
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));

    const result = await service.parse('有什麼功能');
    expect(result.intent).toBe('SHOW_FEATURES');
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('NluResultSchema rejects confidence out of range', () => {
    const invalid = {
      intent: 'UNKNOWN',
      entities: {},
      rawText: 'test',
      confidence: 1.5,
    };
    expect(() => NluResultSchema.parse(invalid)).toThrow();
  });
});
