import { describe, expect, it } from 'vitest';
import { parseVolumeRanges, parseVolumeText, summarizeVolumes, seriesChapters, volumeChapters, volumeOf, volumeRangesToText, titleVariants, mergeNewVolumes, keepExtras, sameRanges } from './volumes';
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

describe('parseVolumeRanges, pages with several series', () => {
  // Light novels first (chapters restart in every volume), then the manga, then a spin-off.
  const page = `==Light novels==
{{Graphic novel list/header|x=1}}
{{Graphic novel list
| VolumeNumber = 1
| ChapterListCol1 =
{{Numbered list|start=1
| "Prologue"
| "One"
| "Two"
}}
}}
{{Graphic novel list
| VolumeNumber = 2
| ChapterListCol1 =
{{Numbered list|start=1
| "Prologue"
| "One"
| "Two"
| "Three"
}}
}}
==Manga==
===''Big Series''===
{{Graphic novel list
| VolumeNumber = 1
| RelDate = October 30, 2015
| ChapterList =
{{Numbered list|start=1
| "A"
| "B"
| "C"
}}
}}
{{Graphic novel list
| VolumeNumber = 2
| ChapterList =
{{Numbered list|start=4
| "D"
| "E"
}}
}}
{{Graphic novel list
| VolumeNumber = 3
| ChapterList =
}}
===''Big Series: Side Story''===
{{Graphic novel list
| VolumeNumber = 1
| ChapterList =
{{Numbered list|start=1
| "S1"
| "S2"
}}
}}
{{Graphic novel list
| VolumeNumber = 2
| ChapterList =
{{Numbered list|start=3
| "S3"
}}
}}`;

  it('skips the light novels and spin-off and reads the manga under the matching heading', () => {
    const r = parseVolumeRanges(page, 'Big Series');
    expect(r.map((x) => [x.volume, x.first, x.last])).toEqual([
      [1, 1, 3],
      [2, 4, 5],
    ]);
  });

  it('still avoids the light novels without a title (chapters that restart are not a manga run)', () => {
    const r = parseVolumeRanges(page);
    expect(r.map((x) => x.volume)).toEqual([1, 2]);
    expect(r[1].first).toBe(4); // the manga run, not the novel volume starting at 1 again
  });

  it('prefers the exact heading match over a spin-off that contains the title', () => {
    const r = parseVolumeRanges(page.replace('===\'\'Big Series\'\'===', "===''Other Name''==="), 'Big Series: Side Story');
    expect(r.map((x) => [x.volume, x.first, x.last])).toEqual([
      [1, 1, 2],
      [2, 3, 3],
    ]);
  });
});

describe('parseVolumeText', () => {
  it('reads one volume per line', () => {
    expect(parseVolumeText('1: 0-12\nVol. 2 = 13 to 26\nVolume 3 - Chapters 27–39.5\nnot a volume line')).toEqual([
      { volume: 1, first: 0, last: 12 },
      { volume: 2, first: 13, last: 26 },
      { volume: 3, first: 27, last: 39.5 },
    ]);
  });

  it('reads text copied from a page, with a prologue and repeated volume rows', () => {
    const page = [
      'Volume 1',
      'Prologue',
      'Chapter 1',
      'Chapter 2',
      'Chapter 12',
      'Korean: September 26, 2019 979-11-89320-29-4',
      'Volume 1',
      'English: March 2, 2021',
      'Volume 2',
      'Chapter 13',
      'Chapter 14',
      'Chapter 26',
      'Korean: January 30, 2020',
    ].join('\n');
    expect(parseVolumeText(page)).toEqual([
      { volume: 1, first: 0, last: 12 },
      { volume: 2, first: 13, last: 26 },
    ]);
  });

  it('reads "Chapters a-b" ranges inside a volume block and ignores volumes without chapters', () => {
    expect(parseVolumeText('Volume 1 contains Chapters 1-7 and a map. Volume 2 is an artbook. Volume 3: Chapters 8 to 15')).toEqual([
      { volume: 1, first: 1, last: 7 },
      { volume: 3, first: 8, last: 15 },
    ]);
  });

  it('returns nothing for text without volumes, and round-trips through the editor text', () => {
    expect(parseVolumeText('hello world')).toEqual([]);
    const ranges = [
      { volume: 1, first: 0, last: 12 },
      { volume: 2, first: 13, last: 26 },
    ];
    expect(parseVolumeText(volumeRangesToText(ranges))).toEqual(ranges);
  });
});

