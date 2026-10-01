/**
 * Tests for scripts/check-secrets.mjs, review round 18: Rust raw strings (r"...", r#"..."#, any hash count) and backtick literals
 * that run over several lines, as the value of an assignment or of an environment setter call (std::env::set_var, os.Setenv).
 * The body is judged like a heredoc; one that does not end within the multi-line bounds is reported (fail closed).
 *
 * Every fake credential below is assembled at RUNTIME from pieces, so this file contains no secret-shaped literal and passes the
 * scanner itself. Do not paste a real credential here.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanText } from '../../../../scripts/check-secrets.mjs';

const HOSTILE_LIMIT_MS = 8000;
const SLOW_TEST_MS = 120_000;
const SLOW = { timeout: SLOW_TEST_MS };
const CHILD_KILL_MS = 100_000;

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '../../../..');
const SCANNER = path.join(REPO_ROOT, 'scripts', 'check-secrets.mjs');
const SCAN_MODULE_IMPORT = `import { scanText } from ${JSON.stringify(pathToFileURL(SCANNER).href)};`;

/** Hostile scans run in a child process with a hard kill timeout, so a backtracking regex fails the test instead of hanging it. */
function timeInChild(body) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `${SCAN_MODULE_IMPORT}\nconst timings = [];\n${body}\nconsole.log(JSON.stringify(timings));`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: CHILD_KILL_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
  expect(result.error, 'the child was killed: a scan is backtracking').toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim());
}

const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Deterministic pseudo-random string so failures are reproducible. */
function randomString(length, seed, alphabet = ALNUM) {
  let state = seed;
  let out = '';
  for (let i = 0; i < length; i += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    out += alphabet[Math.floor(state / 65536) % alphabet.length];
  }
  return out;
}

function windows(secret, size = 8) {
  const out = [];
  for (let i = 0; i + size <= secret.length; i += 1) out.push(secret.slice(i, i + size));
  return out;
}

const secretName = (...parts) => parts.join('');
const hasGit = () => spawnSync('git', ['--version']).status === 0;

