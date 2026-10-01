/**
 * Tests for scripts/check-secrets.mjs, review round 17 (b): systemd units, constant definitions without `=`, and wrapper calls
 * around a literal.
 *
 * Every fake credential below is assembled at RUNTIME from pieces, so this file contains no secret-shaped literal and passes the
 * scanner itself (one test asserts exactly that). Do not paste a real credential here.
 *
 * Test runner: Vitest (run via `cd app && npm test`)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fileMode, scanText } from '../../../../scripts/check-secrets.mjs';

const HOSTILE_LIMIT_MS = 8000;
const SLOW_TEST_MS = 120_000;
const SLOW = { timeout: SLOW_TEST_MS };

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '../../../..');
const SCANNER = path.join(REPO_ROOT, 'scripts', 'check-secrets.mjs');
const THIS_FILE_REL = 'app/src/lib/__tests__/checkSecrets.r17b.test.js';

// Hostile scans run in a child process with a hard kill timeout: a backtracking regex would block the Vitest worker.
const CHILD_KILL_MS = 100_000;
const SCAN_MODULE_IMPORT = `import { scanText } from ${JSON.stringify(pathToFileURL(SCANNER).href)};`;
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

const secretName = (...parts) => parts.join('');

function windows(secret, size = 8) {
  const out = [];
  for (let i = 0; i + size <= secret.length; i += 1) out.push(secret.slice(i, i + size));
  return out;
}

function hasGit() {
  return spawnSync('git', ['--version']).status === 0;
}

const JWT = secretName('JWT_', 'SECRET');
const TOKEN = secretName('API_', 'TOKEN');
const value = randomString(24, 17201);
const passphrase = ['correct', 'horse', 'battery', 'staple'].join(' ');
const Q = '"';
const rules = (file, text) => scanText(file, text).map((f) => f.rule);

// ---------------------------------------------------------------------------
// (1) systemd and Quadlet units
// ---------------------------------------------------------------------------

describe('review round 17b: systemd units', () => {
  const UNIT_FILES = [
    'app.service', 'app.socket', 'app.timer', 'app.target', 'app.mount', 'app.path', 'app.slice', 'app.container', 'app.network',
    'deploy/systemd/app.service',
  ];

  it.each(UNIT_FILES)('%s is classified as configuration', (file) => {
    expect(fileMode(file)).toBe('config');
  });

  const HITS = [
    ['quoted Environment= with a random value', `Environment=${Q}${JWT}=${value}${Q}`],
    ['bare Environment= with a random value', `Environment=${JWT}=${value}`],
    ['quoted Environment= with a passphrase', `Environment=${Q}${JWT}=${passphrase}${Q}`],
    ['bare Environment= with a passphrase', `Environment=${JWT}=${passphrase}`],
    ['single-quoted Environment= with a passphrase', `Environment='${JWT}=${passphrase}'`],
    ['the second of several quoted assignments', `Environment=${Q}A=1${Q} ${Q}${JWT}=${value}${Q}`],
    ['the second of several quoted assignments, a passphrase', `Environment=${Q}A=1${Q} ${Q}${JWT}=${passphrase}${Q}`],
    ['the second of several bare assignments', `Environment=A=1 ${JWT}=${value}`],
    ['an assignment on a continuation line', `Environment=${Q}A=1${Q} \\\n  ${Q}${JWT}=${passphrase}${Q}`],
    ['SetCredential= with a secret-like id', `SetCredential=jwt_secret:${value}`],
    ['SetCredential= with a passphrase', `SetCredential=jwt_secret:${passphrase}`],
    ['SetCredential= with a random value under any id', `SetCredential=db:${value}`],
  ];

  it.each(HITS)('reports %s in a .service unit', (_label, line) => {
    expect(rules('app.service', `[Service]\n${line}\n`)).toContain('secret-assignment');
  });

  it.each(UNIT_FILES)('reports Environment= in %s', (file) => {
    expect(rules(file, `[Unit]\nDescription=x\n\n[Service]\nEnvironment=${Q}${JWT}=${value}${Q}\n`)).toContain('secret-assignment');
    expect(rules(file, `Environment=${JWT}=${passphrase}\n`)).toContain('secret-assignment');
  });

  it('reports a drop-in .conf under a *.d/ directory and a Quadlet .container', () => {
    expect(rules('etc/systemd/system/app.service.d/override.conf', `[Service]\nEnvironment=${Q}${JWT}=${passphrase}${Q}\n`)).toContain('secret-assignment');
    expect(rules('containers/systemd/app.container', `[Container]\nImage=app\nEnvironment=${JWT}=${value}\n`)).toContain('secret-assignment');
  });

  it('reports the Environment= line itself', () => {
    expect(scanText('app.service', `[Service]\nType=simple\nEnvironment=${Q}${JWT}=${value}${Q}\n`)).toEqual([{ path: 'app.service', line: 3, rule: 'secret-assignment' }]);
  });

  const CLEAN = [
    ['a reference', `Environment=${Q}${JWT}=\${X}${Q}`],
    ['a $VARIABLE', `Environment=${JWT}=$CREDENTIALS_DIRECTORY/jwt`],
    ['a specifier path', `Environment=${JWT}=%d/jwt_secret_file`],
    ['a home specifier path', `Environment=${JWT}=%h/.config/app/jwt`],
    ['an empty value', `Environment=${Q}${JWT}=${Q}`],
    ['an empty value before another assignment', `Environment=${Q}${JWT}=${Q} ${Q}A=1${Q}`],
    ['a placeholder', `Environment=${JWT}=changeme`],
    ['an ordinary environment', 'Environment=NODE_ENV=production PORT=3000'],
    ['EnvironmentFile= (a path)', 'EnvironmentFile=/etc/app/jwt-secret.env'],
    ['an optional EnvironmentFile=', 'EnvironmentFile=-/etc/default/app'],
    ['LoadCredential= (a path)', 'LoadCredential=jwt_secret:/etc/credstore/jwt_secret'],
    ['PassEnvironment= (names only)', `PassEnvironment=${JWT} ${TOKEN}`],
    ['UnsetEnvironment= (names only)', `UnsetEnvironment=${JWT}`],
    ['an empty SetCredential=', 'SetCredential=jwt_secret:'],
    ['SetCredential= with a word under an ordinary id', 'SetCredential=firstboot.locale:en_US.UTF-8'],
    ['ExecStart= with a credential file flag', 'ExecStart=/usr/bin/app --jwt-secret-file=%d/jwt_secret'],
    ['a Description=', 'Description=Rotate the JWT secret every night'],
  ];

  it.each(CLEAN)('passes %s', (_label, line) => {
    expect(scanText('app.service', `[Service]\n${line}\n`)).toEqual([]);
  });

  it('the allow marker silences an Environment= line', () => {
    const marker = ['check-secrets', ':allow'].join('');
    expect(scanText('app.service', `Environment=${JWT}=${value} # ${marker}\n`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (2) Constant definitions without `=`
// ---------------------------------------------------------------------------

describe('review round 17b: definitions without an assignment operator', () => {
  const HITS = [
    ['a.h', 'C #define with a random literal', `#define ${TOKEN} ${Q}${value}${Q}`],
    ['a.h', 'C #define with a passphrase', `#define ${JWT} ${Q}${passphrase}${Q}`],
    ['a.h', '#   define with blanks after the hash', `#   define ${TOKEN} ${Q}${value}${Q}`],
    ['a.c', 'an indented #define', `  #  define ${TOKEN} ${Q}${value}${Q}`],
    ['a.h', 'a backslash-continued #define', `#define ${TOKEN} \\\n    ${Q}${value}${Q}`],
    ['a.cpp', 'a #define followed by a comment', `#define ${TOKEN} ${Q}${value}${Q} // x`],
    ['a.h', 'a parenthesised #define', `#define ${TOKEN} (${Q}${value}${Q})`],
    ['a.h', 'a wide-string #define', `#define ${TOKEN} L${Q}${value}${Q}`],
    ['a.m', 'an Objective-C #define', `#define ${TOKEN} @${Q}${value}${Q}`],
    ['a.m', 'an Objective-C static NSString constant', `static NSString *const kApiToken = @${Q}${value}${Q};`],
    ['Makefile', 'a Makefile define ... endef', `define ${TOKEN}\n${value}\nendef`],
    ['build.mk', 'a Makefile define with a passphrase', `define ${JWT} =\n${passphrase}\nendef`],
    ['CMakeLists.txt', 'CMake set()', `set(${TOKEN} ${Q}${value}${Q})`],
    ['CMakeLists.txt', 'CMake set() with a passphrase', `set(${JWT} ${Q}${passphrase}${Q} CACHE STRING ${Q}x${Q})`],
    ['cmake/deps.cmake', 'CMake SET() with a bare value', `SET(${TOKEN} ${value})`],
    ['x.cmake', 'CMake set(ENV{...})', `set(ENV{${TOKEN}} ${Q}${value}${Q})`],
    ['app/build.gradle', 'Gradle buildConfigField', `buildConfigField ${Q}String${Q}, ${Q}${TOKEN}${Q}, ${Q}\\${Q}${value}\\${Q}${Q}`],
    ['app/build.gradle.kts', 'Kotlin DSL buildConfigField', `buildConfigField(${Q}String${Q}, ${Q}${TOKEN}${Q}, ${Q}\\${Q}${value}\\${Q}${Q})`],
    ['app/build.gradle', 'Android resValue', `resValue ${Q}string${Q}, ${Q}api_key${Q}, ${Q}${value}${Q}`],
  ];

  it.each(HITS)('%s: reports %s', (file, _label, text) => {
    expect(rules(file, `${text}\n`)).toContain('secret-assignment');
  });

  const CLEAN = [
    ['a.h', `#define ${TOKEN} ${Q}${Q}`],
    ['a.h', `#define ${TOKEN}_LEN 32`],
    ['a.h', `#define ${TOKEN} getenv(${Q}X${Q})`],
    ['a.h', `#define ${TOKEN} ${Q}YOUR_API_TOKEN${Q}`],
    ['a.h', `#define ${TOKEN}_HEADER ${Q}X-Api-Token${Q}`],
    ['a.h', `#define ${TOKEN} ${TOKEN}_DEFAULT`],
    ['a.h', '#define GET_TOKEN(x) ((x)->token)'],
    ['a.h', `#define ERR_INVALID_TOKEN ${Q}Invalid token${Q}`],
    ['a.h', `#define MSG_MISSING_API_KEY ${Q}Missing API key, set API_KEY first${Q}`],
    ['a.h', `#define ${JWT} ${Q}Token expired, please log in again.${Q}`],
    ['a.h', `#define SESSION_TOKEN ${Q}session_token${Q}`],
    ['a.h', `#define TOKEN_FMT ${Q}%s:%s${Q}`],
    ['notes.md', `#define ${TOKEN} ${Q}${value}${Q}`],
    ['CMakeLists.txt', `set(${TOKEN} ${Q}\${X}${Q})`],
    ['CMakeLists.txt', `set(ENV{${TOKEN}} ${Q}$ENV{Y}${Q})`],
    ['CMakeLists.txt', `set(${TOKEN} ${Q}${Q} CACHE STRING ${Q}The API token${Q})`],
    ['CMakeLists.txt', `set(${TOKEN}_FILE ${Q}\${CMAKE_SOURCE_DIR}/x${Q})`],
    ['CMakeLists.txt', 'set(SECRET_SOURCES src/secret.c src/token.c)'],
    ['Makefile', `define ${TOKEN}\n$(shell cat /run/secrets/x)\nendef`],
    ['Makefile', 'define build_token\n\t$(CC) -o $@ $<\nendef'],
    ['Makefile', 'define generate_token\n\t@echo generating token\nendef'],
    ['Makefile', `define ${TOKEN}\nendef`],
    ['build.gradle', `buildConfigField ${Q}String${Q}, ${Q}${TOKEN}${Q}, ${Q}\\${Q}\${apiToken}\\${Q}${Q}`],
    ['build.gradle', `buildConfigField ${Q}String${Q}, ${Q}${TOKEN}${Q}, ${Q}\\${Q}\\${Q}${Q}`],
    ['build.gradle', `buildConfigField ${Q}String${Q}, ${Q}${TOKEN}${Q}, ${Q}System.getenv(\\${Q}X\\${Q})${Q}`],
    ['build.gradle', `buildConfigField ${Q}String${Q}, ${Q}${TOKEN}${Q}, ${Q}\\${Q}${Q} + props[${Q}x${Q}] + ${Q}\\${Q}${Q}`],
    ['build.gradle', `buildConfigField ${Q}boolean${Q}, ${Q}${TOKEN}_ENABLED${Q}, ${Q}true${Q}`],
    ['build.gradle', `resValue ${Q}string${Q}, ${Q}api_key${Q}, ${Q}YOUR_API_KEY${Q}`],
    ['build.gradle', `resValue ${Q}string${Q}, ${Q}api_key_label${Q}, ${Q}API key${Q}`],
  ];

  it.each(CLEAN)('%s: passes %s', (file, text) => {
    expect(scanText(file, `${text}\n`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (3) Wrapper calls around a literal
// ---------------------------------------------------------------------------

describe('review round 17b: wrapper calls around a literal', () => {
  const lit = `${Q}${value}${Q}`;
  const HITS = [
    ['main.tf', 'a Terraform output value = sensitive("...")', `output ${Q}api_token${Q} {\n  value = sensitive(${lit})\n}`],
    ['main.tf', 'a Terraform variable default = sensitive("...")', `variable ${Q}api_token${Q} {\n  default = sensitive(${lit})\n}`],
    ['main.tf', 'a direct sensitive() assignment', `api_token = sensitive(${lit})`],
    ['main.tf', 'a sensitive() passphrase', `api_token = sensitive(${Q}${passphrase}${Q})`],
    ['main.tf', 'nonsensitive()', `api_token = nonsensitive(${lit})`],
    ['main.tf', 'tostring()', `api_token = tostring(${lit})`],
    ['main.tf', 'trimspace()', `api_token = trimspace(${lit})`],
    ['main.tf', 'chomp()', `api_token = chomp(${lit})`],
    ['main.tf', 'nested wrappers', `api_token = sensitive(trimspace(${lit}))`],
    ['main.tf', 'nested wrappers in a value field', `output ${Q}api_token${Q} {\n  value = sensitive(chomp(${lit}))\n}`],
    ['index.ts', 'pulumi.secret()', `const apiToken = pulumi.secret(${lit});`],
    ['index.ts', 'Output.secret()', `const apiToken = Output.secret(${lit});`],
    ['index.ts', 'pulumi.Output.secret()', `const apiToken = pulumi.Output.secret(${lit});`],
    ['index.ts', 'SecretValue.unsafePlainText()', `const apiToken = SecretValue.unsafePlainText(${lit});`],
    ['index.ts', 'cdk.SecretValue.unsafePlainText()', `const apiToken = cdk.SecretValue.unsafePlainText(${lit});`],
    ['index.ts', 'SecretValue.plainText()', `const apiToken = SecretValue.plainText(${lit});`],
    ['a.py', 'SecretStr()', `api_token = SecretStr(${lit})`],
    ['a.py', 'an annotated SecretStr()', `api_token: SecretStr = SecretStr(${lit})`],
    ['a.py', 'pydantic.SecretStr()', `api_token = pydantic.SecretStr(${lit})`],
    ['a.py', 'Secret()', `api_token = Secret(${lit})`],
  ];

  // A block's `value =` / `default =` field is reported by the name/value pair rule, a direct assignment by secret-assignment.
  it.each(HITS)('%s: reports %s', (file, _label, text) => {
    const found = rules(file, `${text}\n`);
    expect(found.some((rule) => rule === 'secret-assignment' || rule === 'secret-name-value-pair'), found.join(',')).toBe(true);
  });

  const CLEAN = [
    ['main.tf', 'api_token = sensitive(var.x)'],
    ['main.tf', `api_token = sensitive(${Q}${Q})`],
    ['main.tf', `api_token = sensitive(${Q}CHANGEME${Q})`],
    ['main.tf', `output ${Q}api_token${Q} {\n  value = sensitive(var.y)\n}`],
    ['main.tf', `output ${Q}api_token${Q} {\n  value     = sensitive(random_password.x.result)\n  sensitive = true\n}`],
    ['main.tf', `variable ${Q}api_token${Q} {\n  default = sensitive(${Q}${Q})\n}`],
    ['main.tf', 'api_token = tostring(var.z)'],
    ['main.tf', `api_token = trimspace(file(${Q}token.txt${Q}))`],
    ['index.ts', `const apiToken = pulumi.secret(config.require(${Q}x${Q}));`],
    ['index.ts', `const apiToken = pulumi.secret(${Q}your-api-token${Q});`],
    ['index.ts', `const apiToken = SecretValue.unsafePlainText(process.env.X ?? ${Q}${Q});`],
    ['index.ts', `const apiToken = SecretValue.secretsManager(${Q}x${Q});`],
    ['a.py', `api_token = SecretStr(os.environ[${Q}X${Q}])`],
    ['a.py', `api_token = SecretStr(${Q}${Q})`],
    ['a.py', `api_token = SecretStr(${Q}changeme${Q})`],
    ['a.py', 'api_token: SecretStr = Field(...)'],
  ];

  it.each(CLEAN)('%s: passes %s', (file, text) => {
    expect(scanText(file, `${text}\n`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Hostile input, the command line, --range, and this file
// ---------------------------------------------------------------------------

describe('review round 17b: limits and reports', () => {
  const dirs = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('the hostile-input limit holds on unit, #define, Makefile, CMake, Gradle and wrapper shapes (2 MB each)', SLOW, () => {
    const timings = timeInChild(`
      const repeat = (unit) => unit.repeat(Math.ceil((2 * 1024 * 1024) / unit.length));
      const cases = [
        ['app.service', repeat('Environment=\\\\\\n')],
        ['app.service', repeat('Environment="A=' + '\\\\'.repeat(30) + '\\n')],
        ['app.service', 'Environment=' + 'JWT_SECRET=a '.repeat(150000)],
        ['app.service', 'Environment="' + '"'.repeat(2 * 1024 * 1024)],
        ['app.service', repeat('SetCredential=jwt_secret:\\n')],
        ['a.h', repeat('#define API_TOKEN \\\\\\n')],
        ['a.h', repeat('#define API_TOKEN "' + 'a'.repeat(40) + '\\n')],
        ['Makefile', repeat('define API_TOKEN\\n')],
        ['Makefile', 'define API_TOKEN\\n' + 'x\\n'.repeat(1024 * 1024)],
        ['CMakeLists.txt', repeat('set(API_TOKEN ')],
        ['CMakeLists.txt', repeat('set(ENV{API_TOKEN} "')],
        ['build.gradle', repeat('buildConfigField "String", "API_TOKEN", "')],
        ['main.tf', repeat('api_token = sensitive(')],
        ['main.tf', repeat('value = sensitive(trimspace(chomp(tostring(')],
        ['index.ts', repeat('apiToken = pulumi.secret(pulumi.Output.secret("')],
      ];
      for (const [file, text] of cases) {
        const started = performance.now();
        scanText(file, text);
        timings.push(Math.round(performance.now() - started));
      }`);
    for (const ms of timings) expect(ms).toBeLessThan(HOSTILE_LIMIT_MS);
  });

  const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: SLOW_TEST_MS });
  const scan = (cwd, ...args) => run(process.execPath, [SCANNER, ...args], cwd);
  const git = (cwd, ...args) => run('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], cwd);
  const commit = (dir, message, files = {}) => {
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), content);
    }
    git(dir, 'add', '-A');
    expect(git(dir, 'commit', '-q', '-m', message).status).toBe(0);
    return git(dir, 'rev-parse', 'HEAD').stdout.trim();
  };
  const LEAKS = {
    'deploy/app.service': `[Service]\nEnvironment=${Q}A=1${Q} ${Q}${JWT}=${value}${Q}\n`,
    'src/config.h': `#define ${TOKEN} ${Q}${value}${Q}\n`,
    'CMakeLists.txt': `set(ENV{${TOKEN}} ${Q}${value}${Q})\n`,
    'app/build.gradle': `android {\n  defaultConfig {\n    buildConfigField ${Q}String${Q}, ${Q}${TOKEN}${Q}, ${Q}\\${Q}${value}\\${Q}${Q}\n  }\n}\n`,
    'infra/main.tf': `output ${Q}api_token${Q} {\n  value = sensitive(${Q}${value}${Q})\n}\n`,
  };
  const CLEAN = {
    'deploy/app.service': `[Service]\nEnvironment=${Q}A=1${Q}\nLoadCredential=jwt_secret:/etc/credstore/jwt\n`,
    'src/config.h': `#define ${TOKEN} getenv(${Q}X${Q})\n`,
    'CMakeLists.txt': `set(ENV{${TOKEN}} ${Q}$ENV{CI_TOKEN}${Q})\n`,
    'app/build.gradle': `android {\n  defaultConfig {\n    buildConfigField ${Q}String${Q}, ${Q}${TOKEN}${Q}, ${Q}\\${Q}\${apiToken}\\${Q}${Q}\n  }\n}\n`,
    'infra/main.tf': `output ${Q}api_token${Q} {\n  value = sensitive(var.api_token)\n}\n`,
  };

  it.skipIf(!hasGit())('the tree scan and --range report each new form without printing the value', SLOW, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'check-secrets-r17b-'));
    dirs.push(dir);
    expect(run('git', ['init', '-q', '-b', 'main'], dir).status).toBe(0);
    const base = commit(dir, 'base', { 'README.txt': 'base\n' });
    commit(dir, 'add', LEAKS);
    const tree = scan(dir);
    expect(tree.status).toBe(1);
    for (const file of Object.keys(LEAKS)) expect(tree.stderr).toContain(file);
    const head = commit(dir, 'remove', CLEAN);
    expect(scan(dir).status).toBe(0); // the tip is clean again
    const range = scan(dir, '--range', `${base}..${head}`);
    expect(range.status).toBe(1);
    for (const file of Object.keys(LEAKS)) expect(range.stderr).toContain(file);
    for (const result of [tree, range]) {
      const output = `${result.stdout}${result.stderr}`;
      for (const piece of windows(value)) expect(output).not.toContain(piece);
    }
  });

  it('this test file scans clean', () => {
    expect(scanText(THIS_FILE_REL, readFileSync(THIS_FILE, 'utf8'))).toEqual([]);
  });
});
