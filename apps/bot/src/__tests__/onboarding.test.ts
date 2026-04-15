import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleStartOnboarding, handleOnboardingStep } from '../handlers/onboarding.handler.js';
import type { NluResult } from '../services/nlu/schema.js';
import type { ConversationState } from '../services/session.js';

vi.mock('@life-helper/database/repositories', () => ({
  listCategories: vi.fn().mockResolvedValue([
    { id: 'cat-1', name: '食材', isDefault: true, defaultExpiryAlertDays: 7 },
    { id: 'cat-2', name: '調味料', isDefault: false, defaultExpiryAlertDays: 14 },
  ]),
  findCategoryByName: vi.fn().mockResolvedValue(null),
  getDefaultCategory: vi.fn().mockResolvedValue({ id: 'cat-1', name: '食材' }),
  findOrCreateItem: vi.fn().mockResolvedValue({
    item: { id: 'item-1', name: '白米' },
    created: true,
  }),
  addStock: vi.fn().mockResolvedValue({}),
}));

vi.mock('../services/session.js', () => ({
  setSession: vi.fn().mockResolvedValue(undefined),
  clearSession: vi.fn().mockResolvedValue(undefined),
  newSession: vi.fn().mockReturnValue({
    flow: 'ONBOARDING',
    step: 0,
    data: {},
    expiresAt: Date.now() + 99999,
  }),
}));

import { addStock } from '@life-helper/database/repositories';
import { clearSession, setSession } from '../services/session.js';

const mockAddStock = vi.mocked(addStock);
const mockClearSession = vi.mocked(clearSession);
const mockSetSession = vi.mocked(setSession);

function makeNlu(overrides: Partial<NluResult> = {}): NluResult {
  return { intent: 'UNKNOWN', entities: {}, rawText: '', confidence: 0.9, ...overrides };
}

function makeSession(overrides: Partial<ConversationState> = {}): ConversationState {
  return { flow: 'ONBOARDING', step: 1, data: {}, expiresAt: Date.now() + 99999, ...overrides };
}

beforeEach(() => vi.clearAllMocks());

describe('handleStartOnboarding', () => {
  it('lists all categories and sets session', async () => {
    const replies = await handleStartOnboarding('group-1');
    expect(replies[0]!.text).toContain('食材');
    expect(replies[0]!.text).toContain('調味料');
    expect(mockSetSession).toHaveBeenCalledWith('group-1', expect.any(Object));
  });

  it('contains format instructions in the message', async () => {
    const replies = await handleStartOnboarding('group-1');
    expect(replies[0]!.text).toContain('物品名稱');
    expect(replies[0]!.text).toContain('完成');
  });
});

describe('handleOnboardingStep', () => {
  it('ends session on CONFIRM_YES intent', async () => {
    const nlu = makeNlu({ intent: 'CONFIRM_YES', rawText: '確認' });
    const replies = await handleOnboardingStep(nlu, makeSession(), 'group-1');
    expect(mockClearSession).toHaveBeenCalledWith('group-1');
    expect(replies[0]!.text).toContain('盤點完成');
  });

  it('ends session when user says 完成', async () => {
    const nlu = makeNlu({ intent: 'UNKNOWN', rawText: '完成' });
    const replies = await handleOnboardingStep(nlu, makeSession(), 'group-1');
    expect(mockClearSession).toHaveBeenCalled();
    expect(replies[0]!.text).toContain('盤點完成');
  });

  it('ends session on CONFIRM_NO intent', async () => {
    const nlu = makeNlu({ intent: 'CONFIRM_NO', rawText: '取消' });
    const replies = await handleOnboardingStep(nlu, makeSession(), 'group-1');
    expect(mockClearSession).toHaveBeenCalled();
    expect(replies[0]!.text).toContain('已取消');
  });

  it('prompts for correct format when no item entities', async () => {
    const nlu = makeNlu({ intent: 'UNKNOWN', rawText: '隨便說' });
    const replies = await handleOnboardingStep(nlu, makeSession(), 'group-1');
    expect(replies[0]!.text).toContain('物品格式');
  });

  it('warns on malformed entity (missing name/qty/unit)', async () => {
    const nlu = makeNlu({ entities: { items: [{ name: '' }] } });
    const replies = await handleOnboardingStep(nlu, makeSession(), 'group-1');
    expect(replies[0]!.text).toContain('格式不正確');
  });

  it('adds stock and advances session on valid entity', async () => {
    const nlu = makeNlu({
      entities: { items: [{ name: '白米', quantity: 5, unit: 'kg' }] },
    });
    const session = makeSession({ step: 1 });
    const replies = await handleOnboardingStep(nlu, session, 'group-1');
    expect(mockAddStock).toHaveBeenCalled();
    expect(mockSetSession).toHaveBeenCalledWith('group-1', expect.objectContaining({ step: 2 }));
    expect(replies[0]!.text).toContain('白米');
    expect(replies[0]!.text).toContain('新建立');
    expect(replies[0]!.text).toContain('繼續輸入');
  });
});
