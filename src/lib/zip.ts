// Minimal ZIP writer (stored, no compression). Page images are already compressed, so storing them is the
// right trade and keeps this dependency-free. Archives may pass 4 GB and 65,535 files: the central directory then
// uses the ZIP64 extension (readers such as Komga, Kavita, Calibre, 7-Zip and modern comic readers understand it).
// One file inside is still limited to under 4 GB (a page image never comes close).
//
// With a `sink` the bytes are handed over as they are produced (e.g. to a file on disk) instead of being kept
// in memory, so big archives do not need big memory. (Without a sink the archive lives in one Blob, which browsers
// cap at roughly 2 GB, so very large archives need the sink, i.e. Chrome/Edge saving straight to disk.)

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

interface Entry {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

/** Where the plain 32-bit / 16-bit fields run out. Only tests change these, to exercise ZIP64 without 4 GB of data. */
export interface ZipLimits {
  /** An offset or size at or above this goes into a ZIP64 field. */
  big: number;
  /** This many entries or more needs the ZIP64 end record. */
  count: number;
}
const LIMITS: ZipLimits = { big: 0xffffffff, count: 0xffff };

export class ZipBuilder {
  constructor(
    private sink?: (part: Uint8Array) => Promise<void> | void,
    private limits: ZipLimits = LIMITS,
  ) {}

  private parts: Uint8Array[] = [];
  private entries: Entry[] = [];
  private offset = 0;
  private stamp = dosDateTime(new Date());

  async add(name: string, data: Uint8Array) {
    if (data.length >= 0xffffffff) throw new Error('One file inside is over 4 GB, which this .cbz writer cannot store.');
    const nameBytes = new TextEncoder().encode(name);
    const entry: Entry = { name: nameBytes, crc: crc32(data), size: data.length, offset: this.offset, ...this.stamp };
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true); // version needed
    header.setUint16(6, 0x0800, true); // UTF-8 names
    header.setUint16(8, 0, true); // stored
    header.setUint16(10, entry.time, true);
    header.setUint16(12, entry.date, true);
    header.setUint32(14, entry.crc, true);
    header.setUint32(18, entry.size, true);
    header.setUint32(22, entry.size, true);
    header.setUint16(26, nameBytes.length, true);
    header.setUint16(28, 0, true);
    await this.push(new Uint8Array(header.buffer));
    await this.push(nameBytes);
    await this.push(data);
    this.entries.push(entry);
  }

  /** Writes the central directory. Returns the archive, or null when a sink took the bytes. */
  async finish(): Promise<Blob | null> {
    const { big, count } = this.limits;
    const cdStart = this.offset;
    for (const e of this.entries) {
      const far = e.offset >= big; // this entry's offset needs the ZIP64 extra field (8 bytes + 4 byte header)
      const h = new DataView(new ArrayBuffer(46 + (far ? 12 : 0)));
      h.setUint32(0, 0x02014b50, true);
      h.setUint16(4, far ? 45 : 20, true); // made by
      h.setUint16(6, far ? 45 : 20, true); // needed
      h.setUint16(8, 0x0800, true);
      h.setUint16(10, 0, true);
      h.setUint16(12, e.time, true);
      h.setUint16(14, e.date, true);
      h.setUint32(16, e.crc, true);
      h.setUint32(20, e.size, true);
      h.setUint32(24, e.size, true);
      h.setUint16(28, e.name.length, true);
      h.setUint16(30, far ? 12 : 0, true); // extra field length
      h.setUint32(42, far ? 0xffffffff : e.offset, true);
      if (far) {
        h.setUint16(46, 0x0001, true); // ZIP64 extended information
        h.setUint16(48, 8, true);
        h.setBigUint64(50, BigInt(e.offset), true);
      }
      // The name sits between the fixed part and the extra field.
      const fixed = new Uint8Array(h.buffer, 0, 46);
      await this.push(fixed.slice());
      await this.push(e.name);
      if (far) await this.push(new Uint8Array(h.buffer, 46, 12).slice());
    }
    const cdSize = this.offset - cdStart;
    const zip64 = this.entries.length >= count || cdStart >= big || cdSize >= big;
    if (zip64) {
      const recordAt = this.offset;
      const rec = new DataView(new ArrayBuffer(56));
      rec.setUint32(0, 0x06064b50, true);
      rec.setBigUint64(4, 44n, true); // size of the rest of this record
      rec.setUint16(12, 45, true);
      rec.setUint16(14, 45, true);
      rec.setUint32(16, 0, true); // this disk
      rec.setUint32(20, 0, true); // disk with the central directory
      rec.setBigUint64(24, BigInt(this.entries.length), true);
      rec.setBigUint64(32, BigInt(this.entries.length), true);
      rec.setBigUint64(40, BigInt(cdSize), true);
      rec.setBigUint64(48, BigInt(cdStart), true);
      await this.push(new Uint8Array(rec.buffer));
      const loc = new DataView(new ArrayBuffer(20));
      loc.setUint32(0, 0x07064b50, true);
      loc.setUint32(4, 0, true);
      loc.setBigUint64(8, BigInt(recordAt), true);
      loc.setUint32(16, 1, true); // total disks
      await this.push(new Uint8Array(loc.buffer));
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, zip64 ? 0xffff : this.entries.length, true);
    end.setUint16(10, zip64 ? 0xffff : this.entries.length, true);
    end.setUint32(12, zip64 ? 0xffffffff : cdSize, true);
    end.setUint32(16, zip64 ? 0xffffffff : cdStart, true);
    await this.push(new Uint8Array(end.buffer));
    if (this.sink) return null;
    return new Blob(this.parts as BlobPart[], { type: 'application/vnd.comicbook+zip' });
  }

  private async push(part: Uint8Array) {
    this.offset += part.length;
    if (this.sink) await this.sink(part);
    else this.parts.push(part);
  }
}
