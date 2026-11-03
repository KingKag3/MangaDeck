// Minimal ZIP writer (stored, no compression). Page images are already compressed, so storing them is the
// right trade and keeps this dependency-free. Limits: no ZIP64 (under 4 GB, under 65535 files).

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

export class ZipBuilder {
  private parts: Uint8Array[] = [];
  private entries: Entry[] = [];
  private offset = 0;
  private stamp = dosDateTime(new Date());

  add(name: string, data: Uint8Array) {
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
    this.push(new Uint8Array(header.buffer));
    this.push(nameBytes);
    this.push(data);
    this.entries.push(entry);
  }

  finish(): Blob {
    const cdStart = this.offset;
    for (const e of this.entries) {
      const h = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 0x02014b50, true);
      h.setUint16(4, 20, true); // made by
      h.setUint16(6, 20, true); // needed
      h.setUint16(8, 0x0800, true);
      h.setUint16(10, 0, true);
      h.setUint16(12, e.time, true);
      h.setUint16(14, e.date, true);
      h.setUint32(16, e.crc, true);
      h.setUint32(20, e.size, true);
      h.setUint32(24, e.size, true);
      h.setUint16(28, e.name.length, true);
      h.setUint32(42, e.offset, true);
      this.push(new Uint8Array(h.buffer));
      this.push(e.name);
    }
    const cdSize = this.offset - cdStart;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.entries.length, true);
    end.setUint16(10, this.entries.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, cdStart, true);
    this.push(new Uint8Array(end.buffer));
    return new Blob(this.parts as BlobPart[], { type: 'application/vnd.comicbook+zip' });
  }

  private push(part: Uint8Array) {
    this.parts.push(part);
    this.offset += part.length;
  }
}
