# ecode-sdk

JavaScript SDK for Ecology 9 ecode APIs.

## API

### `EcodeClient`

```js
const { EcodeClient } = require('ecode-sdk');

const client = new EcodeClient({
  baseUrl: 'http://your-ecology-server',
  username: 'sysadmin',
  password: 'your-password',
});

await client.login();
const tree = await client.listTree();
const result = await client.download('/path/to/project');
await client.uploadFile('/local/path.js', 'remote-folder-id');
```

### Download

`client.download(outputRoot)` loads the complete remote tree, downloads source
files to `<outputRoot>/src`, and generates
`<outputRoot>/.ecode/ecode-tree.json`.

Existing source files are kept by default. Pass `{ overwrite: true }` to
replace them. Integrations can use `prepareTree` to merge the new remote tree
with local metadata before selecting the remote paths that should be
materialized:

```js
const result = await client.download('/path/to/project', {
  prepareTree: async (remoteTree) => {
    const filePaths = await mergeWithLocalTree(remoteTree);
    return { filePaths };
  },
});

console.log(result.downloaded, result.skipped, result.failed);
```

### JavaScript compiler

The SDK compiles browser-side JavaScript and JSX with the legacy eCode Babel
toolchain (Babel standalone 7.5.5). It uses the classic JSX runtime, so the
generated code continues to use the global `React.createElement`.

```js
const path = require('node:path');
const { compileJavaScript, compileJavaScriptFile } = require('ecode-sdk');

const code = compileJavaScript('const view = <div>Hello</div>;');

const fileCode = await compileJavaScriptFile(path.resolve('index.test.js'));
// Returns the compiled content without writing an output file.
```

The compiler uses the legacy `es2015`, `react`, and `transform-instanceof`
configuration. Pass `sourceType`, `comments`, `compact`, `minified`, or
`retainLines` to override output options. Project Babel configuration files do
not affect the standalone compiler, so output stays deterministic.

## Notes

The SDK uses the modern Node.js global `fetch` API plus `form-data` for uploads. It maintains a cookie jar automatically, so `login()` stores the session cookie and subsequent requests carry it automatically. The actual endpoint paths (`/api/ecode/*`) are placeholders and should be replaced with the real ecode API routes once known.
