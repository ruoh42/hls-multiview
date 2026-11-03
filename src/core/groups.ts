import type { Group, LayoutMode, ViewScope } from '../shared/types';

export interface GroupsSnapshot {
  groups: Group[];
  scope: ViewScope;
  layout: LayoutMode;
  mainChannel: string | null;
}

const MAX_NAME_LENGTH = 30;
const newId = () => 'g-' + Math.random().toString(36).slice(2, 10).padEnd(8, '0');

export class GroupsModel {
  groups: Group[] = [{ id: 'default', name: '기본', channelIds: [] }];
  scope: ViewScope = { kind: 'all' };
  layout: LayoutMode = 'grid';
  mainChannel: string | null = null;

  snapshot(): GroupsSnapshot {
    return {
      groups: this.groups.map((g) => ({ ...g, channelIds: [...g.channelIds] })),
      scope: this.scope,
      layout: this.layout,
      mainChannel: this.mainChannel,
    };
  }

  restore(s: Partial<GroupsSnapshot>): void {
    if (s.groups?.length) this.groups = s.groups;
    this.layout = s.layout ?? 'grid';
    this.mainChannel = s.mainChannel ?? null;
    this.setScope(s.scope ?? { kind: 'all' });
  }

  private selected(): Group[] {
    const scope = this.scope;
    if (scope.kind === 'all') return this.groups;
    return this.groups.filter((g) => scope.groupIds.includes(g.id));
  }

  visibleChannels(): string[] {
    return [...new Set(this.selected().flatMap((g) => g.channelIds))];
  }

  orderedChannels(): string[] {
    const ids = this.visibleChannels();
    if (this.layout !== 'focus') return ids;
    const main = this.currentMain(ids);
    return main ? [main, ...ids.filter((id) => id !== main)] : ids;
  }

  currentMain(ids = this.visibleChannels()): string | null {
    return this.mainChannel && ids.includes(this.mainChannel) ? this.mainChannel : (ids[0] ?? null);
  }

  focusedMain(): string | null {
    return this.layout === 'focus' ? this.currentMain() : null;
  }

  addChannel(channelId: string): 'added' | 'duplicate' {
    const target = this.selected()[0] ?? this.groups[0];
    if (target.channelIds.includes(channelId)) return 'duplicate';
    target.channelIds.push(channelId);
    return 'added';
  }

  removeChannel(channelId: string): void {
    for (const g of this.selected()) {
      g.channelIds = g.channelIds.filter((id) => id !== channelId);
    }
  }

  setScope(scope: ViewScope): void {
    if (scope.kind === 'all') {
      this.scope = scope;
      return;
    }
    const ids = scope.groupIds.filter((id) => this.groups.some((g) => g.id === id));
    this.scope = ids.length ? { kind: 'groups', groupIds: ids } : { kind: 'all' };
  }

  createGroup(): Group {
    const names = new Set(this.groups.map((g) => g.name));
    let n = this.groups.length + 1;
    while (names.has(`그룹 ${n}`)) n++;
    const group: Group = { id: newId(), name: `그룹 ${n}`, channelIds: [] };
    this.groups.push(group);
    return group;
  }

  renameGroup(groupId: string, name: string): boolean {
    const group = this.groups.find((g) => g.id === groupId);
    const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
    if (!group || !trimmed) return false;
    group.name = trimmed;
    return true;
  }

  deleteGroup(groupId: string): boolean {
    if (this.groups.length <= 1) return false;
    const before = this.groups.length;
    this.groups = this.groups.filter((g) => g.id !== groupId);
    this.setScope(this.scope);
    return this.groups.length < before;
  }

  group(groupId: string): Group | undefined {
    return this.groups.find((g) => g.id === groupId);
  }

  setMembership(channelId: string, groupId: string, member: boolean): void {
    const group = this.group(groupId);
    if (!group) return;
    const has = group.channelIds.includes(channelId);
    if (member && !has) group.channelIds.push(channelId);
    if (!member && has) group.channelIds = group.channelIds.filter((id) => id !== channelId);
  }
}

export function toggleScope(scope: ViewScope, groupId: string): ViewScope {
  if (scope.kind === 'all') return { kind: 'groups', groupIds: [groupId] };
  const ids = scope.groupIds.includes(groupId) ? scope.groupIds.filter((id) => id !== groupId) : [...scope.groupIds, groupId];
  return ids.length ? { kind: 'groups', groupIds: ids } : { kind: 'all' };
}
