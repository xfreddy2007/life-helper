import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleResetItem } from '../handlers/reset-item.handler.js';
import type { NluResult } from '../services/nlu/schema.js';

vi.mock('@life-helper/database/repositories', () => ({
  findItemByName: vi.fn(),
  resetQuantity: vi.fn().mockResolvedValue({}),
}));

import { findItemByName, resetQuantity } from '@life-helper/database/repositories';

const mockFindItemByName = vi.mocked(findItemByName);
const mockResetQuantity = vi.mocked(resetQuantity);

const mockItem = {
  id: 'item-1',
  name: '白米',
  units: ['kg'],
  totalQuantity: 5,
  consumptionRate: null,
  expiryAlertDays: null,
  safetyStockWeeks: 2,
  purchaseSuggestionWeeks: 2,
  categoryId: 'cat-1',
  category: {
    id: 'cat-1',
    name: '食材',
    isDefault: true,
    defaultExpiryAlertDays: 7,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  expiryBatches: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeNlu(overrides: Partial<NluResult> = {}): NluResult {
  return { intent: 'RESET_ITEM', entities: {}, rawText: '', confidence: 0.9, ...overrides };
}

beforeEach(() => vi.clearAllMocks());

describe('handleResetItem', () => {
  it('returns prompt when no entities', async () => {
    const replies = await handleResetItem(makeNlu());
    expect(replies[0]!.text).toContain('重置的物品');
  });

  it('returns prompt when entity has no name', async () => {
    const nlu = makeNlu({ entities: { items: [{ name: '' }] } });
    const replies = await handleResetItem(nlu);
    expect(replies[0]!.text).toContain('重置的物品');
  });

  it('returns prompt for qty/unit when entity has name but missing quantity', async () => {
    const nlu = makeNlu({ entities: { items: [{ name: '白米' }] } });
    const replies = await handleResetItem(nlu);
    expect(replies[0]!.text).toContain('數量和單位');
    expect(replies[0]!.text).toContain('白米');
  });

  it('returns not-found message when item does not exist', async () => {
    mockFindItemByName.mockResolvedValue(null);
    const nlu = makeNlu({ entities: { items: [{ name: '豆腐', quantity: 2, unit: '盒' }] } });
    const replies = await handleResetItem(nlu);
    expect(replies[0]!.text).toContain('找不到');
    expect(replies[0]!.text).toContain('豆腐');
  });

  it('resets quantity when item found with valid qty/unit', async () => {
    mockFindItemByName.mockResolvedValue(mockItem as never);
    const nlu = makeNlu({ entities: { items: [{ name: '白米', quantity: 3, unit: 'kg' }] } });
    const replies = await handleResetItem(nlu);
    expect(mockResetQuantity).toHaveBeenCalledWith('item-1', 3, 'kg');
    expect(replies[0]!.text).toContain('白米');
    expect(replies[0]!.text).toContain('3kg');
  });
});
