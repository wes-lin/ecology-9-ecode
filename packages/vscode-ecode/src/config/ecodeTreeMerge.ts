import type { EcodeLocalTreeItem } from './ecodeLocalTree';

export type EcodeTreeConflictReason =
  | 'both-modified'
  | 'local-delete-remote-modify'
  | 'remote-delete-local-modify'
  | 'remote-add-under-local-deleted-parent'
  | 'orphaned-node'
  | 'parent-cycle';

export type EcodeTreeConflict = {
  nodeId: string;
  path: string;
  reason: EcodeTreeConflictReason;
  fields?: string[];
};

export type EcodeTreeMergeResult = {
  items: EcodeLocalTreeItem[];
  conflicts: EcodeTreeConflict[];
};

type TreeEntry = {
  key: string;
  item: EcodeLocalTreeItem;
  parentKey?: string;
  index: number;
  path: string;
  childKeys: string[];
};

type MergedEntry = {
  key: string;
  item: EcodeLocalTreeItem;
  parentKey?: string;
  path: string;
  local?: TreeEntry;
  remote?: TreeEntry;
};

const ignoredFields = new Set(['children', 'hasChild']);

function cloneItemFields(item: EcodeLocalTreeItem): EcodeLocalTreeItem {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (!ignoredFields.has(key)) result[key] = value;
  }
  return result as EcodeLocalTreeItem;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildTreeIndex(items: EcodeLocalTreeItem[]): Map<string, TreeEntry> {
  const entries = new Map<string, TreeEntry>();

  const visit = (
    item: EcodeLocalTreeItem,
    parentKey: string | undefined,
    parentPath: string,
    index: number
  ): string => {
    const name = item.name || '';
    const itemPath = parentPath ? `${parentPath}/${name}` : name;
    const key = item.id ? `id:${item.id}` : `path:${itemPath}`;
    if (entries.has(key)) {
      throw new Error(`Duplicate eCode tree node key "${key}" at "${itemPath}".`);
    }

    const entry: TreeEntry = {
      key,
      item: cloneItemFields(item),
      parentKey,
      index,
      path: itemPath,
      childKeys: [],
    };
    entries.set(key, entry);
    entry.childKeys = (item.children || []).map((child, childIndex) => visit(child, key, itemPath, childIndex));
    return key;
  };

  items.forEach((item, index) => visit(item, undefined, '', index));
  return entries;
}

function snapshotSubtree(entries: Map<string, TreeEntry>, key: string): unknown {
  const entry = entries.get(key);
  if (!entry) return undefined;
  return {
    parentKey: entry.parentKey,
    item: entry.item,
    children: entry.childKeys.map((childKey) => snapshotSubtree(entries, childKey)),
  };
}

function subtreeChanged(baseline: Map<string, TreeEntry>, current: Map<string, TreeEntry>, key: string): boolean {
  return !valuesEqual(snapshotSubtree(baseline, key), snapshotSubtree(current, key));
}

function addConflict(
  conflicts: EcodeTreeConflict[],
  entry: TreeEntry,
  reason: EcodeTreeConflictReason,
  fields?: string[]
): void {
  const normalizedFields = fields?.length ? [...new Set(fields)].sort() : undefined;
  const duplicate = conflicts.some(
    (conflict) =>
      conflict.nodeId === entry.key && conflict.reason === reason && valuesEqual(conflict.fields, normalizedFields)
  );
  if (duplicate) return;
  conflicts.push({
    nodeId: entry.item.id || entry.key,
    path: entry.path,
    reason,
    fields: normalizedFields,
  });
}

function mergeValue(baseline: unknown, local: unknown, remote: unknown): { value: unknown; conflict: boolean } {
  const localChanged = !valuesEqual(local, baseline);
  const remoteChanged = !valuesEqual(remote, baseline);
  if (!localChanged) return { value: remote, conflict: false };
  if (!remoteChanged || valuesEqual(local, remote)) return { value: local, conflict: false };
  return { value: local, conflict: true };
}

function mergeItemFields(
  baseline: EcodeLocalTreeItem | undefined,
  local: EcodeLocalTreeItem,
  remote: EcodeLocalTreeItem
): { item: EcodeLocalTreeItem; conflictFields: string[] } {
  const result: Record<string, unknown> = {};
  const conflictFields: string[] = [];
  const fields = new Set([...Object.keys(baseline || {}), ...Object.keys(local), ...Object.keys(remote)]);

  for (const field of fields) {
    if (ignoredFields.has(field)) continue;
    const merged = mergeValue(
      (baseline as Record<string, unknown> | undefined)?.[field],
      (local as Record<string, unknown>)[field],
      (remote as Record<string, unknown>)[field]
    );
    if (merged.value !== undefined) result[field] = merged.value;
    if (merged.conflict) conflictFields.push(field);
  }

  return { item: result as EcodeLocalTreeItem, conflictFields };
}

