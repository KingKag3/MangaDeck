import { describe, expect, it } from 'vitest';
import { comicInfo } from './export';
import type { Chapter } from '../api/queries';

const item = (n: number) => ({ chapter: { chapterNumber: n } as Chapter, volume: 1 });

describe('comicInfo', () => {
  it('writes volume metadata, escaping text and skipping empty fields', () => {
    const xml = comicInfo(
      {
        series: 'Dandy & Co',
        volume: 3,
        items: [item(15), item(16)],
        meta: {
          author: 'A <b>',
          artist: 'A <b>',
          genre: ['Action', 'Comedy'],
          summary: '**Bold** text',
          released: '2022-10-11',
          isbn: '978-1-9747-3463-4',
          totalVolumes: 28,
          titles: { 15: 'Start' },
        },
      },
      40,
    );
    expect(xml).toContain('<Series>Dandy &amp; Co</Series>');
    expect(xml).toContain('<Volume>3</Volume>');
    expect(xml).toContain('<Count>28</Count>');
    expect(xml).toContain('<Summary>Bold text</Summary>');
    expect(xml).toContain('<Year>2022</Year>');
    expect(xml).toContain('<Month>10</Month>');
    expect(xml).toContain('<Day>11</Day>');
    expect(xml).toContain('<Writer>A &lt;b&gt;</Writer>');
    expect(xml).not.toContain('<Penciller>'); // same as the writer
    expect(xml).toContain('<Genre>Action, Comedy</Genre>');
    expect(xml).toContain('<GTIN>9781974734634</GTIN>');
    expect(xml).toContain('<PageCount>40</PageCount>');
    expect(xml).toContain('Ch. 15: Start; Ch. 16');
    expect(xml).not.toContain('<Web>');
  });

  it('leaves out Volume and Number for a whole-series file', () => {
    const xml = comicInfo({ series: 'S', items: [], meta: {} }, 1);
    expect(xml).not.toContain('<Volume>');
    expect(xml).toContain('<Title>S</Title>');
  });
});
