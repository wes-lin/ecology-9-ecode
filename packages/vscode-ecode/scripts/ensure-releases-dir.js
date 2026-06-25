const fs = require('node:fs');
const path = require('node:path');

const releasesPath = path.resolve(__dirname, '..', 'releases');

fs.mkdirSync(releasesPath, { recursive: true });
