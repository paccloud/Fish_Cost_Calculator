/**
 * Tests for scripts/check-secrets.mjs, review round 17a: Python string prefixes outside source code, PowerShell environment
 * here-strings, and passphrase keys handed to signing / HMAC calls.
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

describe('review round 17a', () => {
  const NAME = secretName('JWT_', 'SECRET');
  const value = randomString(24, 17001);
  // A passphrase whose first word is short: read as a bare word, `r"big` alone is too short to be judged.
  const passphrase = ['big', 'horse', 'battery', 'staple'].join(' ');
  const count = (file, text) => scanText(file, text).length;
  const rules = (file, text) => scanText(file, text).map((f) => f.rule);
  const fence = (lang, body) => ['```', lang, '\n', body, '```\n'].join('');

  const dirs = [];
  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
  });
  const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: SLOW_TEST_MS, maxBuffer: 64 * 1024 * 1024 });
  const scan = (cwd, ...args) => run(process.execPath, [SCANNER, ...args], cwd);
  const git = (cwd, ...args) => run('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], cwd);
  const makeRepo = () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'check-secrets-r17a-'));
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
  describe('(1) Python string prefixes before a quoted value', () => {
    const PREFIXES = ['r', 'b', 'rb', 'br', 'u', 'f', 'R', 'B', 'Rb', 'bR', 'U', 'F', 'fr', 'Rf'];
    const PLACES = [
      ['a fenced Python block', 'README.md', (line) => fence('python', line)],
      ['a plain-text note', 'notes.txt', (line) => line],
      ['a reStructuredText page', 'docs/setup.rst', (line) => line],
      ['a shell script', 'deploy.sh', (line) => line],
      ['a Dockerfile', 'Dockerfile', (line) => line],
      ['a JSON file', 'vars.json', (line) => line],
      ['an HCL file', 'main.tf', (line) => line],
    ];
    const cases = PLACES.flatMap(([label, file, wrap]) =>
      PREFIXES.flatMap((prefix) => [
        [`${label}, ${prefix}"passphrase"`, file, wrap(`${NAME} = ${prefix}"${passphrase}"\n`)],
        [`${label}, ${prefix}'passphrase'`, file, wrap(`${NAME} = ${prefix}'${passphrase}'\n`)],
      ]),
    );

    it.each(cases)('reports the quoted body after the prefix: %s', (_label, file, text) => {
      expect(rules(file, text)).toContain('secret-assignment');
    });

    it.each([
      ['random value, raw', 'README.md', fence('python', `${NAME} = r"${value}"\n`)],
      ['random value, bytes', 'notes.txt', `${NAME} = b'${value}'\n`],
      ['random value, triple-quoted raw bytes', 'README.md', fence('python', `${NAME} = rb'''${value}'''\n`)],
      ['random value, triple-quoted over lines', 'notes.txt', `${NAME} = r"""\n${value}\n"""\n`],
      ['random value, f-string without interpolation', 'deploy.sh', `${NAME}=f"${value}"\n`],
      ['passphrase, prefixed and followed by a method call', 'README.md', fence('python', `${NAME} = r"${passphrase}".strip()\n`)],
    ])('still reports %s', (_label, file, text) => {
      expect(rules(file, text)).toContain('secret-assignment');
    });

    it.each([
      ['an interpolated f-string', 'README.md', fence('python', `${NAME} = f"{settings.base}{suffix}"\n`)],
      ['an interpolated f-string in a note', 'notes.txt', `${NAME} = f'{other_value}'\n`],
      ['a placeholder', 'README.md', fence('python', `${NAME} = r"${['your', 'secret', 'here'].join('_')}"\n`)],
      ['documentation about the value', 'notes.txt', `${NAME} = u"see the deployment guide for the value"\n`],
      ['a non-secret name joined by a raw string', 'README.md', fence('python', `x = r"${value}".join(parts)\n`)],
      ['a prefixed separator', 'notes.txt', `sep = r"${passphrase}".join(words)\n`],
      ['a regular expression under a non-secret name', 'README.md', fence('python', 'pattern = r"^[a-z]+ [0-9]+$"\n')],
      ['an empty prefixed string', 'notes.txt', `${NAME} = r""\n`],
    ])('does not report %s', (_label, file, text) => {
      expect(count(file, text)).toBe(0);
    });

    it('does not read a word that merely ends in a prefix letter as a prefix', () => {
      // `bar"...` is not a prefix: only r b u f and rb br fr rf are.
      expect(count('notes.txt', `${NAME} = bar"${'ab'}"\n`)).toBe(0);
    });

    it('source code keeps its own reading: a prefixed random value is reported, a prefixed passphrase is text', () => {
      expect(rules('settings.py', `${NAME} = r"${value}"\n`)).toContain('secret-assignment');
      expect(rules('settings.py', `${NAME} = rb"${value}"\n`)).toContain('secret-assignment');
      expect(count('settings.py', `x = r"${value}".join(y)\n`)).toBe(0);
      expect(count('app.js', `const pattern = r"${value}".length;\n`)).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('(2) PowerShell environment here-strings', () => {
    const lines = (opener, body) => `${opener}\n${body}\n${opener === "@'" ? "'@" : '"@'}\n`;
    const flagged = [
      ['$env: with a literal here-string', 'setup.ps1', `$env:${NAME} = ${lines("@'", value)}`],
      ['$env: with an expandable here-string', 'setup.ps1', `$env:${NAME} = ${lines('@"', value)}`],
      ['${env:} with a literal here-string', 'setup.ps1', `\${env:${NAME}} = ${lines("@'", value)}`],
      ['$env: += here-string', 'setup.psm1', `$env:${NAME} += ${lines("@'", value)}`],
      ['$env: without blanks', 'setup.ps1', `$env:${NAME}=${lines("@'", value)}`],
      ['$env: with a passphrase body', 'setup.ps1', `$env:${NAME} = ${lines("@'", passphrase)}`],
      ['[Environment]::SetEnvironmentVariable with a here-string', 'setup.ps1', `[Environment]::SetEnvironmentVariable('${NAME}', ${lines("@'", value).trimEnd()}, 'User')\n`],
      ['[System.Environment]::SetEnvironmentVariable with an expandable here-string', 'setup.ps1', `[System.Environment]::SetEnvironmentVariable("${NAME}", ${lines('@"', value).trimEnd()})\n`],
      ['a fenced PowerShell block', 'README.md', fence('powershell', `$env:${NAME} = ${lines("@'", value)}`)],
    ];
    it.each(flagged)('reports %s', (_label, file, text) => {
      expect(count(file, text)).toBeGreaterThan(0);
    });

    it.each([
      ['a variable in an expandable here-string', 'setup.ps1', `$env:${NAME} = ${lines('@"', '$secretValue')}`],
      ['a sub-expression in an expandable here-string', 'setup.ps1', `$env:${NAME} = ${lines('@"', '$($vault.Token)')}`],
      ['a placeholder body', 'setup.ps1', `$env:${NAME} = ${lines("@'", ['your', 'secret', 'here'].join('_'))}`],
      ['a non-secret name', 'setup.ps1', `$env:PATH = ${lines("@'", value)}`],
      ['a hashtable, not a here-string', 'setup.ps1', `$env:${NAME} = @{ a = 1 }\n`],
      ['a here-string in plain prose', 'notes.md', `$env:${NAME} = ${lines("@'", value)}`],
    ])('does not report %s', (_label, file, text) => {
      expect(count(file, text)).toBe(0);
    });

    it('reports a here-string that never closes (fail closed)', () => {
      expect(count('setup.ps1', `$env:${NAME} = @'\n${value}\n`)).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('(3) passphrase keys of signing and HMAC calls', () => {
    const key = passphrase;
    const flagged = [
      ['jwt.sign', 'auth.js', `const t = jwt.sign(payload, "${key}");\n`],
      ['jwt.sign with options', 'auth.js', `const t = jwt.sign({ sub: id }, '${key}', { expiresIn: '1h' });\n`],
      ['jwt.verify', 'auth.ts', `jwt.verify(token, "${key}");\n`],
      ['jsonwebtoken.sign', 'auth.js', `jsonwebtoken.sign(payload, \`${key}\`);\n`],
      ['Python jwt.encode', 'auth.py', `token = jwt.encode(payload, "${key}", algorithm="HS256")\n`],
      ['Python jwt.decode with key=', 'auth.py', `data = jwt.decode(token, key="${key}", algorithms=["HS256"])\n`],
      ['Ruby JWT.encode', 'auth.rb', `token = JWT.encode(payload, "${key}", 'HS256')\n`],
      ['Ruby JWT.decode', 'auth.rb', `JWT.decode(token, '${key}', true)\n`],
      ['JJWT signWith', 'Auth.java', `Jwts.builder().setSubject(id).signWith(SignatureAlgorithm.HS256, "${key}").compact();\n`],
      ['JJWT setSigningKey', 'Auth.java', `Jwts.parser().setSigningKey("${key}").parseClaimsJws(token);\n`],
      ['JJWT signWith(Keys.hmacShaKeyFor(...))', 'Auth.kt', `Jwts.builder().signWith(Keys.hmacShaKeyFor("${key}".toByteArray())).compact()\n`],
      ['SecretKeySpec', 'Auth.java', `Key k = new SecretKeySpec("${key}".getBytes(), "HmacSHA256");\n`],
      ['Python HMAC(key=)', 'sign.py', `h = HMAC(key="${key}")\n`],
      ['Python hmac.new(b"...")', 'sign.py', `h = hmac.new(b"${key}", msg, hashlib.sha256)\n`],
      ['crypto.createHmac', 'sign.js', `crypto.createHmac('sha256', "${key}").update(body).digest('hex');\n`],
      ['express-jwt options', 'server.js', `app.use(expressJwt({ secret: "${key}", algorithms: ['HS256'] }));\n`],
      ['express-session options', 'server.js', `app.use(session({ resave: false, secret: "${key}" }));\n`],
      ['express-session with a nested cookie object first', 'server.js', `app.use(session({ cookie: { secure: true }, secret: '${key}' }));\n`],
      ['express-session over several lines', 'server.js', `app.use(session({\n  resave: false,\n  secret: "${key}",\n}));\n`],
      ['passport-jwt secretOrKey', 'passport.js', `passport.use(new JwtStrategy({ jwtFromRequest: fromHeader(), secretOrKey: "${key}" }, verify));\n`],
      ['cookie-parser', 'server.js', `app.use(cookieParser("${key}"));\n`],
    ];
    it.each(flagged)('reports a passphrase key: %s', (_label, file, text) => {
      expect(rules(file, text)).toContain('hardcoded-signing-key');
    });

    it('still reports a random-looking key', () => {
      expect(rules('auth.js', `jwt.sign(payload, "${value}");\n`)).toContain('hardcoded-signing-key');
      expect(rules('server.js', `app.use(cookieParser("${value}"));\n`)).toContain('hardcoded-signing-key');
    });

    it.each([
      ['a placeholder key', 'auth.js', `jwt.sign(payload, "${['your', 'secret', 'here'].join(' ')}");\n`],
      ['an environment reference', 'auth.js', 'jwt.sign(payload, process.env.JWT_KEY);\n'],
      ['an interpolated template', 'auth.js', 'jwt.sign(payload, `${prefix} and more words`);\n'],
      ['documentation about the key', 'auth.js', `jwt.sign(payload, "see the deployment guide for the key");\n`],
      ['a short word', 'server.js', 'app.use(cookieParser("cookies"));\n'],
      ['a plain-word key that is not random', 'auth.py', 'jwt.encode(payload, "development")\n'],
      ['the payload, not the key', 'auth.js', `jwt.sign("${key}", key);\n`],
      ['the algorithm name of createHmac', 'sign.js', `crypto.createHmac("sha256", key);\n`],
      ['a secret: option of an unrelated call', 'ui.js', `render({ secret: "${key}" });\n`],
      ['a secret: option outside any call', 'ui.js', `const labels = { secret: "${key}" };\n`],
      ['a signWith literal after the call closed', 'Auth.java', `b.signWith(key); log("${key}");\n`],
      ['a call in prose', 'notes.md', `Call jwt.sign(payload, "${key}") to sign.\n`],
    ])('does not report %s', (_label, file, text) => {
      expect(rules(file, text)).not.toContain('hardcoded-signing-key');
    });
  });

  // -------------------------------------------------------------------------
  it('hostile inputs stay linear', SLOW, () => {
    const timings = timeInChild(`
      const cases = {
        prefixes: 'X = r"'.repeat(40000) + '\\n' + ('JWT' + '_SECRET = rb').repeat(20000),
        hereStrings: ('$env:JWT' + "_SECRET = @'\\n").repeat(20000),
        setEnv: ("[Environment]::SetEnvironmentVariable('JWT" + "_SECRET', @'\\n").repeat(10000),
        signCalls: ['jwt.sign', '(a, '].join('').repeat(30000) + ['.sign', 'With('].join('').repeat(30000) + ['SecretKeySpec', '("'].join('').repeat(20000),
        hmacCalls: ['HMAC', '(key=rb'].join('').repeat(30000) + ['createHmac', "('sha256', "].join('').repeat(20000) + ['cookieParser', '("'].join('').repeat(20000),
        options: 'session({ '.repeat(20000) + 'secret: "a b ' + '{'.repeat(50000) + 'secret: "x y z w" '.repeat(20000),
      };
      for (const [name, text] of Object.entries(cases)) {
        for (const file of ['a.js', 'a.py', 'a.ps1', 'a.md', 'a.txt']) {
          const start = performance.now();
          scanText(file, text);
          timings.push([name + ' ' + file, performance.now() - start]);
        }
      }
    `);
    for (const [label, ms] of timings) expect(ms, label).toBeLessThan(HOSTILE_LIMIT_MS);
  });

  // -------------------------------------------------------------------------
  it.skipIf(!hasGit())('the tree scan and --range report each class without printing the value', SLOW, () => {
    const dir = makeRepo();
    const base = commit(dir, { 'README.md': '# demo\n' });
    expect(scan(dir).status).toBe(0);
    const files = {
      'docs/setup.md': fence('python', `${NAME} = r"${passphrase}"\n`),
      'setup.ps1': `$env:${NAME} = @'\n${value}\n'@\n`,
      'auth.js': `module.exports = (p) => jwt.sign(p, "${passphrase}");\n`,
    };
    commit(dir, files);
    for (const args of [[], ['--range', `${base}..HEAD`]]) {
      const result = scan(dir, ...args);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status, output).toBe(1);
      expect(output).toContain('docs/setup.md');
      expect(output).toContain('setup.ps1');
      expect(output).toContain('auth.js');
      expect(output).toContain('hardcoded-signing-key');
      for (const piece of [...windows(value), ...windows(passphrase)]) expect(output).not.toContain(piece);
    }
  });
});
