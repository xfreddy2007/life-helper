export function buildItem(
  overrides: Partial<{
    id: string;
    name: string;
    categoryId: string;
    units: string[];
    totalQuantity: number;
    consumptionRate: number | null;
  }> = {},
) {
  return {
    id: 'test-item-id',
    name: '白米',
    categoryId: 'test-category-id',
    units: ['kg'],
    totalQuantity: 5,
    consumptionRate: 1,
    expiryAlertDays: null,
    safetyStockWeeks: 2,
    purchaseSuggestionWeeks: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
