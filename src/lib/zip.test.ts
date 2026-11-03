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
