import type { RemoteTreeItem } from './type';

export function getEcodeAppId(item: RemoteTreeItem): string {
  const isApp = Boolean(item.initialAppId) || item.attribute === 'system';
  return isApp ? item.id || '' : '';
}

export function isTreeContainer(item: RemoteTreeItem): boolean {
  return item.treeType === 'folder' || item.businessType === 'type' || item.businessType === 'project';
}

export function normalizeTreePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}
