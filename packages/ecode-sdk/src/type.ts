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
  debugMode?: 'y' | 'n';
};
