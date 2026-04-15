import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleQueryPurchaseList } from '../handlers/query-purchase-list.handler.js';

vi.mock('@life-helper/database/repositories', () => ({
  listItems: vi.fn().mockResolvedValue([]),
  createPurchaseList: vi.fn().mockResolvedValue({}),
  getActivePurchaseList: vi.fn().mockResolvedValue(null),
}));

// purchase-advisor is pure — let it run for real
// (its behaviour is already tested in purchase-advisor.test.ts)

import {
  listItems,
  getActivePurchaseList,
  createPurchaseList,
} from '@life-helper/database/repositories';

const mockListItems = vi.mocked(listItems);
const mockGetActivePurchaseList = vi.mocked(getActivePurchaseList);
const mockCreatePurchaseList = vi.mocked(createPurchaseList);

beforeEach(() => vi.clearAllMocks());

describe('handleQueryPurchaseList', () => {
  it('returns no-purchase message when no items need buying', async () => {
    mockGetActivePurchaseList.mockResolvedValue(null);
    mockListItems.mockResolvedValue([]);
    const replies = await handleQueryPurchaseList();
    expect(replies[0]!.text).toContain('庫存充足');
    expect(mockCreatePurchaseList).not.toHaveBeenCalled();
  });

  it('returns cached active list when generated today', async () => {
    const today = new Date();
    mockGetActivePurchaseList.mockResolvedValue({
      id: 'pl-1',
      status: 'PENDING',
      generatedAt: today,
      completedAt: null,
      items: [
        {
          id: 'pli-1',
          purchaseListId: 'pl-1',
          itemId: 'item-1',
          item: { name: '白米' },
          suggestedQty: 2,
          unit: 'kg',
          urgency: 'URGENT',
          reason: '庫存不足',
          status: 'PENDING',
        },
      ],
    } as never);
    const replies = await handleQueryPurchaseList();
    expect(replies[0]!.text).toContain('採購清單');
    // Should NOT call listItems — uses the cached list
    expect(mockListItems).not.toHaveBeenCalled();
  });

  it('generates fresh list when active list is from a previous day', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    mockGetActivePurchaseList.mockResolvedValue({
      id: 'pl-old',
      status: 'PENDING',
      generatedAt: yesterday,
      completedAt: null,
      items: [],
    } as never);
    mockListItems.mockResolvedValue([]);
    const replies = await handleQueryPurchaseList();
    // Should generate fresh
    expect(mockListItems).toHaveBeenCalled();
    expect(replies[0]!.text).toContain('庫存充足');
  });

  it('creates purchase list when recommendations exist', async () => {
    mockGetActivePurchaseList.mockResolvedValue(null);
    // An item with consumptionRate > 0 and very low stock triggers URGENT
    mockListItems.mockResolvedValue([
      {
        id: 'item-1',
        name: '白米',
        totalQuantity: 0,
        consumptionRate: 5,
        units: ['kg'],
        purchaseSuggestionWeeks: 2,
        expiryBatches: [],
        category: { name: '食材' },
        categoryId: 'cat-1',
        expiryAlertDays: null,
        safetyStockWeeks: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);
    const replies = await handleQueryPurchaseList();
    expect(mockCreatePurchaseList).toHaveBeenCalled();
    expect(replies[0]!.text).toContain('採購清單');
  });
});
