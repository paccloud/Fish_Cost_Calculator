// Turns the federal product recovery rates for Alaska groundfish (50 CFR Part 679, Table 3) into
// rows, and sets them beside the bulletin's averages where both cover the same fish and form.
//
//   node research/sources/us-50cfr679/build.mjs [<table-1a.xml> <table-2a.xml>]
//
// table3-as-printed.json is the record of what was read from the printed table; nothing here
// changes a value. With the two eCFR XML files (see README.md) it also rewrites product-codes.json
// and species-codes.json. Writes recovery-rates.json and comparison-with-mab37.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const fail = (msg) => { console.error(`${msg}\nNothing written.`); process.exit(1); };
const printed = JSON.parse(readFileSync(join(HERE, 'table3-as-printed.json'), 'utf8'));

// ---- the code tables, from the eCFR text ----
const text = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const tableRows = (xml) => [...xml.matchAll(/<TR>(.*?)<\/TR>/gs)].map((m) => [...m[1].matchAll(/<T[DH][^>]*>(.*?)<\/T[DH]>/gs)].map((c) => text(c[1])));
const outputs = [];
if (process.argv[2] && process.argv[3]) {
  const products = tableRows(readFileSync(process.argv[2], 'utf8')).filter((r) => r.length === 2 && /^\d{2}$/.test(r[1])).map(([description, code]) => ({ code, description }));
  if (products.length < 30 || !products.some((p) => p.code === '08' && /Eastern cut/.test(p.description))) fail(`${process.argv[2]}: this does not look like Table 1a (${products.length} product codes).`);
  // The table groups some species under a heading (FLOUNDER, ROCKFISH, SOLE) by indenting them. The
  // XML does not carry the indent, so where a group ends cannot be told; names are kept as printed.
  const species = tableRows(readFileSync(process.argv[3], 'utf8')).filter((r) => r.length === 2 && /^\d{3}$/.test(r[1])).map(([name, code]) => ({ code, name }));
  if (species.length < 40 || !species.some((s) => s.code === '110')) fail(`${process.argv[3]}: this does not look like Table 2a (${species.length} species codes).`);
  const source = (table) => ({ source: `50 CFR Part 679, ${table}`, read_from: 'eCFR (ecfr.gov), as of 2026-11-10' });
  outputs.push(['product-codes.json', { ...source('Table 1a: Delivery Condition and Product Codes'), codes: products.sort((a, b) => a.code.localeCompare(b.code)) }]);
  outputs.push(['species-codes.json', { ...source('Table 2a: Species Codes: FMP Groundfish'), note: 'In print order. Short names such as "Arrowtooth" or "Dover" sit under a heading (FLOUNDER, ROCKFISH, SOLE) in the regulation.', codes: species }]);
}

// ---- the rates ----
const rows = [];
for (const s of printed.species) {
  for (const [code, value] of Object.entries(s.rates)) {
    if (!printed.columns[code]) fail(`${s.name}: product code ${code} is not a column of the table.`);
    const check = s.check?.[code] ?? null;
    for (const rate of [].concat(value)) {
      if (!(rate > 0 && rate <= 1) && !check) fail(`${s.name}, code ${code}: ${rate} is not above 0 and up to 1, and carries no note.`);
      rows.push({ species_code: s.code, species: s.name, product_code: code.padStart(2, '0'), product: printed.columns[code], rate, yield_pct: rate > 0 && rate <= 1 ? Number((rate * 100).toFixed(1)) : null, basis: s.basis ?? 'round weight', check });
    }
  }
}
outputs.push(['recovery-rates.json', { source: printed.source, read_from: printed.read_from, notes: printed.notes, rows }]);

