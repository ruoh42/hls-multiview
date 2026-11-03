import { app, session, shell } from 'electron';

export const CHZZK_PARTITION = 'persist:chzzk';

export const isNaverUrl = (url: string) => {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && /(^|\.)naver\.(com|net)$/.test(hostname);
  } catch {
    return false;
  }
};

export function openExternal(url: string): void {
  if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
}

function cleanUserAgent(ua: string): string {
  return ua.replace(/ (?!AppleWebKit\/|Chrome\/|Safari\/|Version\/)[A-Za-z][\w.-]*\/[\w.]+/g, '');
}

export function setupChzzkSession(): void {
  app.userAgentFallback = cleanUserAgent(app.userAgentFallback);
  const ses = session.fromPartition(CHZZK_PARTITION);
  ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));
}

export async function fetchLiveJson(url: string): Promise<unknown> {
  const res = await session.fromPartition(CHZZK_PARTITION).fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
