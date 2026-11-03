const CHANNEL_ID = /^[0-9a-f]{32}$/i;

export const isChannelId = (s: string) => CHANNEL_ID.test(s);

export function parseChannelInput(input: string): string | null {
  const text = input.trim();
  if (CHANNEL_ID.test(text)) return text.toLowerCase();

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.hostname !== 'chzzk.naver.com') return null;

  const parts = url.pathname.split('/').filter(Boolean);
  const candidate = parts[0] === 'live' ? parts[1] : parts[0];
  return candidate && CHANNEL_ID.test(candidate) ? candidate.toLowerCase() : null;
}
