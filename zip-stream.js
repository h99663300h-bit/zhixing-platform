// Streams a standards-compatible, uncompressed ZIP without buffering file bodies.
const fs = require('node:fs');
const { Readable } = require('node:stream');
const path = require('node:path');

const table = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let n = 0; n < 8; n++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
  return c >>> 0;
});
function crc32(crc, chunk) { for (const byte of chunk) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8); return crc >>> 0; }
function dosDate(value) {
  const d = new Date(value || Date.now());
  const year = Math.max(1980, Math.min(2107, d.getUTCFullYear()));
  return { time: ((d.getUTCHours() & 31) << 11) | ((d.getUTCMinutes() & 63) << 5) | (Math.floor(d.getUTCSeconds() / 2) & 31), date: ((year - 1980) << 9) | (((d.getUTCMonth() + 1) & 15) << 5) | (d.getUTCDate() & 31) };
}
function safeName(value) { return String(value || 'file').replace(/[\/\\\r\n\x00-\x1f]/g, '_').slice(0, 150) || 'file'; }
function streamZip(res, entries, uploadDir, archiveName) {
  if (!Array.isArray(entries) || entries.length > 50) throw new Error('Too many archive members');
  const names = new Set();
  let estimatedSize = 22;
  for (const item of entries) {
    if (!/^[0-9a-f-]{36}\.[a-z0-9]+$/.test(item.storedName)) throw new Error('Invalid stored filename');
    const name = safeName(item.name);
    if (names.has(name.toLowerCase())) throw new Error('Duplicate archive member');
    names.add(name.toLowerCase());
    const stat = fs.statSync(path.join(uploadDir, item.storedName));
    if (!stat.isFile() || stat.size > 15 * 1024 * 1024) throw new Error('Invalid archive member');
    estimatedSize += stat.size + 76 + 2 * Buffer.byteLength(name, 'utf8');
  }
  if (estimatedSize > 0xffffffff) throw new Error('Archive is too large');
  res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(safeName(archiveName) + '.zip'), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  async function* chunks() {
    let offset = 0; const central = [];
    for (const item of entries) {
      if (!/^[0-9a-f-]{36}\.[a-z0-9]+$/.test(item.storedName)) throw new Error('Invalid stored filename');
      const full = path.join(uploadDir, item.storedName);
      const stat = fs.statSync(full);
      if (!stat.isFile() || stat.size > 0xffffffff) throw new Error('Invalid archive member');
      const name = Buffer.from(safeName(item.name), 'utf8');
      const date = dosDate(item.createdAt);
      const start = offset;
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x808, 6);
      local.writeUInt16LE(0, 8); local.writeUInt16LE(date.time, 10); local.writeUInt16LE(date.date, 12);
      local.writeUInt32LE(stat.size, 18); local.writeUInt32LE(stat.size, 22); local.writeUInt16LE(name.length, 26);
      yield local; yield name; offset += local.length + name.length;
      let crc = 0xffffffff;
      for await (const part of fs.createReadStream(full)) { crc = crc32(crc, part); yield part; offset += part.length; }
      crc = (crc ^ 0xffffffff) >>> 0;
      const descriptor = Buffer.alloc(16); descriptor.writeUInt32LE(0x08074b50, 0); descriptor.writeUInt32LE(crc, 4); descriptor.writeUInt32LE(stat.size, 8); descriptor.writeUInt32LE(stat.size, 12);
      yield descriptor; offset += descriptor.length;
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x808, 8);
      header.writeUInt16LE(0, 10); header.writeUInt16LE(date.time, 12); header.writeUInt16LE(date.date, 14);
      header.writeUInt32LE(crc, 16); header.writeUInt32LE(stat.size, 20); header.writeUInt32LE(stat.size, 24);
      header.writeUInt16LE(name.length, 28); header.writeUInt32LE(start, 42);
      central.push(header, name);
    }
    const directoryOffset = offset;
    for (const item of central) { yield item; offset += item.length; }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(offset - directoryOffset, 12); end.writeUInt32LE(directoryOffset, 16); yield end;
  }
  Readable.from(chunks()).on('error', () => res.destroy()).pipe(res);
}
module.exports = { streamZip };
