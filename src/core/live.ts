const LIVE_API = (channelId: string) => `https://api.chzzk.naver.com/service/v3/channels/${channelId}/live-detail`;

export type JsonFetcher = (url: string) => Promise<unknown>;

type LiveState = 'live' | 'offline' | 'restricted' | 'error';

interface LiveInfo {
  state: LiveState;
  name: string | null;
  title: string | null;
  url: string | null;
  fetchedAt: number;
}

const LIVE_REFRESH_MS = 3 * 60_000;
const OFFLINE_REFRESH_MS = 60_000;
const ERROR_RETRY_MS = 30_000;
const URL_MAX_AGE_MS = 12 * 60 * 60_000;
const MIN_INTERVAL_MS = 10_000;
const CONCURRENCY = 4;

async function fetchLive(fetchJson: JsonFetcher, channelId: string): Promise<LiveInfo> {
  const body = (await fetchJson(LIVE_API(channelId))) as { content?: Record<string, unknown> | null };
  const c = body.content;
  const now = Date.now();
  if (!c) return { state: 'offline', name: null, title: null, url: null, fetchedAt: now };

  const name = ((c.channel as { channelName?: string } | undefined)?.channelName ?? null) || null;
  const title = (c.liveTitle as string | undefined) ?? null;
  if (c.status !== 'OPEN') return { state: 'offline', name, title, url: null, fetchedAt: now };

  let url: string | null = null;
  try {
    const playback = JSON.parse((c.livePlaybackJson as string) || '{}') as { media?: { mediaId: string; path: string }[] };
    const media = playback.media ?? [];
    url = (media.find((m) => m.mediaId === 'LLHLS') ?? media.find((m) => m.mediaId === 'HLS'))?.path ?? null;
  } catch {
    url = null;
  }
  return { state: url ? 'live' : 'restricted', name, title, url, fetchedAt: now };
}

export class LiveInfoService {
  private info = new Map<string, LiveInfo>();
  private due = new Map<string, number>();
  private inFlight = new Set<string>();
  private lastRequest = new Map<string, number>();
  private wantNewUrl = new Set<string>();
  private timer: ReturnType<typeof setInterval>;

  constructor(
    private fetchJson: JsonFetcher,
    private onChange: (channelId: string) => void,
  ) {
    this.timer = setInterval(() => this.pump(), 1000);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  get(channelId: string): LiveInfo | undefined {
    return this.info.get(channelId);
  }

  track(channelIds: string[]): void {
    const keep = new Set(channelIds);
    for (const id of [...this.due.keys()]) {
      if (!keep.has(id)) {
        this.due.delete(id);
        this.info.delete(id);
        this.wantNewUrl.delete(id);
      }
    }
    for (const id of channelIds) if (!this.due.has(id)) this.due.set(id, 0);
    this.pump();
  }

  refresh(channelId: string): void {
    if (!this.due.has(channelId)) return;
    this.wantNewUrl.add(channelId);
    const last = this.lastRequest.get(channelId) ?? 0;
    this.due.set(channelId, Math.max(Date.now(), last + MIN_INTERVAL_MS));
  }

  refreshAll(): void {
    for (const id of this.due.keys()) this.refresh(id);
  }

  private pump(): void {
    const now = Date.now();
    const ready = [...this.due.entries()]
      .filter(([id, at]) => at <= now && !this.inFlight.has(id))
      .sort((a, b) => a[1] - b[1]);
    for (const [id] of ready) {
      if (this.inFlight.size >= CONCURRENCY) break;
      void this.load(id);
    }
  }

  private async load(channelId: string): Promise<void> {
    this.inFlight.add(channelId);
    this.lastRequest.set(channelId, Date.now());
    let next: LiveInfo;
    try {
      next = await fetchLive(this.fetchJson, channelId);
    } catch (err) {
      const prev = this.info.get(channelId);
      console.warn('[live] 조회 실패', channelId, String(err));
      next = prev ?? { state: 'error', name: null, title: null, url: null, fetchedAt: Date.now() };
      this.due.set(channelId, Date.now() + ERROR_RETRY_MS);
      this.inFlight.delete(channelId);
      if (!prev) this.emit(channelId, next);
      return;
    }
    this.inFlight.delete(channelId);
    if (!this.due.has(channelId)) return;

    const wait = next.state === 'live' ? LIVE_REFRESH_MS : OFFLINE_REFRESH_MS;
    this.due.set(channelId, Date.now() + wait * (0.8 + Math.random() * 0.4));
    this.emit(channelId, next);
  }

  private emit(channelId: string, next: LiveInfo): void {
    const prev = this.info.get(channelId);
    const forceNew = this.wantNewUrl.delete(channelId);
    if (!forceNew && prev?.url && next.url && prev.state === 'live' && next.state === 'live' && Date.now() - prev.fetchedAt < URL_MAX_AGE_MS) {
      next = { ...next, url: prev.url, fetchedAt: prev.fetchedAt };
    }
    this.info.set(channelId, next);
    if (forceNew || !prev || prev.state !== next.state || prev.name !== next.name || prev.title !== next.title || prev.url !== next.url) {
      this.onChange(channelId);
    }
  }
}
