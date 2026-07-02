export type EcodeNodeType = 'folder' | 'file' | 'info';

export type EcodeNodeOptions = {
  id?: string;
  label: string;
  type: EcodeNodeType;
  treeType?: string;
  businessType?: string;
  parent?: EcodeNode;
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
  loading?: boolean;
  debugMode?: 'y' | 'n';
};

export class EcodeNode {
  id?: string;
  label: string;
  type: EcodeNodeType;
  treeType = '';
  businessType = '';
  parent?: EcodeNode;
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
  loading = false;
  debugMode?: 'y' | 'n';
  children?: EcodeNode[];

  constructor(options: EcodeNodeOptions) {
    this.label = options.label;
    this.type = options.type;
    Object.assign(this, options);
  }
}
