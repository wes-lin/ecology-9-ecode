import type { EcodeLocalTreeItem } from '../../config/ecodeLocalTree';
import { createEcodeId, createLocalNodeId } from '../../utils/localNodeId';

export function createLocalAppTree(name: string): EcodeLocalTreeItem {
  const appId = createEcodeId();
  return {
    id: appId,
    name,
    treeType: 'folder',
    hasChild: true,
    initialAppId: appId,
    status: '',
    preStateOrder: 10000,
    children: [
      {
        id: createLocalNodeId(),
        name: 'config',
        treeType: 'folder',
        attribute: 'config',
        hasChild: true,
        children: [
          createConfigFile('configLoad.js', 'config'),
          createConfigFile('configLoad_default.js', 'non-code'),
          createConfigFile('config_default.json', 'non-code', 'json'),
          createConfigFile('config.js', 'config', 'js', 'pre-state'),
          createConfigFile('config.json', 'non-code', 'json'),
          createConfigFile('config_default.js', 'non-code', 'js', 'pre-state'),
        ],
      },
      {
        id: createLocalNodeId(),
        name: 'jar',
        treeType: 'folder',
        attribute: 'jar',
        hasChild: false,
      },
      {
        id: createLocalNodeId(),
        name: 'resources',
        treeType: 'folder',
        attribute: 'resource',
        hasChild: false,
      },
    ],
  };
}

function createConfigFile(name: string, attribute: string, fileExtension = 'js', state?: string): EcodeLocalTreeItem {
  return {
    id: createLocalNodeId(),
    name,
    treeType: 'file',
    attribute,
    fileExtension,
    state,
    hasChild: false,
  };
}
