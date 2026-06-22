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
const tree = await client.listTree('/');
const buffer = await client.downloadFile('/path/to/file.js');
await client.uploadFile('/local/path.js', '/remote/path.js');
```

## Notes

The SDK uses the modern Node.js global `fetch` API plus `form-data` for uploads. It maintains a cookie jar automatically, so `login()` stores the session cookie and subsequent requests carry it automatically. The actual endpoint paths (`/api/ecode/*`) are placeholders and should be replaced with the real ecode API routes once known.
