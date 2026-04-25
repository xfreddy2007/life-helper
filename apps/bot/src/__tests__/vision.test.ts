import { describe, it, expect } from 'vitest';
import { parseVisionResponse, applyMappings } from '../services/vision.service.js';

// ── parseVisionResponse ────────────────────────────────────────

describe('parseVisionResponse', () => {
  it('parses a valid JSON response', () => {
    const raw = JSON.stringify({
      items: [
        {
          categoryName: '蔬菜',
          quantity: 2,
          unit: '包',
          sourceItems: ['履歷油菜', '履歷水耕A菜250g'],
          quantityUnclear: false,
          bogoDetected: false,
        },
        {
          categoryName: '橄欖油',
          quantity: 1,
          unit: '瓶',
          sourceItems: ['橄欖油'],
          expiryDate: '2027-06-30',
          quantityUnclear: false,
          bogoDetected: false,
        },
      ],
    });
    const result = parseVisionResponse(raw);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.categoryName).toBe('蔬菜');
    expect(result.items[0]!.sourceItems).toEqual(['履歷油菜', '履歷水耕A菜250g']);
    expect(result.items[1]!.expiryDate).toBe('2027-06-30');
  });

  it('strips markdown code fences before parsing', () => {
    const raw =
      '```json\n{"items":[{"categoryName":"白米","quantity":1,"unit":"kg","sourceItems":["白米"],"quantityUnclear":false,"bogoDetected":false}]}\n```';
    const result = parseVisionResponse(raw);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.categoryName).toBe('白米');
  });

  it('strips code fences without language tag', () => {
    const raw = '```\n{"items":[]}\n```';
    expect(parseVisionResponse(raw).items).toHaveLength(0);
  });

  it('returns empty items array on invalid JSON', () => {
    const result = parseVisionResponse('not valid json');
    expect(result.items).toHaveLength(0);
  });

  it('returns empty items array when items field is missing', () => {
    const result = parseVisionResponse('{"something":"else"}');
    expect(result.items).toHaveLength(0);
  });

  it('returns empty items array on empty string', () => {
    expect(parseVisionResponse('').items).toHaveLength(0);
  });

  it('ignores items with invalid shape (empty categoryName)', () => {
    const raw = JSON.stringify({
      items: [
        {
          categoryName: '',
          quantity: 1,
          unit: 'kg',
          sourceItems: ['x'],
          quantityUnclear: false,
          bogoDetected: false,
        },
      ],
    });
    const result = parseVisionResponse(raw);
    expect(result.items).toHaveLength(0);
  });

  it('ignores items with empty sourceItems array', () => {
    const raw = JSON.stringify({
      items: [
        {
          categoryName: '白米',
          quantity: 1,
          unit: 'kg',
          sourceItems: [],
          quantityUnclear: false,
          bogoDetected: false,
        },
      ],
    });
    const result = parseVisionResponse(raw);
    expect(result.items).toHaveLength(0);
  });

  it('defaults quantityUnclear and bogoDetected when omitted', () => {
    const raw = JSON.stringify({
      items: [{ categoryName: '牛奶', quantity: 2, unit: 'L', sourceItems: ['牛奶'] }],
    });
    const result = parseVisionResponse(raw);
    expect(result.items[0]!.quantityUnclear).toBe(false);
    expect(result.items[0]!.bogoDetected).toBe(false);
  });

  it('handles extra unknown fields gracefully', () => {
    const raw = JSON.stringify({
      items: [
        {
          categoryName: '牛奶',
          quantity: 2,
          unit: 'L',
          sourceItems: ['牛奶'],
          confidence: 0.9,
          quantityUnclear: false,
          bogoDetected: false,
        },
      ],
    });
    const result = parseVisionResponse(raw);
    expect(result.items[0]!.categoryName).toBe('牛奶');
  });

  it('parses bogoDetected flag correctly', () => {
    const raw = JSON.stringify({
      items: [
        {
          categoryName: '元氣白桃氣泡水',
          quantity: 2,
          unit: '瓶',
          sourceItems: ['元氣白桃氣泡水', '元氣白桃氣泡水BOGO'],
          quantityUnclear: false,
          bogoDetected: true,
        },
      ],
    });
    const result = parseVisionResponse(raw);
    expect(result.items[0]!.bogoDetected).toBe(true);
    expect(result.items[0]!.quantity).toBe(2);
    expect(result.items[0]!.sourceItems).toHaveLength(2);
  });

  it('parses quantityUnclear flag correctly', () => {
    const raw = JSON.stringify({
      items: [
        {
          categoryName: '可口可樂330ml',
          quantity: 1,
          unit: '瓶',
          sourceItems: ['可口可樂330ml'],
          quantityUnclear: true,
          bogoDetected: false,
        },
      ],
    });
    const result = parseVisionResponse(raw);
    expect(result.items[0]!.quantityUnclear).toBe(true);
  });
});

