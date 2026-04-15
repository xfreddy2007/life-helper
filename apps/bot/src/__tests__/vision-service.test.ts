import { describe, it, expect, vi } from 'vitest';
import { VisionService } from '../services/vision.service.js';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              items: [
                { receiptName: '白米', quantity: 2, unit: '袋' },
                { receiptName: '橄欖油', quantity: 1, unit: '瓶', expiryDate: '2027-06-30' },
              ],
            }),
          },
        ],
      }),
    },
  })),
}));

describe('VisionService.recognizeReceipt', () => {
  it('calls Claude and returns parsed items', async () => {
    const service = new VisionService('sk-test');
    const result = await service.recognizeReceipt('base64data', 'image/jpeg');
    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.receiptName).toBe('白米');
    expect(result.items[1]!.expiryDate).toBe('2027-06-30');
  });

  it('returns empty items when Claude returns empty text', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    vi.mocked(Anthropic).mockImplementationOnce(
      () =>
        ({
          messages: {
            create: vi.fn().mockResolvedValue({ content: [] }),
          },
        }) as never,
    );
    const service = new VisionService('sk-test');
    const result = await service.recognizeReceipt('base64data', 'image/png');
    expect(result.items).toHaveLength(0);
  });
});
