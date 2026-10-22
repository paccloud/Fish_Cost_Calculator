/**
 * Tests for scripts/check-secrets.mjs, review round 18: lockfile digests are blanked only where the lockfile format puts an
 * integrity value (an integrity / checksum key, the fragment of a resolved URL, a hash-list element, a go.sum or Gemfile.lock
 * CHECKSUMS line), never in an auth field. Before, every string of a digest's exact shape was blanked wherever it stood, so a
 * credential written as "sha512-<base64>" under _authToken (or as a ?token= URL parameter) never reached lockfile-credential.
 *
 * Every fake credential below is assembled at RUNTIME from pieces, so this file contains no secret-shaped literal and passes the
 * scanner itself. Do not paste a real credential here.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sanitizeLockfile, scanText } from '../../../../scripts/check-secrets.mjs';

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
const HEX = '0123456789abcdef';
const BASE64 = `${ALNUM}+/`;

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

const hasGit = () => spawnSync('git', ['--version']).status === 0;
const scheme = ['https', '://'].join('');
const ATBB = ['AT', 'BB'].join('');

// One value of every digest shape the lockfile sanitizer knows, each of its algorithm's exact size.
const DIGEST_SHAPES = [
  ['sha512 SRI', (seed) => `sha512-${randomString(86, seed, BASE64)}==`],
  ['sha384 SRI', (seed) => `sha384-${randomString(64, seed, BASE64)}`],
  ['sha256 SRI', (seed) => `sha256-${randomString(43, seed, BASE64)}=`],
  ['sha1 SRI', (seed) => `sha1-${randomString(27, seed, BASE64)}=`],
  ['go.sum h1', (seed) => `h1:${randomString(43, seed, BASE64)}=`],
  ['sha256:hex', (seed) => `sha256:${randomString(64, seed, HEX)}`],
  ['sha512=hex', (seed) => `sha512=${randomString(128, seed, HEX)}`],
  ['md5:hex', (seed) => `md5:${randomString(32, seed, HEX)}`],
];

// Digests that carry an Atlassian-token-shaped run after a "+" (the "+" satisfies the token's boundary). If one of them were NOT
// blanked, atlassian-token would report it, so "no finding" in a lockfile proves the digest was blanked.
const carrier = {
  sha512: (seed) => `sha512-${randomString(51, seed)}+${ATBB}${randomString(30, seed + 1)}==`,
  sha384: (seed) => `sha384-${randomString(29, seed)}+${ATBB}${randomString(30, seed + 1)}`,
  sha256: (seed) => `sha256-${randomString(8, seed)}+${ATBB}${randomString(30, seed + 1)}=`,
  h1: (seed) => `h1:${randomString(8, seed)}+${ATBB}${randomString(30, seed + 1)}=`,
};

// The digest body: the part a sanitized lockfile must no longer contain.
const bodyOf = (digest) => digest.replace(/^(?:sha\d{1,3}[-:=]|h1:|md5[:=])/, '');

describe('review round 18: lockfile digests are blanked by position, not by shape', () => {
  const rules = (file, text) => scanText(file, text).map((f) => f.rule);

  // -------------------------------------------------------------------------
  describe('(1) a credential shaped like a digest in an auth field or a credential URL parameter is reported', () => {
    const AUTH_PLACES = [
      ['package-lock.json _authToken', 'package-lock.json', (v) => `{\n  "name": "app",\n  "_authToken": "${v}"\n}\n`],
      ['package-lock.json registry-scoped _authToken', 'package-lock.json', (v) => `{"//registry.internal/:_authToken": "${v}"}\n`],
      ['npm-shrinkwrap.json _password', 'npm-shrinkwrap.json', (v) => `{"_password":"${v}"}\n`],
      ['yarn.lock .npmrc-style _authToken line', 'yarn.lock', (v) => `//registry.internal/:_authToken=${v}\n`],
      ['yarn.lock _auth line', 'yarn.lock', (v) => `_auth = ${v}\n`],
      ['yarn.lock berry npmAuthToken', 'yarn.lock', (v) => `npmAuthToken: "${v}"\n`],
      ['pnpm-lock.yaml token', 'pnpm-lock.yaml', (v) => `settings:\n  token: ${v}\n`],
      ['poetry.lock source password', 'poetry.lock', (v) => `[[package.source]]\npassword = "${v}"\n`],
      ['Pipfile.lock source password', 'Pipfile.lock', (v) => `{"_meta":{"sources":[{"name":"internal","password":"${v}"}]}}\n`],
      ['bun.lock _authToken', 'bun.lock', (v) => `{\n  "_authToken": "${v}",\n}\n`],
      ['a token parameter of a resolved URL', 'package-lock.json', (v) => `{"resolved":"${scheme}registry.internal/x/-/x-1.0.0.tgz?token=${v}"}\n`],
      ['a "#" that starts the value (not a URL fragment)', 'yarn.lock', (v) => `//registry.internal/:_authToken=#${v}\n`],
    ];

    describe.each(AUTH_PLACES)('%s', (_label, file, place) => {
      it.each(DIGEST_SHAPES)('a %s-shaped value is reported and left visible', (_shape, digest) => {
        const text = place(digest(1801));
        expect(sanitizeLockfile(text)).toBe(text);
        expect(rules(file, text)).toContain('lockfile-credential');
      });
    });

    it('the auth value is reported when an integrity value of the same shape sits right before it on the line', () => {
      const integrity = carrier.sha512(1811);
      const token = DIGEST_SHAPES[0][1](1813);
      for (const [file, text] of [
        ['package-lock.json', `{"integrity":"${integrity}","_authToken":"${token}"}\n`],
        ['pnpm-lock.yaml', `settings: {integrity: ${integrity}, token: ${token}}\n`],
      ]) {
        const cleaned = sanitizeLockfile(text);
        expect(cleaned, file).not.toContain(bodyOf(integrity));
        expect(cleaned, file).toContain(token);
        expect(rules(file, text), file).toEqual(['lockfile-credential']);
      }
    });

    it('a value longer than its algorithm digest is not an integrity value, even under an integrity key', () => {
      const longer = `sha512-${randomString(100, 1815, BASE64)}`;
      const text = `{"integrity":"${longer}"}\n`;
      expect(sanitizeLockfile(text)).toBe(text);
    });
  });

  // -------------------------------------------------------------------------
  describe('(2) the same shapes where the lockfile format puts an integrity value stay blanked', () => {
    const d = {
      sha512: carrier.sha512(1821),
      sha512b: carrier.sha512(1823),
      sha384: carrier.sha384(1825),
      sha256: carrier.sha256(1827),
      sha1: `sha1-${randomString(27, 1829, BASE64)}=`,
      h1: carrier.h1(1831),
      h1b: carrier.h1(1833),
      sha256hex: `sha256:${randomString(64, 1835, HEX)}`,
      sha256hexb: `sha256:${randomString(64, 1837, HEX)}`,
      sha256eq: `sha256=${randomString(64, 1839, HEX)}`,
      sha256eqb: `sha256=${randomString(64, 1840, HEX)}`,
      sha512eq: `sha512=${randomString(128, 1841, HEX)}`,
      hex40: randomString(40, 1843, HEX),
      hex64: randomString(64, 1845, HEX),
      hex128: randomString(128, 1847, HEX),
    };

    it('each carrier digest would be an atlassian-token finding if it were not blanked', () => {
      for (const digest of [d.sha512, d.sha512b, d.sha384, d.sha256, d.h1, d.h1b]) {
        expect(rules('data.json', `{"value":"${digest}"}\n`)).toContain('atlassian-token');
      }
    });

    const INTEGRITY_PLACES = [
      ['package-lock.json integrity', 'package-lock.json', `{\n  "packages": {\n    "node_modules/x": {\n      "version": "1.0.0",\n      "integrity": "${d.sha512}"\n    }\n  }\n}\n`],
      ['package-lock.json v1 integrity listing two digests', 'package-lock.json', `{"dependencies":{"x":{"version":"1.0.0","integrity":"${d.sha1} ${d.sha512}"}}}\n`],
      ['npm-shrinkwrap.json resolved URL with an SRI fragment', 'npm-shrinkwrap.json', `{"dependencies":{"x":{"resolved":"${scheme}registry.npmjs.org/x/-/x-1.0.0.tgz#${d.sha512}"}}}\n`],
      ['yarn.lock v1 integrity line', 'yarn.lock', `"x@^1.0.0":\n  version "1.0.0"\n  resolved "${scheme}registry.yarnpkg.com/x/-/x-1.0.0.tgz#${d.hex40}"\n  integrity ${d.sha512}\n`],
      ['yarn.lock v1 resolved URL with an SRI fragment', 'yarn.lock', `"x@^1.0.0":\n  version "1.0.0"\n  resolved "${scheme}registry.yarnpkg.com/x/-/x-1.0.0.tgz#${d.sha256}"\n`],
      ['pnpm-lock.yaml flow resolution', 'pnpm-lock.yaml', `packages:\n  x@1.0.0:\n    resolution: {integrity: ${d.sha512}, tarball: ${scheme}registry.npmjs.org/x/-/x-1.0.0.tgz}\n`],
      ['pnpm-lock.yaml block resolution', 'pnpm-lock.yaml', `packages:\n  /x/1.0.0:\n    resolution:\n      integrity: ${d.sha384}\n`],
      ['bun.lock package array', 'bun.lock', `{\n  "lockfileVersion": 1,\n  "packages": {\n    "x": ["x@1.0.0", "", {}, "${d.sha512}"],\n    "y": ["y@2.0.0", "", {}, "${d.sha512b}"],\n  }\n}\n`],
      ['Pipfile.lock hash list', 'Pipfile.lock', `${JSON.stringify({ default: { x: { hashes: [d.sha256hex, d.sha256hexb], version: '==1.0.0' } } }, null, 4)}\n`],
      ['poetry.lock file hash', 'poetry.lock', `[[package.files]]\nfile = "x-1.0.0.tar.gz"\nhash = "${d.sha256hex}"\n`],
      ['poetry.lock legacy hash list', 'poetry.lock', `[metadata.files]\nx = [\n    "${d.sha256hex}",\n    "${d.sha256hexb}",\n]\n`],
      ['Gemfile.lock CHECKSUMS', 'Gemfile.lock', `CHECKSUMS\n  rake (13.0.6) ${d.sha256eq}\n  nokogiri (1.16.0-x86_64-linux) ${d.sha256eqb},${d.sha512eq}\n`],
      ['go.sum', 'go.sum', `example.com/x v1.2.3 ${d.h1}\nexample.com/x v1.2.3/go.mod ${d.h1b}\n`],
      ['Cargo.lock checksum', 'Cargo.lock', `[[package]]\nname = "x"\nversion = "1.0.0"\nchecksum = "${d.hex64}"\n`],
      ['yarn.lock berry checksum', 'yarn.lock', `"x@npm:^1.0.0":\n  version: 1.0.0\n  checksum: 10c0/${d.hex128}\n`],
      ['composer.lock shasum', 'composer.lock', `{"packages":[{"name":"a/x","dist":{"type":"zip","shasum":"${d.hex40}"}}]}\n`],
    ];

    it.each(INTEGRITY_PLACES)('%s: every digest is blanked and nothing is reported', (_label, file, text) => {
      const cleaned = sanitizeLockfile(text);
      expect(cleaned.length).toBe(text.length);
      expect(cleaned.split('\n').length).toBe(text.split('\n').length);
      for (const digest of Object.values(d)) {
        if (text.includes(digest)) expect(cleaned, digest.slice(0, 7)).not.toContain(bodyOf(digest));
      }
      expect(scanText(file, text)).toEqual([]);
    });

    it('every digest in the real lockfiles of this repository is still blanked', () => {
      const SHAPES = /sha(?:1|256|384|512)-[A-Za-z0-9+/]{20,}|h1:[A-Za-z0-9+/]{40,}|(?:sha\d{1,3}|md5)[:=][0-9a-f]{32,}/g;
      for (const file of ['package-lock.json', 'app/package-lock.json', 'server/package-lock.json', 'shared/package-lock.json']) {
        const text = readFileSync(path.join(REPO_ROOT, file), 'utf8');
        expect((text.match(SHAPES) ?? []).length, file).toBeGreaterThan(0);
        expect(sanitizeLockfile(text).match(SHAPES), file).toBeNull();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Review round 19: a URL user name that ENDS in a key word (subhash, cicommit, ci-hash, prev) read as a key, and a "#" that starts
  // a value read as a URL fragment, so the hex or SRI password after it was blanked before url-password / lockfile-credential ran.
  describe('(3) URL userinfo passwords and "#"-led values are never blanked as digests', () => {
    const h40 = randomString(40, 1901, HEX);
    const h64 = randomString(64, 1903, HEX);
    const sri = `sha512-${randomString(86, 1905, ALNUM + '+')}==`; // no "/" (url-password's class stops at one)
    const USERINFO = [
      ['package-lock.json user "subhash", hex40', 'package-lock.json', `{\n  "packages": {\n    "x": {\n      "resolved": "${scheme}subhash:${h40}@registry.internal/x/-/x-1.0.0.tgz"\n    }\n  }\n}\n`],
      ['package-lock.json user "cicommit", hex64', 'package-lock.json', `{"resolved": "${scheme}cicommit:${h64}@registry.internal/x.tgz"}\n`],
      ['package-lock.json user "hash" right after //', 'package-lock.json', `{"resolved": "${scheme}hash:${h40}@registry.internal/x.tgz"}\n`],
      ['package-lock.json user "ci-hash", SRI-shaped', 'package-lock.json', `{"resolved": "${scheme}ci-hash:${sri}@registry.internal/x.tgz"}\n`],
      ['pnpm-lock.yaml tarball, user "ci-hash", SRI-shaped', 'pnpm-lock.yaml', `packages:\n  x:\n    resolution: {tarball: ${scheme}ci-hash:${sri}@registry.internal/x.tgz}\n`],
      ['pnpm-lock.yaml tarball, user "x_digest", SRI-shaped', 'pnpm-lock.yaml', `packages:\n  x:\n    resolution: {tarball: ${scheme}x_digest:${sri}@registry.internal/x.tgz}\n`],
      ['yarn.lock resolved with a commit fragment, user "subhash"', 'yarn.lock', `x@1:\n  resolved "${scheme}subhash:${h40}@registry.internal/x.tgz#${randomString(40, 1907, HEX)}"\n`],
      ['Gemfile.lock remote, user "subhash"', 'Gemfile.lock', `GEM\n  remote: ${scheme}subhash:${h40}@gems.internal/\n`],
      ['composer.lock dist url, user "prev"', 'composer.lock', `{"dist": {"url": "${scheme}prev:${h40}@repo.internal/x.zip"}}\n`],
    ];
    it.each(USERINFO)('%s: url-password', (_label, file, text) => {
      expect(rules(file, text)).toContain('url-password');
    });

    const HASH_LED = [
      ['yarn.lock _authToken=#hex64', 'yarn.lock', `//registry.internal/:_authToken=#${h64}\n`],
      ['package-lock.json "_authToken": "#hex64"', 'package-lock.json', `{"_authToken": "#${h64}"}\n`],
      ['package-lock.json "_password": "#hex40"', 'package-lock.json', `{"_password": "#${h40}"}\n`],
      ['resolved URL ?token=#hex64', 'package-lock.json', `{"resolved": "${scheme}registry.internal/x.tgz?token=#${h64}"}\n`],
    ];
    it.each(HASH_LED)('%s: left visible and reported', (_label, file, text) => {
      expect(sanitizeLockfile(text)).toBe(text);
      expect(rules(file, text)).toContain('lockfile-credential');
    });

    const LEGIT = [
      ['yarn v1 commit fragment and integrity', 'yarn.lock', `x@1:\n  resolved "${scheme}registry.yarnpkg.com/x/-/x-1.0.0.tgz#${h40}"\n  integrity ${carrier.sha512(1909)}\n`, [h40]],
      ['yarn berry #commit= and checksum', 'yarn.lock', `"x@${scheme}github.com/a/b.git#commit=${h40}":\n  checksum: 10c0/${randomString(128, 1911, HEX)}\n`, [h40]],
      ['composer content-hash, reference, shasum', 'composer.lock', `{\n "content-hash": "${randomString(32, 1913, HEX)}",\n "packages": [{"source": {"reference": "${h40}"}, "dist": {"shasum": "${h64.slice(0, 40)}"}}]\n}\n`, [h40]],
      ['pnpm git resolution {commit: ...}', 'pnpm-lock.yaml', `packages:\n  x:\n    resolution: {commit: ${h40}, repo: ${scheme}github.com/a/b, type: git}\n`, [h40]],
      ['git+ssh URL with a commit fragment', 'package-lock.json', `{"resolved": "git+ssh://git@github.com/a/b.git#${h40}"}\n`, [h40]],
      ['pnpm top-level camelCase checksums', 'pnpm-lock.yaml', `lockfileVersion: '9.0'\npackageExtensionsChecksum: ${carrier.sha256(1915)}\npnpmfileChecksum: ${carrier.sha256(1917)}\n`, []],
    ];
    it.each(LEGIT)('%s: still blanked, nothing reported', (_label, file, text, hidden) => {
      const cleaned = sanitizeLockfile(text);
      for (const value of hidden) expect(cleaned).not.toContain(value);
      expect(scanText(file, text)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  it('hostile digest-dense inputs stay linear', SLOW, () => {
    const timings = timeInChild(`
      const sri = 'sha512-' + 'Ab+/'.repeat(21) + 'Ab' + '==';
      const h1 = 'h1:' + 'Ab+/'.repeat(10) + 'Abc' + '=';
      const hex = 'sha256=' + 'ab'.repeat(32);
      const size = 2 * 1024 * 1024;
      const fill = (unit) => unit.repeat(Math.ceil(size / unit.length));
      const cases = {
        arrayElements: fill('"' + sri + '",'),
        indentedElements: fill('[' + ' '.repeat(300) + '"' + sri + '"'),
        oneLongList: 'integrity ' + fill(sri + ' '),
        oneLongLine: fill('example.com/x v1.0.0 ' + h1 + ' '),
        goSumLines: fill('example.com/x v1.0.0 ' + h1 + '\\n'),
        gemfileLines: fill('  x (1.0.0) ' + hex + ',' + hex + '\\n'),
        authFields: fill('_authToken=' + sri + ' '),
        fragments: fill('a#' + sri + '#'),
      };
      for (const [name, text] of Object.entries(cases)) {
        for (const file of ['package-lock.json', 'yarn.lock', 'go.sum', 'Gemfile.lock']) {
          const start = performance.now();
          scanText(file, text);
          timings.push([name + ' ' + file, performance.now() - start]);
        }
      }
    `);
    for (const [label, ms] of timings) expect(ms, label).toBeLessThan(HOSTILE_LIMIT_MS);
  });

  // -------------------------------------------------------------------------
  describe('the command line', () => {
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

    it.skipIf(!hasGit())('the tree scan and --range report the digest-shaped auth values only, without printing them', SLOW, () => {
      const dir = makeRepo();
      const base = commit(dir, { 'README.md': '# demo\n' });
      const sri512 = DIGEST_SHAPES[0][1](1851);
      const sri256 = DIGEST_SHAPES[2][1](1853);
      const ordinary = {
        'integrity/package-lock.json': `{\n  "packages": {\n    "node_modules/x": {\n      "integrity": "${carrier.sha512(1855)}"\n    }\n  }\n}\n`,
        'fragment/package-lock.json': `{\n  "packages": {\n    "node_modules/x": {\n      "resolved": "${scheme}registry.npmjs.org/x/-/x-1.0.0.tgz#${carrier.sha512(1857)}"\n    }\n  }\n}\n`,
        'v1/yarn.lock': `"x@^1.0.0":\n  version "1.0.0"\n  integrity ${carrier.sha512(1859)}\n`,
      };
      const leaks = {
        'auth512/package-lock.json': `{\n  "name": "app",\n  "_authToken": "${sri512}"\n}\n`,
        'auth256/package-lock.json': `{\n  "name": "app",\n  "_authToken": "${sri256}"\n}\n`,
      };
      commit(dir, ordinary);
      expect(scan(dir).status, scan(dir).stderr).toBe(0);
      commit(dir, leaks);
      for (const args of [[], ['--range', `${base}..HEAD`]]) {
        const result = scan(dir, ...args);
        const output = `${result.stdout}\n${result.stderr}`;
        expect(result.status, output).toBe(1);
        expect(output).toContain('auth512/package-lock.json');
        expect(output).toContain('auth256/package-lock.json');
        expect(output).toContain('lockfile-credential');
        for (const file of Object.keys(ordinary)) expect(output).not.toContain(file);
        for (const piece of [...windows(bodyOf(sri512)), ...windows(bodyOf(sri256))]) expect(output).not.toContain(piece);
      }
    });

    it.skipIf(!hasGit())('URL userinfo and "#"-led auth values are reported by the tree scan, --range and --history', SLOW, () => {
      const dir = makeRepo();
      const base = commit(dir, { 'README.md': '# demo\n' });
      const h40 = randomString(40, 1921, HEX);
      const h64 = randomString(64, 1923, HEX);
      const sri = `sha512-${randomString(86, 1925, ALNUM + '+')}==`;
      commit(dir, {
        'a/yarn.lock': `x@1:\n  resolved "${scheme}subhash:${h40}@registry.internal/x.tgz#${randomString(40, 1927, HEX)}"\n`,
        'b/pnpm-lock.yaml': `packages:\n  x:\n    resolution: {tarball: ${scheme}ci-hash:${sri}@registry.internal/x.tgz}\n`,
        'c/yarn.lock': `x@1:\n  resolved "${scheme}deploy:${h40}@registry.internal/x.tgz"\n`,
        'd/package-lock.json': `{\n  "_authToken": "#${h64}"\n}\n`,
      });
      for (const args of [[], ['--range', `${base}..HEAD`], ['--history']]) {
        const result = scan(dir, ...args);
        const output = `${result.stdout}\n${result.stderr}`;
        expect(result.status, output).toBe(1);
        for (const file of ['a/yarn.lock', 'b/pnpm-lock.yaml', 'c/yarn.lock', 'd/package-lock.json']) expect(output, `${args}: ${file}`).toContain(file);
        for (const piece of [...windows(h40), ...windows(h64)]) expect(output).not.toContain(piece);
      }
    });
  });
});
