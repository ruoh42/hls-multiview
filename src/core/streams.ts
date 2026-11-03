import type { StreamStatus, Tile } from '../shared/types';
import type { Rect } from './layout';
import { LiveInfoService, type JsonFetcher } from './live';

interface StreamEntry {
  channelId: string;
  rect: Rect | null;
  muted: boolean;
  sleeping: boolean;
  pinned: boolean;
  seq: number;
}

interface TileContext {
  origin: { x: number; y: number };
  mainChannel: string | null;
  chatChannel: string | null;
  focusLayout: boolean;
  qualityPenalty: number;
  maxQuality: number;
}

export class StreamManager {
  private entries = new Map<string, StreamEntry>();
  private live: LiveInfoService;

  constructor(
    fetchJson: JsonFetcher,
    private onChange: () => void,
  ) {
    this.live = new LiveInfoService(fetchJson, () => this.onChange());
  }

  stop(): void {
    this.live.stop();
  }

  sync(channelIds: string[]): void {
    const keep = new Set(channelIds);
    for (const id of [...this.entries.keys()]) if (!keep.has(id)) this.entries.delete(id);
    for (const channelId of channelIds) {
      if (!this.entries.has(channelId)) {
        this.entries.set(channelId, { channelId, rect: null, muted: true, sleeping: false, pinned: false, seq: 0 });
      }
    }
    this.live.track(channelIds);
  }

  layout(channelIds: string[], rects: Rect[]): void {
    channelIds.forEach((id, i) => {
      const entry = this.entries.get(id);
      if (entry) entry.rect = rects[i] ?? null;
    });
  }

  info(channelId: string) {
    const entry = this.entries.get(channelId);
    const live = this.live.get(channelId);
    return {
      name: live?.name ?? null,
      title: live?.title ?? null,
      status: entry ? this.statusOf(entry) : ('loading' as const),
      muted: entry?.muted ?? true,
    };
  }

  tiles(order: string[], ctx: TileContext): Tile[] {
    const tiles: Tile[] = [];
    for (const channelId of order) {
      const entry = this.entries.get(channelId);
      if (!entry?.rect) continue;
      const live = this.live.get(channelId);
      const status = this.statusOf(entry);
      const isMain = channelId === ctx.mainChannel;
      tiles.push({
        channelId,
        x: entry.rect.x - ctx.origin.x,
        y: entry.rect.y - ctx.origin.y,
        width: entry.rect.width,
        height: entry.rect.height,
        name: live?.name ?? null,
        status,
        url: status === 'live' ? live!.url : null,
        seq: entry.seq,
        muted: entry.muted,
        isMain,
        selected: channelId === ctx.chatChannel,
        promoteOnClick: ctx.focusLayout && !isMain,
        qualityPenalty: isMain ? 0 : ctx.qualityPenalty,
        maxQuality: ctx.maxQuality,
      });
    }
    return tiles;
  }

  setMuted(channelId: string, muted: boolean): void {
    const entry = this.entries.get(channelId);
    if (!entry) return;
    entry.muted = muted;
    this.onChange();
  }

  soloAudio(channelId: string): void {
    for (const entry of this.entries.values()) entry.muted = entry.channelId !== channelId;
    this.onChange();
  }

  reload(channelId: string): void {
    const entry = this.entries.get(channelId);
    if (!entry) return;
    if (entry.sleeping) return this.wake(channelId);
    entry.seq++;
    this.live.refresh(channelId);
    this.onChange();
  }

  refreshAll(): void {
    this.live.refreshAll();
  }

  playerProblem(channelId: string): void {
    if (!this.entries.has(channelId)) return;
    this.live.refresh(channelId);
  }

  wake(channelId: string): void {
    const entry = this.entries.get(channelId);
    if (!entry?.sleeping) return;
    entry.sleeping = false;
    entry.pinned = true;
    this.onChange();
  }

  sleepOne(protect: Set<string>, order: string[]): boolean {
    const rank = (e: StreamEntry) => order.indexOf(e.channelId);
    const target = [...this.entries.values()]
      .filter((e) => !e.sleeping && !e.pinned && !protect.has(e.channelId) && e.rect && this.live.get(e.channelId)?.state === 'live')
      .sort((a, b) => area(a) - area(b) || rank(b) - rank(a))[0];
    if (!target) return false;
    target.sleeping = true;
    this.onChange();
    return true;
  }

  wakeOne(order: string[]): boolean {
    const rank = (e: StreamEntry) => order.indexOf(e.channelId);
    const target = [...this.entries.values()]
      .filter((e) => e.sleeping && e.rect)
      .sort((a, b) => area(b) - area(a) || rank(a) - rank(b))[0];
    if (!target) return false;
    target.sleeping = false;
    this.onChange();
    return true;
  }

  sleepingCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.sleeping) n++;
    return n;
  }

  private statusOf(entry: StreamEntry): StreamStatus {
    const live = this.live.get(entry.channelId);
    if (!live) return 'loading';
    if (live.state === 'live' && entry.sleeping) return 'sleeping';
    return live.state;
  }
}

const area = (e: StreamEntry) => (e.rect ? e.rect.width * e.rect.height : 0);
