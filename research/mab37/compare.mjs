// Compares the transcription (mab37.json) with the reference yields the app ships
// (app/src/data/fish_data_v3.js) and writes comparison.md and comparison.json.
//
//   node research/mab37/build.mjs && node research/mab37/compare.mjs
//
// It changes nothing in the app. Each app species is matched to one table in the bulletin: by the
// hand-checked list in species-map.json first, then by scientific name, then by the words in its
// name. Rows are then paired by starting form and product.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DATA = join(HERE, '..', '..', 'app', 'src', 'data', 'fish_data_v3.js');

const squash = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
// Spelling the scan's text layer got wrong, and nothing else: the comparison should not hide real differences.
const formKey = (s) => squash(s).replace(/\bsib\b/g, 's/b').replace(/\bo\/h\b/g, 'd/h').replace(/\s*\(\s*/g, ' (').replace(/\s*\)/g, ')');
// A looser key used only to suggest that two differently worded rows are the same row.
const looseKey = (s) => formKey(s).replace(/fillets\b/g, 'fillet').replace(/meats\b/g, 'meat').replace(/[^a-z0-9/]+/g, ' ').trim();
const sciKey = (s) => squash(s).replace(/\bspp?\.?$/, '').replace(/[^a-z ]/g, '').trim();
const words = (s) => new Set(squash(s).replace(/[^a-z ]/g, ' ').split(' ').filter((w) => w.length > 2 && !['and', 'the', 'general', 'including'].includes(w)));
const sameRange = (a, b) => (a === null && b === null) || (Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1]);
const showRange = (r) => (r ? `${r[0]}–${r[1]}` : 'none');
const tableKey = (r) => [r.group, r.species, r.subheading].filter(Boolean).join(' / ');

export function groupTables(rows) {
  const tables = new Map();
  for (const row of rows) {
    const key = tableKey(row);
    if (!tables.has(key)) tables.set(key, { key, group: row.group, species: row.species, subheading: row.subheading, scientific: new Set(), rows: [], pages: new Set() });
    const t = tables.get(key);
    if (row.scientific_name) t.scientific.add(sciKey(row.scientific_name));
    for (const s of row.applies_to_species ?? []) t.scientific.add(sciKey(s));
    t.rows.push(row);
    t.pages.add(row.pdf_page);
  }
  return tables;
}

export function matchSpecies(appData, tables, manual = {}) {
  const matches = {};
  for (const [name, entry] of Object.entries(appData)) {
    if (name in manual) {
      const keys = [].concat(manual[name] ?? []);
      matches[name] = { tables: keys.filter((k) => tables.has(k)), how: keys.length ? 'hand-checked list' : 'hand-checked: not in the bulletin', missing: keys.filter((k) => !tables.has(k)) };
      continue;
    }
    const sci = sciKey(entry.scientific_name);
    const bySci = sci ? [...tables.values()].filter((t) => t.scientific.has(sci)) : [];
    if (bySci.length === 1) { matches[name] = { tables: [bySci[0].key], how: 'scientific name' }; continue; }
    const want = words(name);
    let best = null;
    for (const t of bySci.length ? bySci : tables.values()) {
      const have = words(t.key);
      const shared = [...want].filter((w) => have.has(w)).length;
      const score = shared / Math.max(want.size, have.size);
      if (shared && (!best || score > best.score)) best = { key: t.key, score, shared };
    }
    matches[name] = best && best.score > 0.5 ? { tables: [best.key], how: `name (${Math.round(best.score * 100)}% of words shared)` } : { tables: [], how: 'no match', guess: best?.key ?? null };
  }
  return matches;
}

