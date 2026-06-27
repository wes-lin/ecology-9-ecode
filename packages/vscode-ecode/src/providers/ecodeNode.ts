export type EcodeNodeType = 'folder' | 'file' | 'info';

export type EcodeNodeOptions = {
  id?: string;
  label: string;
  type: EcodeNodeType;
  treeType?: string;
  remotePath?: string;
  hasChild?: boolean;
  appId?: string;
  attribute?: string;
  deletable?: boolean;
  state?: string;
};

export type RemoteTreeItem = {
  id?: string;
  name?: string;
  treeType?: string;
  businessType?: string;
  hasChild?: boolean;
  initialAppId?: string;
  attribute?: string;
  state?: string;
};

export class EcodeNode {
  id?: string;
  label: string;
  type: EcodeNodeType;
  treeType: string;
  remotePath: string;
  hasChild: boolean;
  appId: string;
  attribute: string;
  deletable: boolean;
  state: string;
  children?: EcodeNode[];

  constructor({
    id,
    label,
    type,
    treeType = '',
    remotePath = '',
    hasChild = false,
    appId = '',
    attribute = '',
    deletable = false,
    state = '',
  }: EcodeNodeOptions) {
    this.id = id;
    this.label = label;
    this.type = type;
    this.treeType = treeType;
    this.remotePath = remotePath;
    this.hasChild = hasChild;
    this.appId = appId;
    this.attribute = attribute;
    this.deletable = deletable;
    this.state = state;
  }
}
