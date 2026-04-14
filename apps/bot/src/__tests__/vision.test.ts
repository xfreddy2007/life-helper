import { describe, it, expect } from 'vitest';
import { parseVisionResponse, applyMappings } from '../services/vision.service.js';

// ── parseVisionResponse ────────────────────────────────────────

describe('parseVisionResponse', () => {
  it('parses a valid JSON response', () => {
    const raw = JSON.stringify({
      items: [
        { receiptName: '特選白米', quantity: 2, unit: '袋' },
        { receiptName: '橄欖油', quantity: 1, unit: '瓶', expiryDate: '2027-06-30' },
      ],
    });
    const result = parseVisionResponse(raw);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.receiptName).toBe('特選白米');
    expect(result.items[1]!.expiryDate).toBe('2027-06-30');
  });

  it('strips markdown code fences before parsing', () => {
    const raw = '```json\n{"items":[{"receiptName":"白米","quantity":1,"unit":"kg"}]}\n```';
    const result = parseVisionResponse(raw);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.receiptName).toBe('白米');
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

  it('ignores items with invalid shape and returns what is valid', () => {
    // Zod will fail the whole parse if an item is malformed
    const raw = JSON.stringify({ items: [{ receiptName: '', quantity: 1, unit: 'kg' }] });
    // Empty receiptName fails z.string().min(1)
    const result = parseVisionResponse(raw);
    expect(result.items).toHaveLength(0);
  });

  it('handles extra unknown fields gracefully (passthrough)', () => {
    const raw = JSON.stringify({
      items: [{ receiptName: '牛奶', quantity: 2, unit: 'L', confidence: 0.9 }],
    });
    const result = parseVisionResponse(raw);
    // Zod strips unknown fields by default
    expect(result.items[0]!.receiptName).toBe('牛奶');
  });
});

// ── applyMappings ─────────────────────────────────────────────

describe('applyMappings', () => {
  const mappings = [
    { receiptName: '特選米', item: { id: 'item-rice', name: '白米' } },
    { receiptName: 'EVA橄欖油', item: { id: 'item-oil', name: '橄欖油' } },
  ];

  it('resolves receiptName to item name when mapping exists', () => {
    const items = [{ receiptName: '特選米', quantity: 2, unit: '袋' }];
    const result = applyMappings(items, mappings);
    expect(result[0]!.resolvedName).toBe('白米');
    expect(result[0]!.mappedItemId).toBe('item-rice');
  });

  it('keeps receiptName as resolvedName when no mapping exists', () => {
    const items = [{ receiptName: '醬油', quantity: 1, unit: '瓶' }];
    const result = applyMappings(items, mappings);
    expect(result[0]!.resolvedName).toBe('醬油');
    expect(result[0]!.mappedItemId).toBeUndefined();
  });

  it('handles mixed mapped and unmapped items', () => {
    const items = [
      { receiptName: '特選米', quantity: 1, unit: 'kg' },
      { receiptName: '鹽', quantity: 1, unit: '包' },
    ];
    const result = applyMappings(items, mappings);
    expect(result[0]!.resolvedName).toBe('白米');
    expect(result[1]!.resolvedName).toBe('鹽');
  });

  it('returns empty array for empty items input', () => {
    expect(applyMappings([], mappings)).toHaveLength(0);
  });

  it('returns items unchanged when mappings list is empty', () => {
    const items = [{ receiptName: '白糖', quantity: 1, unit: 'kg' }];
    const result = applyMappings(items, []);
    expect(result[0]!.resolvedName).toBe('白糖');
  });

  it('preserves expiryDate through mapping', () => {
    const items = [{ receiptName: '特選米', quantity: 1, unit: 'kg', expiryDate: '2027-01-01' }];
    const result = applyMappings(items, mappings);
    expect(result[0]!.expiryDate).toBe('2027-01-01');
  });
});
