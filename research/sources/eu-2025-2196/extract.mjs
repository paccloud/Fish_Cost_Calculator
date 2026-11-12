// Pulls the code lists and conversion factors out of Commission Implementing Regulation (EU)
// 2025/2196, which replaced Regulation 404/2011 on 10 January 2026.
//
//   node research/sources/eu-2025-2196/extract.mjs <32025R2196.md>
//
// The input is a Markdown copy of the EUR-Lex text (see README.md for where it came from and how
// to check it). Writes presentation-codes.json, state-codes.json and conversion-factors.json.
// A conversion factor is live weight divided by product weight, so yield % = 100 / factor.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const input = process.argv[2];
if (!input) { console.error('usage: extract.mjs <32025R2196.md>'); process.exit(2); }
const raw = readFileSync(input, 'utf8');
const lines = raw.split('\n');
const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());
const plain = (s) => s.replace(/\[\^[^\]]*\]/g, '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
const between = (start, end) => { const a = lines.findIndex((l) => l.trim() === start); const b = lines.findIndex((l, i) => i > a && l.trim() === end); return lines.slice(a + 1, b === -1 ? undefined : b); };

function codeTable(block, columns) {
  return block.filter((l) => l.startsWith('|') && !/^\|\s*-/.test(l)).map(cells).filter((c) => c.length === columns && /^[A-Z]{3}$/.test(c[0])).map((c) => c.map(plain));
}
const annex1 = between('## ANNEX I', '## ANNEX II');
const t2 = annex1.findIndex((l) => l.includes('*Table 2*'));
const presentations = codeTable(annex1.slice(0, t2), 3).map(([code, name, description]) => ({ code, name, description }));
const states = codeTable(annex1.slice(t2), 2).map(([code, name]) => ({ code, name }));

function factors(block, state, annex) {
  const rows = []; let species = null;
  for (const line of block) {
    if (!line.startsWith('|')) continue;
    const c = cells(line);
    if (c.length !== 2) continue;
    const head = /^Species:\s*(.+)$/.exec(plain(c[0]));
    if (head) {
      // "Albacore *Thunnus alalunga*" : the common name is roman, the scientific name italic
      const m = /^Species:\s*(.*?)\s*\*(.+?)\*\s*(.*)$/.exec(c[0].replace(/\[\^[^\]]*\]/g, ''));
      species = { asfis: plain(c[1]), name: m ? m[1].trim() : head[1], scientific_name: m ? `${m[2]} ${m[3]}`.trim() : null };
      continue;
    }
    if (species && /^[A-Z]{3}(\+[A-Z]{3})*(-C)?$/.test(c[0]) && /^\d+,\d+$/.test(c[1])) {
      const factor = Number(c[1].replace(',', '.'));
      rows.push({ annex, state, ...species, presentation: c[0], factor, yield_pct: Number((100 / factor).toFixed(1)) });
    }
  }
  return rows;
}
const rows = [
  ...factors(between('## ANNEX XII', '## ANNEX XIII'), 'fresh', 'XII'),
  ...factors(between('## ANNEX XIII', '## ANNEX XIV'), 'fresh salted', 'XIII'),
  ...factors(between('## ANNEX XIV', '## ANNEX XV'), 'frozen', 'XIV'),
];

const provenance = {
  regulation: 'Commission Implementing Regulation (EU) 2025/2196 of 17 October 2025',
  eli: 'http://data.europa.eu/eli/reg_impl/2025/2196/oj',
  input_sha256: createHash('sha256').update(raw).digest('hex'),
};
const write = (name, body) => writeFileSync(join(HERE, name), `${JSON.stringify({ ...provenance, ...body }, null, 2)}\n`);
write('presentation-codes.json', { table: 'Annex I, Table 1', codes: presentations });
write('state-codes.json', { table: 'Annex I, Table 2', codes: states });
write('conversion-factors.json', { note: 'factor = live weight / product weight; yield_pct = 100 / factor, rounded to one decimal', rows });
const species = new Set(rows.map((r) => r.asfis));
console.log(`${presentations.length} presentation codes, ${states.length} states, ${rows.length} factors for ${species.size} species (${['XII', 'XIII', 'XIV'].map((a) => `${a}: ${rows.filter((r) => r.annex === a).length}`).join(', ')}).`);