describe('titleVariants', () => {
  it('adds the title without a subtitle or bracketed note', () => {
    expect(titleVariants('Mushoku Tensei - Jobless Reincarnation')).toEqual(['Mushoku Tensei - Jobless Reincarnation', 'Mushoku Tensei']);
    expect(titleVariants('Re:Zero: Starting Life (Official)')).toEqual(['Re:Zero: Starting Life (Official)', 'Re:Zero', 'Re:Zero: Starting Life']);
  });

  it('keeps a plain title as it is and ignores tiny leftovers', () => {
    expect(titleVariants('Dandadan')).toEqual(['Dandadan']);
    expect(titleVariants('A - B')).toEqual(['A - B']);
  });
});

describe('parseVolumeRanges, "Mission" style pages', () => {
  const page = `{{Graphic novel list
| VolumeNumber = 1
| ChapterList = *Mission: 1–5
| Summary = Mission 99 is mentioned here but is not a chapter list.
}}
{{Graphic novel list
| VolumeNumber = 2
| ChapterList = *Mission: 6–11
*Short Mission: 1
}}
{{Graphic novel list
| VolumeNumber = 3
| ChapterList = *Mission: 12–17
*Extra Mission: 2
*Short Mission: 15, 17-18
}}
{{Graphic novel list
| VolumeNumber = 4
| ChapterList = *Mission: 18
}}`;

  it('reads the Mission bullets and ignores short, extra and bonus lines', () => {
    expect(parseVolumeRanges(page).map((r) => [r.volume, r.first, r.last])).toEqual([
      [1, 1, 5],
      [2, 6, 11],
      [3, 12, 17],
      [4, 18, 18],
    ]);
  });

  it('understands other chapter words and several bullets in one volume', () => {
    const text = `{{Graphic novel list
| VolumeNumber = 1
| ChapterList =
*Episode: 1–4
*Episode: 5–8
}}`;
    expect(parseVolumeRanges(text).map((r) => [r.volume, r.first, r.last])).toEqual([[1, 1, 8]]);
  });
});

describe('parseVolumeRanges, one bullet per chapter ("Days 1: Title")', () => {
  const page = `{{Graphic novel list
| VolumeNumber = 1
| ChapterList =
*Days 1: {{Nihongo|"The Legendary Hit Man"|伝説の殺し屋|Densetsu}}
*Days 2: {{Nihongo|"Family Rules"|家訓|Kekakun}}
| ChapterListCol2 =
*Days 3: {{Nihongo|"Mysterious Hero"|ヒーロー|Hiro}}
}}
{{Graphic novel list
| VolumeNumber = 2
| ChapterList =
*Days 4: {{Nihongo|"China Invasion!"|x|y}}
*Days 5: {{Nihongo|"Showtime"|x|y}}
*Special Days: 99
}}
=== ''Holidays'' ===
{{Graphic novel list
| VolumeNumber = 1
| ChapterList =
*Days 1: {{Nihongo|"Other"|x|y}}
}}`;

  it('reads the chapter numbers and titles, across columns, and ignores special lines', () => {
    const r = parseVolumeRanges(page, 'Sakamoto Days');
    expect(r.map((x) => [x.volume, x.first, x.last])).toEqual([
      [1, 1, 3],
      [2, 4, 5],
    ]);
    expect(r[0].titles).toEqual({ 1: 'The Legendary Hit Man', 2: 'Family Rules', 3: 'Mysterious Hero' });
    expect(r[1].titles).toEqual({ 4: 'China Invasion!', 5: 'Showtime' });
  });
});

describe('mergeNewVolumes', () => {
  const cur = [
    { volume: 1, first: 1, last: 5 },
    { volume: 2, first: 6, last: 10 },
  ];

  it('adds only volumes numbered above the last saved one', () => {
    const found = [
      { volume: 1, first: 1, last: 4 }, // a different reading of volume 1: ignored, ours stays
      { volume: 2, first: 6, last: 10 },
      { volume: 3, first: 11, last: 16 },
      { volume: 4, first: 17, last: 21 },
    ];
    const r = mergeNewVolumes(cur, found);
    expect(r.added).toBe(2);
    expect(r.ranges.map((x) => [x.volume, x.first, x.last])).toEqual([
      [1, 1, 5],
      [2, 6, 10],
      [3, 11, 16],
      [4, 17, 21],
    ]);
  });

  it('adds nothing when there is nothing newer, and leaves the saved list as it was', () => {
    const r = mergeNewVolumes(cur, [{ volume: 2, first: 6, last: 12 }]);
    expect(r.added).toBe(0);
    expect(r.ranges).toEqual(cur);
  });
});