export function compareSpecies(appEntry, sourceRows) {
  const app = Object.entries(appEntry.conversions ?? {}).map(([key, v]) => {
    const [from, to] = key.split('→').map((p) => p.trim());
    return { key, from, to, average: v.yield ?? null, range: v.range ?? null, k: `${formKey(from)}→${formKey(to)}`, used: false };
  });
  const src = sourceRows.map((r) => ({ ...r, k: `${formKey(r.from)}→${formKey(r.to)}`, used: false }));
  const out = { same: [], valueDiffers: [], spellingOnly: [], reworded: [], wrongFrom: [], onlyInApp: [], onlyInSource: [] };

  const take = (a, s) => { a.used = true; s.used = true; };
  // 1. same starting form and product
  for (const a of app) {
    const s = src.find((x) => !x.used && x.k === a.k);
    if (!s) continue;
    take(a, s);
    const sameValues = a.average === s.average && sameRange(a.range, s.range);
    const sameSpelling = squash(a.from) === squash(s.from) && squash(a.to) === squash(s.to);
    if (!sameValues) out.valueDiffers.push({ app: a, source: s });
    else if (!sameSpelling) out.spellingOnly.push({ app: a, source: s });
    else out.same.push({ app: a, source: s });
  }
  // 2. same row, worded differently (plural, punctuation)
  for (const a of app.filter((x) => !x.used)) {
    const s = src.find((x) => !x.used && looseKey(x.from) === looseKey(a.from) && looseKey(x.to) === looseKey(a.to));
    if (!s) continue;
    take(a, s);
    out.reworded.push({ app: a, source: s, valuesMatch: a.average === s.average && sameRange(a.range, s.range) });
  }
  // 3. same product and the same numbers, under a different starting form: the two-column misread
  for (const a of app.filter((x) => !x.used)) {
    const s = src.find((x) => !x.used && looseKey(x.to) === looseKey(a.to) && x.average === a.average && sameRange(x.range, a.range));
    if (!s) continue;
    take(a, s);
    out.wrongFrom.push({ app: a, source: s });
  }
  out.onlyInApp = app.filter((x) => !x.used);
  out.onlyInSource = src.filter((x) => !x.used);
  return out;
}

const line = (r) => `${r.from} → ${r.to}: ${r.average ?? 'no average'}${r.range ? ` (${showRange(r.range)})` : ''}`;

