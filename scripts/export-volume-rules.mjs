// Copies the volume lists you made by hand (Set volumes / wiki import) from your Suwayomi server into
// src/data/volumeRules.json, so they ship with the app for everyone. Run it before committing:
//
//   npm run volumes:export            update the file
//   npm run volumes:export -- --dry   only show what would change
//
// SUWAYOMI_URL picks the server (default http://localhost:4567).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidatesFromMangas, formatRules, mergeRules } from './volumeRulesExport.mjs';

const dry = process.argv.includes('--dry');
const server = (process.env.SUWAYOMI_URL || 'http://localhost:4567').replace(/\/+$/, '');
const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'volumeRules.json');

async function gql(query, variables) {
  const res = await fetch(`${server}/api/graphql`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  if (!res.ok) throw new Error(`${server} answered ${res.status}`);
  const json = await res.json();
  if (!json.data) throw new Error(json.errors?.[0]?.message ?? 'No data from the server');
  return json.data;
}

const mangas = [];
try {
  const PAGE = 400;
  for (let offset = 0; ; offset += PAGE) {
    const d = await gql(
      `query($first: Int, $offset: Int) { mangas(first: $first, offset: $offset) { nodes { id title meta { key value } } totalCount } }`,
      { first: PAGE, offset },
    );
    mangas.push(...d.mangas.nodes);
    if (mangas.length >= d.mangas.totalCount || d.mangas.nodes.length === 0) break;
  }
} catch (e) {
  console.error(`Could not read ${server}: ${e.message}\nStart Suwayomi (docker compose up -d suwayomi) or set SUWAYOMI_URL.`);
  process.exit(1);
}

const existing = JSON.parse(readFileSync(file, 'utf8'));
const candidates = candidatesFromMangas(mangas);
const { rules, report } = mergeRules(existing, candidates);
const changed = report.added.length + report.updated.length + report.aliased.length;

console.log(`Looked at ${mangas.length} manga on ${server}: ${candidates.length} with a hand-made volume list.`);
for (const [label, list] of [['New', report.added], ['Updated', report.updated], ['Extra name', report.aliased]]) {
  if (list.length) console.log(`  ${label}: ${list.join('; ')}`);
}
if (!changed) {
  console.log(`Nothing new: ${file} already has all of them (${existing.length} series).`);
} else if (dry) {
  console.log('Dry run: nothing written.');
} else {
  writeFileSync(file, formatRules(rules));
  console.log(`Wrote ${rules.length} series to src/data/volumeRules.json. Commit it to share them.`);
}
