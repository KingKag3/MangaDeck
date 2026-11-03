import { describe, expect, it } from 'vitest';
import { dayBucket, timeAgo, toMs } from './format';

describe('toMs', () => {
  it('leaves milliseconds alone and converts seconds', () => {
    expect(toMs('1752668520431')).toBe(1752668520431);
    expect(toMs('1793734105')).toBe(1793734105000);
    expect(toMs('0')).toBe(0);
    expect(toMs(null)).toBe(0);
  });
});

describe('dates', () => {
  it('treat second-based fetchedAt as recent, not 1970', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(dayBucket(String(nowSeconds))).toBe('Today');
    expect(timeAgo(String(nowSeconds - 3 * 3600))).toBe('3h ago');
  });
});

import { parseDescription } from './format';

describe('parseDescription', () => {
  it('splits facts, synopsis and extra sections', () => {
    const d = parseDescription(
      '**Rating**: 8.06/10\n**Year**: 2013\n**Views**: 730.7K\n\n\n**Synopsis**: A boy wants to be a **hero**.\n\n*Source: Somewhere*\n\n**Alternative Names**:\n- One\n- Two',
    );
    expect(d.meta).toEqual(['★ 8.06/10', '2013', '730.7K views']);
    expect(d.text).toBe('A boy wants to be a hero.\n\nSource: Somewhere');
    expect(d.extras).toEqual([{ label: 'Alternative Names', text: 'One  ·  Two' }]);
  });

  it('formats plain numeric views and survives a missing rating', () => {
    expect(parseDescription('**Year**: 2017\n**Views**: 16700622\n\n**Synopsis**: Hi').meta).toEqual(['2017', `${Number(16700622).toLocaleString()} views`]);
  });

  it('returns plain text unchanged when there are no headings', () => {
    expect(parseDescription('Just a story.')).toEqual({ meta: [], text: 'Just a story.', extras: [] });
    expect(parseDescription(null)).toEqual({ meta: [], text: '', extras: [] });
  });
});
