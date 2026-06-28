export type EcodeNodeType = 'folder' | 'file' | 'info';

export type EcodeNodeOptions = {
  id?: string;
  label: string;
  type: EcodeNodeType;
  treeType?: string;
  remotePath?: string;
  route?: string;
  hasChild?: boolean;
  appId?: string;
  attribute?: string;
  deletable?: boolean;
  state?: string;
  appStatus?: string;
  appPreStateOrder?: number;
  fileExtension?: string;
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
  status?: string;
  preStateOrder?: number;
  fileExtension?: string;
  route?: string;
};

export class EcodeNode {
  id?: string;
  label: string;
  type: EcodeNodeType;
  treeType = '';
  remotePath = '';
  route = '';
  hasChild = false;
  appId = '';
  attribute = '';
  deletable = false;
  state = '';
  appStatus?: string;
  appPreStateOrder?: number;
  fileExtension?: string;
  children?: EcodeNode[];

  constructor(options: EcodeNodeOptions) {
    this.label = options.label;
    this.type = options.type;
    Object.assign(this, options);
  }
}
