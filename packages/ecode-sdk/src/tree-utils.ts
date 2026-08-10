import type { RemoteTreeItem } from './type';

export type EcodeTreeItem = Omit<RemoteTreeItem, 'children'> & {
  children?: EcodeTreeItem[];
};

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

export type EcodeTreeVisit = {
  ancestors: EcodeTreeItem[];
  node: EcodeTreeItem;
  relativePath: string;
  typeAncestors: EcodeTreeItem[];
};

export function walkEcodeTree(items: EcodeTreeItem[], visitor: (visit: EcodeTreeVisit) => boolean | void): boolean {
  function visit(
    nodes: EcodeTreeItem[] | undefined,
    ancestors: EcodeTreeItem[],
    parentPath: string,
    typeAncestors: EcodeTreeItem[]
  ): boolean {
    for (const node of nodes || []) {
      if (!node || typeof node !== 'object') continue;
      const relativePath = normalizeTreePath(
        node.name ? (parentPath ? `${parentPath}/${node.name}` : node.name) : parentPath
      );
      if (visitor({ ancestors, node, relativePath, typeAncestors }) === false) return false;
      const completed = visit(
        node.children,
        ancestors.concat(node),
        relativePath,
        isTypeNode(node) ? typeAncestors.concat(node) : typeAncestors
      );
      if (!completed) return false;
    }
    return true;
  }

  return visit(items, [], '', []);
}

export function isTypeNode(item: EcodeTreeItem | undefined): boolean {
  return Boolean(item && (item.treeType === 'type' || item.businessType === 'type' || item.businessType === 'project'));
}

export type EcodeAppContext = {
  appNode: EcodeTreeItem;
  appPath: string;
  typeNodes: EcodeTreeItem[];
};

export function findAppContext(items: EcodeTreeItem[], appId: string): EcodeAppContext | undefined {
  let result: EcodeAppContext | undefined;
  walkEcodeTree(items, ({ node, relativePath, typeAncestors }) => {
    if (!result && (node.id === appId || node.initialAppId === appId)) {
      result = { appNode: node, appPath: relativePath, typeNodes: typeAncestors };
      return false;
    }
    return undefined;
  });
  return result;
}

export function findTypeChainByPath(items: EcodeTreeItem[], appPath: string): EcodeTreeItem[] {
  const segments = normalizeTreePath(appPath).split('/').filter(Boolean);
  const typeSegments = segments.slice(0, -1);
  let nodes = items;
  const chain: EcodeTreeItem[] = [];

  for (const segment of typeSegments) {
    const matchingNode = nodes.find((node) => isTypeNode(node) && node.name === segment);
    if (!matchingNode) return [];
    chain.push(matchingNode);
    nodes = matchingNode.children || [];
  }
  return chain;
}

export type EcodePathMetadata = {
  config?: boolean;
  jar?: boolean;
  resource?: boolean;
  preState?: boolean;
  node: EcodeTreeItem;
};

export function createPathMetadata(appNode: EcodeTreeItem | undefined): Map<string, EcodePathMetadata> {
  const metadata = new Map<string, EcodePathMetadata>();
  walkEcodeTree(appNode?.children || [], ({ ancestors, node, relativePath }) => {
    if (!node.name) return undefined;
    const lineage = ancestors.concat(node);
    metadata.set(relativePath, {
      config: lineage.some((item) => item.attribute === 'config' || item.attribute === 'non-code'),
      jar: lineage.some((item) => item.attribute === 'jar' || item.treeType === 'jar'),
      resource: lineage.some((item) => item.attribute === 'resource' || item.treeType === 'resource'),
      preState: node.state === 'pre-state',
      node,
    });
    return undefined;
  });
  return metadata;
}