// ── applyMappings ─────────────────────────────────────────────

describe('applyMappings', () => {
  const mappings = [
    { receiptName: '特選米', item: { id: 'item-rice', name: '白米' } },
    { receiptName: 'EVA橄欖油', item: { id: 'item-oil', name: '橄欖油' } },
  ];

  it('resolves via sourceItems when a mapping exists', () => {
    const items = [
      {
        categoryName: '白米',
        quantity: 2,
        unit: '袋',
        sourceItems: ['特選米'],
        quantityUnclear: false,
        bogoDetected: false,
      },
    ];
    const result = applyMappings(items, mappings);
    expect(result[0]!.resolvedName).toBe('白米');
    expect(result[0]!.mappedItemId).toBe('item-rice');
  });

  it('uses first matching sourceItem when multiple are present', () => {
    const items = [
      {
        categoryName: '油品',
        quantity: 1,
        unit: '瓶',
        sourceItems: ['EVA橄欖油', '其他油'],
        quantityUnclear: false,
        bogoDetected: false,
      },
    ];
    const result = applyMappings(items, mappings);
    expect(result[0]!.resolvedName).toBe('橄欖油');
    expect(result[0]!.mappedItemId).toBe('item-oil');
  });

  it('falls back to categoryName when no sourceItem matches', () => {
    const items = [
      {
        categoryName: '醬油',
        quantity: 1,
        unit: '瓶',
        sourceItems: ['醬油'],
        quantityUnclear: false,
        bogoDetected: false,
      },
    ];
    const result = applyMappings(items, mappings);
    expect(result[0]!.resolvedName).toBe('醬油');
    expect(result[0]!.mappedItemId).toBeUndefined();
  });

  it('handles mixed mapped and unmapped items', () => {
    const items = [
      {
        categoryName: '白米',
        quantity: 1,
        unit: 'kg',
        sourceItems: ['特選米'],
        quantityUnclear: false,
        bogoDetected: false,
      },
      {
        categoryName: '鹽',
        quantity: 1,
        unit: '包',
        sourceItems: ['鹽'],
        quantityUnclear: false,
        bogoDetected: false,
      },
    ];
    const result = applyMappings(items, mappings);
    expect(result[0]!.resolvedName).toBe('白米');
    expect(result[1]!.resolvedName).toBe('鹽');
  });

  it('returns empty array for empty items input', () => {
    expect(applyMappings([], mappings)).toHaveLength(0);
  });

  it('returns items with categoryName as resolvedName when mappings list is empty', () => {
    const items = [
      {
        categoryName: '白糖',
        quantity: 1,
        unit: 'kg',
        sourceItems: ['白糖'],
        quantityUnclear: false,
        bogoDetected: false,
      },
    ];
    const result = applyMappings(items, []);
    expect(result[0]!.resolvedName).toBe('白糖');
  });

  it('preserves expiryDate through mapping', () => {
    const items = [
      {
        categoryName: '白米',
        quantity: 1,
        unit: 'kg',
        sourceItems: ['特選米'],
        expiryDate: '2027-01-01',
        quantityUnclear: false,
        bogoDetected: false,
      },
    ];
    const result = applyMappings(items, mappings);
    expect(result[0]!.expiryDate).toBe('2027-01-01');
  });
});
