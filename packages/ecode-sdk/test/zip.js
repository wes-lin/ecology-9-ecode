const fs = require('node:fs');
const { inflateRawSync } = require('node:zlib');

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

function parseZipEntries(source) {
  const buffer = Buffer.isBuffer(source) ? source : fs.readFileSync(source);
  const minimumOffset = Math.max(0, buffer.length - 65557);
  let endOffset = -1;

  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error('Invalid ZIP archive: central directory was not found.');

  const entryCount = buffer.readUInt16LE(endOffset + 10);
  let offset = buffer.readUInt32LE(endOffset + 16);
  const entries = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('Invalid ZIP archive: malformed central directory.');
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    entries.push({
      compressedSize: buffer.readUInt32LE(offset + 20),
      compressionMethod: buffer.readUInt16LE(offset + 10),
      localHeaderOffset: buffer.readUInt32LE(offset + 42),
      name: buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'),
      uncompressedSize: buffer.readUInt32LE(offset + 24),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { buffer, entries };
}

function listZipEntries(source) {
  return parseZipEntries(source).entries.map((entry) => entry.name);
}

function readZipEntry(source, entryName) {
  const archive = parseZipEntries(source);
  const entry = archive.entries.find((candidate) => candidate.name === entryName);
  if (!entry) throw new Error(`ZIP entry not found: ${entryName}`);
  const offset = entry.localHeaderOffset;
  if (archive.buffer.readUInt32LE(offset) !== LOCAL_FILE_SIGNATURE) {
    throw new Error(`Invalid ZIP local header for ${entryName}.`);
  }
  const nameLength = archive.buffer.readUInt16LE(offset + 26);
  const extraLength = archive.buffer.readUInt16LE(offset + 28);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const compressed = archive.buffer.subarray(dataOffset, dataOffset + entry.compressedSize);
  let contents;

  if (entry.compressionMethod === 0) contents = compressed;
  else if (entry.compressionMethod === 8) contents = inflateRawSync(compressed);
  else throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod}.`);

  if (contents.length !== entry.uncompressedSize) {
    throw new Error(`Invalid ZIP entry size for ${entryName}.`);
  }
  return contents;
}

module.exports = { listZipEntries, readZipEntry };