describe('review round 18: multi-line Rust raw strings', () => {
  const NAME = secretName('JWT_', 'SECRET');
  const value = randomString(24, 18001);
  const count = (file, text) => scanText(file, text).length;
  const rules = (file, text) => scanText(file, text).map((f) => f.rule);
  const lines = (file, text) => scanText(file, text).map((f) => f.line);
  // Rust raw string openers and closers by hash count: r"..." (0), r#"..."# (1), r##"..."## (2), r################"..."# (16, the cap).
  const raw = (hashes, body, prefix = 'r') => `${prefix}${'#'.repeat(hashes)}"${body}"${'#'.repeat(hashes)}`;
  const HASH_COUNTS = [0, 1, 2, 3, 16];

  const dirs = [];
  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
  });
  const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: SLOW_TEST_MS, maxBuffer: 64 * 1024 * 1024 });
  const scan = (cwd, ...args) => run(process.execPath, [SCANNER, ...args], cwd);
  const git = (cwd, ...args) => run('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], cwd);
  const makeRepo = () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'check-secrets-r18-'));
    dirs.push(dir);
    expect(run('git', ['init', '-q', '-b', 'main'], dir).status).toBe(0);
    return dir;
  };
  const commit = (dir, files) => {
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), content);
    }
    git(dir, 'add', '-A');
    expect(git(dir, 'commit', '-q', '-m', 'c').status).toBe(0);
    return git(dir, 'rev-parse', 'HEAD').stdout.trim();
  };

  // -------------------------------------------------------------------------
  describe('(1) the value of an assignment', () => {
    const assignment = (literal) => `const ${NAME}: &str = ${literal};\n`;

    it.each(HASH_COUNTS)('one line, %i hashes: still reported', (hashes) => {
      expect(rules('src/config.rs', assignment(raw(hashes, value)))).toContain('secret-assignment');
    });

    it.each(HASH_COUNTS)('the value on the first line of a literal over lines, %i hashes', (hashes) => {
      expect(rules('src/config.rs', assignment(raw(hashes, `${value}\ncontinued`)))).toContain('secret-assignment');
    });

    it.each(HASH_COUNTS)('the value on a later line of a literal over lines, %i hashes', (hashes) => {
      expect(rules('src/config.rs', assignment(raw(hashes, `\n    ${value}\n`)))).toContain('secret-assignment');
    });

    it('a byte raw string (br"...") over lines', () => {
      expect(rules('src/config.rs', assignment(raw(0, `${value}\ncontinued`, 'br')))).toContain('secret-assignment');
      expect(rules('src/config.rs', assignment(raw(1, `${value}\ncontinued`, 'br')))).toContain('secret-assignment');
    });

    it('the finding is on the line of the name, not the line of the value', () => {
      expect(lines('src/config.rs', `fn main() {\n${assignment(raw(1, `\n${value}\n`))}}\n`)).toEqual([2]);
    });

    it('a hashed raw string over lines in another language file is read too (the hashes mark it)', () => {
      expect(rules('lib/config.swift', assignment(raw(2, `${value}\ncontinued`)))).toContain('secret-assignment');
    });

    it('a Go backtick value over lines in a setter call is read (the assignment form already was)', () => {
      expect(rules('main.go', `func main() { os.Setenv("${NAME}", \`${value}\ncontinued\`) }\n`)).toContain('secret-assignment');
    });

    it.each([
      ['a placeholder body', assignment(raw(1, `\n${['your', 'secret', 'here'].join('_')}\n`))],
      ['a reference', assignment(raw(1, `\n$\{${secretName('JWT_', 'SECRET')}}\n`))],
      ['an SQL query under a secret-like name', `let ${secretName('TOKEN_', 'QUERY')} = ${raw(1, '\nselect id, name from users\nwhere id = 1\n')};\n`],
      ['a non-secret name', `const BANNER: &str = ${raw(1, `\n${value}\n`)};\n`],
      ['an allow marker on the closing line', assignment(raw(1, `\n${value}\n`)).replace(';\n', '; // check-secrets:allow\n')],
      ['an allow marker on the opening line', assignment(raw(1, `\n${value}\n`)).replace('r#"\n', 'r#" // check-secrets:allow\n')],
    ])('does not report %s', (_label, text) => {
      expect(count('src/config.rs', text)).toBe(0);
    });

    it('a Python raw string stays one line: the next line of code is not part of the value', () => {
      // Python r"..." cannot contain a line break, so an unclosed r" is a syntax error there, not a literal that runs on.
      expect(count('config.py', `${NAME} = r"\nx = "${value}"\n`)).toBe(0);
      // but closed on its line it is reported as before
      expect(rules('config.py', `${NAME} = r"${value}"\n`)).toContain('secret-assignment');
    });
  });

  // -------------------------------------------------------------------------
  describe('(2) the value of an environment setter call', () => {
    const setter = (callee, literal) => `fn main() {\n    ${callee}("${NAME}", ${literal});\n}\n`;
    const CALLEES = ['std::env::set_var', 'env::set_var'];

    it.each(CALLEES.flatMap((callee) => HASH_COUNTS.map((hashes) => [callee, hashes])))('one line: %s with %i hashes', (callee, hashes) => {
      expect(rules('src/main.rs', setter(callee, raw(hashes, value)))).toContain('secret-assignment');
    });

    it.each(CALLEES.flatMap((callee) => HASH_COUNTS.map((hashes) => [callee, hashes])))('over lines: %s with %i hashes', (callee, hashes) => {
      expect(rules('src/main.rs', setter(callee, raw(hashes, `${value}\ncontinued`)))).toContain('secret-assignment');
      expect(rules('src/main.rs', setter(callee, raw(hashes, `\n    ${value}\n`)))).toContain('secret-assignment');
    });

    it('the finding is on the line of the call', () => {
      expect(lines('src/main.rs', setter('std::env::set_var', raw(1, `\n${value}\n`)))).toEqual([2]);
    });

    it.each([
      ['a placeholder', setter('std::env::set_var', raw(1, `\n${['change', 'me'].join('-')}\n`))],
      ['a non-secret name', setter('std::env::set_var', raw(1, `\n${value}\n`)).replace(NAME, 'RUST_LOG_FORMAT')],
      ['a variable', `fn main() {\n    std::env::set_var("${NAME}", value);\n}\n`],
    ])('does not report %s', (_label, text) => {
      expect(count('src/main.rs', text)).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('(3) the bounds: an unterminated or oversize raw string is reported, not read to the end of the file', () => {
    const opener = (hashes) => `r${'#'.repeat(hashes)}"`;

    it.each(HASH_COUNTS)('an unterminated raw string in an assignment, %i hashes', (hashes) => {
      const text = `const ${NAME}: &str = ${opener(hashes)}${value}\nfn main() {}\n`;
      expect(rules('src/config.rs', text)).toContain('secret-assignment');
    });

    it('an unterminated raw string in a setter call', () => {
      expect(rules('src/main.rs', `fn main() {\n    std::env::set_var("${NAME}", r#"\n    unterminated\n}\n`)).toContain('secret-assignment');
    });

    it('a raw string whose closer is a different hash count is unterminated', () => {
      // r##"..."# does not close an r##" literal, so the value runs to the end of the file: reported.
      expect(rules('src/config.rs', `const ${NAME}: &str = r##"\n${value}\n"#;\n`)).toContain('secret-assignment');
    });

    it('a raw string over more lines than the bound is reported even when its body is harmless', () => {
      const body = 'harmless line of prose\n'.repeat(201);
      expect(rules('src/config.rs', `const ${NAME}: &str = r#"\n${body}"#;\n`)).toContain('secret-assignment');
      // within the bound, the same harmless body is not
      expect(count('src/config.rs', `const ${NAME}: &str = r#"\n${'harmless line of prose\n'.repeat(150)}"#;\n`)).toBe(0);
    });

    it('a raw string over more characters than the bound is reported even when its body is harmless', () => {
      const body = `${'x'.repeat(4000)}\n`.repeat(9);
      expect(rules('src/config.rs', `const ${NAME}: &str = r#"\n${body}"#;\n`)).toContain('secret-assignment');
    });

    it('hostile inputs stay linear', SLOW, () => {
      const timings = timeInChild(`
        const name = 'JWT' + '_SECRET';
        const cases = {
          unterminatedAssignments: ('const ' + name + ': &str = r#"\\n').repeat(40000),
          unterminatedSetters: ('std::env::set_var("' + name + '", r##"\\n').repeat(40000),
          unterminatedPlain: (name + ' = r"\\n').repeat(40000),
          unterminatedBackticks: ('os.Setenv("' + name + '", \`\\n').repeat(40000),
          oneHugeLine: ('const ' + name + ': &str = r#"').repeat(100000),
          closedOnLaterLines: ('const ' + name + ': &str = r#"\\nabc\\n"#;\\n').repeat(40000),
        };
        for (const [label, text] of Object.entries(cases)) {
          for (const file of ['a.rs', 'a.go', 'a.py', 'a.swift']) {
            const start = performance.now();
            const found = scanText(file, text);
            timings.push([label + ' ' + file, performance.now() - start, found.length]);
          }
        }
      `);
      for (const [label, ms] of timings) expect(ms, label).toBeLessThan(HOSTILE_LIMIT_MS);
      // the unterminated Rust openers are reported (fail closed), not skipped
      for (const [label, , found] of timings) {
        if (label.startsWith('unterminated') && !label.startsWith('unterminatedPlain') && !label.startsWith('unterminatedBackticks') && label.endsWith('a.rs')) {
          expect(found, label).toBeGreaterThanOrEqual(1);
        }
      }
      expect(timings.find(([label]) => label === 'unterminatedPlain a.rs')[2]).toBeGreaterThanOrEqual(1);
      expect(timings.find(([label]) => label === 'unterminatedBackticks a.go')[2]).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  it.skipIf(!hasGit())('the tree scan and --range report the assignment and the setter without printing the value', SLOW, () => {
    const dir = makeRepo();
    const base = commit(dir, { 'README.md': '# demo\n' });
    expect(scan(dir).status).toBe(0);
    commit(dir, {
      'src/config.rs': `pub const ${NAME}: &str = ${raw(1, `${value}\ncontinued`)};\n`,
      'src/main.rs': `fn main() {\n    std::env::set_var("${NAME}", ${raw(2, `\n${value}\n`)});\n}\n`,
      'src/unterminated.rs': `const ${NAME}: &str = r#"\nnever closed\n`,
    });
    for (const args of [[], ['--range', `${base}..HEAD`]]) {
      const result = scan(dir, ...args);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status, output).toBe(1);
      expect(output).toContain('src/config.rs');
      expect(output).toContain('src/main.rs');
      expect(output).toContain('src/unterminated.rs');
      for (const piece of windows(value)) expect(output).not.toContain(piece);
    }
  });
});
