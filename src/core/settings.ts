import { CHAT_KEEP_ALIVE_RANGE, QUALITY_OPTIONS, type Settings } from '../shared/types';

export function sanitizeSettings(v: unknown): Partial<Settings> {
  if (typeof v !== 'object' || v === null) return {};
  const s = v as Record<string, unknown>;
  const out: Partial<Settings> = {};
  if (typeof s.audioFollowsChat === 'boolean') out.audioFollowsChat = s.audioFollowsChat;
  if (typeof s.autoDegrade === 'boolean') out.autoDegrade = s.autoDegrade;
  if (QUALITY_OPTIONS.includes(s.maxQuality as Settings['maxQuality'])) out.maxQuality = s.maxQuality as Settings['maxQuality'];
  if (Number.isInteger(s.chatKeepAlive)) {
    const n = s.chatKeepAlive as number;
    out.chatKeepAlive = Math.min(CHAT_KEEP_ALIVE_RANGE.max, Math.max(CHAT_KEEP_ALIVE_RANGE.min, n));
  }
  return out;
}
