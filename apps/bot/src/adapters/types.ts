import type { ReplyMessage } from '../handlers/intent-router.js';

export interface MessagingAdapter {
  platform: 'slack';
  push(channelId: string, messages: ReplyMessage[]): Promise<void>;
}

export type AdapterConfig = {
  adapter: MessagingAdapter;
  /** Returns the channel IDs this adapter should push cron messages to. */
  getChannelIds: () => Promise<string[]>;
};
