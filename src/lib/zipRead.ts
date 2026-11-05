// Minimal ZIP reader: lists the entries of an archive and returns their stored bytes, so pages can be copied into a
// new archive without being decompressed (see merge.ts). Reads only the parts it needs with Blob.slice, so a
// multi-gigabyte .cbz is never held in memory. Understands ZIP64. Only stored (0) and deflate (8) data is accepted.

export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate. Anything else cannot be copied safely. */
  method: number;
  flags: number;
  crc: number;
  /** Size as stored in the archive. */
  csize: number;
  /** Uncompressed size. */
  size: number;
  /** Where the entry's local header starts. */
  offset: number;
}

const bytes = async (b: Blob, start: number, end: number) => new Uint8Array(await b.slice(start, end).arrayBuffer());

export async function readZip(file: Blob): Promise<ZipEntry[]> {
  if (file.size < 22) throw new Error('This is not a zip / .cbz file.');
  const tailStart = Math.max(0, file.size - (65535 + 22));
  const tail = await bytes(file, tailStart, file.size);
  const tv = new DataView(tail.buffer);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This is not a zip / .cbz file (no end record found).');
  let count = tv.getUint16(eocd + 10, true);
  let cdSize = tv.getUint32(eocd + 12, true);
  let cdOffset = tv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    if (eocd < 20 || tv.getUint32(eocd - 20, true) !== 0x07064b50) throw new Error('Damaged zip: ZIP64 locator is missing.');
    const recAt = Number(tv.getBigUint64(eocd - 20 + 8, true));
    const rec = new DataView((await bytes(file, recAt, recAt + 56)).buffer);
    if (rec.getUint32(0, true) !== 0x06064b50) throw new Error('Damaged zip: ZIP64 end record is missing.');
    count = Number(rec.getBigUint64(32, true));
    cdSize = Number(rec.getBigUint64(40, true));
    cdOffset = Number(rec.getBigUint64(48, true));
  }
  const cdBytes = await bytes(file, cdOffset, cdOffset + cdSize);
  const cd = new DataView(cdBytes.buffer);
  const dec = new TextDecoder('utf-8');
  const out: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cdBytes.length || cd.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged zip: bad directory entry.');
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    const crc = cd.getUint32(p + 16, true);
    let csize = cd.getUint32(p + 20, true);
    let size = cd.getUint32(p + 24, true);
    const nlen = cd.getUint16(p + 28, true);
    const elen = cd.getUint16(p + 30, true);
    const clen = cd.getUint16(p + 32, true);
    let offset = cd.getUint32(p + 42, true);
    const name = dec.decode(cdBytes.subarray(p + 46, p + 46 + nlen));
    // ZIP64 extra field: only the values that were set to 0xffffffff are present, in this order.
    let e = p + 46 + nlen;
    const eEnd = e + elen;
    while (e + 4 <= eEnd) {
      const id = cd.getUint16(e, true);
      const len = cd.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) (size = Number(cd.getBigUint64(q, true))), (q += 8);
        if (csize === 0xffffffff) (csize = Number(cd.getBigUint64(q, true))), (q += 8);
        if (offset === 0xffffffff) offset = Number(cd.getBigUint64(q, true));
      }
      e += 4 + len;
    }
    out.push({ name, method, flags, crc, csize, size, offset });
    p += 46 + nlen + elen + clen;
  }
  return out;
}

/** The entry's bytes as stored in the archive (compressed when method is 8). */
export async function readRaw(file: Blob, e: ZipEntry): Promise<Uint8Array> {
  if (e.flags & 1) throw new Error(`"${e.name}" is encrypted.`);
  const head = new DataView((await bytes(file, e.offset, e.offset + 30)).buffer);
  if (head.getUint32(0, true) !== 0x04034b50) throw new Error(`Damaged zip: bad header for "${e.name}".`);
  const start = e.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
  return bytes(file, start, start + e.csize);
}

/** The entry's real content (decompressed). Meant for small files such as ComicInfo.xml. */
export async function readContent(file: Blob, e: ZipEntry): Promise<Uint8Array> {
  const raw = await readRaw(file, e);
  if (e.method === 0) return raw;
  if (e.method !== 8) throw new Error(`"${e.name}" uses a compression method this reader does not support.`);
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
