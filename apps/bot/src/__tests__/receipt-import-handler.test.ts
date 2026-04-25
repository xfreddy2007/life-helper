import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleReceiptImageResult,
  handleReceiptConfirmation,
  handleReceiptCorrection,
} from '../handlers/receipt-import.handler.js';

vi.mock('@life-helper/database/repositories', () => ({
  findOrCreateItem: vi
    .fn()
    .mockResolvedValue({ item: { id: 'item-1', name: '白米' }, created: false }),
  getDefaultCategory: vi.fn().mockResolvedValue({ id: 'cat-1', name: '食材' }),
  addStock: vi.fn().mockResolvedValue({}),
  findMappingsByReceiptNames: vi.fn().mockResolvedValue([]),
  upsertReceiptMapping: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/vision.service.js', () => ({
  applyMappings: vi
    .fn()
    .mockImplementation(
      (
        items: Array<{
          categoryName: string;
          quantity: number;
          unit: string;
          sourceItems: string[];
          quantityUnclear: boolean;
          bogoDetected: boolean;
        }>,
      ) => items.map((i) => ({ ...i, resolvedName: i.categoryName, mappedItemId: undefined })),
    ),
}));

vi.mock('../services/session.js', () => ({
  getSession: vi.fn().mockResolvedValue(null),
  setSession: vi.fn().mockResolvedValue(undefined),
  clearSession: vi.fn().mockResolvedValue(undefined),
  newSession: vi.fn().mockReturnValue({
    flow: 'RECEIPT_IMPORT',
    step: 0,
    data: {},
    expiresAt: Date.now() + 99999,
  }),
}));

import { addStock, upsertReceiptMapping } from '@life-helper/database/repositories';
import { getSession } from '../services/session.js';

const mockAddStock = vi.mocked(addStock);
const mockUpsertMapping = vi.mocked(upsertReceiptMapping);
const mockGetSession = vi.mocked(getSession);

