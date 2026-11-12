// Joins the per-page transcriptions in pages/ into one dataset, and refuses to if a page is malformed.
//
//   node research/mab37/build.mjs
//
// Writes mab37.json (every row, in print order, with an id that says where it is on the page) and
// mab37.csv (the same rows for a spreadsheet). The page files are the record of what was read from
// the scan; nothing here changes a value.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGES = join(HERE, 'pages');

const isYield = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 100;
const text = (v) => typeof v === 'string' && v.trim() === v && v.length > 0;

export function validatePage(page, file) {
  const problems = [];
  const say = (i, msg) => problems.push(`${file}${i === null ? '' : ` row ${i + 1}`}: ${msg}`);
  if (!Number.isInteger(page.pdf_page)) say(null, 'pdf_page must be a whole number');
  if (page.side !== 'left' && page.side !== 'right') say(null, 'side must be "left" or "right"');
  if (!Array.isArray(page.rows)) { say(null, 'rows must be a list'); return problems; }
  page.rows.forEach((row, i) => {
    if (!text(row.species)) say(i, 'species is missing');
    if (!text(row.from)) say(i, 'from is missing');
    if (!text(row.to)) say(i, 'to is missing');
    if (row.average !== null && !isYield(row.average)) say(i, `average ${row.average} is not above 0 and up to 100`);
    if (row.range !== null) {
      if (!Array.isArray(row.range) || row.range.length !== 2 || !row.range.every(isYield)) say(i, `range ${JSON.stringify(row.range)} is not two yields`);
      else if (row.range[0] > row.range[1]) say(i, `range ${row.range.join('-')} is backwards`);
    }
    if (row.average === null && row.range === null) say(i, 'has neither an average nor a range');
    for (const key of ['group', 'subheading', 'scientific_name', 'scientific_name_as_printed', 'check']) {
      if (row[key] !== null && row[key] !== undefined && !text(row[key])) say(i, `${key} must be text or null`);
    }
    // The legend spells these D/H-On, D/H-Off and S/B. The scan's text layer reads them O/H and SIB.
    for (const key of ['from', 'to']) {
      if (/\bSIB\b|\bO\/H\b|\bOIH\b|\bDIH\b|\bD\/ H\b/.test(row[key] ?? '')) say(i, `${key} "${row[key]}" still carries an OCR spelling`);
    }
  });
  return problems;
}

export function loadPages(dir = PAGES) {
  const files = readdirSync(dir).filter((f) => /^page-\d{2}-(left|right)\.json$/.test(f)).sort();
  return files.map((file) => ({ file, page: JSON.parse(readFileSync(join(dir, file), 'utf8')) }));
}

export function build(pages) {
  const rows = [];
  const notes = [];
  const crossReferences = [];
  for (const { page } of pages) {
    const where = `p${String(page.pdf_page).padStart(2, '0')}${page.side === 'left' ? 'L' : 'R'}`;
    page.rows.forEach((row, i) => {
      rows.push({
        id: `${where}-${String(i + 1).padStart(2, '0')}`,
        pdf_page: page.pdf_page,
        side: page.side,
        book_page: page.book_page ?? null,
        group: row.group ?? null,
        species: row.species,
        subheading: row.subheading ?? null,
        scientific_name: row.scientific_name ?? null,
        scientific_name_as_printed: row.scientific_name_as_printed ?? null,
        ...(row.applies_to_species ? { applies_to_species: row.applies_to_species } : {}),
        from: row.from,
        to: row.to,
        average: row.average,
        range: row.range,
        check: row.check ?? null,
      });
    });
    for (const note of page.notes ?? []) notes.push({ pdf_page: page.pdf_page, side: page.side, ...note });
    for (const ref of page.cross_references ?? []) crossReferences.push({ pdf_page: page.pdf_page, side: page.side, ...ref });
  }
  return { rows, notes, crossReferences };
}

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join('; ') : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function main() {
  const pages = loadPages();
  const problems = pages.flatMap(({ file, page }) => validatePage(page, file));
  if (problems.length) {
    console.error(problems.join('\n'));
    console.error(`\n${problems.length} problem(s). Nothing written.`);
    process.exit(1);
  }
  const { rows, notes, crossReferences } = build(pages);
  const dataset = {
    source: {
      title: 'Recoveries and Yields from Pacific Fish and Shellfish',
      series: 'Marine Advisory Bulletin No. 37, revised 2004',
      publisher: 'Alaska Sea Grant College Program',
      isbn: '1-56612-012-8',
      transcribed_from: 'research/MAB-37PDF-Recoveries and Yields fro.pdf, PDF pages 5 to 16, read from the page images',
      note: 'Yields are percentages of the starting form\'s weight. The publisher holds the copyright in the bulletin.',
    },
    rows,
    notes,
    cross_references: crossReferences,
  };
  writeFileSync(join(HERE, 'mab37.json'), `${JSON.stringify(dataset, null, 2)}\n`);
  const columns = ['id', 'pdf_page', 'side', 'book_page', 'group', 'species', 'subheading', 'scientific_name', 'from', 'to', 'average', 'range_low', 'range_high', 'check'];
  const lines = [columns.join(',')];
  for (const r of rows) {
    const flat = { ...r, range_low: r.range?.[0] ?? null, range_high: r.range?.[1] ?? null };
    lines.push(columns.map((c) => csvCell(flat[c])).join(','));
  }
  writeFileSync(join(HERE, 'mab37.csv'), `${lines.join('\n')}\n`);
  const flagged = rows.filter((r) => r.check).length;
  console.log(`${pages.length} half pages, ${rows.length} rows (${rows.filter((r) => r.range).length} with a range, ${flagged} flagged for a second look), ${notes.length} notes.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
