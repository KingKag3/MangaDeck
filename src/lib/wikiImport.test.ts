import { describe, expect, it } from 'vitest';
import { chaptersFromVolumePage, parseWikiUrl, volumePagePattern } from './wikiImport';

describe('parseWikiUrl', () => {
  it('points Fandom pages at their own api.php and Wikipedia at /w/api.php', () => {
    expect(parseWikiUrl('https://mushokutensei.fandom.com/wiki/Manga_Volume_1#Chapters')).toEqual({
      api: 'https://mushokutensei.fandom.com/api.php',
      title: 'Manga Volume 1',
    });
    expect(parseWikiUrl('https://en.wikipedia.org/wiki/List_of_Dandadan_chapters')).toEqual({
      api: 'https://en.wikipedia.org/w/api.php',
      title: 'List of Dandadan chapters',
    });
    expect(parseWikiUrl('https://onepiece.fandom.com/fr/wiki/Tome_1')?.api).toBe('https://onepiece.fandom.com/fr/api.php');
  });

  it('refuses other hosts, plain http and non-wiki links', () => {
    expect(parseWikiUrl('https://example.com/wiki/Thing')).toBeNull();
    expect(parseWikiUrl('http://x.fandom.com/wiki/Thing')).toBeNull();
    expect(parseWikiUrl('https://x.fandom.com/not-a-wiki-page')).toBeNull();
    expect(parseWikiUrl('not a url')).toBeNull();
  });
});

describe('volumePagePattern', () => {
  it('builds the title of any volume from one volume page', () => {
    const p = volumePagePattern('Manga Volume 1')!;
    expect(p.n).toBe(1);
    expect(p.build(12)).toBe('Manga Volume 12');
    expect(volumePagePattern('Light Novel Vol. 7')!.build(8)).toBe('Light Novel Vol. 8');
  });

  it('is null for pages that are not a numbered volume', () => {
    expect(volumePagePattern('Manga')).toBeNull();
    expect(volumePagePattern('List of volumes')).toBeNull();
  });
});

describe('chaptersFromVolumePage', () => {
  it('reads the Chapters section only, not mentions elsewhere on the page', () => {
    const page = [
      '== Synopsis ==',
      'Later on, see Chapter 99 of the novel.',
      '== Chapters ==',
      '* [[Chapter 22]]',
      '* [[Chapter 23]]',
      '* [[Chapter 27]]',
      '== Trivia ==',
      'Chapter 500 is mentioned here too.',
    ].join('\n');
    expect(chaptersFromVolumePage(page)).toEqual({ first: 22, last: 27 });
  });

  it('counts a prologue as chapter 0 and reads ranges and decimals', () => {
    expect(chaptersFromVolumePage('==Chapters==\nPrologue\nChapter 1\nChapters 2-5\nChapter 5.5')).toEqual({ first: 0, last: 5.5 });
  });

  it('falls back to the whole page without a Chapters heading, and is null with no chapters', () => {
    expect(chaptersFromVolumePage('Contains Chapter 8 to Chapter 15')).toEqual({ first: 8, last: 15 });
    expect(chaptersFromVolumePage('Nothing here')).toBeNull();
  });
});
