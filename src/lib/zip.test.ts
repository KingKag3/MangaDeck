import { describe, expect, it } from 'vitest';
import { ZipBuilder, crc32 } from './zip';

const enc = (s: string) => new TextEncoder().encode(s);

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(enc('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('ZipBuilder', () => {
  it('writes a readable central directory', async () => {
    const z = new ZipBuilder();
    await z.add('a.txt', enc('hello'));
    await z.add('dir/ü.txt', enc('world!'));
    const buf = new DataView(await (await z.finish())!.arrayBuffer());

    const eocd = buf.byteLength - 22;
    expect(buf.getUint32(eocd, true)).toBe(0x06054b50);
    expect(buf.getUint16(eocd + 10, true)).toBe(2);

    // First central entry points at the first local header, with the right size and CRC.
    const cd = buf.getUint32(eocd + 16, true);
    expect(buf.getUint32(cd, true)).toBe(0x02014b50);
    expect(buf.getUint32(cd + 16, true)).toBe(crc32(enc('hello')));
    expect(buf.getUint32(cd + 24, true)).toBe(5);
    const local = buf.getUint32(cd + 42, true);
    expect(buf.getUint32(local, true)).toBe(0x04034b50);
    expect(local).toBe(0);
  });

  it('uses ZIP64 records once the plain fields run out', async () => {
    // Tiny limits stand in for 4 GB / 65,535 files: offsets from 40 bytes on, and 3+ entries, need ZIP64.
    const z = new ZipBuilder(undefined, { big: 40, count: 3 });
    await z.add('a.txt', enc('hello'));
    await z.add('b.txt', enc('world'));
    await z.add('c.txt', enc('again'));
    const buf = new DataView(await (await z.finish())!.arrayBuffer());

    const eocd = buf.byteLength - 22;
    expect(buf.getUint32(eocd, true)).toBe(0x06054b50);
    expect(buf.getUint16(eocd + 10, true)).toBe(0xffff); // real count lives in the ZIP64 record
    expect(buf.getUint32(eocd + 16, true)).toBe(0xffffffff);

    const loc = eocd - 20;
    expect(buf.getUint32(loc, true)).toBe(0x07064b50);
    const rec = Number(buf.getBigUint64(loc + 8, true));
    expect(buf.getUint32(rec, true)).toBe(0x06064b50);
    expect(Number(buf.getBigUint64(rec + 32, true))).toBe(3); // total entries
    const cdSize = Number(buf.getBigUint64(rec + 40, true));
    const cdStart = Number(buf.getBigUint64(rec + 48, true));
    expect(cdStart + cdSize).toBe(rec);

    // Walk the central directory: entries at offset >= 40 carry the ZIP64 extra with their real offset.
    let p = cdStart;
    const offsets: number[] = [];
    while (p < rec) {
      expect(buf.getUint32(p, true)).toBe(0x02014b50);
      const nameLen = buf.getUint16(p + 28, true);
      const extraLen = buf.getUint16(p + 30, true);
      const plain = buf.getUint32(p + 42, true);
      if (extraLen) {
        expect(plain).toBe(0xffffffff);
        const x = p + 46 + nameLen;
        expect(buf.getUint16(x, true)).toBe(0x0001);
        offsets.push(Number(buf.getBigUint64(x + 4, true)));
      } else offsets.push(plain);
      p += 46 + nameLen + extraLen;
    }
    expect(p).toBe(rec);
    expect(offsets).toHaveLength(3);
    for (const o of offsets) expect(buf.getUint32(o, true)).toBe(0x04034b50); // every offset lands on a local header
  });

  it('streams to a sink instead of keeping bytes', async () => {
    const chunks: Uint8Array[] = [];
    const z = new ZipBuilder((p) => void chunks.push(p));
    await z.add('a.txt', enc('hello'));
    expect(await z.finish()).toBeNull();
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const kept = new ZipBuilder();
    await kept.add('a.txt', enc('hello'));
    expect((await kept.finish())!.size).toBe(total);
  });
});