// ---- beside the bulletin ----
// Which bulletin tables a federal species line covers, and which federal product a bulletin row is.
// The bulletin does not say which side of the collar bone an unqualified "D/H-Off" is cut, or
// whether a fillet keeps its ribs, so those rows are set beside every federal product they could be.
const TABLES = {
  'Pacific Cod': [/^Cod, Pacific$/], Pollock: [/^Pollock, Walleye$/], Sablefish: [/^Sablefish$/], 'Atka Mackerel': [/^Mackerel, Atka$/],
  'Thornyhead Rockfish': [/^Rockfish \/ Black \/ Greenstriped \/ Thornyhead$/], Rockfish: [/^Rockfish \/ Canary/], Sculpins: [/^Sculpin$/],
  Smelts: [/^Smelt$/], Capelin: [/^Capelin$/], Sharks: [/^Shark \/ Sharks, General$/], Skates: [/^Skates$/],
  'Flatfish other than Pacific Halibut': [/^Soles \//, /^Flounders \//, /^Plaice, Alaska$/, /^Turbot, Greenland$/],
};
const FORMS = [
  [/^D\/H-On$/, ['4']], [/^D\/H-Off$/, ['7', '8']], [/^D\/H-Off \(Eastern\)$/, ['8']],
  [/^Skin-On Fillets?$/, ['20', '21']], [/^Skinless Fillets?$/, ['22', '23']], [/^S\/B Fillets$/i, ['23']],
  [/^Roe$/, ['14']], [/^Wings$/, ['13']], [/^Mince$/, ['31']], [/^Surimi/, ['30']], [/^Belly Flaps$/, ['19']],
];
const bulletin = JSON.parse(readFileSync(join(HERE, '..', '..', 'mab37', 'mab37.json'), 'utf8')).rows;
const tableOf = (r) => [r.group, r.species, r.subheading].filter(Boolean).join(' / ');
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const md = ['# Federal recovery rates beside the bulletin', '', 'Generated by `research/sources/us-50cfr679/build.mjs`. The federal rate is a single standard for a whole species group, set for catch accounting; the bulletin gives an average and often a range for one species. "Inside the range" says whether the federal rate falls within the bulletin\'s printed range.', ''];
md.push('| Federal species | Bulletin table | Bulletin row (Round → …) | Bulletin | Federal product | Federal | Difference | Inside the range |', '|---|---|---|---:|---|---:|---:|---|');
let pairs = 0; let within = 0; let ranged = 0; const diffs = [];
for (const s of printed.species) {
  for (const pattern of TABLES[s.name] ?? []) {
    for (const b of bulletin.filter((r) => r.from === 'Round' && pattern.test(tableOf(r)))) {
      const codes = FORMS.find(([re]) => re.test(b.to))?.[1] ?? [];
      for (const code of codes) {
        const value = s.rates[code];
        if (value === undefined || s.check?.[code]?.includes('excluded')) continue;
        for (const rate of [].concat(value)) {
          const pct = rate * 100; pairs++;
          const mid = b.average ?? (b.range[0] + b.range[1]) / 2;
          const inside = b.range ? pct >= b.range[0] && pct <= b.range[1] : null;
          if (inside !== null) { ranged++; if (inside) within++; }
          diffs.push(pct - mid);
          md.push(`| ${s.name} | ${tableOf(b)} | ${b.to} | ${b.average ?? '–'}${b.range ? ` (${b.range[0]}–${b.range[1]})` : ''} | ${code.padStart(2, '0')} ${printed.columns[code]} | ${fmt(pct)} | ${pct - mid > 0 ? '+' : ''}${fmt(Number((pct - mid).toFixed(1)))} | ${inside === null ? 'no range printed' : inside ? 'yes' : '**no**'} |`);
        }
      }
    }
  }
}
const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
const lower = diffs.filter((d) => d < 0).length;
md.splice(4, 0, `${pairs} pairs. Where the bulletin prints a range, the federal rate is inside it for ${within} of ${ranged}. The federal rate is below the bulletin's average in ${lower} of ${pairs} pairs; the mean difference is ${mean.toFixed(1)} points.`, '');
md.push('', 'A row appears more than once where the bulletin\'s wording fits more than one federal product: an unqualified `D/H-Off` is set beside both the Western cut (07) and the Eastern cut (08), a skin-on fillet beside 20 and 21, a skinless fillet beside 22 and 23.', '');
outputs.push(['comparison-with-mab37.md', md.join('\n')]);

for (const [file, content] of outputs) writeFileSync(join(HERE, file), typeof content === 'string' ? `${content}\n` : `${JSON.stringify(content, null, 2)}\n`);
console.log(`${printed.species.length} species lines, ${rows.length} rates; ${pairs} pairs with the bulletin, ${within} of ${ranged} inside its range, mean difference ${mean.toFixed(1)} points. Wrote ${outputs.map(([f]) => f).join(', ')}.`);