const sampleItems = [
  {
    categoryName: '白米',
    quantity: 2,
    unit: '袋',
    sourceItems: ['白米'],
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
];

beforeEach(() => vi.clearAllMocks());

describe('handleReceiptImageResult', () => {
  it('returns no-items message when vision returns empty array', async () => {
    const replies = await handleReceiptImageResult([], 'group-1');
    expect(replies[0]!.text).toContain('無法辨識');
  });

  it('returns preview message with recognised items', async () => {
    const replies = await handleReceiptImageResult(sampleItems, 'group-1');
    expect(replies[0]!.text).toContain('辨識結果');
    expect(replies[0]!.text).toContain('白米');
    expect(replies[0]!.text).toContain('橄欖油');
    expect(replies[0]!.text).toContain('確認');
  });

  it('includes expiry date in preview when provided', async () => {
    const replies = await handleReceiptImageResult(sampleItems, 'group-1');
    expect(replies[0]!.text).toContain('到期');
    expect(replies[0]!.text).toContain('2027');
  });

  it('passes all sourceItems to findMappingsByReceiptNames', async () => {
    const { findMappingsByReceiptNames } = await import('@life-helper/database/repositories');
    await handleReceiptImageResult(sampleItems, 'group-1');
    expect(vi.mocked(findMappingsByReceiptNames)).toHaveBeenCalledWith(['白米', '橄欖油']);
  });
});

describe('handleReceiptConfirmation', () => {
  it('returns null when no RECEIPT_IMPORT session', async () => {
    mockGetSession.mockResolvedValue(null);
    const result = await handleReceiptConfirmation(true, 'group-1');
    expect(result).toBeNull();
  });

  it('returns null when session flow is not RECEIPT_IMPORT', async () => {
    mockGetSession.mockResolvedValue({ flow: 'ONBOARDING', step: 0, data: {}, expiresAt: 9999 });
    const result = await handleReceiptConfirmation(true, 'group-1');
    expect(result).toBeNull();
  });

  it('returns cancel message on CONFIRM_NO', async () => {
    mockGetSession.mockResolvedValue({
      flow: 'RECEIPT_IMPORT',
      step: 0,
      data: {
        pendingItems: sampleItems.map((i) => ({ ...i, resolvedName: i.categoryName })),
      },
      expiresAt: 9999,
    });
    const result = await handleReceiptConfirmation(false, 'group-1');
    expect(result![0]!.text).toContain('取消');
    expect(mockAddStock).not.toHaveBeenCalled();
  });

  it('adds stock and upserts mappings for all sourceItems on CONFIRM_YES', async () => {
    mockGetSession.mockResolvedValue({
      flow: 'RECEIPT_IMPORT',
      step: 0,
      data: {
        pendingItems: [
          {
            categoryName: '白米',
            resolvedName: '白米',
            quantity: 2,
            unit: '袋',
            sourceItems: ['特選米', '越光米'],
            quantityUnclear: false,
            bogoDetected: false,
          },
          {
            categoryName: '橄欖油',
            resolvedName: '橄欖油',
            quantity: 1,
            unit: '瓶',
            sourceItems: ['橄欖油'],
            expiryDate: '2027-06-30',
            quantityUnclear: false,
            bogoDetected: false,
          },
        ],
      },
      expiresAt: 9999,
    });
    const result = await handleReceiptConfirmation(true, 'group-1');
    expect(mockAddStock).toHaveBeenCalledTimes(2);
    // 3 upserts: 2 for 白米's sourceItems + 1 for 橄欖油
    expect(mockUpsertMapping).toHaveBeenCalledTimes(3);
    expect(result![0]!.text).toContain('補貨完成');
  });

  it('includes expiry date in success message when present', async () => {
    mockGetSession.mockResolvedValue({
      flow: 'RECEIPT_IMPORT',
      step: 0,
      data: {
        pendingItems: [
          {
            categoryName: '牛奶',
            resolvedName: '牛奶',
            quantity: 2,
            unit: '瓶',
            sourceItems: ['牛奶'],
            expiryDate: '2026-04-30',
            quantityUnclear: false,
            bogoDetected: false,
          },
        ],
      },
      expiresAt: 9999,
    });
    const result = await handleReceiptConfirmation(true, 'group-1');
    expect(result![0]!.text).toContain('到期');
  });
});

describe('handleReceiptCorrection', () => {
  it('returns null when no RECEIPT_IMPORT session', async () => {
    mockGetSession.mockResolvedValue(null);
    const result = await handleReceiptCorrection('可口可樂330ml 6瓶', 'group-1');
    expect(result).toBeNull();
  });

  it('returns null when text does not match correction pattern', async () => {
    mockGetSession.mockResolvedValue({
      flow: 'RECEIPT_IMPORT',
      step: 0,
      data: {
        pendingItems: [
          {
            categoryName: '可口可樂330ml',
            resolvedName: '可口可樂330ml',
            quantity: 1,
            unit: '瓶',
            sourceItems: ['可口可樂330ml'],
            quantityUnclear: true,
            bogoDetected: false,
          },
        ],
      },
      expiresAt: 9999,
    });
    const result = await handleReceiptCorrection('隨便說說', 'group-1');
    expect(result).toBeNull();
  });

  it('returns null when item name not found in pending list', async () => {
    mockGetSession.mockResolvedValue({
      flow: 'RECEIPT_IMPORT',
      step: 0,
      data: {
        pendingItems: [
          {
            categoryName: '可口可樂330ml',
            resolvedName: '可口可樂330ml',
            quantity: 1,
            unit: '瓶',
            sourceItems: ['可口可樂330ml'],
            quantityUnclear: true,
            bogoDetected: false,
          },
        ],
      },
      expiresAt: 9999,
    });
    const result = await handleReceiptCorrection('百事可樂 6瓶', 'group-1');
    expect(result).toBeNull();
  });

  it('updates quantity, unit and clears quantityUnclear flag', async () => {
    const { setSession } = await import('../services/session.js');
    mockGetSession.mockResolvedValue({
      flow: 'RECEIPT_IMPORT',
      step: 0,
      data: {
        pendingItems: [
          {
            categoryName: '可口可樂330ml',
            resolvedName: '可口可樂330ml',
            quantity: 1,
            unit: '瓶',
            sourceItems: ['可口可樂330ml'],
            quantityUnclear: true,
            bogoDetected: false,
          },
        ],
      },
      expiresAt: 9999,
    });
    const result = await handleReceiptCorrection('可口可樂330ml 6瓶', 'group-1');
    expect(result).not.toBeNull();
    expect(result![0]!.text).toContain('可口可樂330ml');
    expect(result![0]!.text).toContain('6瓶');
    expect(result![0]!.text).not.toContain('❓');
    expect(vi.mocked(setSession)).toHaveBeenCalled();
  });
});
