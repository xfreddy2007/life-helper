import { describe, it, expect } from 'vitest';
import { formatReceiptPreview } from '../handlers/receipt-import.handler.js';
import type { PendingReceiptItem } from '../handlers/receipt-import.handler.js';

function makeItem(overrides: Partial<PendingReceiptItem> = {}): PendingReceiptItem {
  return {
    categoryName: '白米',
    resolvedName: '白米',
    quantity: 2,
    unit: '袋',
    sourceItems: ['特選白米'],
    quantityUnclear: false,
    bogoDetected: false,
    ...overrides,
  };
}

describe('formatReceiptPreview', () => {
  it('shows the header and footer', () => {
    const text = formatReceiptPreview([makeItem()]);
    expect(text).toContain('辨識結果');
    expect(text).toContain('確認');
    expect(text).toContain('取消');
  });

  it('shows categoryName → resolvedName when they differ', () => {
    const item = makeItem({ categoryName: '特選米', resolvedName: '白米' });
    const text = formatReceiptPreview([item]);
    expect(text).toContain('特選米 → 白米');
  });

  it('shows only resolvedName when categoryName and resolvedName are the same', () => {
    const item = makeItem({ categoryName: '橄欖油', resolvedName: '橄欖油' });
    const text = formatReceiptPreview([item]);
    expect(text).not.toContain('→');
    expect(text).toContain('橄欖油');
  });

  it('includes quantity and unit', () => {
    const item = makeItem({ quantity: 3, unit: '瓶' });
    const text = formatReceiptPreview([item]);
    expect(text).toContain('3瓶');
  });

  it('includes expiry date when provided', () => {
    const item = makeItem({ expiryDate: '2027-06-30' });
    const text = formatReceiptPreview([item]);
    expect(text).toContain('到期');
    expect(text).toContain('2027');
  });

  it('omits expiry information when no expiryDate', () => {
    const item = makeItem({ expiryDate: undefined });
    const text = formatReceiptPreview([item]);
    expect(text).not.toContain('到期');
  });

  it('shows ❓ and correction hint for quantityUnclear items', () => {
    const item = makeItem({ quantityUnclear: true });
    const text = formatReceiptPreview([item]);
    expect(text).toContain('❓');
    expect(text).toContain('修正');
  });

  it('shows 🎁 and BOGO note for bogoDetected items', () => {
    const item = makeItem({ bogoDetected: true, quantity: 2 });
    const text = formatReceiptPreview([item]);
    expect(text).toContain('🎁');
    expect(text).toContain('買一送一');
  });

  it('shows grouped source items in parentheses when multiple', () => {
    const item = makeItem({
      categoryName: '蔬菜',
      resolvedName: '蔬菜',
      quantity: 2,
      unit: '包',
      sourceItems: ['履歷油菜', '履歷水耕A菜250g'],
    });
    const text = formatReceiptPreview([item]);
    expect(text).toContain('履歷油菜');
    expect(text).toContain('履歷水耕A菜250g');
  });

  it('does not show parentheses when only one source item', () => {
    const item = makeItem({ sourceItems: ['橄欖油'] });
    const text = formatReceiptPreview([item]);
    // single-source items should not show redundant parentheses
    expect(text).not.toMatch(/（橄欖油）/);
  });

  it('lists all items', () => {
    const items = [
      makeItem({ resolvedName: '白米', categoryName: '白米' }),
      makeItem({ resolvedName: '橄欖油', categoryName: '橄欖油', unit: '瓶' }),
      makeItem({ resolvedName: '鹽', categoryName: '鹽', unit: '包' }),
    ];
    const text = formatReceiptPreview(items);
    expect(text).toContain('白米');
    expect(text).toContain('橄欖油');
    expect(text).toContain('鹽');
  });

  it('handles single item correctly', () => {
    const text = formatReceiptPreview([
      makeItem({ resolvedName: '糖', categoryName: '糖', unit: 'kg', quantity: 1 }),
    ]);
    expect(text).toContain('糖');
    expect(text).toContain('1kg');
  });

  it('does not show BOGO/unclear hints when none present', () => {
    const text = formatReceiptPreview([makeItem()]);
    expect(text).not.toContain('🎁');
    expect(text).not.toContain('❓');
  });
});