describe('titleVariants, shouted titles', () => {
  it('adds a normally capitalised form of an ALL CAPS title', () => {
    expect(titleVariants('GACHIAKUTA')).toEqual(['GACHIAKUTA', 'Gachiakuta']);
    expect(titleVariants('MY HERO ACADEMIA')).toEqual(['MY HERO ACADEMIA', 'My Hero Academia']);
  });

  it('leaves mixed-case titles alone and keeps the subtitle split working', () => {
    expect(titleVariants('Spy x Family')).toEqual(['Spy x Family']);
    expect(titleVariants('RE:ZERO - STARTING LIFE')).toEqual(['RE:ZERO - STARTING LIFE', 'Re:Zero - Starting Life', 'RE:ZERO', 'Re:Zero']);
  });
});

describe('parseVolumeRanges, bullets that start with the chapter number ("* 162. Title")', () => {
  const page = `{{Graphic novel list
| VolumeNumber = 1
| ChapterListCol1 =
* 1. {{Nihongo|"The Sphere"|天界|Tenkai}}
* 2. {{Nihongo|"Quasi Living Things"|x|y}}
| ChapterListCol2 =
* 3. {{Nihongo|"Imbued"|x|y}}
* 4. "The Ground"
}}
{{Graphic novel list
| VolumeNumber = 2
| ChapterListCol1 =
* 5. {{Nihongo|"Interpersonal Relations"|x|y}}
* 5.2. {{Nihongo|"Extra"|x|y}}
| ChapterListCol2 =
* 6. "Plain title"
}}`;

  it('reads the numbers, decimal chapters and titles, across columns', () => {
    const r = parseVolumeRanges(page, 'GACHIAKUTA');
    expect(r.map((x) => [x.volume, x.first, x.last])).toEqual([
      [1, 1, 4],
      [2, 5, 6],
    ]);
    expect(r[0].titles).toEqual({ 1: 'The Sphere', 2: 'Quasi Living Things', 3: 'Imbued', 4: 'The Ground' });
    expect(r[1].titles?.[5.2]).toBe('Extra');
  });
});

describe('keepExtras and sameRanges', () => {
  const old = [
    { volume: 1, first: 1, last: 4, released: '2022-05-17', isbn: '978-4-06-527922-9', titles: { 1: 'The Sphere' } },
    { volume: 2, first: 5, last: 13, released: '2022-08-09' },
  ];

  it('keeps the date, ISBN and titles of a volume that is still in the list, even with new chapter numbers', () => {
    const edited = [
      { volume: 1, first: 1, last: 5 }, // chapters corrected
      { volume: 2, first: 6, last: 13 },
      { volume: 3, first: 14, last: 22 }, // a new volume has nothing to keep
    ];
    const r = keepExtras(edited, old);
    expect(r[0]).toEqual({ volume: 1, first: 1, last: 5, released: '2022-05-17', isbn: '978-4-06-527922-9', titles: { 1: 'The Sphere' } });
    expect(r[1].released).toBe('2022-08-09');
    expect(r[2]).toEqual({ volume: 3, first: 14, last: 22 });
  });

  it('drops the extras of a volume that was deleted, and does nothing without an old list', () => {
    expect(keepExtras([{ volume: 2, first: 5, last: 13 }], old).map((r) => r.volume)).toEqual([2]);
    expect(keepExtras([{ volume: 1, first: 1, last: 2 }], undefined)).toEqual([{ volume: 1, first: 1, last: 2 }]);
  });

  it('sameRanges ignores dates and titles but notices any change in volume or chapters', () => {
    expect(sameRanges(old, [{ volume: 1, first: 1, last: 4 }, { volume: 2, first: 5, last: 13 }])).toBe(true);
    expect(sameRanges(old, [{ volume: 1, first: 1, last: 4 }, { volume: 2, first: 5, last: 14 }])).toBe(false);
    expect(sameRanges(old, [{ volume: 1, first: 1, last: 4 }])).toBe(false);
    expect(sameRanges(undefined, [])).toBe(false);
  });
});

describe('parseVolumeText on a one-page chapter list (Fandom "Chapters")', () => {
  it('does not let omakes and specials after the last volume stretch it', () => {
    const page = [
      '==Chapter list==',
      '===Volume 15===',
      '*Chapter 98: [[Communicating]]',
      '*Chapter 99: [[Mob]]',
      '{{clr}}',
      '===Volume 16===',
      '*Chapter 100: [[Unnamed]]',
      '*Chapter 101: [[101]]',
      '{{clr}}',
      '===Omakes and Specials===',
      '====Named====',
      '*[[Fake Pot]] (Chapter 18 extra)',
    ].join('\n');
    expect(parseVolumeText(page)).toEqual([
      { volume: 15, first: 98, last: 99 },
      { volume: 16, first: 100, last: 101 },
    ]);
  });
});
