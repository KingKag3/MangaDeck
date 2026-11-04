// The logic behind `npm run volumes:export`, kept apart from the command so it can be tested.

export const META_KEY = 'mangadeck.volumes';

/** Same title comparison the app uses: ignore case, accents and punctuation. */
export const norm = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const signature = (ranges) => JSON.stringify(ranges);

/**
 * Hand-made volume lists found in the manga meta on the server, as [title, rows] candidates.
 * Lists read from Wikipedia are left out (anyone's app finds those itself), and so are lists that already came from the
 * built-in rules.
 */
export function candidatesFromMangas(mangas) {
  const out = [];
  for (const m of mangas) {
    const raw = (m.meta || []).find((x) => x.key === META_KEY)?.value;
    if (!raw) continue;
    let info;
    try {
      info = JSON.parse(raw);
    } catch {
      continue;
    }
    if (info?.source !== 'manual' || !Array.isArray(info.ranges) || info.ranges.length === 0) continue;
    const ranges = info.ranges
      .filter((r) => Number.isFinite(r.volume) && Number.isFinite(r.first) && Number.isFinite(r.last))
      .map((r) => [r.volume, r.first, r.last])
      .sort((a, b) => a[0] - b[0]);
    if (ranges.length) out.push({ title: m.title, ranges });
  }
  return out;
}

/**
 * Fold candidates into the existing rules without losing anything:
 *  - a title that already has a rule gets that rule's ranges replaced when they differ (the server copy is newer);
 *  - a list identical to an existing rule's adds its title as another name for that series;
 *  - the rest become new rules (candidates with identical lists share one rule).
 */
export function mergeRules(existing, candidates, page = 'Added by a user (wiki import or typed in)') {
  const rules = existing.map((r) => ({ ...r, titles: [...r.titles], ranges: r.ranges.map((x) => [...x]) }));
  const report = { added: [], updated: [], aliased: [] };

  for (const c of candidates) {
    const t = norm(c.title);
    const byTitle = rules.find((r) => r.titles.some((x) => norm(x) === t));
    if (byTitle) {
      if (signature(byTitle.ranges) !== signature(c.ranges)) {
        byTitle.ranges = c.ranges;
        report.updated.push(c.title);
      }
      continue;
    }
    const bySame = rules.find((r) => signature(r.ranges) === signature(c.ranges));
    if (bySame) {
      bySame.titles.push(c.title);
      report.aliased.push(c.title);
      continue;
    }
    rules.push({ titles: [c.title], page, ranges: c.ranges });
    report.added.push(c.title);
  }
  return { rules, report };
}

/** JSON text with one volume row per cell and eight cells to a line, so git diffs stay small and readable. */
export function formatRules(rules) {
  const cell = (r) => `[${r.join(', ')}]`;
  const body = rules.map((rule) => {
    const lines = [];
    for (let i = 0; i < rule.ranges.length; i += 8) lines.push('      ' + rule.ranges.slice(i, i + 8).map(cell).join(', '));
    return [
      '  {',
      `    "titles": ${JSON.stringify(rule.titles)},`,
      `    "page": ${JSON.stringify(rule.page)},`,
      '    "ranges": [',
      lines.join(',\n'),
      '    ]',
      '  }',
    ].join('\n');
  });
  return `[\n${body.join(',\n')}\n]\n`;
}
