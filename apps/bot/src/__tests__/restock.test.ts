import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRestock } from '../handlers/restock.handler.js';
import type { NluResult } from '../services/nlu/schema.js';

vi.mock('@life-helper/database/repositories', () => ({
  findItemByName: vi.fn(),
  addStock: vi.fn().mockResolvedValue({}),
  findOrCreateItem: vi.fn(),
  findCategoryByName: vi.fn().mockResolvedValue(null),
  getDefaultCategory: vi.fn().mockResolvedValue({ id: 'cat-1', name: '食材' }),
  findPendingItemsByItemIds: vi.fn().mockResolvedValue([]),
  updatePurchaseListItemStatus: vi.fn().mockResolvedValue({}),
}));

vi.mock('../services/session.js', () => ({
  newSession: vi.fn(() => ({ flow: 'RESTOCK_EXPIRY', step: 0, data: {}, expiresAt: 0 })),
  setSession: vi.fn().mockResolvedValue(undefined),
  clearSession: vi.fn().mockResolvedValue(undefined),
}));

import {
  findItemByName,
  addStock,
  findOrCreateItem,
  findPendingItemsByItemIds,
  updatePurchaseListItemStatus,
} from '@life-helper/database/repositories';

const mockFindItemByName = vi.mocked(findItemByName);
const mockAddStock = vi.mocked(addStock);
vi.mocked(findOrCreateItem);
const mockFindPendingItemsByItemIds = vi.mocked(findPendingItemsByItemIds);
const mockUpdatePurchaseListItemStatus = vi.mocked(updatePurchaseListItemStatus);

const SOURCE_ID = 'user-123';

const mockItem = {
  id: 'item-1',
  name: '橄欖油',
  categoryId: 'cat-1',
  category: {
    id: 'cat-1',
    name: '食材',
    isDefault: true,
    defaultExpiryAlertDays: 7,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  units: ['瓶'],
  totalQuantity: 2,
  consumptionRate: null,
  expiryAlertDays: null,
  safetyStockWeeks: 2,
  purchaseSuggestionWeeks: 2,
  expiryBatches: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeNlu(overrides: Partial<NluResult> = {}): NluResult {
  return { intent: 'RESTOCK', entities: {}, rawText: '', confidence: 0.9, ...overrides };
}

beforeEach(() => vi.clearAllMocks());

describe('handleRestock', () => {
  it('returns prompt when no item entities provided', async () => {
    const replies = await handleRestock(makeNlu(), SOURCE_ID);
    expect(replies[0]!.text).toContain('補充了什麼物品');
  });

  it('warns when entity is missing quantity or unit', async () => {
    const nlu = makeNlu({ entities: { items: [{ name: '橄欖油' }] } });
    const replies = await handleRestock(nlu, SOURCE_ID);
    expect(replies[0]!.text).toContain('缺少數量或單位');
  });

  it('asks for expiry date when item has no expiry (existing item)', async () => {
    mockFindItemByName.mockResolvedValue(mockItem as never);
    const nlu = makeNlu({ entities: { items: [{ name: '橄欖油', quantity: 2, unit: '瓶' }] } });
    const replies = await handleRestock(nlu, SOURCE_ID);
    expect(mockAddStock).not.toHaveBeenCalled();
    expect(replies[0]!.text).toContain('到期日是');
    expect(replies[0]!.text).toContain('橄欖油');
  });

  it('asks for expiry date when item does not exist yet', async () => {
    mockFindItemByName.mockResolvedValue(null);
    const nlu = makeNlu({ entities: { items: [{ name: '橄欖油', quantity: 1, unit: '瓶' }] } });
    const replies = await handleRestock(nlu, SOURCE_ID);
    expect(mockAddStock).not.toHaveBeenCalled();
    expect(replies[0]!.text).toContain('到期日是');
  });

  it('adds stock immediately when expiryDate is provided', async () => {
    mockFindItemByName.mockResolvedValue(mockItem as never);
    const nlu = makeNlu({
      entities: { items: [{ name: '橄欖油', quantity: 1, unit: '瓶', expiryDate: '2027-06-30' }] },
    });
    const replies = await handleRestock(nlu, SOURCE_ID);
    expect(mockAddStock).toHaveBeenCalledWith(
      'item-1',
      expect.objectContaining({ expiryDate: expect.any(Date) }),
    );
    expect(replies[0]!.text).toContain('到期');
  });

  it('adds stock immediately when expiryDays is provided', async () => {
    mockFindItemByName.mockResolvedValue(mockItem as never);
    const nlu = makeNlu({
      entities: { items: [{ name: '橄欖油', quantity: 1, unit: '瓶', expiryDays: 30 }] },
    });
    await handleRestock(nlu, SOURCE_ID);
    expect(mockAddStock).toHaveBeenCalledWith(
      'item-1',
      expect.objectContaining({ expiryDate: expect.any(Date) }),
    );
  });

  it('auto-completes matching purchase list items when expiry is provided', async () => {
    mockFindItemByName.mockResolvedValue(mockItem as never);
    mockFindPendingItemsByItemIds.mockResolvedValue([
      { id: 'pli-1', item: { name: '橄欖油' } },
    ] as never);
    const nlu = makeNlu({
      entities: {
        items: [{ name: '橄欖油', quantity: 2, unit: '瓶', expiryDate: '2027-06-30' }],
      },
    });
    const replies = await handleRestock(nlu, SOURCE_ID);
    expect(mockUpdatePurchaseListItemStatus).toHaveBeenCalledWith('pli-1', 'COMPLETED');
    expect(replies[0]!.text).toContain('採購清單已自動標記');
  });
});