function mergePresentNode(
  baseline: TreeEntry | undefined,
  local: TreeEntry,
  remote: TreeEntry,
  conflicts: EcodeTreeConflict[]
): MergedEntry {
  const mergedFields = mergeItemFields(baseline?.item, local.item, remote.item);
  const mergedParent = mergeValue(baseline?.parentKey, local.parentKey, remote.parentKey);
  if (mergedParent.conflict) mergedFields.conflictFields.push('parent');
  if (mergedFields.conflictFields.length > 0) {
    addConflict(conflicts, local, 'both-modified', mergedFields.conflictFields);
  }

  return {
    key: local.key,
    item: mergedFields.item,
    parentKey: mergedParent.value as string | undefined,
    path: local.path,
    local,
    remote,
  };
}

function entryOrder(left: MergedEntry, right: MergedEntry): number {
  if (left.local && right.local) return left.local.index - right.local.index;
  if (left.local) return -1;
  if (right.local) return 1;
  if (left.remote && right.remote) return left.remote.index - right.remote.index;
  return left.path.localeCompare(right.path);
}

function hasParentCycle(entries: Map<string, MergedEntry>, key: string): boolean {
  const visited = new Set<string>([key]);
  let parentKey = entries.get(key)?.parentKey;
  while (parentKey) {
    if (visited.has(parentKey)) return true;
    visited.add(parentKey);
    parentKey = entries.get(parentKey)?.parentKey;
  }
  return false;
}

export function mergeEcodeTrees(
  baselineItems: EcodeLocalTreeItem[],
  localItems: EcodeLocalTreeItem[],
  remoteItems: EcodeLocalTreeItem[]
): EcodeTreeMergeResult {
  const baseline = buildTreeIndex(baselineItems);
  const local = buildTreeIndex(localItems);
  const remote = buildTreeIndex(remoteItems);
  const conflicts: EcodeTreeConflict[] = [];
  const merged = new Map<string, MergedEntry>();
  const keys = new Set([...baseline.keys(), ...local.keys(), ...remote.keys()]);

  for (const key of keys) {
    const baselineEntry = baseline.get(key);
    const localEntry = local.get(key);
    const remoteEntry = remote.get(key);

    if (!baselineEntry) {
      if (localEntry && remoteEntry) {
        merged.set(key, mergePresentNode(undefined, localEntry, remoteEntry, conflicts));
      } else {
        const entry = localEntry || remoteEntry;
        if (entry) {
          merged.set(key, {
            key,
            item: cloneItemFields(entry.item),
            parentKey: entry.parentKey,
            path: entry.path,
            local: localEntry,
            remote: remoteEntry,
          });
        }
      }
      continue;
    }

    if (!localEntry && !remoteEntry) continue;

    if (!localEntry && remoteEntry) {
      if (subtreeChanged(baseline, remote, key)) {
        addConflict(conflicts, remoteEntry, 'local-delete-remote-modify');
      }
      continue;
    }

    if (localEntry && !remoteEntry) {
      if (!subtreeChanged(baseline, local, key)) continue;
      addConflict(conflicts, localEntry, 'remote-delete-local-modify');
      merged.set(key, {
        key,
        item: cloneItemFields(localEntry.item),
        parentKey: localEntry.parentKey,
        path: localEntry.path,
        local: localEntry,
      });
      continue;
    }

    if (localEntry && remoteEntry) {
      merged.set(key, mergePresentNode(baselineEntry, localEntry, remoteEntry, conflicts));
    }
  }

  let removedOrphan = true;
  while (removedOrphan) {
    removedOrphan = false;
    for (const [key, entry] of merged) {
      if (!entry.parentKey || merged.has(entry.parentKey)) continue;
      if (!entry.local && entry.remote) {
        addConflict(conflicts, entry.remote, 'remote-add-under-local-deleted-parent');
        merged.delete(key);
        removedOrphan = true;
      } else {
        addConflict(conflicts, entry.local || entry.remote!, 'orphaned-node');
        entry.parentKey = undefined;
      }
    }
  }

  for (const entry of merged.values()) {
    if (!hasParentCycle(merged, entry.key)) continue;
    addConflict(conflicts, entry.local || entry.remote!, 'parent-cycle');
    entry.parentKey = undefined;
  }

  const childrenByParent = new Map<string | undefined, MergedEntry[]>();
  for (const entry of merged.values()) {
    const siblings = childrenByParent.get(entry.parentKey) || [];
    siblings.push(entry);
    childrenByParent.set(entry.parentKey, siblings);
  }
  for (const siblings of childrenByParent.values()) siblings.sort(entryOrder);

  const buildItem = (entry: MergedEntry): EcodeLocalTreeItem => {
    const children = (childrenByParent.get(entry.key) || []).map(buildItem);
    return {
      ...entry.item,
      hasChild: children.length > 0,
      children: children.length > 0 ? children : undefined,
    };
  };

  return {
    items: (childrenByParent.get(undefined) || []).map(buildItem),
    conflicts,
  };
}