async function main() {
  const dataset = JSON.parse(readFileSync(join(HERE, 'mab37.json'), 'utf8'));
  const { FISH_DATA_V3 } = await import(pathToFileURL(APP_DATA).href);
  const manualFile = join(HERE, 'species-map.json');
  const manual = existsSync(manualFile) ? JSON.parse(readFileSync(manualFile, 'utf8')) : {};
  const tables = groupTables(dataset.rows);
  const matches = matchSpecies(FISH_DATA_V3, tables, manual);

  const totals = { same: 0, valueDiffers: 0, spellingOnly: 0, reworded: 0, wrongFrom: 0, onlyInApp: 0, onlyInSource: 0 };
  const perSpecies = [];
  const usedTables = new Map();
  for (const [name, entry] of Object.entries(FISH_DATA_V3)) {
    const m = matches[name];
    const rows = m.tables.flatMap((k) => tables.get(k).rows);
    for (const k of m.tables) usedTables.set(k, [...(usedTables.get(k) ?? []), name]);
    const result = compareSpecies(entry, rows);
    for (const k of Object.keys(totals)) totals[k] += result[k].length;
    perSpecies.push({ name, match: m, result });
  }
  const unusedTables = [...tables.values()].filter((t) => !usedTables.has(t.key));
  const sharedTables = [...usedTables.entries()].filter(([, names]) => names.length > 1);
  const appRows = Object.values(FISH_DATA_V3).reduce((n, e) => n + Object.keys(e.conversions ?? {}).length, 0);

  const md = [];
  md.push('# The app\'s reference yields against the bulletin', '');
  md.push(`Generated by \`research/mab37/compare.mjs\`. The bulletin was re-read from the page images into \`mab37.json\` (${dataset.rows.length} rows in ${tables.size} tables). The app ships ${appRows} conversions for ${Object.keys(FISH_DATA_V3).length} species in \`app/src/data/fish_data_v3.js\`.`, '');
  md.push('| | Rows |', '|---|---:|');
  md.push(`| Same starting form, product and numbers | ${totals.same} |`);
  md.push(`| Same row and numbers, spelled differently (for example \`SIB\` for \`S/B\`) | ${totals.spellingOnly} |`);
  md.push(`| Same row, worded differently (plural, punctuation) | ${totals.reworded} |`);
  md.push(`| **Numbers differ** | ${totals.valueDiffers} |`);
  md.push(`| **Right product and numbers, wrong starting form** | ${totals.wrongFrom} |`);
  md.push(`| **In the app, not found in the matched table** | ${totals.onlyInApp} |`);
  md.push(`| **In the bulletin's table, missing from the app** | ${totals.onlyInSource} |`, '');

  md.push('## Species matching', '');
  const unmatched = perSpecies.filter((p) => !p.match.tables.length);
  md.push(`${perSpecies.length - unmatched.length} of ${perSpecies.length} app species were matched to a table. ${unmatched.length ? `Not matched: ${unmatched.map((p) => `${p.name}${p.match.guess ? ` (closest: ${p.match.guess})` : ''}`).join('; ')}.` : ''}`, '');
  if (sharedTables.length) {
    md.push('Tables that more than one app species points at:', '');
    for (const [key, names] of sharedTables) md.push(`- **${key}**: ${names.join(', ')}`);
    md.push('');
  }
  if (unusedTables.length) {
    md.push('Tables in the bulletin that no app species uses:', '');
    for (const t of unusedTables) md.push(`- **${t.key}** (${t.rows.length} rows, PDF page ${[...t.pages].join(', ')})`);
    md.push('');
  }

  md.push('## Differences by species', '');
  for (const p of perSpecies) {
    const r = p.result;
    const n = r.valueDiffers.length + r.wrongFrom.length + r.onlyInApp.length + r.onlyInSource.length + r.spellingOnly.length + r.reworded.length;
    if (!n && p.match.tables.length) continue;
    md.push(`### ${p.name}`, '');
    md.push(`Matched to: ${p.match.tables.length ? p.match.tables.map((k) => `**${k}**`).join(', ') : '_nothing_'} (${p.match.how}).`, '');
    for (const d of r.valueDiffers) md.push(`- Numbers differ. App: ${line(d.app)}. Bulletin \`${d.source.id}\`: ${line(d.source)}.`);
    for (const d of r.wrongFrom) md.push(`- Wrong starting form. App: ${line(d.app)}. Bulletin \`${d.source.id}\`: ${line(d.source)}.`);
    for (const d of r.onlyInApp) md.push(`- Only in the app: ${line(d)}.`);
    for (const d of r.onlyInSource) md.push(`- Missing from the app. Bulletin \`${d.id}\`: ${line(d)}.`);
    for (const d of r.reworded) md.push(`- Worded differently${d.valuesMatch ? '' : ', and the numbers differ'}. App: ${line(d.app)}. Bulletin \`${d.source.id}\`: ${line(d.source)}.`);
    if (r.spellingOnly.length) md.push(`- ${r.spellingOnly.length} row(s) differ only in spelling: ${[...new Set(r.spellingOnly.map((d) => `\`${d.app.to}\` for \`${d.source.to}\``))].join(', ')}.`);
    md.push('');
  }

  const flagged = dataset.rows.filter((r) => r.check);
  if (flagged.length) {
    md.push('## Cells the transcribers were not sure of', '');
    for (const r of flagged) md.push(`- \`${r.id}\` ${tableKey(r)}, ${line(r)}: ${r.check}`);
    md.push('');
  }

  writeFileSync(join(HERE, 'comparison.md'), `${md.join('\n')}\n`);
  writeFileSync(join(HERE, 'comparison.json'), `${JSON.stringify({ totals, matches, perSpecies: perSpecies.map((p) => ({ name: p.name, tables: p.match.tables, ...Object.fromEntries(Object.entries(p.result).map(([k, v]) => [k, v.length])) })) }, null, 2)}\n`);
  console.log(JSON.stringify(totals), `| unmatched species: ${unmatched.length} | unused tables: ${unusedTables.length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
