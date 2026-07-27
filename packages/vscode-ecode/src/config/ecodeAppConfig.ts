export type EcodeAppConfig = {
  path: string;
  appId: string;
  typeId: string;
  appStatus: string;
  appPreStateOrder: number;
  preStateFiles: string[];
  resources: string[];
  configs: string[];
  debugMode?: 'y' | 'n';
};
