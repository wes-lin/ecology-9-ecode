declare module '@babel/standalone' {
  type SourceType = 'script' | 'module' | 'unambiguous';

  type TransformOptions = {
    filename?: string;
    sourceType?: SourceType;
    comments?: boolean;
    compact?: boolean | 'auto';
    minified?: boolean;
    retainLines?: boolean;
    sourceMaps?: boolean;
    plugins?: string[];
    presets?: string[];
  };

  type TransformResult = {
    code?: string | null;
  };

  export function transform(source: string, options?: TransformOptions): TransformResult;
}
