// Gives every table in the bulletin its standard species identifiers: the FAO ASFIS 3-alpha code
// (what the EU, NAFO and GDST use) and the WoRMS AphiaID (the taxonomic anchor).
//
//   node research/vocab/build-species.mjs <cl_asfis_species.csv> <cl_asfis_species_enriched_with_worms.csv>
//
// The two CSVs are FAO's ASFIS list as published by the FAO/FIRMS Fisheries Data Interoperability
// Working Group (see README.md for where to get them). They are not kept in this repository.
// A name is matched as printed first, then through corrections.json (names the bulletin misspells
// or that have since changed), then at genus level for the bulletin's "sp." entries.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const [asfisPath, wormsPath] = process.argv.slice(2);
if (!asfisPath || !wormsPath) { console.error('usage: build-species.mjs <asfis.csv> <asfis_with_worms.csv>'); process.exit(2); }

function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const key = (s) => String(s ?? '').toLowerCase().replace(/\bspp?\.?$/, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
const asfis = parseCsv(readFileSync(asfisPath, 'utf8'));
const worms = new Map(parseCsv(readFileSync(wormsPath, 'utf8')).map((r) => [r.code, r]));
const byName = new Map(); const byGenus = new Map();
for (const r of asfis) {
  const k = key(r.taxon_scientific_name);
  if (!byName.has(k)) byName.set(k, r);
  // ASFIS writes a genus-level entry as "Genus spp"
  if (/\bspp$/.test(r.taxon_scientific_name)) byGenus.set(k, r);
}
const corrections = JSON.parse(readFileSync(join(HERE, 'corrections.json'), 'utf8'));
const dataset = JSON.parse(readFileSync(join(HERE, '..', 'mab37', 'mab37.json'), 'utf8'));

// `misprint` is the bulletin's own spelling where the transcription had to correct it to read it
// ("Haliotus" for Haliotis). It is kept as `printed`, so "as printed" is only said of a name that is.
function lookup(read, misprint = null) {
  const printed = misprint ?? read;
  const fixed = corrections[read] ?? (misprint ? { name: read, why: 'Misspelled in the bulletin.' } : undefined);
  const name = fixed?.name ?? read;
  const genusOnly = /\bspp?\.?$/.test(name.trim());
  // An exact name first: ASFIS lists some higher taxa as a single word ("Anguilliformes"), with no "spp".
  let hit = genusOnly ? byGenus.get(key(name)) : byName.get(key(name)) ?? (name.trim().includes(' ') ? undefined : byGenus.get(key(name)));
  let match = hit ? (fixed ? 'corrected name' : 'as printed') : null;
  if (!hit && !genusOnly && name.trim().includes(' ')) { hit = byGenus.get(key(name.split(' ')[0])); if (hit) match = 'genus only'; }
  if (!hit) return { printed, ...(fixed ? { corrected: fixed.name, why: fixed.why } : {}), asfis: null, match: 'none' };
  const w = worms.get(hit.code);
  return {
    printed, ...(fixed ? { corrected: fixed.name, why: fixed.why } : {}),
    asfis: hit.code, fao_name: hit.name_en, fao_scientific_name: hit.taxon_scientific_name, isscaap_group: hit.isscaap_group_code || null,
    aphia_id: w && w.AphiaID && w.AphiaID !== 'NA' ? Number(w.AphiaID) : null,
    accepted_name: w && w.valid_name && w.valid_name !== 'NA' ? w.valid_name : null,
    match,
  };
}

// One scientific-name cell can hold several names ("Chionoecetes bairdi, C. opilio"; "Salmo sp./ Salvelinus sp.")
function splitNames(cell) {
  const parts = cell.split(/\s*[,/]\s*|\s+and\s+/).map((p) => p.trim()).filter(Boolean);
  let genus = '';
  return parts.map((p) => {
    const m = /^([A-Z])\.\s+(.+)$/.exec(p);
    if (m && genus.startsWith(m[1])) return `${genus} ${m[2]}`;
    genus = p.split(' ')[0];
    return p;
  });
}

const tables = new Map();
for (const row of dataset.rows) {
  const table = [row.group, row.species, row.subheading].filter(Boolean).join(' / ');
  if (tables.has(table)) continue;
  const entries = [];
  if (row.applies_to_species) {
    for (const listed of row.applies_to_species) {
      const m = /^(.*?)\s+([A-Z][a-z]+ [a-z]+.*)$/.exec(listed);
      entries.push({ common_name: m ? m[1] : listed, ...lookup(m ? m[2] : listed) });
    }
  } else if (row.scientific_name) {
    const names = splitNames(row.scientific_name);
    const asPrinted = row.scientific_name_as_printed ? splitNames(row.scientific_name_as_printed) : names;
    names.forEach((name, i) => entries.push({ common_name: row.species, ...lookup(name, asPrinted.length === names.length && asPrinted[i] !== name ? asPrinted[i] : null) }));
  }
  tables.set(table, { table, pdf_page: row.pdf_page, taxa: entries });
}

const out = [...tables.values()];
const taxa = out.flatMap((t) => t.taxa);
writeFileSync(join(HERE, 'species.json'), `${JSON.stringify({
  source: 'FAO ASFIS List of Species for Fishery Statistics Purposes, with WoRMS AphiaIDs, as published in fdiwg/fdi-codelists (global/cwp)',
  note: 'A table with no taxa has no scientific name in the bulletin. "match" says how the name was found: as printed, through corrections.json, at genus level, or not at all.',
  tables: out,
}, null, 2)}\n`);
const count = (m) => taxa.filter((t) => t.match === m).length;
console.log(`${out.length} tables, ${taxa.length} names: ${count('as printed')} as printed, ${count('corrected name')} corrected, ${count('genus only')} genus only, ${count('none')} not found; ${out.filter((t) => !t.taxa.length).length} tables with no scientific name.`);
for (const t of out) for (const x of t.taxa) if (x.match === 'none' || x.match === 'genus only') console.log(`  ${x.match.padEnd(10)} ${t.table} :: ${x.printed}${x.asfis ? ` -> ${x.asfis} ${x.fao_scientific_name}` : ''}`);
