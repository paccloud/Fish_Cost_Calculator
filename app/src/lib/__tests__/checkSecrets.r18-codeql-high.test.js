/**
 * Tests for scripts/check-secrets.mjs, review round 18: the CodeQL HIGH alert on PR #120 (js/incomplete-sanitization).
 *
 * The alert was in the test suite, not the scanner: the chpasswd test built a shell-escaped passphrase with
 * `phrase.replace(/ /g, '\\ ')`, an escape that adds backslashes without first escaping the backslashes already in the input.
 * The fixed helper (`shellEscape` below, the same expression as in checkSecrets.test.js) escapes a backslash and a space in one
 * pass. These tests pin the scanner down on every shape that helper can produce: a passphrase with escaped spaces, one that also
 * holds a literal backslash (escaped as `\\`), and a hostile line of nothing but escapes, which must stay linear.
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

/** Shell-escape a word for an unquoted position: a backslash before each backslash and space, in one pass (backslash first). */
const shellEscape = (text) => text.replace(/[\\ ]/g, '\\$&');

const secretName = (...parts) => parts.join('');
const hasGit = () => spawnSync('git', ['--version']).status === 0;

describe('review round 18: CodeQL js/incomplete-sanitization in the chpasswd tests', () => {
  const CHPASSWD = secretName('chp', 'asswd');
  const account = 'admin';
  const phrase = ['correct horse', ' battery staple'].join('');
  // A passphrase that holds a literal backslash: the shell needs it written as `\\`, and the scanner must read it back as one.
  const slashed = ['correct horse\\', ' battery staple'].join('');
  const count = (file, text) => scanText(file, text).length;
  const rules = (file, text) => scanText(file, text).map((f) => f.rule);

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

  it('the helper escapes a backslash before it escapes a space', () => {
    expect(shellEscape('a b')).toBe('a\\ b');
    expect(shellEscape('a\\ b')).toBe('a\\\\\\ b'); // the input backslash is doubled; the space gets its own
    expect(shellEscape('a\\b')).toBe('a\\\\b');
    expect(shellEscape('')).toBe('');
  });

  it('reports a passphrase written with escaped spaces (the fixed test shape)', () => {
    expect(count('a.sh', `echo ${account}:${shellEscape(phrase)} | ${CHPASSWD}\n`)).toBe(1);
    expect(rules('a.sh', `echo ${account}:${shellEscape(phrase)} | ${CHPASSWD}\n`)).toEqual(['config-directive-secret']);
  });

  it('reports a passphrase that holds a literal backslash, escaped as the shell needs it', () => {
    const line = `echo ${account}:${shellEscape(slashed)} | ${CHPASSWD}\n`;
    expect(line).toContain('\\\\\\ '); // `\\` then `\ `: the backslash and the space after it are both escaped
    expect(count('a.sh', line)).toBe(1);
    expect(count('Dockerfile', `RUN ${line}`)).toBe(1);
  });

  it('still passes references and placeholders written with the same escaping', () => {
    for (const p of ['${PASSWORD}', '$PASSWORD', 'changeme', 'change me']) {
      expect(count('a.sh', `echo ${account}:${shellEscape(p)} | ${CHPASSWD}\n`), p).toBe(0);
    }
  });

  it('never prints the passphrase, through the CLI, for the escaped shapes', SLOW, () => {
    if (!hasGit()) return;
    const dir = makeRepo();
    const base = commit(dir, { 'setup.sh': '#!/bin/sh\n' });
    const head = commit(dir, {
      'setup.sh': `#!/bin/sh\necho ${account}:${shellEscape(phrase)} | ${CHPASSWD}\n`,
      'users.sh': `echo ${account}:${shellEscape(slashed)} | ${CHPASSWD}\n`,
    });
    for (const args of [[], ['--range', `${base}..${head}`]]) {
      const found = scan(dir, ...args);
      expect(found.status, `${args.join(' ')}: ${found.stderr}`).toBe(1);
      expect(found.stderr).toContain('setup.sh');
      expect(found.stderr).toContain('users.sh');
      for (const leak of ['horse', 'battery', 'staple', shellEscape(phrase), shellEscape(slashed)]) {
        expect(`${found.stdout}${found.stderr}`).not.toContain(leak);
      }
    }
  });

  // Review round 19: the same CodeQL query flagged the scanner itself, in goEnvDefaultIsSecret, which escaped a Go variable's dots
  // (`v.replace(/\./g, '\\.')`) to build one regex per variable. That code is gone: one precompiled pattern captures the tested and
  // the assigned names, and they are compared with the read's variable as strings. These pin the behaviour down.
  describe('Go env defaults on dotted variables (no regex built from file text)', () => {
    const NAME = secretName('DB_', 'PASS', 'WORD');
    const value = ['A7fK9mQ2', 'xL8vN4pR', '6tY3uW8z'].join('');
    const go = (read, test, assign) => `package x\n\nfunc load() {\n\t${read} := os.Getenv("${NAME}")\n\tif ${test} == "" {\n\t\t${assign} = "${value}"\n\t}\n}\n`;
    const fallbacks = (text) => scanText('config.go', text).filter((f) => f.rule === 'hardcoded-secret-fallback');

    it('reports `x.y := os.Getenv(N)` then `if x.y == "" { x.y = "<fake>" }`', () => {
      expect(fallbacks(go('x.y', 'x.y', 'x.y'))).toHaveLength(1);
      expect(fallbacks(go('cfg.Db.Password', 'cfg.Db.Password', 'cfg.Db.Password'))).toHaveLength(1);
    });

    it('does not take a look-alike name (a dot is not a wildcard) for the variable, in the test or in the assignment', () => {
      expect(fallbacks(go('cfg.DbPassword', 'cfgXDbPassword', 'cfg.DbPassword'))).toHaveLength(0);
      expect(fallbacks(go('cfg.DbPassword', 'cfg.DbPassword', 'cfgXDbPassword'))).toHaveLength(0);
      expect(fallbacks(go('cfg.DbPassword', 'cfg.DbPasswordX', 'cfg.DbPassword'))).toHaveLength(0);
      expect(fallbacks(go('x.y', 'x.y', 'x.y.z'))).toHaveLength(0);
    });

    it('reads the other empty tests and the ok flag the same way', () => {
      const lines = (read, test, assign) => `${read}\nif ${test} {\n  ${assign} = "${value}"\n}\n`;
      expect(fallbacks(lines(`a.b := os.Getenv("${NAME}")`, 'len(a.b) == 0', 'a.b'))).toHaveLength(1);
      expect(fallbacks(lines(`a.b := os.Getenv("${NAME}")`, '"" == a.b', 'a.b'))).toHaveLength(1);
      expect(fallbacks(lines(`v, ok := os.LookupEnv("${NAME}")`, '!ok', 'v'))).toHaveLength(1);
      expect(fallbacks(lines(`v, ok := os.LookupEnv("${NAME}")`, '!found', 'v'))).toHaveLength(0);
    });

    it('scans many distinct Go variables in linear time (no per-variable compile)', SLOW, () => {
      const timings = timeInChild(`
        const N = 'JWT_' + 'SECRET';
        const V = 'A7fK9mQ2' + 'xL8vN4pR6tY3uW8';
        let distinct = 'package x\\n';
        for (let i = 0; i < 66000; i += 1) distinct += 'v' + i + ' := os.Getenv("' + N + '")\\n';
        let dotted = 'package x\\n';
        for (let i = 0; i < 3000; i += 1) dotted += 'cfg.A' + i + ' := os.Getenv("' + N + '")\\nif cfg.A' + i + ' == "" {\\n cfg.A' + i + ' = "' + V + '"\\n}\\n';
        for (const text of [distinct, dotted]) {
          const started = performance.now();
          scanText('x.go', text);
          timings.push(Math.round(performance.now() - started));
        }`);
      for (const ms of timings) expect(ms).toBeLessThan(HOSTILE_LIMIT_MS);
    });
  });

  it('scans hostile runs of escapes in linear time', SLOW, () => {
    const timings = timeInChild(`
      const C = 'chp' + 'asswd';
      const texts = [
        'echo admin:' + '\\\\ '.repeat(50000) + ' | ' + C, // 100 KB of escaped spaces
        'echo admin:' + '\\\\\\\\'.repeat(50000) + ' | ' + C, // 100 KB of escaped backslashes
        'echo admin:' + '\\\\\\\\\\\\ '.repeat(30000) + ' | ' + C, // 90 KB of escaped backslash + escaped space pairs
        'echo admin:' + 'a\\\\ '.repeat(30000) + ' | ' + C, // letters between the escapes
        'echo admin:' + '\\\\'.repeat(100000), // a backslash run with no command after it
      ];
      for (const file of ['a.sh', 'Dockerfile']) for (const text of texts) {
        const started = performance.now();
        scanText(file, text);
        timings.push(Math.round(performance.now() - started));
      }`);
    for (const ms of timings) expect(ms).toBeLessThan(HOSTILE_LIMIT_MS);
  });
});
