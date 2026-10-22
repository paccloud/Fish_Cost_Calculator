/**
 * Tests for scripts/check-secrets.mjs, review round 18: the history modes (--range, --history) leave out the ADDED lines of the
 * scanner's own test files (app/src/lib/__tests__/checkSecrets*.test.js, exact paths) and say so in one note line, while the
 * same line in any other path is still reported and the tree scan of those files is unchanged.
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
import { fileURLToPath } from 'node:url';
import { formatFixtureNote, formatHistoryReport, isScannerFixture, scanText } from '../../../../scripts/check-secrets.mjs';

const SLOW_TEST_MS = 120_000;
const SLOW = { timeout: SLOW_TEST_MS };

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '../../../..');
const SCANNER = path.join(REPO_ROOT, 'scripts', 'check-secrets.mjs');

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

// The exact paths the exemption covers, and near misses that it must not cover.
const FIXTURE_FILE = 'app/src/lib/__tests__/checkSecrets.test.js';
const FIXTURE_ROUND_FILE = 'app/src/lib/__tests__/checkSecrets.r17a.test.js';
const OTHER_PATHS = [
  'app/src/lib/__tests__/other.test.js',
  'app/src/lib/__tests__/checkSecretsHelper.js',
  'app/src/lib/__tests__/checkSecrets.test.jsx',
  'app/src/lib/__tests__/checkSecrets.test.js.bak',
  'app/src/lib/checkSecrets.test.js',
  'app/src/__tests__/checkSecrets.test.js',
  'src/lib/__tests__/checkSecrets.test.js',
  'lib/app/src/lib/__tests__/checkSecrets.test.js',
  'app/src/lib/__tests__/nested/checkSecrets.test.js',
  'scripts/x.mjs',
  'scripts/checkSecrets.test.js',
  // Near misses from review round 19: case, a trailing blank, other extensions, a look-alike letter, a subdirectory, a top-level b/.
  'app/src/lib/__tests__/CheckSecrets.test.js',
  'app/src/lib/__tests__/checkSecrets.test.js ',
  'app/src/lib/__tests__/checkSecrets.test.mjs',
  'app/src/lib/__tests__/checkSecrets.test.ts',
  'app/src/lib/__tests__/checkSecrets.test.\u0458s',
  'app/src/lib/__tests__/checkSecrets.test.js/x.js',
  'b/app/src/lib/__tests__/checkSecrets.test.js',
];
// A git path is always "/"-separated; a backslash is a literal character of the name. This one is a single root-level file.
const BACKSLASH_NAME = 'app\\src\\lib\\__tests__\\checkSecrets.test.js';
const NOTE_START = 'note: ';
const NOTE_TEXT = "of the scanner's own test files (app/src/lib/__tests__/checkSecrets*.test.js)";

describe('review round 18: scanner fixture files in --range and --history', () => {
  const NAME = secretName('JWT_', 'SECRET');
  const value = randomString(32, 18001);
  // A quoted random literal under a strong name: a finding in source code (secret-assignment), fixture-shaped like the real tests.
  const line = `const ${NAME} = "${value}";\n`;
  const fixtureBody = `// a fixture\n${line}`;

  it('the fixture line itself is a finding for scanText in every path (the exemption is a history-mode policy, not a rule change)', () => {
    for (const file of [FIXTURE_FILE, FIXTURE_ROUND_FILE, ...OTHER_PATHS]) {
      expect(scanText(file, fixtureBody).map((f) => f.rule), file).toContain('secret-assignment');
    }
  });

  describe('isScannerFixture matches the exact paths and nothing else', () => {
    it.each([FIXTURE_FILE, FIXTURE_ROUND_FILE, 'app/src/lib/__tests__/checkSecrets.r18-range-fixture.test.js', 'app/src/lib/__tests__/checkSecrets.anything.test.js'])(
      'matches %s',
      (file) => {
        expect(isScannerFixture(file)).toBe(true);
      },
    );
    it.each(OTHER_PATHS)('does not match %s', (file) => {
      expect(isScannerFixture(file)).toBe(false);
    });
    it('matches the git path as it is: a name holding backslashes is never the fixture, on any platform', () => {
      // Git prints "/" on every platform, so no OS-separator conversion applies (on Windows it would turn this name into the fixture).
      expect(isScannerFixture(BACKSLASH_NAME)).toBe(false);
      expect(isScannerFixture(FIXTURE_FILE.split('/').join('\\'))).toBe(false);
    });
  });

  describe('formatFixtureNote and formatHistoryReport', () => {
    it('is empty when no fixture version was skipped', () => {
      expect(formatFixtureNote({})).toBe('');
      expect(formatFixtureNote({ binary: 2 })).toBe('');
      expect(formatHistoryReport([], { commits: 1 })).not.toContain(NOTE_START);
    });
    it('is one line that names the files and the count', () => {
      const one = formatFixtureNote({ 'scanner-fixture': 1 });
      expect(one.split('\n')).toHaveLength(1);
      expect(one).toContain('1 version ');
      expect(one).toContain(NOTE_TEXT);
      expect(one).toContain('reviewed by hand');
      const many = formatFixtureNote({ 'scanner-fixture': 3, binary: 1 });
      expect(many).toContain('3 versions ');
    });
    it('is part of a hits report when fixture versions were skipped', () => {
      const hit = { commit: 'a'.repeat(40), path: 'scripts/x.mjs', rule: 'secret-assignment', count: 1 };
      const report = formatHistoryReport([hit], { commits: 2, label: '--range', skipped: { 'scanner-fixture': 1 } });
      expect(report).toContain(NOTE_TEXT);
      expect(report).toContain('scripts/x.mjs');
    });
  });

  describe.runIf(hasGit())('in a temporary repository', () => {
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
    const commit = (dir, files, message = 'c') => {
      for (const [file, content] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        writeFileSync(path.join(dir, file), content);
      }
      git(dir, 'add', '-A');
      expect(git(dir, 'commit', '-q', '-m', message).status).toBe(0);
      return git(dir, 'rev-parse', 'HEAD').stdout.trim();
    };
    const output = (result) => `${result.stdout}\n${result.stderr}`;
    const expectNoValue = (text) => {
      for (const piece of windows(value)) expect(text).not.toContain(piece);
    };

    it.each([FIXTURE_FILE, FIXTURE_ROUND_FILE])(
      'a commit that adds the fixture line to %s and a later commit that removes it: --range passes and says what it skipped',
      SLOW,
      (file) => {
        const dir = makeRepo();
        const base = commit(dir, { 'README.md': '# t\n' });
        commit(dir, { [file]: fixtureBody }, 'add fixture');
        commit(dir, { [file]: '// rewritten\n' }, 'rewrite fixture');
        const result = scan(dir, '--range', `${base}..HEAD`);
        const text = output(result);
        expect(result.status, text).toBe(0);
        expect(text).not.toContain('INCOMPLETE');
        expect(text).toContain(NOTE_TEXT);
        expect(text).toContain('no hits in 2 commits');
        expect(text).toContain('2 scanner-fixture'); // the add and the rewrite each added lines to the file
        // One note line only, on stdout, and the tree is clean at the tip too.
        expect(result.stdout.split('\n').filter((l) => l.startsWith(NOTE_START))).toHaveLength(1);
        expect(scan(dir).status).toBe(0);
        expectNoValue(text);
      },
    );

    it(
      'a fixture line that is still at the tip: --range passes, but the tree scan reports it (no allow marker)',
      SLOW,
      () => {
        const dir = makeRepo();
        const base = commit(dir, { 'README.md': '# t\n' });
        commit(dir, { [FIXTURE_FILE]: fixtureBody }, 'add fixture');
        const range = scan(dir, '--range', `${base}..HEAD`);
        expect(range.status, output(range)).toBe(0);
        expect(output(range)).toContain(NOTE_TEXT);
        const tree = scan(dir);
        const text = output(tree);
        expect(tree.status, text).toBe(1);
        expect(text).toContain(FIXTURE_FILE);
        expect(text).toContain('secret-assignment');
        expectNoValue(text);
        // An allow marker on the line is the only way the tree scan lets a fixture through, exactly as before.
        commit(dir, { [FIXTURE_FILE]: `// a fixture\nconst ${NAME} = "${value}"; // check-secrets:allow\n` }, 'mark');
        expect(scan(dir).status).toBe(0);
      },
    );

    it.each(OTHER_PATHS)(
      'the same line added in %s is still reported by --range (exit 1) and the note is absent',
      SLOW,
      (file) => {
        const dir = makeRepo();
        const base = commit(dir, { 'README.md': '# t\n' });
        commit(dir, { [file]: fixtureBody }, 'add');
        commit(dir, { [file]: '// rewritten\n' }, 'rewrite');
        const result = scan(dir, '--range', `${base}..HEAD`);
        const text = output(result);
        expect(result.status, text).toBe(1);
        expect(text).toContain(file);
        expect(text).toContain('secret-assignment');
        expect(text).not.toContain(NOTE_START);
        expectNoValue(text);
      },
    );

    it(
      'a range with a fixture version AND a real hit elsewhere fails, and the report carries both the hit and the note',
      SLOW,
      () => {
        const dir = makeRepo();
        const base = commit(dir, { 'README.md': '# t\n' });
        commit(dir, { [FIXTURE_FILE]: fixtureBody, 'scripts/x.mjs': fixtureBody }, 'both');
        const result = scan(dir, '--range', `${base}..HEAD`);
        const text = output(result);
        expect(result.status, text).toBe(1);
        expect(text).toContain('scripts/x.mjs');
        expect(text).not.toMatch(/^\s+[0-9a-f]{7}\s+app\/src\/lib\/__tests__\/checkSecrets\.test\.js/m);
        expect(text).toContain(NOTE_TEXT);
        expect(text).toContain('1 hit in 1 of 1 commit');
        expectNoValue(text);
      },
    );

    it(
      '--history treats the fixture file the same way (skipped by design, never INCOMPLETE)',
      SLOW,
      () => {
        const dir = makeRepo();
        commit(dir, { 'README.md': '# t\n' });
        commit(dir, { [FIXTURE_FILE]: fixtureBody }, 'add fixture');
        commit(dir, { [FIXTURE_FILE]: '// rewritten\n' }, 'rewrite fixture');
        const result = scan(dir, '--history');
        const text = output(result);
        expect(result.status, text).toBe(0);
        expect(text).not.toContain('INCOMPLETE');
        expect(text).toContain(NOTE_TEXT);
        expect(text).toContain('no hits in 3 commits');
        expect(text).toContain('2 scanner-fixture'); // the add and the rewrite each added lines to the file
        expectNoValue(text);
      },
    );

    // diff.noprefix in the user's git config (here through GIT_CONFIG_* so the real config is untouched) drops the "b/" of each
    // "+++ " line in `git log -p`. The scanner passes explicit prefixes, so a real top-level b/ directory is never stripped.
    const NOPREFIX = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'diff.noprefix', GIT_CONFIG_VALUE_0: 'true' };
    const scanWithEnv = (cwd, env, ...args) =>
      spawnSync(process.execPath, [SCANNER, ...args], { cwd, encoding: 'utf8', timeout: SLOW_TEST_MS, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } });

    it.each([['--range'], ['--history']])(
      'with diff.noprefix=true, %s still reports a secret added and removed at b/app/src/lib/__tests__/checkSecrets.test.js',
      SLOW,
      (mode) => {
        const dir = makeRepo();
        const file = `b/${FIXTURE_FILE}`;
        const base = commit(dir, { 'README.md': '# t\n' });
        commit(dir, { [file]: fixtureBody }, 'add');
        commit(dir, { [file]: '// rewritten\n' }, 'rewrite');
        const args = mode === '--range' ? ['--range', `${base}..HEAD`] : ['--history'];
        for (const env of [{}, NOPREFIX]) {
          const result = scanWithEnv(dir, env, ...args);
          const text = output(result);
          expect(result.status, text).toBe(1);
          expect(text).toContain(file);
          expect(text).toContain('secret-assignment');
          expect(text).not.toContain(NOTE_START);
          expectNoValue(text);
        }
      },
    );

    it(
      'with diff.noprefix=true the real fixture file is still left out (exit 0, note shown)',
      SLOW,
      () => {
        const dir = makeRepo();
        const base = commit(dir, { 'README.md': '# t\n' });
        commit(dir, { [FIXTURE_FILE]: fixtureBody }, 'add fixture');
        commit(dir, { [FIXTURE_FILE]: '// rewritten\n' }, 'rewrite fixture');
        const result = scanWithEnv(dir, NOPREFIX, '--range', `${base}..HEAD`);
        expect(result.status, output(result)).toBe(0);
        expect(output(result)).toContain('2 scanner-fixture');
      },
    );

    it.runIf(process.platform !== 'win32')(
      'a root-level file whose name holds backslashes is scanned like any other path by --range',
      SLOW,
      () => {
        const dir = makeRepo();
        const base = commit(dir, { 'README.md': '# t\n' });
        commit(dir, { [BACKSLASH_NAME]: fixtureBody }, 'add');
        commit(dir, { [BACKSLASH_NAME]: '// rewritten\n' }, 'rewrite');
        const result = scan(dir, '--range', `${base}..HEAD`);
        const text = output(result);
        expect(result.status, text).toBe(1);
        expect(text).toContain('secret-assignment');
        expect(text).not.toContain(NOTE_START);
        expectNoValue(text);
      },
    );

    it(
      'an INCOMPLETE --range or --history result still names the skipped fixture versions',
      SLOW,
      () => {
        const dir = makeRepo();
        const base = commit(dir, { 'README.md': '# t\n' });
        // A fixture version and an over-the-limit text file elsewhere: the run is incomplete (exit 2), and the note is in it.
        commit(dir, { [FIXTURE_FILE]: fixtureBody, 'data/big.txt': `${'word '.repeat(1_300_000)}\n` }, 'both');
        for (const args of [['--range', `${base}..HEAD`], ['--history']]) {
          const result = scan(dir, ...args);
          const text = output(result);
          expect(result.status, text).toBe(2);
          expect(text).toContain('INCOMPLETE');
          expect(text).toContain(NOTE_TEXT);
        }
      },
    );

    it(
      'a merge whose result rewrites the fixture file is left out and counted too, and a merge of any other file is not',
      SLOW,
      () => {
        const dir = makeRepo();
        const base = commit(dir, { [FIXTURE_FILE]: '// top\n\n\n\n// bottom\n', 'scripts/x.mjs': '// top\n\n\n\n// bottom\n' });
        expect(git(dir, 'checkout', '-q', '-b', 'side').status).toBe(0);
        commit(dir, { [FIXTURE_FILE]: `// top\n\n\n\n${line}`, 'scripts/x.mjs': `// top\n\n\n\n${line}` }, 'side adds');
        expect(git(dir, 'checkout', '-q', 'main').status).toBe(0);
        commit(dir, { [FIXTURE_FILE]: '// top changed\n\n\n\n// bottom\n', 'scripts/x.mjs': '// top changed\n\n\n\n// bottom\n' }, 'main edits');
        expect(git(dir, 'merge', '-q', '--no-ff', '--no-edit', 'side').status).toBe(0);
        const result = scan(dir, '--range', `${base}..HEAD`);
        const text = output(result);
        // The side commit is the one that added the line to scripts/x.mjs: reported there, exit 1; the fixture file is never named.
        expect(result.status, text).toBe(1);
        expect(text).toContain('scripts/x.mjs');
        expect(text).not.toMatch(/^\s+[0-9a-f]{7}\s+app\/src\/lib\/__tests__\/checkSecrets\.test\.js/m);
        expect(text).toContain(NOTE_TEXT);
        expectNoValue(text);
      },
    );
  });
});
