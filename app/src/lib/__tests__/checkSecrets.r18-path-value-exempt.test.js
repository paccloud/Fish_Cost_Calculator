/**
 * Tests for scripts/check-secrets.mjs, review round 18: a configuration value that is a file-system path names the FILE that holds the
 * secret (`private_key: /etc/ssl/private/key.pem`), so it is not reported under a weak or a strong secret-like name. A token that merely
 * contains "/" (base64), starts with "/", or sits in a path as a random-looking piece is still reported: base64 is the main
 * false-negative risk of this exemption, so those tests come first.
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
import { isFileSystemPath, scanText } from '../../../../scripts/check-secrets.mjs';

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

describe('review round 18: file-system path values', () => {
  // Strong names end in a secret noun (any 8+ character value counts in config); weak names only mention one (a random value counts).
  const STRONG = [secretName('private', '_key'), secretName('client', '_secret'), secretName('signing', 'Key'), secretName('db_', 'password')];
  const WEAK = [secretName('private_key', '_file'), secretName('jwt_secret', '_path'), secretName('api_token', '_file')];
  const NAMES = [...STRONG.map((name) => ['strong', name]), ...WEAK.map((name) => ['weak', name])];

  // The shapes a configuration value is written in. Each returns [file, text].
  const FORMATS = [
    ['YAML plain scalar', (name, value) => ['config/app.yml', `tls:\n  ${name}: ${value}\n`]],
    ['YAML double-quoted', (name, value) => ['config/app.yaml', `${name}: ${JSON.stringify(value)}\n`]],
    ['YAML single-quoted', (name, value) => ['config/app.yml', `${name}: '${value}'\n`]],
    ['JSON', (name, value) => ['config/app.json', `{\n  "${name}": ${JSON.stringify(value)}\n}\n`]],
    ['dotenv', (name, value) => ['.env.production', `${name.toUpperCase()}=${value}\n`]],
    ['ini', (name, value) => ['app.ini', `[tls]\n${name} = ${value}\n`]],
    ['TOML', (name, value) => ['app.toml', `[tls]\n${name} = ${JSON.stringify(value)}\n`]],
    ['Markdown', (name, value) => ['docs/deploy.md', `Set it in the environment:\n\n${name.toUpperCase()}=${value}\n`]],
    ['XML element', (name, value) => ['conf/settings.xml', `<settings>\n  <${name}>${value}</${name}>\n</settings>\n`]],
  ];
  // Markdown prose reads an UNQUOTED value up to the first blank, so a value with blanks in it is judged by its first word there
  // ("C:\Program"); such values are checked in the formats that read the whole value.
  const WHOLE_VALUE_FORMATS = FORMATS.filter(([format]) => format !== 'Markdown');
  const matrix = (values, names = NAMES) =>
    values.flatMap(([label, value]) =>
      (/\s/.test(value) ? WHOLE_VALUE_FORMATS : FORMATS).flatMap(([format, make]) =>
        names.map(([kind, name]) => [`${label} | ${format} | ${kind} ${name}`, ...make(name, value)]),
      ),
    );
  const count = (file, text) => scanText(file, text).length;
  const rules = (file, text) => scanText(file, text).map((f) => f.rule);

  // -------------------------------------------------------------------------
  describe('(1) tokens that contain or start with "/" are still reported (the false-negative risk)', () => {
    const base64 = (length, seed) => randomString(length, seed, `${ALNUM}+/`).replace(/[+/]/g, 'Q');
    const TOKENS = [
      // Standard base64 has "/", "+" and "=" in its alphabet: a value with a slash inside is not a path.
      ['base64 with "=" padding (the review example)', ['aGVsbG8v', 'd29ybGQv', 'Zm9v='].join('')],
      ['base64 with "/" inside', `${base64(12, 18001)}/${base64(14, 18002)}/${base64(9, 18003)}`],
      ['base64 with "/", "+" and "="', `${base64(10, 18004)}+${base64(10, 18005)}/${base64(8, 18006)}==`],
      ['base64 that starts with "/"', `/${base64(30, 18007)}`],
      ['base64 that starts with "/" and has another one inside', `/${base64(20, 18008)}/${base64(11, 18009)}`],
      // A path whose piece looks machine-generated is a token, not a file name.
      ['a path with a random last segment', `/tmp/${randomString(24, 18010)}`],
      ['a path with a 40-hex segment', `/run/secrets/${randomString(40, 18011, HEX)}`],
      ['a home path with a random segment', `~/.config/app/${randomString(20, 18012)}`],
      ['a Windows path with a random file name', `C:\\keys\\${randomString(20, 18013)}.pfx`],
      ['a random file name with a key extension', `${randomString(24, 18014)}.pem`],
      ['a relative path with a random piece', `certs/${randomString(16, 18015)}-key.pem`],
    ];
    it.each(matrix(TOKENS))('reports %s', (_label, file, text) => {
      expect(count(file, text)).toBeGreaterThan(0);
    });

    // A strong name reports any 8+ character literal, so these are findings there (and not random enough for a weak name).
    const STRONG_ONLY = [
      ['one segment after "/" (a password that starts with "/")', `/${['hunter', '2', 'hunter', '2'].join('')}`],
      ['a relative path without a key-file extension (base64 can look like it)', 'secrets/db_password'],
      ['scp-style user:password@host:/path', `deploy:${randomString(16, 18016)}@files.internal:/srv/keys/key.pem`],
      ['a path-like value with "=" in it', `/etc/app/key=${['hunter', '2', 'hunter', '2'].join('')}`],
      ['a path-like value with "+" in it', '/etc/app/key+backup/server'],
      ['a spaced relative path (only an anchored path may hold blanks)', 'my notes/old keys'],
    ];
    it.each(matrix(STRONG_ONLY, NAMES.filter(([kind]) => kind === 'strong')))('reports under a strong name: %s', (_label, file, text) => {
      expect(count(file, text)).toBeGreaterThan(0);
    });

    it('a URL with a password is not a path: url-password still reports it', () => {
      const url = `https://deploy:${randomString(16, 18017)}@files.internal/keys/key.pem`;
      for (const [, make] of FORMATS) {
        const [file, text] = make(STRONG[0], url);
        expect(rules(file, text), file).toContain('url-password');
      }
    });

    it('source code keeps its randomness-only gate: a random token after "/" is reported, a plain path is not', () => {
      expect(count('src/tls.js', `const privateKey = '/${randomString(24, 18018)}';\n`)).toBeGreaterThan(0);
      expect(count('src/tls.js', "const privateKey = '/etc/ssl/private/key.pem';\n")).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('(2) a value that is clearly a file-system path is not reported', () => {
    const PATHS = [
      ['an absolute key path (the review example)', '/etc/ssl/private/key.pem'],
      ['an absolute path with a hyphenated file name', '/etc/ssl/private/server-key.pem'],
      ['a Docker secret', '/run/secrets/db_password'],
      ['a Kubernetes service-account token file', '/var/run/secrets/kubernetes.io/serviceaccount/token'],
      ['a path with digits in its pieces (random-looking as a whole)', '/var/lib/app/keys/2024/ab12cd34.pem'],
      ['a credentials document', '/home/deploy/.config/gcloud/application_default_credentials.json'],
      ['a directory', '/etc/ssl/private/'],
      ['a home path', '~/.ssh/id_rsa'],
      ['a home path with digits', '~/.ssh/id_ed25519'],
      ['a $HOME path', '$HOME/.ssh/id_rsa'],
      ['a ./ relative path', './certs/server.key'],
      ['a ../ relative path', '../secrets/api-key.txt'],
      ['a relative path with a key extension', 'certs/server.pem'],
      ['a relative PKCS#12 path', 'keys/prod.p12'],
      ['a bare file name with a credential-document extension', 'service-account.json'],
      ['a Windows drive path', 'C:\\secrets\\client.json'],
      ['a Windows drive path with forward slashes', 'C:/secrets/client.json'],
      ['a Windows PFX path', 'D:\\keys\\server.pfx'],
      ['a UNC share', '\\\\fileserver\\share\\keys\\server.pem'],
      ['a .\\ relative Windows path', '.\\certs\\key.pem'],
      ['a %USERPROFILE% path', '%USERPROFILE%\\.ssh\\id_rsa'],
      ['a Windows path with a blank', 'C:\\Program Files\\App\\certs\\key.pem'],
      ['a macOS path with a blank', '/Users/me/Library/Application Support/app/key.pem'],
    ];
    it.each(matrix(PATHS))('does not report %s', (_label, file, text) => {
      expect(scanText(file, text)).toEqual([]);
    });

    it('reads the repro fixture of the review without a finding', () => {
      const yaml = [
        'tls:',
        `  ${STRONG[0]}: /etc/ssl/private/key.pem`,
        `  ${WEAK[0]}: /etc/ssl/private/server-key.pem`,
        `  ${secretName('signing', '_key')}: ~/.ssh/id_rsa`,
        `  ${STRONG[1]}: C:\\secrets\\client.json`,
        `  ${secretName('quoted_private', '_key')}: "/etc/ssl/private/key.pem"`,
        '',
      ].join('\n');
      expect(scanText('config.yml', yaml)).toEqual([]);
      expect(scanText('app.ini', `[ssl]\n${STRONG[0]} = /etc/ssl/private/key.pem\n`)).toEqual([]);
      expect(scanText('.env.example', `${STRONG[0].toUpperCase()}=/etc/ssl/private/key.pem\n`)).toEqual([]);
    });

    it('a trailing YAML comment after the path is not part of the value', () => {
      expect(scanText('config.yml', `${STRONG[0]}: /etc/ssl/private/key.pem  # the TLS key\n`)).toEqual([]);
    });

    it('XML keeps its documented path exemption (Maven settings.xml privateKey)', () => {
      const xml = '<server><id>siteServer</id><privateKey>/path/to/private/key</privateKey></server>\n';
      expect(scanText('conf/settings.xml', xml)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe('(3) isFileSystemPath', () => {
    it.each([
      '/etc/ssl/private/key.pem',
      '/run/secrets/db_password',
      '/etc/ssl/private/',
      '~/.ssh/id_rsa',
      '$HOME/.ssh/id_rsa',
      './certs/server.key',
      '../../secrets/api-key.txt',
      './key.pem',
      'certs/server.pem',
      'server.key',
      'C:\\secrets\\client.json',
      'C:\\\\secrets\\\\client.json',
      'C:/secrets/client.json',
      '\\keys\\server.pfx',
      '\\\\fileserver\\share',
      '.\\certs\\key.pem',
      '%APPDATA%\\gcloud\\credentials.json',
      'C:\\Program Files\\App\\certs\\key.pem',
      '/srv/app/0e5c3b2a-1d4f-4a6b-9c8d-7e6f5a4b3c2d/key.pem',
    ])('is a path: %s', (value) => {
      expect(isFileSystemPath(value)).toBe(true);
    });

    it.each([
      ['empty', ''],
      ['a root alone', '/'],
      ['a drive alone', 'C:\\'],
      ['one segment after "/"', '/hunter2hunter2'],
      ['one segment after ~/', '~/.netrc'],
      ['a relative path without a key extension', 'abc/def'],
      ['a lower-case $variable (reads as a password)', '$home/.ssh/id_rsa'],
      ['a URL', 'https://files.internal/keys/key.pem'],
      ['user@host:/path', 'deploy@files.internal:/srv/keys/key.pem'],
      ['"=" inside', '/etc/app/key=value/x'],
      ['"+" inside', '/etc/app/a+b/x'],
      ['"%" outside the anchor', '/etc/app/%41%42/x'],
      ['"$" outside the anchor', '/etc/$KEY/x.pem'],
      ['a blank in an unanchored path', 'my notes/key.txt'],
      ['two blanks in a row', '/etc/my  keys/x.pem'],
      ['a backslash in a POSIX path', '/etc/app\\key/x'],
      ['too many segments', `/${'a/'.repeat(80)}x`],
      ['over the length cap', `/${'a'.repeat(5000)}/x.pem`],
    ])('is not a path: %s', (_label, value) => {
      expect(isFileSystemPath(value)).toBe(false);
    });

    it('is not a path when a piece looks machine-generated', () => {
      expect(isFileSystemPath(`/tmp/${randomString(24, 18101)}`)).toBe(false);
      expect(isFileSystemPath(`/${randomString(20, 18102)}/${randomString(11, 18103)}`)).toBe(false);
      expect(isFileSystemPath(`/run/secrets/${randomString(40, 18104, HEX)}`)).toBe(false);
      expect(isFileSystemPath(`${randomString(24, 18105)}.pem`)).toBe(false);
      expect(isFileSystemPath(`certs/app-${randomString(12, 18106)}.key`)).toBe(false);
      expect(isFileSystemPath(`C:\\keys\\${randomString(12, 18107)}\\server.pfx`)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  it('hostile inputs stay linear', SLOW, () => {
    const timings = timeInChild(`
      const name = 'private' + '_key';
      const cases = {
        manySegments: name + ': ' + '/a'.repeat(4000) + '\\n',
        spacedSegments: name + ': /' + 'a '.repeat(4000) + 'b\\n',
        windowsSegments: name + ': C:' + '\\\\a'.repeat(4000) + '\\n',
        doubledSeparators: name + ': C:' + '\\\\\\\\'.repeat(4000) + 'x.pem\\n',
        pathLines: (name + ': /etc/ssl/private dir/key.pem\\n').repeat(20000),
        quotedPathLines: (name + ": 'C:\\\\Program Files\\\\App\\\\key.pem'\\n").repeat(20000),
        anchors: ('~/./../$HOME/%A%\\\\\\\\' ).repeat(5000) + '\\n' + (name + ': ' + '../'.repeat(3000) + '\\n'),
      };
      for (const [label, text] of Object.entries(cases)) {
        for (const file of ['a.yml', '.env', 'a.ini', 'a.json', 'a.md', 'a.xml']) {
          const start = performance.now();
          scanText(file, text);
          timings.push([label + ' ' + file, performance.now() - start]);
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
      const dir = mkdtempSync(path.join(tmpdir(), 'check-secrets-r18-path-'));
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

    it.skipIf(!hasGit())('the tree scan and --range pass path values and report a token path without printing it', SLOW, () => {
      const dir = makeRepo();
      const base = commit(dir, {
        'config/app.yml': `tls:\n  ${STRONG[0]}: /etc/ssl/private/key.pem\n  ${STRONG[1]}: C:\\secrets\\client.json\n  ${WEAK[0]}: keys/prod.p12\n`,
        'app.ini': `[ssl]\n${STRONG[0]} = ~/.ssh/id_rsa\n`,
        '.env.example': `${STRONG[0].toUpperCase()}=/run/secrets/db_password\n`,
      });
      let result = scan(dir);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

      const token = `/${randomString(20, 18201)}/${randomString(11, 18202)}`;
      commit(dir, { 'config/prod.yml': `${STRONG[0]}: ${token}\n` });
      for (const args of [[], ['--range', `${base}..HEAD`]]) {
        result = scan(dir, ...args);
        const output = `${result.stdout}\n${result.stderr}`;
        expect(result.status, output).toBe(1);
        expect(output).toContain('config/prod.yml');
        expect(output).toContain('secret-assignment');
        expect(output).not.toContain('config/app.yml');
        for (const piece of windows(token)) expect(output).not.toContain(piece);
      }
    });
  });
});
