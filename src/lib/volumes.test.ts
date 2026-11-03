import { describe, expect, it } from 'vitest';
import { parseVolumeRanges, summarizeVolumes, seriesChapters, volumeChapters, volumeOf } from './volumes';
import type { Chapter } from '../api/queries';

const WIKI = `
== Volumes ==
{{Graphic novel list/header
| Language = Japanese
}}
{{Graphic novel list
| VolumeNumber    = 1
| OriginalRelDate = August 4, 2021<ref>{{Cite web|title=Vol. 1|url=https://x.test}}</ref>
| ChapterList     =
{{Numbered list|start = 1
| {{Nihongo|"One"|a|b}}
| {{Nihongo|"Two"|a|b}}
| {{Nihongo|"Three"|a|b}}
}}
| ChapterListCol2 =
{{Numbered list|start = 4
| {{Nihongo|"Four"|a|b}}
| {{Nihongo|"Five"|a|b}}
}}
| Summary = text
}}
{{Graphic novel list
| VolumeNumber = 2
| ChapterList =
{{Numbered list|start = 6
| "Six"
| "Seven"
}}
}}
`;

function ch(chapterNumber: number, name = `Chapter ${chapterNumber}`, isRead = false): Chapter {
  return { id: chapterNumber * 10, name, chapterNumber, isRead } as Chapter;
}

describe('parseVolumeRanges', () => {
  it('reads chapter ranges per volume, including extra columns', () => {
    expect(parseVolumeRanges(WIKI)).toEqual([
      {
        volume: 1,
        first: 1,
        last: 5,
        released: '2021-08-04',
        titles: { 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five' },
      },
      { volume: 2, first: 6, last: 7, titles: { 6: 'Six', 7: 'Seven' } },
    ]);
  });

  it('prefers the licensed release date and reads the ISBN', () => {
    const text = `{{Graphic novel list
| VolumeNumber = 1
| OriginalRelDate = August 4, 2021
| LicensedRelDate = October 11, 2022<ref name="x">{{Cite web|title=a}}</ref>
| LicensedISBN = 978-1-9747-3463-4
| ChapterList =
{{Numbered list|start = 1
| "A"
}}
}}`;
    expect(parseVolumeRanges(text)[0]).toMatchObject({ released: '2022-10-11', isbn: '978-1-9747-3463-4' });
  });

  it('ignores the header template and pages without volumes', () => {
    expect(parseVolumeRanges('{{Graphic novel list/header|x=1}}')).toEqual([]);
    expect(parseVolumeRanges('plain text')).toEqual([]);
  });

  it('counts "#" lists that give no start', () => {
    const text = `{{Graphic novel list
| VolumeNumber = 1
| ChapterList =
# one
# two
}}
{{Graphic novel list
| VolumeNumber = 2
| ChapterList =
# three
}}`;
    expect(parseVolumeRanges(text)).toEqual([
      { volume: 1, first: 1, last: 2, titles: { 1: 'one', 2: 'two' } },
      { volume: 2, first: 3, last: 3, titles: { 3: 'three' } },
    ]);
  });
});

describe('parseVolumeRanges, other page styles', () => {
  const page = `{{Graphic novel list
| VolumeNumber = 1
| RelDate = July 4, 2020
| ISBN = 978-4-08-882000-0
| ChapterList =
* Chapter: 1–6
| Summary = x
}}
{{Graphic novel list
| VolumeNumber = 2
| ChapterList =
* Chapters 7-12.5
}}
{{Graphic novel list
| VolumeNumber = 3
| ChapterList =
* Chapter 13
}}
== Side story ==
{{Graphic novel list
| VolumeNumber = 1
| ChapterList =
* Chapter: 1–3
}}`;

  it('reads "Chapter: a–b" bullets and ignores a second table that restarts at volume 1', () => {
    expect(parseVolumeRanges(page)).toEqual([
      { volume: 1, first: 1, last: 6, released: '2020-07-04', isbn: '978-4-08-882000-0' },
      { volume: 2, first: 7, last: 12.5 },
      { volume: 3, first: 13, last: 13 },
    ]);
  });
});

describe('volumeOf', () => {
  const ranges = [
    { volume: 1, first: 1, last: 5 },
    { volume: 2, first: 6, last: 7 },
  ];

  it('maps by chapter number, with decimals joining the whole chapter', () => {
    expect(volumeOf(ch(3), ranges)).toBe(1);
    expect(volumeOf(ch(5.5), ranges)).toBe(1);
    expect(volumeOf(ch(7), ranges)).toBe(2);
  });

  it('returns null outside every volume and for unnumbered chapters', () => {
    expect(volumeOf(ch(8), ranges)).toBeNull();
    expect(volumeOf(ch(-1), ranges)).toBeNull();
    expect(volumeOf(ch(3), undefined)).toBeNull();
  });

  it('prefers "Vol. N" in the chapter name', () => {
    expect(volumeOf(ch(3, 'Vol.9 Ch.3'), ranges)).toBe(9);
    expect(volumeOf(ch(3, 'Volume 4 - Chapter 3'), undefined)).toBe(4);
  });
});

describe('summarizeVolumes', () => {
  it('counts chapters and unread per volume', () => {
    const ranges = [{ volume: 1, first: 1, last: 2 }];
    const list = [ch(1, 'Chapter 1', true), ch(2), ch(3)];
    expect(summarizeVolumes(list, ranges)).toEqual([{ volume: 1, count: 2, unread: 1, first: 1, last: 2 }]);
  });

  it('counts copies from several groups once, read if any copy is read', () => {
    const ranges = [{ volume: 1, first: 1, last: 2 }];
    const list = [ch(2), { ...ch(2), id: 99 }, ch(1), { ...ch(1), id: 98, isRead: true }];
    expect(summarizeVolumes(list, ranges)).toEqual([{ volume: 1, count: 2, unread: 1, first: 1, last: 2 }]);
  });
});

describe('volumeChapters', () => {
  const ranges = [{ volume: 1, first: 1, last: 3 }];
  const g = (n: number, scanlator: string, id: number) => ({ ...ch(n), id, scanlator }) as Chapter;

  it('takes one copy per number from the biggest group, oldest first', () => {
    const list = [g(3, 'A', 1), g(3, 'B', 2), g(2, 'B', 3), g(1, 'B', 4), g(9, 'B', 5)];
    // B has 4 chapters, A has 1, so B wins; chapter 9 is outside the volume.
    expect(volumeChapters(list, ranges, 1).map((c) => c.id)).toEqual([4, 3, 2]);
  });
});

describe('seriesChapters', () => {
  it('orders by volume then number, one copy each, unassigned last', () => {
    const ranges = [
      { volume: 1, first: 1, last: 2 },
      { volume: 2, first: 3, last: 3 },
    ];
    const mk = (n: number, scanlator: string, id: number) => ({ ...ch(n), id, scanlator }) as Chapter;
    const list = [mk(9, 'A', 1), mk(3, 'A', 2), mk(2, 'A', 3), mk(2, 'B', 4), mk(1, 'A', 5), mk(1, 'B', 6)];
    expect(seriesChapters(list, ranges).map((i) => [i.chapter.id, i.volume])).toEqual([
      [5, 1],
      [3, 1],
      [2, 2],
      [1, null],
    ]);
  });
});
