// Copies the volume lists you approved in Supabase (volume_submissions, approved = true) into
// src/data/volumeRules.json, so they are kept in git too. Run it before committing:
//
//   npm run volumes:import            update the file
//   npm run volumes:import -- --dry   only show what would change
//
// It only reads, with the same public key the app uses. Approving or deleting rows happens in the Supabase dashboard.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatRules, mergeRules } from './volumeRulesExport.mjs';

const dry = process.argv.includes('--dry');
const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'volumeRules.json');

// The URL and key live in src/lib/community.ts; read them from there so there is one place to change.
const community = readFileSync(join(dirname(file), '..', 'lib', 'community.ts'), 'utf8');
const url = /SUPABASE_URL\s*=\s*'([^']+)'/.exec(community)?.[1];
const key = /SUPABASE_KEY\s*=\s*'([^']+)'/.exec(community)?.[1];
if (!url || !key) {
  console.error('No Supabase URL / key in src/lib/community.ts.');
  process.exit(1);
}

let rows;
try {
  const res = await fetch(`${url}/rest/v1/volume_submissions?select=id,titles,page,ranges&approved=eq.true&order=id.asc&limit=5000`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`answered ${res.status}`);
  rows = await res.json();
} catch (e) {
  console.error(`Could not read the shared list: ${e.message}`);
  process.exit(1);
}

let rules = JSON.parse(readFileSync(file, 'utf8'));
const report = { added: [], updated: [], aliased: [] };
for (const row of rows) {
  const ranges = [...row.ranges].sort((a, b) => a[0] - b[0]);
  for (const title of row.titles) {
    const merged = mergeRules(rules, [{ title, ranges }], row.page || 'Shared by a user');
    rules = merged.rules;
    for (const k of Object.keys(report)) report[k].push(...merged.report[k]);
  }
}

const changed = report.added.length + report.updated.length + report.aliased.length;
console.log(`${rows.length} approved lists in the shared table.`);
for (const [label, list] of [['New', report.added], ['Updated (ranges changed)', report.updated], ['Extra name', report.aliased]]) {
  if (list.length) console.log(`  ${label}: ${list.join('; ')}`);
}
if (!changed) {
  console.log('Nothing new: volumeRules.json already has all of them.');
} else if (dry) {
  console.log('Dry run: nothing written.');
} else {
  writeFileSync(file, formatRules(rules));
  console.log(`Wrote ${rules.length} series to src/data/volumeRules.json. Commit it to keep them.`);
}
