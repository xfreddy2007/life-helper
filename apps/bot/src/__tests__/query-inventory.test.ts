import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleQueryInventory } from '../handlers/query-inventory.handler.js';
import type { NluResult } from '../services/nlu/schema.js';

vi.mock('@life-helper/database/repositories', () => ({
  findItemByName: vi.fn(),
  listItems: vi.fn(),
}));

import { findItemByName, listItems } from '@life-helper/database/repositories';

const mockFindItemByName = vi.mocked(findItemByName);
const mockListItems = vi.mocked(listItems);

const mockCategory = {
  id: 'cat-1',
  name: '食材',
  isDefault: true,
  defaultExpiryAlertDays: 7,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockItem = {
  id: 'item-1',
  name: '白米',
  categoryId: 'cat-1',
  category: mockCategory,
  units: ['kg'],
  totalQuantity: 5,
  consumptionRate: 1,
  expiryAlertDays: null,
  safetyStockWeeks: 2,
  purchaseSuggestionWeeks: 2,
  expiryBatches: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeNlu(overrides: Partial<NluResult> = {}): NluResult {
  return { intent: 'QUERY_INVENTORY', entities: {}, rawText: '', confidence: 0.9, ...overrides };
}

beforeEach(() => vi.clearAllMocks());

describe('handleQueryInventory', () => {
  it('returns single item detail when item name provided and found', async () => {
    mockFindItemByName.mockResolvedValue(mockItem as never);
    const nlu = makeNlu({ entities: { items: [{ name: '白米' }] } });
    const replies = await handleQueryInventory(nlu);
    expect(replies[0]!.text).toContain('白米');
    expect(replies[0]!.text).toContain('5');
    expect(replies[0]!.text).toContain('食材');
  });

  it('returns not-found message when item name provided but not found', async () => {
    mockFindItemByName.mockResolvedValue(null);
    const nlu = makeNlu({ entities: { items: [{ name: '豆腐' }] } });
    const replies = await handleQueryInventory(nlu);
    expect(replies[0]!.text).toContain('找不到');
    expect(replies[0]!.text).toContain('豆腐');
  });

  it('includes batch info when item has expiry batches', async () => {
    const itemWithBatch = {
      ...mockItem,
      expiryBatches: [
        {
          id: 'b1',
          itemId: 'item-1',
          quantity: 5,
          unit: 'kg',
          expiryDate: new Date('2027-01-01'),
          alertSent: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    };
    mockFindItemByName.mockResolvedValue(itemWithBatch as never);
    const nlu = makeNlu({ entities: { items: [{ name: '白米' }] } });
    const replies = await handleQueryInventory(nlu);
    expect(replies[0]!.text).toContain('到期批次');
  });

  it('returns full inventory list when no item name or category', async () => {
    mockListItems.mockResolvedValue([mockItem] as never);
    const nlu = makeNlu({ entities: {} });
    const replies = await handleQueryInventory(nlu);
    expect(replies[0]!.text).toContain('庫存');
    expect(mockListItems).toHaveBeenCalledWith(undefined);
  });

  it('filters by category when category entity provided', async () => {
    mockListItems.mockResolvedValue([mockItem] as never);
    const nlu = makeNlu({ entities: { category: '食材' } });
    const replies = await handleQueryInventory(nlu);
    expect(mockListItems).toHaveBeenCalledWith('食材');
    expect(replies[0]!.text).toContain('食材');
  });
});
