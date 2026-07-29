declare module '@babel/standalone' {
  type SourceType = 'script' | 'module' | 'unambiguous';
  type PluginItem = string | [string, Record<string, unknown>];

  type TransformOptions = {
    filename?: string;
    sourceType?: SourceType;
    comments?: boolean;
    compact?: boolean | 'auto';
    minified?: boolean;
    retainLines?: boolean;
    sourceMaps?: boolean;
    plugins?: PluginItem[];
    presets?: string[];
  };

  type TransformResult = {
    code?: string | null;
  };

  export function transform(source: string, options?: TransformOptions): TransformResult;
}
