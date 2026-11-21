import fs from 'node:fs';
import path from 'node:path';

/**
 * Read a single file out of an Electron asar archive (or its .unpacked sibling).
 * Returns a Buffer if found, or null if the archive/entry does not exist.
 */
export function readAsarFile(asarPath, relPath) {
  if (!asarPath || !relPath || !fs.existsSync(asarPath)) {
    return null;
  }

  const parts = String(relPath)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  let fd;
  try {
    fd = fs.openSync(asarPath, 'r');
    const sizeBuf = Buffer.alloc(8);
    if (fs.readSync(fd, sizeBuf, 0, 8, 0) < 8) {
      return null;
    }

    const headerSize = sizeBuf.readUInt32LE(4);
    const headerBuf = Buffer.alloc(headerSize);
    if (fs.readSync(fd, headerBuf, 0, headerSize, 8) < headerSize) {
      return null;
    }

    const jsonLen = headerBuf.readUInt32LE(4);
    const header = JSON.parse(headerBuf.subarray(8, 8 + jsonLen).toString('utf8'));

    let cur = header;
    for (const seg of parts) {
      if (!cur?.files || !Object.hasOwn(cur.files, seg)) {
        return null;
      }
      cur = cur.files[seg];
    }

    if (!cur || cur.files) {
      return null;
    }

    if (cur.unpacked) {
      const unpackedPath = path.join(`${asarPath}.unpacked`, ...parts);
      return fs.existsSync(unpackedPath) ? fs.readFileSync(unpackedPath) : null;
    }

    if (cur.offset === undefined || cur.size === undefined) {
      return null;
    }

    const size = Number(cur.size);
    const offset = Number(cur.offset);
    if (!Number.isFinite(size) || !Number.isFinite(offset) || size < 0 || offset < 0) {
      return null;
    }

    const out = Buffer.alloc(size);
    let readTotal = 0;
    const baseOffset = 8 + headerSize + offset;
    while (readTotal < size) {
      const n = fs.readSync(fd, out, readTotal, size - readTotal, baseOffset + readTotal);
      if (n <= 0) break;
      readTotal += n;
    }
    return readTotal === size ? out : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
  }
}
