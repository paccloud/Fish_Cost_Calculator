/**
 * Tests for scripts/check-secrets.mjs (the repository secret scanner).
 *
 * Every fake credential below is assembled at RUNTIME from pieces, so this file
 * contains no secret-shaped literal and passes the scanner itself (one test
 * asserts exactly that). Do not paste a real credential here, not even to
 * "test with a real one".
 *
 * Test runner: Vitest (run via `cd app && npm test`)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  RULES,
  credentialFormats,
  decodeText,
  fileMode,
  formatHistoryReport,
  formatOversizeReport,
  formatReport,
  formatUnreadableReport,
  isBinaryContent,
  isPlaceholder,
  scanText,
  secretNameKind,
  shouldSkipPath,
} from '../../../../scripts/check-secrets.mjs';

// Generous, but still meaningful, wall-clock limits. Hostile-input tests guard against catastrophic (quadratic or worse)
// backtracking, which takes minutes on these inputs; a slow CI runner is several times slower than a laptop, not
// hundreds of times. SLOW_TEST_MS is the Vitest timeout of every test that spawns git or node or builds a big fixture.
// The allow marker, built at runtime so that only the tests that mean to use it carry it.
const ALLOW_MARKER = ['check-secrets', ':allow'].join('');
const HOSTILE_LIMIT_MS = 8000;
const SLOW_TEST_MS = 120_000;
const SLOW = { timeout: SLOW_TEST_MS };

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '../../../..');
const SCANNER = path.join(REPO_ROOT, 'scripts', 'check-secrets.mjs');
const THIS_FILE_REL = 'app/src/lib/__tests__/checkSecrets.test.js';

// ---------------------------------------------------------------------------
// Runtime fixture builders
// ---------------------------------------------------------------------------

const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const LOWER_ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const UPPER_ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const HEX = '0123456789abcdef';
const DIGITS = '0123456789';
const BASE64 = `${ALNUM}+/`;
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const PASSWORD_MANAGER = `${ALNUM}!$*-_.~+=^`;

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

const base64url = (value) =>
  btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

const secretName = (...parts) => parts.join('');

// Each case: which rule must fire, in what kind of file, and the secret part
// that must never appear in a report. `text` is the full file content.
const SECRET_CASES = (() => {
  const dbPassword = randomString(24, 11);
  const keyBody = randomString(64, 12, BASE64);
  const awsBody = randomString(16, 13, UPPER_ALNUM);
  const googleBody = randomString(35, 14);
  const ghBody = randomString(36, 15);
  const patBody = randomString(60, 16);
  const slackBody = randomString(24, 17);
  const stripeBody = randomString(24, 18);
  const jwtSignature = randomString(43, 19);
  const envSecret = randomString(32, 20);
  const yamlSecret = randomString(32, 21);
  const jsonSecret = randomString(40, 22);
  const fallbackSecret = randomString(14, 23);
  const napiBody = randomString(60, 24, LOWER_ALNUM);
  const npgBody = randomString(12, 25);
  const sskBody = randomString(32, 26);
  const sqlSecret = randomString(24, 27);
  const codeSecret = randomString(28, 28);
  const shortSecret = randomString(12, 29);
  const passphrase = ['correct-horse-battery-staple-', 'xxxx'].join('');
  const netrcPassword = randomString(22, 91);
  const hookToken = randomString(24, 92);
  const signature = randomString(30, 93);
  const pairValue = randomString(26, 94);

  const scheme = ['postgres', 'ql'].join('');
  const pemHeader = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
  const rsaHeader = ['-----BEGIN RSA ', 'PRIVATE KEY-----'].join('');
  const jwtHead = base64url({ alg: 'HS256', typ: 'JWT' });
  const jwtBody = base64url({ sub: 'user-1234', role: 'admin' });

  return [
    {
      name: 'database URL with a password',
      rule: 'url-password',
      path: 'docs/setup.md',
      secret: dbPassword,
      text: `Connect with ${scheme}://svc_owner:${dbPassword}@db-host.internal:5432/appdb?sslmode=require\n`,
    },
    {
      name: 'mongodb+srv URL with a password',
      rule: 'url-password',
      path: 'config/db.json',
      secret: dbPassword,
      text: `{"uri": "${['mongodb', '+srv'].join('')}://app:${dbPassword}@cluster0.internal/app"}\n`,
    },
    {
      name: 'SQL Server URL with a password',
      rule: 'url-password',
      path: '.env',
      secret: dbPassword,
      text: `DATABASE_URL=${['ms', 'sql'].join('')}://admin:${dbPassword}@db.internal.corp/db\n`,
    },
    {
      name: 'driver-suffixed SQLAlchemy URL',
      rule: 'url-password',
      path: '.env',
      secret: dbPassword,
      text: `DATABASE_URL=${scheme}+psycopg2://app:${dbPassword}@db.internal.corp/db\n`,
    },
    {
      name: 'neo4j+s URL',
      rule: 'url-password',
      path: 'notes.md',
      secret: dbPassword,
      text: `uri ${['neo4j', '+s'].join('')}://neo4j:${dbPassword}@graph.internal.corp:7687\n`,
    },
    {
      name: 'HTTPS basic-auth URL',
      rule: 'url-password',
      path: 'notes.md',
      secret: dbPassword,
      text: `git clone https://deploy:${dbPassword}@gitlab.internal.org/x.git\n`,
    },
    {
      name: 'database URL whose host merely contains "example"',
      rule: 'url-password',
      path: '.env',
      secret: dbPassword,
      text: `DATABASE_URL=${scheme}://admin:${dbPassword}@ep-example-app-123456.us-east-2.aws.neon.tech/db\n`,
    },
    {
      name: 'curl -u user:password',
      rule: 'url-password',
      path: 'docs/runbook.md',
      secret: dbPassword,
      text: `curl -u admin:${dbPassword} https://api.internal.corp/v1/x\n`,
    },
    {
      name: 'PEM private key on separate lines',
      rule: 'private-key-block',
      line: 1, // reported on the header line
      path: 'deploy/key.txt',
      secret: keyBody,
      text: `${pemHeader}\n${keyBody}\n${['-----END ', 'PRIVATE KEY-----'].join('')}\n`,
    },
    {
      name: 'RSA private key',
      rule: 'private-key-block',
      line: 1,
      path: 'deploy/id_rsa.txt',
      secret: keyBody,
      text: `${rsaHeader}\n${keyBody}\n`,
    },
    {
      name: 'PEM private key escaped inside JSON',
      rule: 'private-key-block',
      path: 'service-account.json',
      secret: keyBody,
      text: `{"private_key": "${pemHeader}\\n${keyBody}\\n"}\n`,
    },
    {
      name: 'AWS access key id',
      rule: 'aws-access-key-id',
      path: 'notes.md',
      secret: awsBody,
      text: `id: ${['AKIA', awsBody].join('')}\n`,
    },
    {
      name: 'Google API key',
      rule: 'google-api-key',
      path: 'src/config.js',
      secret: googleBody,
      text: `const key = "${['AIza', googleBody].join('')}";\n`,
    },
    {
      name: 'GitHub personal access token',
      rule: 'github-token',
      path: 'notes.md',
      secret: ghBody,
      text: `token ${['gh', 'p_', ghBody].join('')}\n`,
    },
    {
      name: 'GitHub fine-grained token',
      rule: 'github-token',
      path: 'notes.md',
      secret: patBody,
      text: `token ${['github', '_pat_', patBody].join('')}\n`,
    },
    {
      name: 'Slack token',
      rule: 'slack-token',
      path: 'notes.md',
      secret: slackBody,
      text: `hook ${['xox', 'b-', '123456789012-', slackBody].join('')}\n`,
    },
    {
      name: 'Stripe live secret key',
      rule: 'stripe-live-key',
      path: 'notes.md',
      secret: stripeBody,
      text: `key ${['sk_', 'live_', stripeBody].join('')}\n`,
    },
    {
      name: 'Stripe live restricted key',
      rule: 'stripe-live-key',
      path: 'notes.md',
      secret: stripeBody,
      text: `key ${['rk_', 'live_', stripeBody].join('')}\n`,
    },
    {
      name: 'Neon API key in code',
      rule: 'neon-api-key',
      path: 'src/neon.js',
      secret: napiBody,
      text: `const k='${['na', 'pi_', napiBody].join('')}'\n`,
    },
    {
      name: 'Neon role password',
      rule: 'neon-role-password',
      path: 'notes.md',
      secret: npgBody,
      text: `password ${['np', 'g_', npgBody].join('')}\n`,
    },
    {
      name: 'Stack Auth secret server key in code',
      rule: 'stack-auth-secret-key',
      path: 'src/stack.js',
      secret: sskBody,
      text: `export const stack = { ${secretName('secretServer', 'Key')}: '${['ss', 'k_', sskBody].join('')}' };\n`,
    },
    {
      name: 'JWT-shaped token',
      rule: 'jwt-token',
      path: 'notes.md',
      secret: jwtSignature,
      text: `Authorization: Bearer ${[jwtHead, jwtBody, jwtSignature].join('.')}\n`,
    },
    {
      name: 'SQL ALTER ROLE ... PASSWORD',
      rule: 'sql-password-literal',
      path: 'db/rotate.sql',
      secret: sqlSecret,
      text: `ALTER ROLE neondb_owner WITH PASSWORD '${sqlSecret}';\n`,
    },
    {
      name: 'SQL CREATE ROLE ... LOGIN PASSWORD in a runbook',
      rule: 'sql-password-literal',
      path: 'docs/runbook.md',
      secret: sqlSecret,
      text: `CREATE ROLE app LOGIN PASSWORD '${sqlSecret}';\n`,
    },
    {
      name: 'MySQL IDENTIFIED BY',
      rule: 'sql-password-literal',
      path: 'db/users.sql',
      secret: sqlSecret,
      text: `CREATE USER 'app'@'%' IDENTIFIED BY '${sqlSecret}';\n`,
    },
    {
      name: 'SECRET in an .env file',
      rule: 'secret-assignment',
      path: 'app/.env',
      secret: envSecret,
      text: `# comment\n${secretName('JWT_', 'SECRET')}=${envSecret}\n`,
    },
    {
      name: 'PASSWORD in an .env.production file',
      rule: 'secret-assignment',
      path: 'app/.env.production',
      secret: envSecret,
      text: `${secretName('DB_', 'PASSWORD')}=${envSecret}\n`,
    },
    {
      name: 'DB_PASS (abbreviated name)',
      rule: 'secret-assignment',
      path: '.env',
      secret: envSecret,
      text: `${secretName('DB_', 'PASS')}=${envSecret}\n`,
    },
    {
      name: 'SENDGRID_KEY (vendor key name)',
      rule: 'secret-assignment',
      path: '.env',
      secret: envSecret,
      text: `${secretName('SENDGRID_', 'KEY')}=${envSecret}\n`,
    },
    {
      name: 'SERVICE_ROLE_KEY',
      rule: 'secret-assignment',
      path: '.env',
      secret: envSecret,
      text: `${secretName('SUPABASE_SERVICE_ROLE_', 'KEY')}=${envSecret}\n`,
    },
    {
      name: 'ENCRYPTION_KEY (qualified key name)',
      rule: 'secret-assignment',
      path: '.env',
      secret: envSecret,
      text: `${secretName('ENCRYPTION_', 'KEY')}=${envSecret}\n`,
    },
    {
      name: 'export in .envrc',
      rule: 'secret-assignment',
      path: '.envrc',
      secret: envSecret,
      text: `export ${secretName('API_', 'TOKEN')}=${envSecret}\n`,
    },
    {
      name: 'env.production without a leading dot',
      rule: 'secret-assignment',
      path: 'env.production',
      secret: envSecret,
      text: `${secretName('DB_', 'PASSWORD')}=${envSecret}\n`,
    },
    {
      name: 'Makefile variable',
      rule: 'secret-assignment',
      path: 'Makefile',
      secret: envSecret,
      text: `${secretName('SIGNING_', 'KEY')} = ${envSecret}\n`,
    },
    {
      name: 'AWS credentials file',
      rule: 'secret-assignment',
      path: '.aws/credentials',
      secret: envSecret,
      text: `[default]\n${secretName('aws_secret_access_', 'key')} = ${envSecret}\n`,
    },
    {
      name: 'TOKEN with export and quotes',
      rule: 'secret-assignment',
      path: 'scripts/setup.sh',
      secret: envSecret,
      text: `export ${secretName('AUTH_', 'TOKEN')}="${envSecret}"\n`,
    },
    {
      name: 'PRIVATE_KEY in YAML',
      rule: 'secret-assignment',
      path: 'config/app.yml',
      secret: yamlSecret,
      text: `service:\n  ${secretName('private_', 'key')}: ${yamlSecret}\n`,
    },
    {
      name: 'API_KEY in JSON (camelCase name)',
      rule: 'secret-assignment',
      path: 'config/app.json',
      secret: jsonSecret,
      text: `{\n  "${secretName('api', 'Key')}": "${jsonSecret}"\n}\n`,
    },
    {
      name: 'SECRET in a Markdown code block',
      rule: 'secret-assignment',
      path: 'docs/setup.md',
      secret: envSecret,
      text: `\`\`\`\n${secretName('SESSION_', 'SECRET')}=${envSecret}\n\`\`\`\n`,
    },
    {
      name: 'password in Terraform',
      rule: 'secret-assignment',
      path: 'infra/main.tf',
      secret: codeSecret,
      text: `resource "db" "main" {\n  ${secretName('pass', 'word')} = "${codeSecret}"\n}\n`,
    },
    {
      name: 'quoted UPPER_SNAKE constant in JavaScript',
      rule: 'secret-assignment',
      path: 'server/auth.js',
      secret: codeSecret,
      text: `const ${secretName('JWT_', 'SECRET')} = '${codeSecret}';\n`,
    },
    {
      name: 'password key of a connection pool object',
      rule: 'secret-assignment',
      path: 'api/db.js',
      secret: codeSecret,
      text: `const pool = new Pool({ host: 'h', user: 'neondb_owner', ${secretName('pass', 'word')}: '${codeSecret}' });\n`,
    },
    {
      name: 'exported constant in TypeScript',
      rule: 'secret-assignment',
      path: 'src/keys.ts',
      secret: codeSecret,
      text: `export const ${secretName('api', 'Key')}: string = "${codeSecret}";\n`,
    },
    {
      name: 'property in a JSX file',
      rule: 'secret-assignment',
      path: 'src/App.jsx',
      secret: codeSecret,
      text: `const config = { ${secretName('api', 'Key')}: "${codeSecret}" };\n`,
    },
    {
      name: 'property in a Vue single-file component',
      rule: 'secret-assignment',
      path: 'src/App.vue',
      secret: codeSecret,
      text: `<script>\nexport default { data: () => ({ ${secretName('pass', 'word')}: '${codeSecret}' }) };\n</script>\n`,
    },
    {
      name: 'inline script in an HTML page',
      rule: 'secret-assignment',
      path: 'public/index.html',
      secret: codeSecret,
      text: `<script>\n  const ${secretName('api', 'Key')} = "${codeSecret}";\n</script>\n`,
    },
    {
      name: 'password variable in Python',
      rule: 'secret-assignment',
      path: 'tools/db.py',
      secret: codeSecret,
      text: `${secretName('pass', 'word')} = "${codeSecret}"\n`,
    },
    {
      name: 'SESSION_TOKEN of only 12 characters',
      rule: 'secret-assignment',
      path: '.env',
      secret: shortSecret,
      text: `${secretName('SESSION_', 'TOKEN')}=${shortSecret}\n`,
    },
    {
      name: 'passphrase-style secret',
      rule: 'secret-assignment',
      path: '.env',
      secret: passphrase,
      text: `${secretName('JWT_', 'SECRET')}=${passphrase}\n`,
    },
    {
      name: 'value cut by ";" (first part too short to look random)',
      rule: 'secret-assignment',
      line: 1,
      path: '.env',
      secret: envSecret,
      text: `${secretName('DB_', 'PASSWORD')}=${envSecret.slice(0, 3)};${envSecret.slice(3)}\n`,
    },
    {
      name: 'value cut by "#" (first part too short to look random)',
      rule: 'secret-assignment',
      line: 1,
      path: '.env',
      secret: envSecret,
      text: `${secretName('DB_', 'PASSWORD')}=${envSecret.slice(0, 3)}#${envSecret.slice(3)}\n`,
    },
    {
      name: 'value cut by "," (first part too short to look random)',
      rule: 'secret-assignment',
      line: 1,
      path: '.env',
      secret: envSecret,
      text: `${secretName('DB_', 'PASSWORD')}=${envSecret.slice(0, 10)},${envSecret.slice(10)}\n`,
    },
    {
      name: 'k8s name/value pair split over two lines',
      rule: 'secret-name-value-pair',
      line: 2, // reported on the "- name:" line; the value is on line 3
      path: 'k8s/deploy.yaml',
      secret: envSecret,
      text: `env:\n  - name: ${secretName('DB_', 'PASSWORD')}\n    value: "${envSecret}"\n`,
    },
    {
      name: 'Vercel-style {"key","value"} pair',
      rule: 'secret-name-value-pair',
      path: 'vercel-env.json',
      secret: envSecret,
      text: `[{"key":"${secretName('JWT_', 'SECRET')}","value":"${envSecret}"}]\n`,
    },
    {
      name: 'jwt.sign with a string literal key',
      rule: 'hardcoded-signing-key',
      path: 'api/login.js',
      secret: codeSecret,
      text: `const t = jwt.sign({ id: user.id }, '${codeSecret}', { expiresIn: '1h' });\n`,
    },
    {
      name: 'hardcoded fallback for a secret env var',
      rule: 'hardcoded-secret-fallback',
      path: 'server/server.js',
      secret: fallbackSecret,
      text: `const key = process.env.JWT_${'SECRET'} || '${fallbackSecret}';\n`,
    },
    {
      name: 'hardcoded fallback with ?? and double quotes',
      rule: 'hardcoded-secret-fallback',
      path: 'api/auth.mjs',
      secret: fallbackSecret,
      text: `export const key = process.env.SIGNING_${'TOKEN'} ?? "${fallbackSecret}";\n`,
    },
    {
      name: 'fallback through bracket access',
      rule: 'hardcoded-secret-fallback',
      path: 'server/server.js',
      secret: fallbackSecret,
      text: `const key = process.env['JWT_${'SECRET'}'] || '${fallbackSecret}';\n`,
    },
    {
      name: 'fallback as a destructuring default',
      rule: 'hardcoded-secret-fallback',
      path: 'server/server.js',
      secret: fallbackSecret,
      text: `const { JWT_${'SECRET'} = '${fallbackSecret}', PORT } = process.env;\n`,
    },
    {
      name: 'fallback with a lowercase variable name',
      rule: 'hardcoded-secret-fallback',
      path: 'server/server.js',
      secret: fallbackSecret,
      text: `const key = process.env.jwt_${'secret'} || '${fallbackSecret}';\n`,
    },
    {
      name: 'fallback for DB_PASS (name outside SECRET/PASSWORD/TOKEN)',
      rule: 'hardcoded-secret-fallback',
      path: 'server/db.js',
      secret: fallbackSecret,
      text: `const pass = process.env.DB_${'PASS'} || '${fallbackSecret}';\n`,
    },
    {
      name: 'fallback for ENCRYPTION_KEY',
      rule: 'hardcoded-secret-fallback',
      path: 'server/crypto.js',
      secret: fallbackSecret,
      text: `const key = process.env.ENCRYPTION_${'KEY'} || '${fallbackSecret}';\n`,
    },
    {
      name: 'fallback with the literal on the next line (Prettier wrapping)',
      rule: 'hardcoded-secret-fallback',
      line: 1,
      path: 'server/server.js',
      secret: fallbackSecret,
      text: `const key = process.env.JWT_${'SECRET'} ||\n  '${fallbackSecret}';\n`,
    },
    {
      name: 'Python getenv default',
      rule: 'hardcoded-secret-fallback',
      path: 'tools/db.py',
      secret: fallbackSecret,
      text: `key = os.getenv("JWT_${'SECRET'}", "${fallbackSecret}")\n`,
    },
    {
      name: '.netrc password',
      rule: 'credential-file',
      path: 'home/.netrc',
      secret: netrcPassword,
      text: `machine api.internal login app password ${netrcPassword}\n`,
    },
    {
      name: 'webhook URL with a path token',
      rule: 'webhook-url',
      path: 'docs/alerts.md',
      secret: hookToken,
      text: `curl -X POST https://hooks.slack.com/services/T0123ABCD/B0123ABCD/${hookToken}\n`,
    },
    {
      name: 'signed URL held by a secret name',
      rule: 'secret-assignment',
      path: '.env',
      secret: signature,
      text: `${['API_', 'TOKEN'].join('')}=https://download.internal.org/file?sig=${signature}\n`,
    },
    {
      name: 'JSON name and value in reverse order with a field in between',
      rule: 'secret-name-value-pair',
      path: 'exports/env.json',
      line: 1,
      secret: pairValue,
      text: `[{"value":"${pairValue}","type":"encrypted","key":"${['JWT_', 'SECRET'].join('')}"}]\n`,
    },
    {
      name: 'secret set on a command line',
      rule: 'secret-cli-command',
      path: 'deploy.sh',
      line: 1,
      secret: pairValue,
      text: `gh secret set ${['JWT_', 'SECRET'].join('')} --body ${pairValue}\n`,
    },
  ];
})();

function windows(secret, size = 8) {
  const out = [];
  for (let i = 0; i + size <= secret.length; i += 1) out.push(secret.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Rule coverage
// ---------------------------------------------------------------------------

describe('fixtures', () => {
  it('generated fake secrets do not look like placeholders', () => {
    for (const c of SECRET_CASES) expect(isPlaceholder(c.secret), c.name).toBe(false);
  });

  it('every scanner rule has at least one positive case', () => {
    const covered = new Set(SECRET_CASES.map((c) => c.rule));
    expect([...covered].sort()).toEqual(RULES.map((r) => r.id).sort());
  });
});

describe('scanText: detection', () => {
  for (const c of SECRET_CASES) {
    it(`detects: ${c.name}`, () => {
      const findings = scanText(c.path, c.text);
      expect(findings.map((f) => f.rule)).toContain(c.rule);
      const hit = findings.find((f) => f.rule === c.rule);
      const expectedLine = c.line ?? c.text.split('\n').findIndex((l) => l.includes(c.secret)) + 1;
      expect(hit.line).toBe(expectedLine);
      expect(hit.path).toBe(c.path);
    });
  }

  it('reports the correct line number in a longer file', () => {
    const secret = randomString(32, 31);
    const text = `A=1\nB=2\n\n${['API_', 'KEY'].join('')}=${secret}\nC=3\n`;
    expect(scanText('.env', text)).toEqual([{ path: '.env', line: 4, rule: 'secret-assignment' }]);
  });

  it('handles CRLF line endings', () => {
    const secret = randomString(32, 32);
    const text = `A=1\r\n${['API_', 'KEY'].join('')}=${secret}\r\n`;
    expect(scanText('.env', text).map((f) => f.line)).toEqual([2]);
  });

  it('in source code only a QUOTED literal counts; a bare KEY=value is an expression', () => {
    const secret = randomString(32, 33);
    const name = ['API_', 'KEY'].join('');
    expect(scanText('src/config.js', `${name}=${secret}\n`)).toEqual([]);
    expect(scanText('src/config.js', `const ${name} = "${secret}";\n`).map((f) => f.rule)).toEqual(['secret-assignment']);
    expect(scanText('.env.local', `${name}=${secret}\n`).map((f) => f.rule)).toEqual(['secret-assignment']);
    expect(scanText('production.env', `${name}=${secret}\n`).map((f) => f.rule)).toEqual(['secret-assignment']);
  });

  it('in env and config files any non-placeholder value of 8+ characters counts, with no entropy test', () => {
    const name = ['API_', 'TOKEN'].join('');
    const hex = randomString(40, 35, HEX);
    const camel = 'ThisIsAVeryLongCamelCaseIdentifierNameHere';
    const kebab = 'my-long-descriptive-config-name-value';
    for (const value of [hex, camel, kebab, randomString(8, 36), 'a'.repeat(9)]) {
      expect(scanText('.env', `${name}=${value}\n`).map((f) => f.rule), value.length).toEqual(['secret-assignment']);
    }
    expect(scanText('.env', `${name}=${randomString(7, 37)}\n`)).toEqual([]);
  });

  it('a name that only MENTIONS a secret needs a random-looking value', () => {
    const endpoint = ['TOKEN_', 'ENDPOINT'].join('');
    const salt = ['PASSWORD_', 'HINT'].join('');
    expect(scanText('.env', `${endpoint}=oauth-token-endpoint-name\n`)).toEqual([]);
    expect(scanText('.env', `${salt}=${randomString(24, 38)}\n`).map((f) => f.rule)).toEqual(['secret-assignment']);
  });

  it('digit-free single-case random secrets are found (they used to be missed)', () => {
    const name = ['SECRET_', 'SEED'].join('');
    expect(scanText('.env', `${name}=${randomString(32, 39, LOWER)}\n`).map((f) => f.rule)).toEqual(['secret-assignment']);
    expect(scanText('.env', `${name}=${randomString(32, 40, UPPER)}\n`).map((f) => f.rule)).toEqual(['secret-assignment']);
  });

  it('honors the inline check-secrets:allow marker on that line only', () => {
    const secret = randomString(32, 34);
    const name = ['API_', 'KEY'].join('');
    const allowed = `${name}=${secret} # check-secrets:allow\n`;
    expect(scanText('.env', allowed)).toEqual([]);
    const second = `${allowed}${name}=${secret}\n`;
    expect(scanText('.env', second).map((f) => f.line)).toEqual([2]);
  });

  it('honors the marker on any line a multi-line match spans', () => {
    const secret = randomString(14, 41);
    const text = `const key = process.env.JWT_${'SECRET'} ||\n  '${secret}'; // check-secrets:allow\n`;
    expect(scanText('server/server.js', text)).toEqual([]);
  });

  it('a minified single-line file with thousands of matches still reports one finding per rule and line', () => {
    const name = ['API_', 'KEY'].join('');
    const secret = randomString(32, 42);
    const text = Array.from({ length: 2000 }, () => `${name}="${secret}"`).join(' ');
    expect(scanText('bundle.min.json', text)).toEqual([{ path: 'bundle.min.json', line: 1, rule: 'secret-assignment' }]);
  });
});

describe('secretNameKind', () => {
  it.each([
    ['JWT_SECRET', 'strong'],
    ['jwtSecret', 'strong'],
    ['db.password', 'strong'],
    ['DB_PASS', 'strong'],
    ['DB_PWD', 'strong'],
    ['MYSQL_PWD', 'strong'],
    ['AUTH_TOKEN', 'strong'],
    ['refresh_token2', 'strong'],
    ['apiKey', 'strong'],
    ['STRIPE_API_KEY', 'strong'],
    ['ENCRYPTION_KEY', 'strong'],
    ['SIGNING_KEY', 'strong'],
    ['SESSION_KEY', 'strong'],
    ['HMAC_KEY', 'strong'],
    ['aws_secret_access_key', 'strong'],
    ['PRIVATE_KEY', 'strong'],
    ['SERVICE_ROLE_KEY', 'strong'],
    ['SENDGRID_KEY', 'weak'],
    ['STRIPE_KEY', 'weak'],
    ['TOKEN_ENDPOINT', 'weak'],
    ['PASSWORD_MIN_LENGTH', 'weak'],
    ['API_KEY_HEADER', 'weak'],
    ['CREDENTIALS', 'weak'],
    ['SALT', 'weak'],
    ['max_tokens', 'weak'],
    ['tokenizer', 'weak'],
    ['PORT', null],
    ['bypass', null],
    ['compass', null],
    ['KEY', null],
    ['keyboard', null],
    ['keyword', null],
    ['DATABASE_URL', null],
  ])('%s is %s', (name, expected) => {
    expect(secretNameKind(name)).toBe(expected);
  });
});

describe('fileMode', () => {
  it.each([
    ['.env', 'config'],
    ['app/.env.production', 'config'],
    ['production.env', 'config'],
    ['env.production', 'config'],
    ['.envrc', 'config'],
    ['Makefile', 'config'],
    ['.aws/credentials', 'config'],
    ['infra/main.tf', 'config'],
    ['k8s/deploy.yaml', 'config'],
    ['config.json', 'config'],
    ['docs/setup.md', 'prose'],
    ['notes.txt', 'prose'],
    ['server/server.js', 'code'],
    ['src/App.jsx', 'code'],
    ['src/App.vue', 'code'],
    ['tools/db.py', 'code'],
    ['db/rotate.sql', 'code'],
    ['public/index.html', 'code'],
  ])('%s is %s', (file, mode) => {
    expect(fileMode(file)).toBe(mode);
  });
});

// ---------------------------------------------------------------------------
// Measured detection rates. These are the shapes that used to slip through: the old gate missed
// 18-19% of 32-character hex secrets and 10-16% of 16-character alphanumeric ones in env files.
// ---------------------------------------------------------------------------

describe('scanText: detection rate over generated secrets', () => {
  const uuid = (seed) =>
    [randomString(8, seed, HEX), randomString(4, seed + 1, HEX), `4${randomString(3, seed + 2, HEX)}`, `a${randomString(3, seed + 3, HEX)}`, randomString(12, seed + 4, HEX)].join('-');

  const GENERATORS = [
    ['alnum-12', (s) => randomString(12, s), 0.85],
    ['alnum-16', (s) => randomString(16, s), 0.95],
    ['alnum-20', (s) => randomString(20, s), 0.95],
    ['alnum-24', (s) => randomString(24, s), 0.97],
    ['alnum-32', (s) => randomString(32, s), 0.97],
    ['hex-16', (s) => randomString(16, s, HEX), 0],
    ['hex-32', (s) => randomString(32, s, HEX), 0.99],
    ['hex-40', (s) => randomString(40, s, HEX), 0.99],
    ['uuid-v4', uuid, 0.99],
    ['base64-24', (s) => randomString(24, s, BASE64), 0.97],
    ['base64-44', (s) => randomString(44, s, BASE64), 0.97],
    ['lowercase-32', (s) => randomString(32, s, LOWER), 0.95],
    ['uppercase-32', (s) => randomString(32, s, UPPER), 0.95],
    ['digits-20', (s) => randomString(20, s, DIGITS), 0.99],
    ['password-manager-20', (s) => randomString(20, s, PASSWORD_MANAGER), 0.95],
    ['prefixed-16', (s) => `pk_${randomString(12, s)}`, 0.85],
  ];
  const SAMPLES = 150;
  const name = (...parts) => parts.join('');

  describe.each(GENERATORS)('%s', (label, make, codeRate) => {
    const values = Array.from({ length: SAMPLES }, (_, i) => make(1000 + i * 7));

    it('every value is found as an env-file secret, quoted or not (no length or entropy test)', () => {
      const shapes = [
        (v) => ['.env', `${name('JWT_', 'SECRET')}=${v}\n`],
        (v) => ['app/.env.production', `${name('DB_', 'PASSWORD')}=${v}\n`],
        (v) => ['.env', `${name('DB_', 'PASSWORD')}="${v}"\n`],
        (v) => ['.env', `${name('JWT_', 'SECRET')}='${v}'\n`],
      ];
      let misses = 0;
      for (const v of values) {
        for (const shape of shapes) {
          const [file, text] = shape(v);
          if (scanText(file, text).length === 0) misses += 1;
        }
      }
      expect(misses).toBe(0);
    });

    it(`is found as a quoted literal in source code at least ${codeRate * 100}% of the time`, () => {
      const shapes = [
        (v) => ['a.js', `const ${name('JWT_', 'SECRET')} = '${v}';\n`],
        (v) => ['a.js', `new Pool({ ${name('pass', 'word')}: '${v}' });\n`],
        (v) => ['a.py', `${name('pass', 'word')} = "${v}"\n`],
      ];
      let total = 0;
      let hits = 0;
      for (const v of values) {
        for (const shape of shapes) {
          const [file, text] = shape(v);
          total += 1;
          if (scanText(file, text).length > 0) hits += 1;
        }
      }
      expect(hits / total).toBeGreaterThanOrEqual(codeRate);
    });
  });
});

// ---------------------------------------------------------------------------
// Placeholders and references must not be flagged
// ---------------------------------------------------------------------------

describe('scanText: placeholders and references', () => {
  const dbScheme = ['postgres', 'ql'].join('');
  const realish = randomString(24, 41);

  const CLEAN_ENV_LINES = [
    `DATABASE_URL=${dbScheme}://user:password@host/dbname`,
    `DATABASE_URL=${dbScheme}://USER:PASSWORD@HOST:5432/DB`,
    `DATABASE_URL=${dbScheme}://user:[YOUR-PASSWORD]@host/db`,
    `DATABASE_URL=${['mongodb', '+srv'].join('')}://<user>:<password>@cluster.example.net/db`,
    `DATABASE_URL=${dbScheme}://app:\${DB_PASSWORD}@db/app`,
    `DATABASE_URL=${dbScheme}://app:...@db/app`,
    `DATABASE_URL=${dbScheme}://app:${realish}@db.example.com/app`,
    `DATABASE_URL=${dbScheme}://app:${realish}@db.example.org:5432/app`,
    `DATABASE_URL=${dbScheme}://app:${realish}@service.example/app`,
    `DATABASE_URL=${dbScheme}://app:${realish}@db.internal.test/app`,
    `DATABASE_URL=${dbScheme}://app:${realish}@localhost:5432/app`,
    `DATABASE_URL=${dbScheme}://app:${realish}@127.0.0.1/app`,
    'JWT_SECRET=your_jwt_secret_here',
    'JWT_SECRET=change-me-to-a-long-random-string-0123456789',
    'JWT_SECRET=changeme',
    'SESSION_TOKEN=',
    'SESSION_TOKEN=""',
    'AUTH_TOKEN=<paste-token-here>',
    'STRIPE_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxx',
    'OTHER_SECRET=REDACTED',
    'OTHER_PASSWORD=...',
    'OTHER_PASSWORD=************',
    'VITE_API_KEY=$VITE_API_KEY',
    'VITE_API_KEY=${VITE_API_KEY}',
    'API_TOKEN=example-token-1234567890abcdef',
    'SECRET_KEY=process.env.SECRET_KEY',
    'SECRET_KEY=import.meta.env.VITE_SECRET_KEY',
    'CLIENT_SECRET=this_is_a_dummy_value_9999',
    'WEBHOOK_TOKEN=fake_token_for_local_dev_1',
    'VITE_GEMINI_API_KEY=AIza...',
    'GITHUB_TOKEN=ghp_...',
    'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    'PASSWORD_HASH=$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
    'DB_PASSWORD=ENC[AES256_GCM,data:abcdefghijklmnop,type:str]',
    'ORDINARY_SETTING=abcdefghijklmnopqrstuvwxyz0123456789',
    'TOKEN_ENDPOINT=https://auth.internal.test/oauth/token',
    'PASSWORD_MIN_LENGTH=12',
    'API_KEY_HEADER=x-api-key',
    'PASSWORD_FILE=/run/secrets/db_password',
    'max_tokens=100000000',
    'SECRET_NAME=fish-db-credentials',
    'CACHE_KEY=fish-data-v3',
    'STORAGE_KEY=fishCalcState_v2',
    'PARTITION_KEY=user_id',
    'DB_PASSWORD=password',
    'DB_PASSWORD=required',
    'token=localStorage.getItem("token");',
    'token=req.body.token',
    'DB_PASSWORD=$(cat /run/secrets/db)',
    'docker run -u 1000:1000 example/image',
    'docker run -u root:root example/image',
    'curl -u admin:password https://api.internal.corp/v1/x',
    'curl -u admin:${API_PASSWORD} https://api.internal.corp/v1/x',
  ];

  for (const line of CLEAN_ENV_LINES) {
    it(`ignores: ${line}`, () => {
      expect(scanText('app/.env.example', `${line}\n`)).toEqual([]);
    });
  }

  it('a docker user and group pair is not an HTTP password, even when the next line mentions curl', () => {
    const name = ['a', 'pp'].join('');
    expect(scanText('docs/run.md', `docker run -u ${name}:${name} img\ncurl https://api.internal.corp/x\n`)).toEqual([]);
  });

  it('ignores GitHub Actions secret references in YAML', () => {
    const yaml = ['env:', '  NPM_TOKEN: ${{ secrets.NPM_TOKEN }}', '  API_KEY: "${{ secrets.API_KEY }}"', ''].join('\n');
    expect(scanText('.github/workflows/x.yml', yaml)).toEqual([]);
  });

  it('ignores label-like values and prose in JSON, YAML and Markdown', () => {
    const json = ['{', '  "password": "Password",', '  "forgotPassword": "Forgot your password?",', '  "token": "Bearer"', '}', ''].join('\n');
    expect(scanText('src/i18n/en.json', json)).toEqual([]);
    const md = ['**Password:** must be at least 8 characters', '- Token: required for every request', 'Set JWT_SECRET to a long random value', ''].join('\n');
    expect(scanText('docs/API.md', md)).toEqual([]);
  });

  it('ignores env references and empty fallbacks in source code', () => {
    const code = [
      'const a = process.env.JWT_SECRET;',
      "const b = process.env.JWT_SECRET || '';",
      'const c = process.env.JWT_SECRET || (isDev ? crypto.randomBytes(32).toString("hex") : null);',
      "const d = process.env.PORT || '3000';",
      'const e = process.env.API_TOKEN || `${other}`;',
      'const f = import.meta.env.VITE_FIREBASE_API_KEY;',
      "const g = process.env['JWT_SECRET'];",
      "const { JWT_SECRET, PORT = '3000' } = process.env;",
      'const h = jwt.sign(payload, secret, { expiresIn: "1h" });',
      "const i = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });",
      '',
    ].join('\n');
    expect(scanText('server/server.js', code)).toEqual([]);
  });

  it('ignores ordinary identifiers and fixtures assigned to secret-like names in source code', () => {
    const code = [
      "const TOKEN_KEY = 'auth_token';",
      "const options = { credentials: 'same-origin', tokenUrl: 'https://auth.internal.test/token' };",
      "const user = { password: 'Password123!', token: 'test-token-12345' };",
      "const secretName = 'fish-db-credentials';",
      "const label = { passwordPlaceholder: 'Enter your password' };",
      "const PASSWORD_RULES = 'must contain a number and a symbol';",
      "const authToken = 'ThisIsAVeryLongCamelCaseIdentifierNameHere';",
      '',
    ].join('\n');
    expect(scanText('src/lib/auth.js', code)).toEqual([]);
  });

  it('ignores placeholder tokens for the prefix-based rules', () => {
    const text = [
      `aws AKIA${'IOSFODNN7'}${'EXAMPLE'}`,
      `github ${['gh', 'p_'].join('')}${'x'.repeat(36)}`,
      `stripe ${['sk_', 'live_'].join('')}${'X'.repeat(24)}`,
      `google ${['AIza', 'x'.repeat(35)].join('')}`,
      `neon ${['na', 'pi_'].join('')}${'x'.repeat(40)}`,
      `neon ${['np', 'g_'].join('')}${'x'.repeat(12)}`,
      `stack ${['ss', 'k_'].join('')}${'x'.repeat(32)}`,
      `jwt ${['eyJ', 'hbGciOiJIUzI1NiJ9'].join('')}.${['eyJ', 'zdWIiOiJ1c2VyIn0'].join('')}.${'x'.repeat(30)}`,
      '',
    ].join('\n');
    expect(scanText('notes.md', text)).toEqual([]);
  });

  it('ignores a PEM header that is not followed by key material', () => {
    const header = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
    expect(scanText('docs/x.md', `${header}\n...\n`)).toEqual([]);
    expect(scanText('docs/x.md', `Keys start with ${header}.\n`)).toEqual([]);
  });

  it('ignores a JWT with a short signature and a truncated sample', () => {
    const head = base64url({ alg: 'RS256', kid: 'abc' });
    const body = base64url({ email: 'a@b.test', sub: '1' });
    expect(scanText('docs/API.md', `Bearer ${[head, body, 'c2lnbg'].join('.')}\n`)).toEqual([]);
    expect(scanText('docs/API.md', `{"token": "${[head, body].join('.').slice(0, 39)}..."}\n`)).toEqual([]);
  });

  it('ignores SQL with placeholder passwords', () => {
    const sql = ["ALTER ROLE app WITH PASSWORD '<new-password>';", "CREATE ROLE app LOGIN PASSWORD 'changeme';", "CREATE USER a IDENTIFIED BY 'your_password';", ''].join('\n');
    expect(scanText('db/rotate.sql', sql)).toEqual([]);
  });

  it('a bare `password' + " '...'` is only SQL in a .sql file", () => {
    const value = randomString(20, 43);
    expect(scanText('docs/x.md', `the password '${value}' was shown\n`)).toEqual([]);
    expect(scanText('db/x.sql', `SET password '${value}';\n`).map((f) => f.rule)).toEqual(['sql-password-literal']);
  });
});

describe('placeholder markers are anchored, not substring tests', () => {
  const realish = randomString(14, 60);
  const tail = randomString(12, 61);
  const name = ['DB_', 'PASSWORD'].join('');
  const dbScheme = ['postgres', 'ql'].join('');
  const flagged = (value) => scanText('app/.env.production', `${name}=${value}\n`).map((f) => f.rule);

  it('a `$` followed by letters is a reference only when the whole value is an upper-case variable name', () => {
    expect(isPlaceholder('$DB_PASSWORD')).toBe(true);
    expect(isPlaceholder('$db_password')).toBe(true);
    expect(isPlaceholder(`$${randomString(15, 62)}`)).toBe(false);
    expect(flagged(`$${randomString(15, 62)}`)).toEqual(['secret-assignment']);
    const url = `DATABASE_URL=${dbScheme}://admin:$${randomString(15, 63)}@db.internal.corp/db\n`;
    expect(scanText('.env', url).map((f) => f.rule)).toEqual(['url-password']);
  });

  it('a marker inside a long random value does not make it a placeholder', () => {
    for (const marker of ['...', '***', '___', '<x>', 'xxx']) {
      expect(isPlaceholder(`${realish}${marker}${tail}`), marker).toBe(false);
      expect(flagged(`${realish}${marker}${tail}`), marker).toEqual(['secret-assignment']);
    }
  });

  it('a marker that stands for most of the value still is a placeholder', () => {
    for (const value of ['AIza...', 'xxxxxxxxxxxxxxxx', 'sk_live_xxxxxxxxxxxx', '<your-token>', '[YOUR-KEY]', '********', 'abcd...wxyz', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...']) {
      expect(isPlaceholder(value), value).toBe(true);
    }
  });

  it('human-style passwords that contain a word like change/sample/enter/todo/foo are NOT placeholders', () => {
    const values = ['Change2024!', 'Sample123', 'Winter2024here', 'Fake1234', 'Spring_2024_todo', 'Enter2024', 'Mock1234!', 'Banana_bar_9', 'Admin_foo_1'];
    for (const value of values) {
      expect(isPlaceholder(value), value).toBe(false);
      expect(flagged(value), value).toEqual(['secret-assignment']);
      const url = `DATABASE_URL=${dbScheme}://admin:${value}@db.internal.corp/db\n`;
      expect(scanText('.env', url).map((f) => f.rule), value).toEqual(['url-password']);
    }
  });

  it('real placeholders built from those words still pass', () => {
    for (const value of ['your_password', 'change-me', 'change_me_please', 'replace-with-your-key', 'enter_your_password', 'paste-token-here', 'fake_token_for_local_dev_1', 'foo_bar', 'new_password', 'todo']) {
      expect(isPlaceholder(value), value).toBe(true);
    }
  });
});

describe('sample values are scoped to the file that shows them', () => {
  const sample = ['secure', 'Password', '123'].join('');
  const dbScheme = ['postgres', 'ql'].join('');

  it('is ignored in docs/API.md (exact match only)', () => {
    expect(scanText('docs/API.md', `{"password": "${sample}"}\n`)).toEqual([]);
    expect(scanText('docs/API.md', `{"password": "${sample}4"}\n`).map((f) => f.rule)).toEqual(['secret-assignment']);
  });

  it('is NOT ignored anywhere else', () => {
    const name = ['DB_', 'PASSWORD'].join('');
    expect(scanText('app/.env.production', `${name}=${sample}\n`).map((f) => f.rule)).toEqual(['secret-assignment']);
    expect(scanText('.env', `${['JWT_', 'SECRET'].join('')}=${sample}\n`).map((f) => f.rule)).toEqual(['secret-assignment']);
    expect(scanText('.env', `DATABASE_URL=${dbScheme}://owner:${sample}@db.internal:5432/app\n`).map((f) => f.rule)).toEqual(['url-password']);
    const mongo = `const uri = "${['mongodb'].join('')}://app:${sample}@cluster0.internal/app";\n`;
    expect(scanText('app.js', mongo).map((f) => f.rule)).toEqual(['url-password']);
  });
});

describe('quoted values with whitespace', () => {
  const name = ['JWT_', 'SECRET'].join('');
  const value = randomString(16, 71);
  const rules = (file, text) => scanText(file, text).map((f) => f.rule);

  it('flags a quoted passphrase that contains spaces (double, single and backtick quotes)', () => {
    for (const q of ['"', "'", '`']) {
      expect(rules('app/.env.x', `${name}=${q}random long password ${value}!${q}\n`), q).toEqual(['secret-assignment']);
    }
    expect(rules('deploy.yaml', `${name}: "random long password ${value}!"\n`)).toEqual(['secret-assignment']);
  });

  it('trims whitespace inside the quotes before judging the value', () => {
    expect(rules('app/.env.x', `${name}="   ${value}   "\n`)).toEqual(['secret-assignment']);
    expect(rules('app/.env.x', `${name}="    "\n`)).toEqual([]);
  });

  it('still flags a quoted value without spaces', () => {
    expect(rules('app/.env.x', `${name}="${value}"\n`)).toEqual(['secret-assignment']);
  });

  it('an UNQUOTED value with spaces runs to the end of the line in dotenv, YAML and ini, but not in shell scripts', () => {
    expect(rules('app/.env.x', `${name}=random long password ${value}\n`)).toEqual(['secret-assignment']);
    expect(rules('c.yml', `${name.toLowerCase()}: random long password ${value}\n`)).toEqual(['secret-assignment']);
    expect(rules('c.ini', `${name.toLowerCase()} = random long password ${value}\n`)).toEqual(['secret-assignment']);
    // In a shell script the words after the first are a command, not part of the value.
    expect(rules('run.sh', `${name}=random long password ${value}\n`)).toEqual([]);
  });

  it('quoted placeholders with spaces still pass', () => {
    expect(rules('app/.env.x', `${name}="your secret goes here"\n`)).toEqual([]);
    expect(rules('app/.env.x', `${name}="change me to something long"\n`)).toEqual([]);
  });
});

describe('shell parameter expansions in config files', () => {
  const name = ['JWT_', 'SECRET'].join('');
  const weak = ['APP_', 'TOKEN'].join('');
  const value = randomString(16, 72);
  const rules = (file, text) => scanText(file, text).map((f) => f.rule);
  const ops = [':-', '-', ':=', '=', ':+', '+'];

  it('flags a literal default or alternate operand for every operator', () => {
    for (const op of ops) {
      expect(rules('docker.env', `${name}=\${${name}${op}${value}}\n`), op).toEqual(['secret-assignment']);
      expect(rules('docker-compose.yml', `      - ${name}=\${${name}${op}${value}}\n`), `compose ${op}`).toEqual(['secret-assignment']);
    }
    expect(rules('docker.env', `${name}="\${${name}:-${value}}"\n`)).toEqual(['secret-assignment']);
    expect(rules('docker.env', `${weak}=\${${weak}:-${value}}\n`)).toEqual(['secret-assignment']);
  });

  it('flags a literal hidden inside a nested expansion', () => {
    expect(rules('docker.env', `${name}=\${OUTER:-\${${name}:-${value}}}\n`)).toEqual(['secret-assignment']);
    expect(rules('docker.env', `${name}=\${OUTER:-\${INNER}}\n`)).toEqual([]);
  });

  it('does not flag pure substitutions or placeholder/variable operands', () => {
    for (const text of [
      `\${${name}}`,
      `$${name}`,
      `\${${name}:?set ${name} in the environment}`,
      `\${${name}:-}`,
      `\${${name}:-changeme}`,
      `\${${name}:-your_secret_here}`,
      `\${${name}:-\${OTHER_SECRET}}`,
      `\${${name}:-$OTHER_SECRET}`,
      `\${${name}:-\${A:-\${B}}}`,
    ]) {
      expect(rules('docker.env', `${name}=${text}\n`), text).toEqual([]);
    }
  });

  it('checks the operand of an unbalanced expansion and stays fast on hostile nesting', SLOW, () => {
    expect(rules('docker.env', `${name}=\${${name}:-${value}\n`)).toEqual(['secret-assignment']);
    expect(rules('docker.env', `${name}=\${${name}:-\${OTHER}\n`)).toEqual([]);
    const hostile = `${name}=${'${A:-'.repeat(20000)}\n`;
    const started = Date.now();
    scanText('docker.env', hostile);
    expect(Date.now() - started).toBeLessThan(HOSTILE_LIMIT_MS);
  });

  it('is limited to config files: a JS template literal is still not a secret', () => {
    expect(rules('app.js', `const ${name} = \`\${${name}:-${value}}\`;\n`)).toEqual([]);
  });
});

describe('review round 3: expansions, phrases, continuations and escapes', () => {
  const name = ['JWT_', 'SECRET'].join('');
  const lower = name.toLowerCase();
  const token = randomString(16, 91);
  const phrase = ['correct', 'horse', 'battery', 'staple'].join(' ');
  const rules = (file, text) => scanText(file, text).map((f) => f.rule);
  const HIT = ['secret-assignment'];

  it('a passphrase with spaces behind a :- default is a finding, quoted or bare', () => {
    expect(rules('a.sh', `${name}="\${A:-${phrase}}"\n`)).toEqual(HIT);
    expect(rules('a.env', `${name}=\${A:-${phrase}}\n`)).toEqual(HIT);
    expect(rules('a.env', `${name}=\${A:-"${phrase}"}\n`)).toEqual(HIT);
    expect(rules('a.env', `${name}="${phrase}"\n`)).toEqual(HIT);
  });

  it('a literal glued to an expansion is a finding, a file path built from one is not', () => {
    expect(rules('a.env', `${name}=\${A}${token}\n`)).toEqual(HIT);
    expect(rules('a.env', `${name}=${token}\${SUFFIX}\n`)).toEqual(HIT);
    expect(rules('a.env', `${name}=\${A}${token}\${B}\n`)).toEqual(HIT);
    expect(rules('a.env', `${name}=/run/secrets/\${NAME}\n`)).toEqual([]);
    expect(rules('a.env', `${name}=\${A} # note about it\n`)).toEqual([]);
  });

  it('fails closed past the nesting cap and for an unterminated expansion', () => {
    for (const depth of [9, 10, 20]) {
      const nested = Array.from({ length: depth }, (_, i) => `\${V${i}:-`).join('') + token + '}'.repeat(depth);
      expect(rules('a.env', `${name}=${nested}\n`), `depth ${depth}`).toEqual(HIT);
    }
    expect(rules('a.env', `${name}=\${A:-${token}\n`)).toEqual(HIT);
  });

  it('message-catalog sentences under secret-like keys are not findings', () => {
    for (const [file, text] of [
      ['en.json', '{"token": "Invalid or expired token"}'],
      ['en.json', '{"apiKey": "API key is missing"}'],
      ['en.json', '{"password": "Please choose a password"}'],
      ['en.json', '{"secret": "Secret is invalid"}'],
      ['en.json', '{"password": "Password must be at least 8 characters"}'],
      ['en.yml', 'password: "Passwords do not match"'],
      ['en.yml', 'password: Password is required'],
      ['messages.yml', 'password: "Password is required"'],
    ]) {
      expect(rules(file, `${text}\n`), text).toEqual([]);
    }
    // A random-looking word inside a phrase still counts.
    expect(rules('en.json', `{"password": "the code is ${token}"}\n`)).toEqual(HIT);
  });

  it('unquoted passphrases in YAML and ini, and YAML block scalars, are findings', () => {
    expect(rules('c.yml', `${lower}: ${phrase}\n`)).toEqual(HIT);
    expect(rules('c.ini', `${lower} = ${phrase}\n`)).toEqual(HIT);
    expect(rules('c.yml', `${lower}: ${phrase} # not a comment part\n`)).toEqual(HIT);
    for (const indicator of ['|', '>', '|-', '>-']) {
      expect(rules('c.yml', `${lower}: ${indicator}\n  ${token}${token}\nother: 1\n`), indicator).toEqual(HIT);
    }
    expect(rules('messages.yml', `${lower}: |\n  Passwords do not match\nother: 1\n`)).toEqual([]);
    expect(rules('c.yml', `${lower}: |\nother: ${token}${token}\n`)).toEqual([]);
    expect(rules('c.yml', `${lower}: !vault |\n`)).toEqual([]);
  });

  it('an escaped quote near the start of a quoted value does not hide the rest', () => {
    for (const text of [`{"${lower}": "a\\"${token}${token}"}`, `${lower} = 'a\\'${token}${token}'`]) {
      expect(rules('c.json', `${text}\n`), text).toEqual(HIT);
    }
  });

  it('Makefile ?= and +=, and Dockerfile ENV/ARG with a space, are recognised', () => {
    expect(rules('Makefile', `${name} ?= ${token}\n`)).toEqual(HIT);
    expect(rules('Makefile', `${name} += ${token}\n`)).toEqual(HIT);
    expect(rules('Dockerfile', `ENV ${name} ${token}\n`)).toEqual(HIT);
    expect(rules('Dockerfile', `ARG ${name} ${token}\n`)).toEqual(HIT);
    expect(rules('Dockerfile', `ENV ${name} \${X:-${token}}\n`)).toEqual(HIT);
    expect(rules('Dockerfile', `ENV ${name} changeme\n`)).toEqual([]);
    expect(rules('Dockerfile', `ENV ${name} \${${name}}\n`)).toEqual([]);
    expect(rules('app.js', `ENV ${name} ${token}\n`)).toEqual([]);
  });
});

describe('documentation sample is compared as the whole value', () => {
  const sample = ['secure', 'Password', '123'].join('');
  const real = randomString(16, 73);
  const rules = (file, text) => scanText(file, text).map((f) => f.rule);

  it('the exact sample passes in docs/API.md in every quoting style', () => {
    expect(rules('docs/API.md', `  "password": "${sample}"\n`)).toEqual([]);
    expect(rules('docs/API.md', `-d '{"username":"fisherman_joe","password":"${sample}"}'\n`)).toEqual([]);
    expect(rules('docs/API.md', `PASSWORD=${sample}\n`)).toEqual([]);
    expect(rules('docs/API.md', `password: '${sample}'\n`)).toEqual([]);
  });

  it('the sample glued to other text is still a finding', () => {
    for (const text of [
      `PASSWORD=${sample}!${real}`,
      `PASSWORD=prefix-${sample}-suffix`,
      `PASSWORD=${real}=${sample}`,
      `PASSWORD=${real}:${sample}`,
      `"password": "prefix ${sample}"`,
      `"password": "${sample} ${real}"`,
      `PASSWORD=${sample}${real}`,
    ]) {
      expect(rules('docs/API.md', `${text}\n`), text).toEqual(['secret-assignment']);
    }
  });

  it('the exact sample is not exempt in any other file', () => {
    expect(rules('docs/OTHER.md', `PASSWORD=${sample}\n`)).toEqual(['secret-assignment']);
    expect(rules('app/docs/API.md', `PASSWORD=${sample}\n`)).toEqual(['secret-assignment']);
  });
});

describe('review round 5: URL password expansions and quoted property names', () => {
  const value = randomString(20, 501);
  const name = secretName('JWT_', 'SECRET');
  const scheme = ['post', 'gresql'].join('');
  const urlLine = (password, file = '.env.prod') => scanText(file, `DATABASE_URL=${scheme}://user:${password}@prod.internal/db\n`).map((f) => f.rule);
  const ref = (n) => `$` + `{${n}}`;
  const withDefault = (n, literal) => `$` + `{${n}:-${literal}}`;

  it('flags a literal default inside an expansion in a URL password', () => {
    expect(urlLine(withDefault('DB_PASSWORD', value))).toEqual(['url-password']);
    expect(urlLine(`$` + `{DB_PASSWORD-${value}}`)).toEqual(['url-password']);
    expect(urlLine(`$` + `{DB_PASSWORD:=${value}}`)).toEqual(['url-password']);
    expect(urlLine(`$` + `{DB_PASSWORD:+${value}}`)).toEqual(['url-password']);
  });

  it('flags a literal nested in an expansion, and literal text next to a reference', () => {
    expect(urlLine(`$` + `{OUTER:-` + withDefault('INNER', value) + `}`)).toEqual(['url-password']);
    expect(urlLine(`${ref('DB_PASSWORD')}${value}`)).toEqual(['url-password']);
    expect(urlLine(`${value}${ref('DB_PASSWORD')}`)).toEqual(['url-password']);
  });

  it('flags a literal default in a curl -u password too', () => {
    const line = `curl -u admin:${withDefault('API_PW', value)} https://api.internal/x\n`;
    expect(scanText('deploy.sh', line).map((f) => f.rule)).toEqual(['url-password']);
    expect(scanText('deploy.sh', `curl -u admin:${ref('API_PW')} https://api.internal/x\n`)).toEqual([]);
  });

  it('negative controls: a pure reference, or a placeholder default, still passes', () => {
    expect(urlLine(ref('DB_PASSWORD'))).toEqual([]);
    expect(urlLine('$DB_PASSWORD')).toEqual([]);
    expect(urlLine(`$` + `{DB_PASSWORD:?set it}`)).toEqual([]);
    expect(urlLine(withDefault('DB_PASSWORD', 'changeme'))).toEqual([]);
    expect(urlLine(withDefault('DB_PASSWORD', ref('OTHER')))).toEqual([]);
    expect(urlLine(`${ref('A')}:${ref('B')}`.replace(':', ''))).toEqual([]);
  });

  it('does not let a long user name or password stop the URL match', () => {
    const longUser = randomString(200, 502, LOWER);
    const longPassword = randomString(900, 503);
    expect(scanText('.env.prod', `U=${scheme}://${longUser}:${value}@prod.internal/db\n`).map((f) => f.rule)).toEqual(['url-password']);
    expect(scanText('.env.prod', `U=${scheme}://user:${longPassword}@prod.internal/db\n`).map((f) => f.rule)).toEqual(['url-password']);
    expect(scanText('.env.prod', `U=${scheme}://user:${'x'.repeat(900)}@prod.internal/db\n`)).toEqual([]);
  });

  it('flags a secret-like name assigned through a quoted property', () => {
    const q = { single: "'", double: '"', backtick: '`' };
    for (const [label, quote] of Object.entries(q)) {
      const bracket = `config[${quote}${name}${quote}] = ${quote}${value}${quote};\n`;
      expect(scanText('config.js', bracket).map((f) => f.rule), label).toEqual(['secret-assignment']);
    }
    for (const text of [
      `obj?.['${name}'] = '${value}';\n`,
      `a.b['c']['${name}'] = '${value}';\n`,
      `a['b'].c["${name}"] = "${value}";\n`,
      `config[ '${name}' ] = '${value}';\n`,
      `module.exports['${name}'] = '${value}'\n`,
      `const o = { ['${name}']: '${value}' };\n`,
      `settings["${name}"] := "${value}"\n`,
    ]) {
      expect(scanText('config.ts', text).map((f) => f.rule), text.replace(value, 'V')).toEqual(['secret-assignment']);
    }
  });

  it('applies the same value rules to bracket notation', () => {
    expect(scanText('config.js', `config['${name}'] = 'your_secret_here';\n`)).toEqual([]);
    expect(scanText('config.js', `config['${name}'] = process.env.${name};\n`)).toEqual([]);
    expect(scanText('config.js', `config['${name}'] = getSecret();\n`)).toEqual([]);
    expect(scanText('config.js', `config['title'] = '${value}';\n`)).toEqual([]);
    expect(scanText('config.js', `x = ['${name}', '${value}'];\n`)).toEqual([]);
  });

  it('still sees a secret name and a fallback literal longer than the old length caps', () => {
    const longName = `${'A_'.repeat(60)}${name}`;
    expect(scanText('.env', `${longName}=${value}\n`).map((f) => f.rule)).toEqual(['secret-assignment']);
    const longFallback = randomString(700, 504);
    expect(scanText('app.js', `const s = process.env.${name} || '${longFallback}';\n`).map((f) => f.rule)).toEqual(['hardcoded-secret-fallback']);
  });
});

describe('review round 6: a rejected assignment must not hide the one after it', () => {
  const value = randomString(22, 601);
  const name = secretName('JWT_', 'SECRET');
  const rules = (file, text) => scanText(file, text).map((f) => f.rule);
  const shapes = {
    'py dict after a non-secret bracket assignment': ['s.py', `settings["auth"] = {"${name}": "${value}"}\n`],
    'py dict() after a bracket assignment': ['s.py', `CONFIG["auth"] = dict(${name}="${value}")\n`],
    'py single quotes, no spaces': ['s.py', `cfg['auth']={'${name}':'${value}'}\n`],
    'js object with an unquoted key': ['s.js', `cfg['auth'] = {${name}: '${value}'};\n`],
    'minified JSON': ['c.json', `{"port":3000,"${name}":"${value}"}\n`],
    'nested minified JSON': ['c.json', `{"a":{"${name}":"${value}"}}\n`],
    'one-line JSON env block': ['c.json', `{"env":{"${name}":"${value}"}}\n`],
    'statement after a statement': ['a.js', `x=1;${name}='${value}';\n`],
    'object literal without spaces': ['a.js', `c = {'${name}': '${value}'};\n`],
    'module.exports object': ['a.js', `module.exports={${name}:'${value}'};\n`],
    'call arguments': ['a.js', `f(x=1,${name}='${value}');\n`],
    'bracket then bracket': ['a.js', `env['PORT']=3;env['${name}']='${value}';\n`],
    'chained bracket assignment': ['a.js', `cfg['x']=cfg['${name}']='${value}';\n`],
    'YAML flow mapping': ['a.yml', `env: {PORT: 3, ${name}: ${value}}\n`],
    'inside a quoted value of a non-secret key': ['a.yml', `run: "${name}=${value} node app.js"\n`],
  };

  it.each(Object.entries(shapes))('flags a secret in: %s', (_label, [file, text]) => {
    expect(rules(file, text)).toContain('secret-assignment');
  });

  it.each(Object.entries(shapes))('a placeholder value passes in: %s', (_label, [file, text]) => {
    expect(rules(file, text.replace(value, 'your_secret_here'))).toEqual([]);
  });

  it('does not treat an expansion default or a URL user as a second assignment', () => {
    const ref = `$` + `{OTHER_SECRET}`;
    expect(rules('docker.env', `${name}=$` + `{${name}:-${ref}}\n`)).toEqual([]);
    expect(rules('a.env', `DATABASE_URL=${['post', 'gresql'].join('')}://password:${value}@prod.internal/db\n`)).toEqual(['url-password']);
  });
});

describe('isPlaceholder', () => {
  it.each([
    '',
    '   ',
    'password',
    'PASSWORD',
    'secret_key',
    'your_api_key',
    'change-me',
    'changeme',
    'example',
    'xxxx',
    'REDACTED',
    '<secret>',
    '[YOUR-PASSWORD]',
    '${TOKEN}',
    '$TOKEN',
    '%TOKEN%',
    '{{ token }}',
    '...',
    'process.env.TOKEN',
    'import.meta.env.VITE_TOKEN',
    '--',
    'AKIAIOSFODNN7EXAMPLE',
  ])('treats %j as a placeholder', (value) => {
    expect(isPlaceholder(value)).toBe(true);
  });

  it('does not treat random-looking values as placeholders', () => {
    expect(isPlaceholder(randomString(32, 51))).toBe(false);
    expect(isPlaceholder(randomString(20, 52, UPPER_ALNUM))).toBe(false);
  });

  it('never swallows a random value, whatever it contains (4000 samples per alphabet)', SLOW, () => {
    for (const alphabet of [ALNUM, PASSWORD_MANAGER, BASE64, HEX, LOWER_ALNUM]) {
      let swallowed = 0;
      for (let i = 0; i < 4000; i += 1) {
        const value = randomString(16 + (i % 17), 5000 + i * 13, alphabet);
        // The little generator sometimes degenerates into runs of one character; that is not a random secret.
        if (new Set(value).size < 8) continue;
        if (isPlaceholder(value)) swallowed += 1;
      }
      expect(swallowed).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------

describe('url-password hosts', () => {
  const pw = randomString(20, 70);
  const dbScheme = ['postgres', 'ql'].join('');
  const rules = (host) => scanText('.env', `DATABASE_URL=${dbScheme}://admin:${pw}@${host}/db\n`).map((f) => f.rule);

  it.each(['db.example.com', 'example.org', 'a.b.example.net', 'svc.example', 'x.test', 'y.invalid', 'localhost:5432', '127.0.0.1'])(
    'lets reserved documentation and loopback host %s pass',
    (host) => {
      expect(rules(host)).toEqual([]);
    },
  );

  it.each([
    'example-prod-db.c1abc.us-east-1.rds.amazonaws.com',
    'ep-example-app-123456.us-east-2.aws.neon.tech',
    'prod.example-corp.io',
    'example.internal',
    'my.example.co',
    'db.internal.corp',
  ])('does NOT let host %s hide a password', (host) => {
    expect(rules(host)).toEqual(['url-password']);
  });

  it('flags a real-looking password for every user name (the user side is not a placeholder test)', () => {
    for (const user of ['user', 'username', 'example', 'password', 'root', 'postgres', 'admin', 'your_user', '']) {
      const text = `DATABASE_URL=${dbScheme}://${user}:${pw}@db.internal.corp/db\n`;
      expect(scanText('.env', text).map((f) => f.rule), user).toEqual(['url-password']);
    }
  });
});

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

describe('redaction', () => {
  it('findings carry only path, line and rule', () => {
    for (const c of SECRET_CASES) {
      for (const finding of scanText(c.path, c.text)) {
        expect(Object.keys(finding).sort(), c.name).toEqual(['line', 'path', 'rule']);
      }
    }
  });

  it('the report never contains the matched text, whole or in part', () => {
    for (const c of SECRET_CASES) {
      const report = formatReport(scanText(c.path, c.text));
      expect(report, c.name).toContain(`${c.path}:`);
      expect(report, c.name).toContain(c.rule);
      expect(report, c.name).not.toContain(c.secret);
      for (const piece of windows(c.secret)) expect(report, c.name).not.toContain(piece);
    }
  });

  it('a report over all cases together leaks nothing', () => {
    const all = SECRET_CASES.flatMap((c) => scanText(c.path, c.text));
    const report = formatReport(all);
    for (const c of SECRET_CASES) {
      for (const piece of windows(c.secret)) expect(report).not.toContain(piece);
    }
  });

  it('strips control characters from printed paths', () => {
    const report = formatReport([{ path: 'a\nb\u001b[31m', line: 1, rule: 'jwt-token' }]);
    expect(report.includes(String.fromCharCode(27))).toBe(false);
    expect(report.split('\n').some((l) => l.startsWith('b'))).toBe(false);
  });

  it('the history report holds only commit, path, rule and counts', () => {
    const report = formatHistoryReport([{ commit: 'a'.repeat(40), path: '.env', rule: 'jwt-token', count: 2 }], {
      commits: 5,
      shallow: true,
      oversize: 1,
    });
    expect(report).toContain('aaaaaaa  .env  jwt-token  x2');
    expect(report).toContain('shallow clone');
    expect(report).toContain('1 file version NOT scanned');
  });

  it('the oversize report names paths only', () => {
    expect(formatOversizeReport(['data/big.json'])).toContain('data/big.json');
  });
});

// ---------------------------------------------------------------------------
// Scan time stays linear on hostile input
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Review round 7 (finding 1): a sentence is not the same as "contains one common word"
//
// Class: quoted (or rest-of-line) values with spaces under a strong secret name. Sentence-likeness is judged on the
// whole text: plain words only, mostly sentence vocabulary, written like a sentence. Both sides are listed on purpose.
// ---------------------------------------------------------------------------

describe('review round 7 (1): passphrase versus UI sentence', () => {
  const name = ['JWT_', 'SECRET'].join('');
  const rules = (file, text) => scanText(file, text).map((f) => f.rule);
  const digits = randomString(3, 201, DIGITS);

  // Passphrases that contain ordinary words (several of them prose words) and must be reported.
  const PASSPHRASES = [
    'correct horse battery and staple', // one function word ("and")
    `random long password ${digits}!`, // "long" is a prose word; the digit-symbol piece is credential-shaped
    'this is my super secret passphrase', // three prose words of six, written in lower case
    'Correct Horse Battery Staple', // Title Case diceware
    'correct horse battery staple.', // closing punctuation does not make it a sentence
    'the quick brown fox jumps over the lazy dog', // 3 of 9 words, lower case
    `Tr0ub4dor and Horse Battery ${digits}`, // letters mixed with digits
    `hunter${digits} is the password`, // "hunter123": mixed piece
    `my dog is named Rover ${digits}`, // two prose words of five
    'purple monkey dishwasher and the tortoise', // 2 of 5
    'Open sesame, said the ancient door',
    `winter-${digits} is coming to the north`, // "winter-123" is not a word-number compound
    'Password1! and more', // symbol-mixed piece
    'blue::green::red the sky', // symbol runs between words
  ];

  it.each(PASSPHRASES)('reports the quoted passphrase %j in env, YAML, JSON and ini files', (phrase) => {
    expect(rules('app/.env.x', `${name}="${phrase}"\n`)).toEqual(['secret-assignment']);
    expect(rules('app/.env.x', `${name}='${phrase}'\n`)).toEqual(['secret-assignment']);
    expect(rules('c.yaml', `${name.toLowerCase()}: "${phrase}"\n`)).toEqual(['secret-assignment']);
    expect(rules('c.json', `{"${name}": "${phrase}"}\n`)).toEqual(['secret-assignment']);
    expect(rules('c.ini', `${name.toLowerCase()} = "${phrase}"\n`)).toEqual(['secret-assignment']);
  });

  it('reports an unquoted passphrase (the rest of a YAML/ini/dotenv line) the same way', () => {
    expect(rules('c.yaml', `${name.toLowerCase()}: correct horse battery and staple\n`)).toEqual(['secret-assignment']);
    expect(rules('app/.env.x', `${name}=correct horse battery and staple\n`)).toEqual(['secret-assignment']);
  });

  // Real UI, validation and error text that message catalogs keep under secret-looking keys.
  const SENTENCES = [
    'Your session token has expired, please sign in again.',
    'Invalid or expired token',
    'Passwords do not match',
    'Password must be at least 8 characters',
    'Forgot password?',
    'Enter your password',
    'Please enter a valid token',
    'Reset your password',
    'Unable to reach the server, try again later',
    'The token %s has expired',
    'Token {name} is invalid',
    'Enter the 6-digit code we sent to your email',
    'The :attribute must be at least 8 characters.',
    'Your password has been changed successfully.',
    'This link is no longer valid. Request a new one.',
    'password too short',
    'passwords do not match',
    'La sesión ha caducado, inicia sesión de nuevo', // another language, with non-ASCII letters
  ];

  it.each(SENTENCES)('does not report the UI sentence %j', (sentence) => {
    for (const key of ['resetToken', 'password', 'invalid_token']) {
      expect(rules('locales/en.json', `{"${key}": "${sentence}"}\n`), key).toEqual([]);
      expect(rules('messages.yml', `${key}: "${sentence}"\n`), key).toEqual([]);
      expect(rules('messages.properties', `${key}=${sentence}\n`), key).toEqual([]);
    }
  });

  it('a random-looking word still makes a sentence-shaped value a finding', () => {
    expect(rules('app/.env.x', `${name}="The token is ${randomString(20, 202)} today."\n`)).toEqual(['secret-assignment']);
  });

  it('a passphrase made only of function words is a finding outside a message catalog, whatever it looks like', () => {
    for (const phrase of ['to be or not to be', 'It is what it is.', 'This is the way.', 'My voice is my password.', 'May the force be with you.']) {
      expect(rules('app/.env.x', `${name}="${phrase}"\n`), phrase).toEqual(['secret-assignment']);
    }
  });

  it('the same sentences are prose inside a message catalog (locales, i18n, messages, en.json)', () => {
    for (const file of ['locales/en.json', 'src/i18n/app.json', 'messages.properties', 'en.yml']) {
      expect(rules(file, file.endsWith('.json') ? `{"${name}": "It is what it is."}\n` : `${name.toLowerCase()}: "It is what it is."\n`), file).toEqual([]);
    }
  });

  it('documents the tradeoff: an ASCII sentence in another language is reported (use a placeholder or the allow marker)', () => {
    expect(rules('locales/es.json', `{"resetToken": "El token ha caducado"}\n`)).toEqual(['secret-assignment']);
    expect(rules('locales/es.json', `{"resetToken": "El token ha caducado" }  // ${ALLOW_MARKER}\n`)).toEqual([]);
  });

  it('weak names are unaffected: a spaced value there needs a random-looking word', () => {
    expect(rules('app/.env.x', `TOKEN_HINT="correct horse battery and staple"\n`)).toEqual([]);
    expect(rules('app/.env.x', `TOKEN_HINT="hint ${randomString(20, 203)}"\n`)).toEqual(['secret-assignment']);
  });
});

// ---------------------------------------------------------------------------
// Review round 7 (finding 2): native credential-file formats
//
// Class: files whose syntax is not NAME=value. Siblings enumerated: .netrc/_netrc (one line, multi-line, default,
// account, quoted, CRLF), .pgpass (wildcards, escaped colons), .git-credentials (password, token as user, doc host),
// .npmrc/.yarnrc (=, scoped //registry/:key, _auth, _password, yarn "key" "value", yarnrc.yml npmAuth*),
// .pypirc, .aws/credentials, docker config.json/.dockercfg/.dockerconfigjson, kubeconfig, .htpasswd/.htdigest,
// .my.cnf, .s3cfg/.boto, Terraform (.terraformrc, tfrc.json, tfvars, tfstate), .curlrc, .wgetrc, .vault-token.
// ---------------------------------------------------------------------------

describe('review round 7 (2): credential-file formats', () => {
  const v = randomString(24, 211);
  const tiny = ['ab', 'c'].join(''); // too short for a credential file value
  const hex = randomString(40, 212, HEX);
  const rules = (file, text) => scanText(file, text).map((f) => f.rule);

  // [path, content, rule that must fire]
  const FINDINGS = [
    ['.netrc', `machine api.internal login app password ${v}\n`, 'credential-file'],
    ['home/_netrc', `machine api.internal\n  login app\n  password ${v}\n`, 'credential-file'],
    ['.netrc', `default login app password ${v}\r\n`, 'credential-file'],
    ['.netrc', `machine ftp.internal login app account ${v}\n`, 'credential-file'],
    ['.netrc', `machine api.internal login app password "${v} tail"\n`, 'credential-file'],
    ['.netrc', `machine a login u password ${tiny}\nmachine b login u password ${v}\n`, 'credential-file'],
    ['.pgpass', `db.internal:5432:prod:app:${v}\n`, 'credential-file'],
    ['.pgpass', `*:*:*:app:${v}\n`, 'credential-file'],
    ['.pgpass', `db.internal:5432:prod:app:a\\:b${v}\r\n`, 'credential-file'],
    ['pgpass.conf', `localhost:5432:*:postgres:${v}\n`, 'credential-file'],
    ['.git-credentials', `https://user:${v}@example.com\n`, 'credential-file'],
    ['.git-credentials', `https://${v}@github.com\n`, 'credential-file'],
    ['.git-credentials', `https://oauth2:${v}@gitlab.internal.org\n`, 'url-password'],
    ['.npmrc', `//registry.npmjs.org/:_authToken=${v}\n`, 'secret-assignment'],
    ['.npmrc', `_authToken=${v}\n`, 'secret-assignment'],
    ['.npmrc', `_auth=${v}\n`, 'secret-assignment'],
    ['.npmrc', `//npm.internal.org/:_password=${v}\n`, 'secret-assignment'],
    ['.npmrc', `//npm.internal.org/:_authToken=abcd12\n`, 'secret-assignment'], // short values count in credential files
    ['.yarnrc', `"//registry.npmjs.org/:_authToken" "${v}"\n`, 'credential-file'],
    ['.yarnrc.yml', `npmAuthToken: ${v}\n`, 'secret-assignment'],
    ['.yarnrc.yml', `npmAuthIdent: user:${v}\n`, 'secret-assignment'],
    ['.pypirc', `[pypi]\nusername = __token__\npassword = pypi-${v}\n`, 'secret-assignment'],
    ['.aws/credentials', `[default]\naws_secret_access_key = ${v}\n`, 'secret-assignment'],
    ['credentials', `[default]\naws_session_token = ${v}${v}\n`, 'secret-assignment'],
    ['.aws/config', `[profile x]\naws_secret_access_key = ${v}\n`, 'secret-assignment'],
    ['.docker/config.json', `{"auths":{"ghcr.io":{"auth":"${v}=="}}}\n`, 'secret-assignment'],
    ['.docker/config.json', `{"identitytoken":"${v}"}\n`, 'secret-assignment'],
    ['.docker/config.json', `{"auths":{"h":{"registrytoken":"${v}"}}}\n`, 'secret-assignment'],
    ['.dockercfg', `{"https://index.docker.io/v1/":{"auth":"${v}"}}\n`, 'secret-assignment'],
    ['manifests/pull-secret.yaml', `data:\n  .dockerconfigjson: ${v}${v}\n`, 'credential-file'],
    ['.kube/config', `users:\n- name: a\n  user:\n    token: ${v}\n`, 'secret-assignment'],
    ['kubeconfig', `users:\n- user:\n    password: ${v}\n`, 'secret-assignment'],
    ['ci/dev.kubeconfig', `users:\n- user:\n    client-key-data: ${v}${v}\n`, 'credential-file'],
    ['deploy/cluster.yaml', `users:\n- user:\n    client-key-data: ${v}${v}\n`, 'credential-file'],
    ['.htpasswd', `admin:$apr1$${randomString(8, 213)}$${randomString(22, 214)}\n`, 'credential-file'],
    ['.htpasswd', `admin:$2y$05$${randomString(53, 215)}\n`, 'credential-file'],
    ['.htpasswd', `admin:{SHA}${randomString(28, 216)}\n`, 'credential-file'],
    ['.htpasswd', `admin:${randomString(13, 217)}\r\n`, 'credential-file'],
    ['.htdigest', `admin:private area:${hex.slice(0, 32)}\n`, 'credential-file'],
    ['.my.cnf', `[client]\nuser=root\npassword=${v}\n`, 'secret-assignment'],
    ['.my.cnf', `[client]\npassword = "${v}"\n`, 'secret-assignment'],
    ['.my.cnf', `[client]\npassword=hunter22\n`, 'secret-assignment'],
    ['.mylogin.cnf', `[client]\npassword=${v}\n`, 'secret-assignment'],
    ['.s3cfg', `[default]\nsecret_key = ${v}\n`, 'secret-assignment'],
    ['.s3cfg', `[default]\naccess_token = ${v}\n`, 'secret-assignment'],
    ['.boto', `[Credentials]\ngs_secret_access_key = ${v}\n`, 'secret-assignment'],
    ['.terraformrc', `credentials "app.terraform.io" {\n  token = "${v}"\n}\n`, 'secret-assignment'],
    ['credentials.tfrc.json', `{"credentials":{"app.terraform.io":{"token":"${v}"}}}\n`, 'secret-assignment'],
    ['prod.tfvars', `db_password = "${v}"\n`, 'secret-assignment'],
    ['terraform.tfstate', `{"attributes":{"password":"${v}"}}\n`, 'secret-assignment'],
    ['.curlrc', `user = "name:${v}"\n`, 'credential-file'],
    ['.curlrc', ['--user', ' ', 'name:', v, '\n'].join(''), 'credential-file'],
    ['.wgetrc', `password = ${v}\n`, 'secret-assignment'],
    ['.vault-token', `hvs.${v}\n`, 'credential-file'],
  ];

  it.each(FINDINGS)('reports %s: %j', (file, text, rule) => {
    expect(rules(file, text)).toContain(rule);
    for (const finding of scanText(file, text)) expect(Object.keys(finding).sort()).toEqual(['line', 'path', 'rule']);
  });

  // Placeholders, references and non-secret content in the same formats must stay quiet.
  const CLEAN = [
    ['.netrc', 'machine api.internal login app password <password>\n'],
    ['.netrc', 'machine api.internal login app password ${NETRC_PASSWORD}\n'],
    ['.netrc', `# password ${v}\nmachine api.internal login app\n`],
    ['.netrc', 'machine api.internal login app\n'],
    ['.pgpass', 'hostname:port:database:username:password\n'],
    ['.pgpass', `# db.internal:5432:prod:app:${v}\n`],
    ['.pgpass', 'db.internal:5432:prod:app:your_password_here\n'],
    ['.git-credentials', 'https://user:password@github.com\n'],
    ['.git-credentials', 'https://<token>@github.com\n'],
    ['.git-credentials', 'https://${GITHUB_TOKEN}@github.com\n'],
    ['.npmrc', '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n'],
    ['.npmrc', 'registry=https://registry.npmjs.org/\nalways-auth=true\nsave-exact=true\n'],
    ['.npmrc', '_auth=<base64 user:password>\n'],
    ['.yarnrc', '"//registry.npmjs.org/:_authToken" "${NPM_TOKEN}"\n'],
    ['.yarnrc.yml', 'npmAuthToken: ${NPM_TOKEN}\nnpmRegistryServer: "https://registry.npmjs.org"\n'],
    ['.pypirc', '[pypi]\nusername = __token__\npassword = <pypi token>\n'],
    ['.pypirc', '[pypi]\nusername = __token__\npassword = ${PYPI_TOKEN}\n'],
    ['.aws/credentials', '[default]\naws_secret_access_key = YOUR_SECRET_ACCESS_KEY\naws_access_key_id = AKIAIOSFODNN7EXAMPLE\n'],
    ['.aws/credentials', '[default]\nregion = us-east-1\noutput = json\n'],
    ['.docker/config.json', '{"auths":{"ghcr.io":{"auth":""}},"credsStore":"desktop"}\n'],
    ['manifests/pull-secret.yaml', 'data:\n  .dockerconfigjson: <base64 of config.json>\n'],
    ['kubeconfig', 'users:\n- user:\n    client-certificate-data: LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCg==\n    exec:\n      command: aws\n'],
    ['kubeconfig', `clusters:\n- cluster:\n    certificate-authority-data: ${v}${v}\n`],
    ['.htpasswd', '# users\nuser:password\n'],
    ['.htpasswd', ''],
    ['.my.cnf', '[client]\nuser=root\nhost=127.0.0.1\n'],
    ['.my.cnf', '[client]\npassword=${MYSQL_PWD}\n'],
    ['.s3cfg', '[default]\nsecret_key = <your secret key>\nhost_base = s3.amazonaws.com\n'],
    ['prod.tfvars', 'db_password = var.db_password\n'],
    ['.terraformrc', 'plugin_cache_dir = "$HOME/.terraform.d/plugin-cache"\n'],
    ['.curlrc', 'silent\nuser = "name:${CURL_PASSWORD}"\n'],
    ['.vault-token', '\n'],
    ['.vault-token', '# token\n'],
  ];

  it.each(CLEAN)('does not report %s: %j', (file, text) => {
    expect(rules(file, text)).toEqual([]);
  });

  it('ordinary code that merely mentions a netrc line is judged by content only (a five-field string in a source file is not a .pgpass line)', () => {
    expect(rules('src/netrc-helper.js', `const line = "db.internal:5432:prod:app:${v}";\n`)).toEqual([]);
  });

  it('classifies credential files by name and directory, and scans them as config files', () => {
    const cases = {
      '.netrc': 'netrc', '_netrc': 'netrc', 'a/b/.pgpass': 'pgpass', '.git-credentials': 'gitcred', '.npmrc': 'npmrc',
      '.yarnrc.yml': 'npmrc', '.pypirc': 'pypirc', '.aws/credentials': 'awscreds', 'x/.aws/config': 'awscreds',
      '.docker/config.json': 'docker', '.dockercfg': 'docker', '.kube/config': 'kube', 'a.kubeconfig': 'kube',
      '.htpasswd': 'htpasswd', '.htdigest': 'htpasswd', '.my.cnf': 'mycnf', '.s3cfg': 's3cfg', '.boto': 's3cfg',
      '.terraformrc': 'terraformrc', 'terraform.tfstate': 'terraformrc', '.curlrc': 'curlrc', '.wgetrc': 'wgetrc',
      '.vault-token': 'vault',
    };
    for (const [file, tag] of Object.entries(cases)) {
      expect([...credentialFormats(file)], file).toContain(tag);
      expect(fileMode(file), file).toBe('config');
    }
    expect(credentialFormats('src/index.js').size).toBe(0);
    expect(credentialFormats('docs/config.json').size).toBe(0);
  });

  it('a credential in a strict format is reported on the line that holds it, with nothing but path/line/rule', () => {
    const findings = scanText('.npmrc', `registry=https://r.internal.org/\n//r.internal.org/:_authToken=${v}\n`);
    expect(findings).toEqual([{ path: '.npmrc', line: 2, rule: 'secret-assignment' }]);
    const report = formatReport(findings);
    for (const piece of windows(v)) expect(report).not.toContain(piece);
  });
});

// ---------------------------------------------------------------------------
// Review round 7 (finding 3): URLs that are bearer credentials
//
// Class: a URL VALUE under a strong secret name, in env, YAML, JSON and Markdown. Siblings: signed-URL query
// parameters (sig, signature, X-Amz-Signature, token, access_token, key, secret, password, auth), a random query value
// under any name, a random path segment, a webhook path token, a token used as the URL user name, a fragment token,
// a percent-encoded value, a JSON-escaped URL; and the webhook shapes themselves (Slack, Discord, Teams, Power
// Automate, Zapier, IFTTT, Telegram) in any file.
// ---------------------------------------------------------------------------

describe('review round 7 (3): URL-valued secrets and webhook URLs', () => {
  const v = randomString(24, 221);
  const hex = randomString(64, 222, HEX);
  const N = (...parts) => parts.join('');
  const rules = (file, text) => scanText(file, text).map((f) => f.rule);

  const URL_FINDINGS = [
    [`API_TOKEN=https://download.internal/file?sig=${v}`, '.env'],
    [`API_TOKEN=https://download.internal/file?Signature=${v}&Expires=1700000000`, '.env'],
    [`API_TOKEN="https://bucket.s3.amazonaws.com/o?X-Amz-Signature=${hex}&X-Amz-Expires=300"`, '.env'],
    [`API_TOKEN=https://download.internal/file?X-Amz-Security-Token=${v}`, '.env'],
    [`API_TOKEN=https://download.internal/file?access_token=${v}`, '.env'],
    [`API_SECRET=https://download.internal/file?apikey=${v}`, '.env'],
    [`API_SECRET=https://download.internal/file?key=${v}`, '.env'],
    [`API_SECRET=https://download.internal/file?password=${v}`, '.env'],
    [`API_TOKEN=https://download.internal/file?token=abcd1234`, '.env'], // short credential parameter
    [`API_TOKEN=https://download.internal/file?file=${v}${v}`, '.env'], // random value under an ordinary name
    [`API_TOKEN=https://download.internal/dl#access_token=${v}`, '.env'],
    [`API_TOKEN=https://download.internal/file?sig=${encodeURIComponent(`${v}+/=`)}`, '.env'],
    [`API_TOKEN=https://${v}@github.com/o/r`, '.env'],
    [`WEBHOOK_TOKEN=https://hooks.internal.net/services/${v}`, '.env'],
    [`WEBHOOK_TOKEN=https://hooks.example.net/services/${v}`, '.env'], // "example" in the host does not hide it
    [`WEBHOOK_SECRET=https://hooks.internal.net/${hex}`, '.env'],
    [`api_token: https://download.internal/file?sig=${v}`, 'c.yaml'],
    [`api_token: 'https://download.internal/file?sig=${v}'`, 'c.yaml'],
    [`downloadToken: "https://download.internal/file?sig=${v}"`, 'c.yaml'],
    [`{"downloadToken": "https://download.internal/file?sig=${v}"}`, 'c.json'],
    [`{"webhookSecret": "https://download.internal\\/hook\\/${v}"}`, 'c.json'],
    [`Set API_TOKEN=https://download.internal/file?sig=${v} in your shell`, 'README.md'],
    [`const cfg = { apiToken: "https://download.internal/file?sig=${v}" };`, 'src/a.js'],
    [`API_TOKEN=\${BASE}/file?sig=${v}`, '.env'], // expansion next to a signed literal
  ];

  it.each(URL_FINDINGS)('reports %s in %s', (text, file) => {
    expect(rules(file, `${text}\n`)).toContain('secret-assignment');
  });

  const URL_CLEAN = [
    ['TOKEN_ENDPOINT=https://auth.internal.net/oauth/token', '.env'],
    ['TOKEN_URL=https://auth.internal.net/oauth/token', '.env'],
    [`TOKEN_URL=https://auth.internal.net/oauth/token?grant=${v}`, '.env'], // weak names keep the endpoint exemption
    [`AUTH_URL=https://auth.internal.net/authorize?client_id=${v}`, '.env'],
    ['API_TOKEN=https://api.internal.net/v1/items?page=2&sort=name', '.env'],
    ['API_TOKEN=https://api.internal.net/v1/oauth/token', '.env'],
    ['API_TOKEN=https://api.internal.net/v1/x?token=<your-token>', '.env'],
    ['API_TOKEN=https://api.internal.net/v1/x?token=${API_TOKEN_VALUE}', '.env'],
    ['API_TOKEN=https://api.internal.net/v1/x?token=', '.env'],
    ['API_TOKEN=https://hooks.internal.net/services/{team}/{bot}/{token}', '.env'],
    ['API_TOKEN=https://hooks.internal.net/services/:team/:token', '.env'],
    ['API_TOKEN=https://<host>/path', '.env'],
    ['api_token: https://api.internal.net/v1/health', 'c.yaml'],
    ['{"apiToken": "https://api.internal.net/v1/health"}', 'c.json'],
    ['Set API_TOKEN=https://api.internal.net/v1/health in your shell', 'README.md'],
    ['API_TOKEN=https://api.internal.net/downloads/annual-fish-yield-report-2024.pdf', '.env'],
  ];

  it.each(URL_CLEAN)('does not report %s in %s', (text, file) => {
    expect(rules(file, `${text}\n`)).toEqual([]);
  });

  it('a URL user name that is a template or a word is not a token', () => {
    expect(rules('.env', 'API_TOKEN=https://${GITHUB_TOKEN}@github.com/o/r\n')).toEqual([]);
    expect(rules('.env', 'API_TOKEN=https://deploy-bot@github.com/o/r\n')).toEqual([]);
  });

  const name = (host, tail) => `https://${host}/${tail}`;
  const WEBHOOKS = [
    ['Slack service', name('hooks.slack.com', `services/T0123ABCD/B0123ABCD/${v}`)],
    ['Slack workflow', name('hooks.slack.com', `workflows/T0123ABCD/A0123ABCD/123456789012/${v}`)],
    ['Slack trigger', name('hooks.slack.com', `triggers/E0123ABCD/123456789012/${hex.slice(0, 32)}`)],
    ['Slack, JSON-escaped slashes', name('hooks.slack.com', `services/T0123ABCD/B0123ABCD/${v}`).replaceAll('/', '\\/')],
    ['Discord', name('discord.com', `api/webhooks/123456789012345678/${v}${v}`)],
    ['Discord (discordapp.com, versioned)', name('discordapp.com', `api/v10/webhooks/123456789012345678/${v}${v}`)],
    [
      'Microsoft Teams',
      name('contoso.webhook.office.com', `webhookb2/${hex.slice(0, 8)}-1111-2222-3333-444444444444@${hex.slice(8, 16)}-1111-2222-3333-444444444444/IncomingWebhook/${hex.slice(0, 32)}/${hex.slice(16, 24)}-1111-2222-3333-444444444444`),
    ],
    [
      'Microsoft Teams (outlook.office.com)',
      name('outlook.office.com', `webhook/${hex.slice(0, 8)}-1111-2222-3333-444444444444@${hex.slice(8, 16)}-1111-2222-3333-444444444444/IncomingWebhook/${hex.slice(0, 32)}/${hex.slice(16, 24)}-1111-2222-3333-444444444444`),
    ],
    ['Power Automate', name('prod-12.westus.logic.azure.com:443', `workflows/${hex.slice(0, 32)}/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=${v}${v}`)],
    ['Zapier', name('hooks.zapier.com', `hooks/catch/123456/${randomString(7, 223, LOWER_ALNUM)}/`)],
    ['IFTTT', name('maker.ifttt.com', `trigger/fish_alert/with/key/${v}`)],
    ['Telegram bot', name('api.telegram.org', `bot123456789:${v}${randomString(12, 224)}/sendMessage`)],
  ];

  it.each(WEBHOOKS)('webhook-url flags a %s webhook wherever it appears', (_label, url) => {
    for (const file of ['deploy.sh', 'README.md', 'src/notify.js', 'config/alerts.yaml', '.env', 'hooks.json']) {
      expect(rules(file, `curl -X POST ${url}\n`), file).toContain('webhook-url');
    }
    const report = formatReport(scanText('README.md', `curl -X POST ${url}\n`));
    for (const piece of windows(v)) expect(report).not.toContain(piece);
  });

  const WEBHOOK_CLEAN = [
    // Built at runtime: a fully literal Slack-shaped URL is blocked by GitHub push protection even as a placeholder.
    ['https://hooks.slack.com/services/T00000000/B00000000/', 'X'.repeat(24)].join(''),
    'https://hooks.slack.com/services/YOUR/WEBHOOK/URL',
    'https://hooks.slack.com/services/<token>',
    'https://hooks.slack.com/services/${SLACK_TOKEN}',
    'https://discord.com/api/webhooks/123456789012345678/<token>',
    'https://discord.com/api/webhooks/123456789012345678/REDACTED-REDACTED-REDACTED',
    'https://hooks.zapier.com/hooks/catch/123456/xxxxxx/',
    'https://maker.ifttt.com/trigger/event/with/key/your-ifttt-key-goes-here',
    'https://api.telegram.org/bot<token>/sendMessage',
    'https://hooks.slack.com/',
    'https://api.slack.com/messaging/webhooks',
  ];

  it.each(WEBHOOK_CLEAN)('webhook-url leaves the placeholder or documentation link %s alone', (url) => {
    expect(rules('README.md', `POST to ${url}\n`)).toEqual([]);
    expect(rules('deploy.sh', `curl -X POST ${url}\n`)).toEqual([]);
  });

  it('a strong name holding a Slack webhook is reported by both the name and the URL', () => {
    const url = name('hooks.slack.com', `services/T0123ABCD/B0123ABCD/${v}`);
    expect(rules('.env', `${N('SLACK_', 'WEBHOOK_TOKEN')}=${url}\n`).sort()).toEqual(['secret-assignment', 'webhook-url']);
    expect(rules('.env', `${N('SLACK_', 'WEBHOOK_URL')}=${url}\n`)).toEqual(['webhook-url']);
  });
});

// ---------------------------------------------------------------------------
// Review round 7 (finding 4): name and value fields in any order
//
// Class: a secret-like NAME field and a VALUE field in the same bounded object, with other fields in between and in
// either order: JSON (compact and pretty), YAML flow mappings, YAML block mappings and list items, Kubernetes env
// lists, Netlify-style nested values, Terraform blocks, JSON stored as an escaped string. Objects do not leak into
// their neighbours and the search never leaves a bounded window.
// ---------------------------------------------------------------------------

describe('review round 7 (4): name/value pairs in any order', () => {
  const v = randomString(24, 231);
  const N = ['JWT_', 'SECRET'].join('');
  const rules = (file, text) => scanText(file, text).map((f) => f.rule);
  const PAIR = 'secret-name-value-pair';

  const FINDINGS = [
    ['JSON, value first', 'a.json', `[{"value":"${v}","key":"${N}"}]`],
    ['JSON, field in between', 'a.json', `{"key":"${N}","type":"encrypted","value":"${v}"}`],
    ['JSON, several fields in between', 'a.json', `{"key":"${N}","target":["production","preview"],"type":"encrypted","comment":"x","value":"${v}"}`],
    ['JSON, value first with fields in between', 'a.json', `{"value":"${v}","type":"encrypted","target":["preview"],"name":"${N}"}`],
    ['JSON, pretty printed', 'a.json', `[\n  {\n    "key": "${N}",\n    "type": "encrypted",\n    "target": ["production"],\n    "value": "${v}"\n  }\n]`],
    ['JSON, pretty printed, value first', 'a.json', `[\n  {\n    "value": "${v}",\n    "type": "encrypted",\n    "name": "${N}"\n  }\n]`],
    ['JSON, second object of an array', 'a.json', `[{"key":"PORT","value":"3000"},{"value":"${v}","key":"${N}"}]`],
    ['JSON, single quotes', 'a.json', `{'value':'${v}','key':'${N}'}`],
    ['JSON, Netlify nested values', 'a.json', `{"key":"${N}","scopes":["builds"],"values":[{"value":"${v}","context":"all"}]}`],
    ['JSON, nested values first', 'a.json', `{"values":[{"value":"${v}","context":"all"}],"key":"${N}"}`],
    ['JSON, secretValue field', 'a.json', `{"secretValue":"${v}","name":"${N}"}`],
    ['JSON stored as an escaped string', 'a.json', `{"data":"{\\"value\\":\\"${v}\\",\\"key\\":\\"${N}\\"}"}`],
    ['Markdown code fence', 'a.md', `\`\`\`json\n{"value":"${v}","key":"${N}"}\n\`\`\``],
    ['YAML flow mapping', 'a.yaml', `env: [{name: ${N}, value: ${v}}]`],
    ['YAML flow mapping, value first', 'a.yaml', `env: [{value: ${v}, name: ${N}}]`],
    ['YAML flow mapping, field in between', 'a.yaml', `env: [{name: ${N}, description: x, value: "${v}"}]`],
    ['YAML list item, field in between', 'a.yaml', `env:\n  - name: ${N}\n    type: opaque\n    value: ${v}`],
    ['YAML list item, value first', 'a.yaml', `env:\n  - value: ${v}\n    type: opaque\n    name: ${N}`],
    ['YAML list item, value in the middle', 'a.yaml', `env:\n  - type: opaque\n    name: ${N}\n    description: d\n    value: "${v}"`],
    ['YAML list item, name in the middle', 'a.yaml', `env:\n  - type: opaque\n    value: "${v}"\n    name: ${N}\n    scope: all`],
    ['YAML plain mapping', 'a.yaml', `name: ${N}\ntype: opaque\nvalue: ${v}`],
    ['YAML plain mapping, value first', 'a.yaml', `value: ${v}\ntype: opaque\nname: ${N}`],
    ['Kubernetes env list', 'deploy.yaml', `containers:\n  - name: app\n    env:\n      - name: PORT\n        value: "3000"\n      - name: ${N}\n        value: ${v}`],
    ['Kubernetes env list with a comment line', 'deploy.yaml', `env:\n  - name: ${N}\n    # rotate monthly\n    value: ${v}`],
    ['Terraform block', 'main.tf', `environment_variable {\n  name  = "${N}"\n  type  = "PLAINTEXT"\n  value = "${v}"\n}`],
    ['Terraform inline map, value first', 'main.tf', `env = { value = "${v}", name = "${N}" }`],
    ['Docker Compose long-form list', 'docker-compose.yml', `services:\n  app:\n    environment:\n      - name: ${N}\n        value: ${v}`],
  ];

  it.each(FINDINGS)('reports: %s', (_label, file, text) => {
    expect(rules(file, `${text}\n`)).toContain(PAIR);
    const finding = scanText(file, `${text}\n`).find((f) => f.rule === PAIR);
    expect(Object.keys(finding).sort()).toEqual(['line', 'path', 'rule']);
  });

  const CLEAN = [
    ['non-secret name', 'a.json', `{"value":"${v}","key":"PORT"}`],
    ['placeholder value', 'a.json', `{"value":"<your secret>","key":"${N}"}`],
    ['environment reference', 'a.json', `{"key":"${N}","value":"\${${N}}"}`],
    ['empty value', 'a.json', `{"key":"${N}","value":""}`],
    ['short value', 'a.json', `{"key":"${N}","value":"dev"}`],
    ['sentence value', 'a.json', `{"key":"reset_password_token","value":"Your session token has expired, please sign in again."}`],
    ['value in the NEXT object of an array', 'a.json', `[{"key":"${N}","note":1},{"key":"OTHER","value":"${v}"}]`],
    ['value in the PREVIOUS object of an array', 'a.json', `[{"key":"OTHER","value":"${v}"},{"key":"${N}","note":1}]`],
    ['valueFrom instead of value', 'a.yaml', `env:\n  - name: ${N}\n    valueFrom:\n      secretKeyRef:\n        name: app-secrets\n        key: jwt`],
    ['secretKeyRef flow mapping', 'a.yaml', `env:\n  - name: ${N}\n    valueFrom:\n      secretKeyRef: {name: app-secrets, key: jwt}`],
    ['YAML: value belongs to the next item', 'a.yaml', `env:\n  - name: ${N}\n    note: 1\n  - name: OTHER\n    value: "${v}"`],
    ['YAML: value belongs to the previous item', 'a.yaml', `env:\n  - value: "${v}"\n    name: OTHER\n  - name: ${N}\n    note: 1`],
    ['YAML: value under a different document', 'a.yaml', `name: ${N}\n---\nvalue: ${v}`],
    ['Terraform: reference value', 'main.tf', `environment_variable {\n  name = "${N}"\n  value = var.jwt_secret\n}`],
    ['GitHub Actions secret reference', 'ci.yml', `steps:\n  - name: deploy\n    env:\n      JWT_SECRET: \${{ secrets.JWT_SECRET }}`],
    ['docker-compose interpolation', 'docker-compose.yml', `services:\n  app:\n    environment:\n      - ${N}=\${${N}:?set it}\n      - PORT=\${PORT:-3000}`],
    ['value far outside the window', 'a.json', `{"key":"${N}","filler":"${'y'.repeat(2500)}","value":"${v}"}`],
  ];

  it.each(CLEAN)('does not report: %s', (_label, file, text) => {
    expect(rules(file, `${text}\n`)).toEqual([]);
  });

  it('reports the line of the name field, and the allow marker on either line silences it', () => {
    const text = `env:\n  - value: ${v}\n    name: ${N}\n`;
    expect(scanText('a.yaml', text)).toEqual([{ path: 'a.yaml', line: 3, rule: PAIR }]);
    expect(rules('a.yaml', `env:\n  - value: ${v}\n    name: ${N}  # ${ALLOW_MARKER}\n`)).toEqual([]);
  });

  it('stays bounded: a very large object with the pair at both ends is not searched end to end', () => {
    const filler = Array.from({ length: 400 }, (_, i) => `"f${i}":${i}`).join(',');
    expect(rules('a.json', `{"key":"${N}",${filler},"value":"${v}"}\n`)).toEqual([]);
  });

  // The dense-file budget: every `name: SECRET` line costs about 250 characters of window, PAIR_BUDGET_CHARS is 24 million.
  it('a file too dense to verify is reported exactly once, on the line where the budget ran out, instead of being searched forever', SLOW, () => {
    const dense = '  name: SECRET\n'.repeat(150_000);
    const started = performance.now();
    const findings = scanText('a.yaml', dense);
    expect(performance.now() - started).toBeLessThan(HOSTILE_LIMIT_MS);
    const pair = findings.filter((f) => f.rule === PAIR);
    expect(pair).toHaveLength(1);
    expect(pair[0].line).toBeGreaterThan(20_000); // not on the first lines: the budget has to run out first
    expect(pair[0].line).toBeLessThanOrEqual(150_000);
  });

  it('a file just under the budget is searched in full and reports nothing', SLOW, () => {
    expect(scanText('a.yaml', '  name: SECRET\n'.repeat(30_000)).filter((f) => f.rule === PAIR)).toEqual([]);
  });
});

describe('scan time', () => {
  const repeat = (unit, bytes) => unit.repeat(Math.ceil(bytes / unit.length));
  const HUNDRED_KB = 100 * 1024;
  const cases = [
    ['a keyword repeated in Markdown', 'notes.md', repeat('secret', HUNDRED_KB)],
    ['token. repeated in Markdown', 'notes.md', repeat('token.', HUNDRED_KB)],
    ['api_key repeated in an env file', '.env', repeat('api_key', HUNDRED_KB)],
    ['name= repeated in an env file', '.env', repeat('secret=', HUNDRED_KB)],
    ['weak name= chain (nested assignments)', '.env', repeat('secret_hint=', HUNDRED_KB)],
    ['weak name= chain in Markdown', 'a.md', repeat('token_url=', HUNDRED_KB)],
    ['a=b= chain', 'a.js', repeat('a=', HUNDRED_KB)],
    ['process.env.SECRET repeated in code', 'a.js', repeat('process.env.SECRET', HUNDRED_KB)],
    ['process.env.SECRET_TOKEN_ repeated in code', 'a.js', repeat('process.env.SECRET_TOKEN_', HUNDRED_KB)],
    ['one very long env name', 'a.js', `process.env.${'SECRET'.repeat(HUNDRED_KB / 6)}`],
    ['unterminated quoted values', '.env', repeat('password="x ', HUNDRED_KB)],
    ['colon after colon', 'a.yaml', repeat('password: :', HUNDRED_KB)],
    ['YAML name lines', 'a.yaml', repeat('- name: SECRET\n  ', HUNDRED_KB)],
    ['brace runs', 'a.js', repeat('{a', HUNDRED_KB)],
    ['destructuring targets', 'a.js', repeat('{a} = process.env ', HUNDRED_KB)],
    ['jwt.sign( repeated', 'a.js', repeat('jwt.sign(', HUNDRED_KB)],
    ['SQL keywords', 'a.sql', repeat('alter role with password ', HUNDRED_KB)],
    ['curl -u repeated', 'a.md', repeat(`curl -u a:${'b'} `, HUNDRED_KB)],
    ['scheme-like runs', 'a.md', repeat('a.b+c-', HUNDRED_KB)],
    ['PEM headers', 'a.md', repeat('-----BEGIN A PRIVATE KEY-----\n', HUNDRED_KB)],
    ['{"key":"SECRET" objects, never closed', 'a.json', repeat('{"key":"SECRET"', HUNDRED_KB)],
    ['"key":"SECRET" fields with no object', 'a.md', repeat('"key":"SECRET",', HUNDRED_KB)],
    ['nested braces before name fields', 'a.json', `${'{'.repeat(5000)}${repeat('"key":"SECRET",', HUNDRED_KB)}`],
    ['YAML name lines with siblings', 'a.yaml', repeat('  - name: SECRET\n    type: x\n', HUNDRED_KB)],
    ['YAML name lines at one indent', 'a.yaml', repeat('  name: SECRET\n', HUNDRED_KB)],
    ['password repeated in a .netrc', '.netrc', repeat('password ', HUNDRED_KB)],
    ['password + newline repeated in a .netrc', '.netrc', repeat('password\n', HUNDRED_KB)],
    ['colons in a .pgpass', '.pgpass', repeat(':', HUNDRED_KB)],
    ['five-field lines in a .pgpass', '.pgpass', repeat('a:b:c:d:e\n', HUNDRED_KB)],
    ['user: repeated in a .htpasswd', '.htpasswd', repeat('a:', HUNDRED_KB)],
    ['_auth repeated in a .npmrc', '.npmrc', repeat('_auth ', HUNDRED_KB)],
    ['URL user@ runs in a .git-credentials', '.git-credentials', repeat('a://b@', HUNDRED_KB)],
    ['signed-URL assignments', '.env', repeat('API_TOKEN=https://a/b?sig=', HUNDRED_KB)],
    ['one URL with a huge query', '.env', `API_TOKEN=https://a/?${repeat('a=b&', HUNDRED_KB)}`],
    ['webhook hosts repeated', 'a.md', repeat('hooks.slack.com/services/A/', HUNDRED_KB)],
    ['Teams and Power Automate hosts repeated', 'a.md', repeat('.webhook.office.com/webhook/.logic.azure.com/workflows/', HUNDRED_KB)],
    ['client-key-data: repeated', 'a.yaml', repeat('client-key-data: ', HUNDRED_KB)],
    // Review round 8 (4): one-line credential files, where per-match line lookups used to make the scan quadratic.
    ['"password x " repeated in a .netrc', '.netrc', repeat('password x ', HUNDRED_KB)],
    ['"token: x " repeated in a kubeconfig', 'kubeconfig', repeat('token: x ', HUNDRED_KB)],
    ['"a:b " repeated in a .htpasswd', '.htpasswd', repeat('a:b ', HUNDRED_KB)],
    ['"user = a:x " repeated in a .curlrc', '.curlrc', repeat('user = a:x ', HUNDRED_KB)],
    ['"auth": repeated in a docker config', 'config.json', repeat('"auth": "x" ', HUNDRED_KB)],
    ['netrc content matcher on a README', 'a.md', repeat('machine a login b password ', HUNDRED_KB)],
    ['pgpass content matcher on a script', 'a.sh', repeat('db:5432:d:u:x\n', HUNDRED_KB)],
    ['"auths" and "auth" keys with no object', 'a.json', repeat('"auths":"auth":', HUNDRED_KB)],
    ['{"key":"SECRET" objects in source code', 'a.js', repeat('{"key":"SECRET",', HUNDRED_KB)],
    ['name( calls in source code', 'a.py', repeat('create(name="SECRET",', HUNDRED_KB)],
    ['unclosed parentheses before name fields', 'a.js', repeat('((((name:"SECRET"', HUNDRED_KB)],
    ['nested secret keys with children', 'a.yaml', repeat('  secret:\n    x: 1\n', HUNDRED_KB)],
    ['secret keys with an empty child block', 'a.yaml', repeat('password:\n  ', HUNDRED_KB)],
    ['XML entries with a name element', 'a.xml', repeat('<property><name>SECRET</name>', HUNDRED_KB)],
    ['XML add entries', 'a.xml', repeat('<add key="SECRET" ', HUNDRED_KB)],
    ['CSV rows', 'a.csv', repeat('secret,x\n', HUNDRED_KB)],
    ['Markdown table rows', 'a.md', repeat('| SECRET | x |\n', HUNDRED_KB)],
    ['CLI commands', 'a.sh', repeat('gh secret set ', HUNDRED_KB)],
    ['YAML tags after a name', 'a.yaml', repeat('password: !!str !!str ', HUNDRED_KB)],
  ];

  it.each(cases)('%s (100 KB) scans within the hostile-input limit', SLOW, (_label, file, text) => {
    const started = performance.now();
    scanText(file, text);
    expect(performance.now() - started).toBeLessThan(HOSTILE_LIMIT_MS);
  });

  // The 100 KB table cannot tell a quadratic scan from a linear one on a fast machine. These are a megabyte or more
  // (a tracked file may be 5 MB): quadratic per-match line lookups took 19 to 23 seconds here, a linear scan takes
  // well under half a second, and the limit is the same generous 8 s (about 20 times the linear time).
  const ONE_MB = 1024 * 1024;
  const BIG = [
    ['.netrc', repeat('password x ', ONE_MB)],
    ['.netrc', repeat('password ', ONE_MB)],
    ['kubeconfig', repeat('token: x ', 2 * ONE_MB)],
    ['.htpasswd', repeat('a:b ', 2 * ONE_MB)],
    ['.curlrc', repeat('user = a:x ', 2 * ONE_MB)],
    ['.git-credentials', repeat('a://b@', 2 * ONE_MB)],
    ['config.json', repeat('"auth": "x" ', ONE_MB)],
    ['.vault-token', repeat('a ', 2 * ONE_MB)],
  ];
  it.each(BIG)('a one-line %s of a megabyte or more scans in linear time', SLOW, (file, text) => {
    const started = performance.now();
    scanText(file, text);
    expect(performance.now() - started).toBeLessThan(HOSTILE_LIMIT_MS);
  });
});

// ---------------------------------------------------------------------------
// Review round 8: siblings of the credential-file, name/value pair, sentence and URL classes
//
// (1) Credential-file content under any name, and written by a script. Siblings: name variants (.bak, .prod, .txt, dot-,
//     prefix and suffix), Markdown/text notes, echo/printf/heredoc writers in shell and CI YAML, JS and Dockerfile writers,
//     docker config as compact/pretty JSON and YAML with auth/identitytoken/registrytoken, pgpass with wildcards.
// (2) Name/value pairs outside config files: JS/TS/Go objects, Python calls, CloudFormation, XML attribute and element
//     forms, value-field synonyms, nested keys, YAML tags/anchors, CSV/TSV/Markdown rows, CLI invocations, and a brace or
//     escaped quote inside a string field.
// (3) Sentences: what passes (message catalogs, documentation about a credential) and what does not (function words).
// (4) Scan time: see the 'scan time' tables above.
// ---------------------------------------------------------------------------

describe('review round 8', () => {
  const V = randomString(22, 801);
  const N = ['JWT_', 'SECRET'].join('');
  const PASS = ['PASS', 'WORD'].join('');
  const B64 = Buffer.from(`u:${V}`).toString('base64');
  const rules = (file, text) => scanText(file, text).map((f) => f.rule);
  const PAIR = 'secret-name-value-pair';
  const CRED = 'credential-file';
  const CLI = 'secret-cli-command';

  describe('(1) credential-file content under any name, and written by a script', () => {
    const NETRC_LINE = `machine a.b login x password ${V}\n`;
    it.each(['netrc.txt', 'config/.netrc.prod', '.netrc.bak', 'dot-netrc', '.netrc.local', 'netrc_backup', 'home/_netrc.old', 'NETRC'])(
      'a netrc line in %s is a finding',
      (file) => {
        expect(rules(file, NETRC_LINE)).toContain(CRED);
      },
    );

    it.each(['pgpass.txt', '.pgpass.bak', 'pgpass.local', 'db/pgpass-prod'])('a pgpass line in %s is a finding', (file) => {
      expect(rules(file, `db:5432:d:u:${V}\n`)).toContain(CRED);
      expect(rules(file, `*:*:*:app:${V}\n`)).toContain(CRED);
    });

    it.each(['git-credentials.txt', '.git-credentials.bak'])('a stored credential URL in %s is a finding', (file) => {
      expect(rules(file, `https://${V}@github.com\n`)).toContain(CRED);
    });

    const DOCKER_JSON = `{"auths":{"h":{"auth":"${B64}"}}}`;
    const DOCKER_PRETTY = `{\n  "auths": {\n    "h": {\n      "auth": "${B64}"\n    }\n  }\n}\n`;
    it.each([
      ['config.json', DOCKER_JSON],
      ['docker-config.json', DOCKER_JSON],
      ['ci/registry.json', DOCKER_JSON],
      ['x.json', DOCKER_PRETTY],
      ['x.yaml', `auths:\n  h:\n    auth: ${B64}\n`],
      ['x.yaml', `auths:\n  h:\n    identitytoken: ${V}\n`],
      ['x.json', `{"auths":{"h":{"registrytoken":"${V}"}}}`],
      ['dockerconfigjson.bak', DOCKER_JSON],
      ['Dockerfile', `RUN echo '{"auths":{"h":{"auth":"${B64}"}}}' > ~/.docker/config.json\n`],
      ['deploy.js', `fs.writeFileSync(target, '{"auths":{"h":{"auth":"${B64}"}}}');\n`],
      ['deploy.sh', `echo "{\\"auths\\":{\\"h\\":{\\"auth\\":\\"${B64}\\"}}}" > ~/.docker/config.json\n`],
    ])('docker registry auth in %s (%#) is a finding', (file, text) => {
      // credential-file (content), or secret-assignment when the file name already says "docker config".
      expect(rules(file, text).some((rule) => rule === CRED || rule === 'secret-assignment')).toBe(true);
    });

    it.each([
      ['README.md', NETRC_LINE],
      ['notes.txt', NETRC_LINE],
      ['docs/guide.md', `machine a.b\n  login x\n  password ${V}\n`],
      ['deploy.sh', `echo "machine github.com login x password ${V}" > ~/.netrc\n`],
      ['.github/workflows/ci.yml', `      - run: echo "machine github.com login x password ${V}" > ~/.netrc\n`],
      ['deploy.sh', `cat > ~/.netrc <<EOF\nmachine github.com\nlogin x\npassword ${V}\nEOF\n`],
      ['deploy.sh', `printf "machine h.io\\nlogin u\\npassword ${V}\\n" > ~/.netrc\n`],
      ['deploy.sh', `echo "default login u password ${V}" >> ~/.netrc\n`],
      ['deploy.sh', `echo "db:5432:d:u:${V}" > ~/.pgpass\n`],
      ['.github/workflows/ci.yml', `      - run: echo "db:5432:d:u:${V}" > ~/.pgpass\n`],
      ['deploy.sh', `cat > ~/.pgpass <<EOF\ndb.internal:5432:prod:app:${V}\nEOF\n`],
      ['notes.txt', `db.internal:5432:prod:app:${V}\n`],
    ])('a netrc or pgpass line written into %s (%#) is a finding', (file, text) => {
      expect(rules(file, text)).toContain(CRED);
    });

    it.each([
      ['README.md', 'machine learning password reset flow\n'],
      ['a.txt', 'machine a.b login x password <password>\n'],
      ['a.txt', 'machine a.b login x password changeme\n'],
      ['a.txt', `machine a.b login x password $${PASS}\n`],
      ['a.sh', 'echo "machine github.com login x password xxxxxxxx" > ~/.netrc\n'],
      ['a.md', 'machine ftp.example.com login anonymous password guest@\n'],
      ['.netrc', 'machine ftp.example.com login anonymous password guest@\n'],
      ['.netrc', 'machine ftp.example.com login anonymous password anonymous\n'],
      ['a.txt', 'timestamps 2024:01:01:12:30:45 and 10:00:00:00:00\n'],
      ['a.txt', 'fe80:0000:0000:0000:0001\n'],
      ['a.sh', 'echo "db:5432:d:u:your_password" > ~/.pgpass\n'],
      ['x.json', '{"auths":{"h":{"auth":""}}}'],
      ['x.json', '{"auths":{}}'],
      ['x.json', '{"auths":{"h":{"auth":"<base64 of user:password>"}}}'],
      ['x.json', ['{"provider":{"', 'auth', '":"basic-auth-scheme-name-only"}}'].join('')],
      ['x.yaml', ['oauth:\n  ', 'auth', ': bearer-scheme-in-some-other-section\n'].join('')],
      ['x.json', `{"auths":{},"filler":"${'y'.repeat(600)}","provider":{"${['au', 'th'].join('')}":"basic-scheme-name"}}`], // "auths" far above
    ])('does not report %s: %j', (file, text) => {
      expect(rules(file, text)).toEqual([]);
    });

    it('.htpasswd: a hash is a credential, a placeholder hash is documentation', () => {
      expect(rules('.htpasswd', `user:$apr1$${V.slice(0, 8)}$${V}${V.slice(0, 4)}\n`)).toContain(CRED);
      expect(rules('.htpasswd', 'user:$apr1$xxxxxxxx$xxxxxxxxxxxxxxxxxxxxxx\n')).toEqual([]);
      expect(rules('.htpasswd', 'user:{SHA}REDACTED\n')).toEqual([]);
      expect(rules('.htpasswd', `user:{SHA}${V}==\n`)).toContain(CRED);
    });

    it('reports path, line and rule only', () => {
      const [finding] = scanText('deploy.sh', `echo hi\necho "machine github.com login x password ${V}" > ~/.netrc\n`);
      expect(finding).toEqual({ path: 'deploy.sh', line: 2, rule: CRED });
    });

    it('classifies the variant names as credential files', () => {
      for (const [file, tag] of [
        ['netrc.txt', 'netrc'], ['.netrc.bak', 'netrc'], ['dot-netrc', 'netrc'], ['pgpass.txt', 'pgpass'],
        ['git-credentials.txt', 'gitcred'], ['a/.docker/anything.json', 'docker'], ['docker-config.json', 'docker'],
      ]) {
        expect(credentialFormats(file).has(tag), file).toBe(true);
      }
      expect(credentialFormats('src/netrc-helper.js').has('netrc')).toBe(true); // by name; its content decides
      expect(credentialFormats('netrcs.txt').has('netrc')).toBe(false);
    });
  });

  describe('(2) name/value pairs in code, XML, CloudFormation, CSV, Markdown and CLI invocations', () => {
    const FINDINGS = [
      ['JS object, type field between', 'a.js', `await api.post('/env',{key:'${N}',type:'encrypted',value:'${V}'})`],
      ['JS object, value first', 'a.js', `const x = {"value":"${V}","key":"${N}"};`],
      ['TS array of objects', 'a.ts', `const x = [{name:"${N}",value:"${V}"}]`],
      ['Go struct literal', 'a.go', `Env{Name:"${N}",Value:"${V}"}`],
      ['Python call with keyword arguments', 'a.py', `create_var(name='${N}', value='${V}')`],
      ['Python call, value first', 'a.py', `create_var(value='${V}', name='${N}')`],
      ['Python dict', 'a.py', `x = {'name': '${N}', 'value': '${V}'}`],
      ['Python call across lines', 'a.py', `create_var(\n    name='${N}',\n    description='x',\n    value='${V}',\n)`],
      ['CloudFormation YAML', 'a.yaml', `- ParameterKey: ${N}\n  ParameterValue: ${V}`],
      ['CloudFormation JSON', 'a.json', `[{"ParameterKey":"${N}","ParameterValue":"${V}"}]`],
      ['Elastic Beanstalk option', 'a.json', `{"OptionName":"${N}","Value":"${V}"}`],
      ['XML add, key then value', 'a.xml', `<add key="${N}" value="${V}"/>`],
      ['XML add in a .config file', 'web.config', `<appSettings>\n  <add key="${N}" value="${V}" />\n</appSettings>`],
      ['XML add, value then key', 'a.xml', `<add value="${V}" key="${N}"/>`],
      ['XML setting with a value element', 'a.xml', `<setting name="${N}"><value>${V}</value></setting>`],
      ['XML property with name and value elements', 'a.xml', `<property><name>${N}</name><value>${V}</value></property>`],
      ['XML property, pretty printed', 'a.xml', `<property>\n  <name>${N}</name>\n  <value>${V}</value>\n</property>`],
      ['JSON content field', 'a.json', `{"name":"${N}","content":"${V}"}`],
      ['JSON data field', 'a.json', `{"name":"${N}","data":"${V}"}`],
      ['JSON default field', 'a.json', `{"name":"${N}","default":"${V}"}`],
      ['JSON defaultValue field', 'a.json', `{"name":"${N}","defaultValue":"${V}"}`],
      ['JSON stringValue field', 'a.json', `{"name":"${N}","stringValue":"${V}"}`],
      ['nested YAML key with a value child', 'a.yaml', `secrets:\n  ${N}:\n    value: ${V}`],
      ['nested YAML key, child after another field', 'a.yaml', `secrets:\n  ${N}:\n    type: opaque\n    value: ${V}`],
      ['nested JSON key with a value child', 'a.json', `{"${N}":{"value":"${V}"}}`],
      ['YAML flow child', 'a.yaml', `${N}: {value: ${V}}`],
      ['YAML !!str tag', 'a.yaml', `name: ${N}\nvalue: !!str ${V}`],
      ['YAML anchor', 'a.yaml', `name: ${N}\nvalue: &a ${V}`],
      ['YAML tag on a plain assignment', 'a.yaml', `${N}: !!str ${V}`, 'secret-assignment'],
      ['YAML anchor on a plain assignment', 'a.yaml', `${N}: &secret ${V}`, 'secret-assignment'],
      ['CSV row', 'a.csv', `${N},${V}`],
      ['CSV row, quoted', 'a.csv', `"${N}","${V}"`],
      ['TSV row', 'a.tsv', `${N}\t${V}`],
      ['Markdown table row', 'a.md', `| ${N} | ${V} |`],
      ['Markdown table row with code spans', 'a.md', `| \`${N}\` | \`${V}\` |`],
      ['brace inside a string field', 'a.json', `{"name":"${N}","desc":"a } b","value":"${V}"}`],
      ['brace inside a string field before the name', 'a.json', `{"value":"${V}","desc":"}","name":"${N}"}`],
      ['escaped quote and brace in a string field', 'a.json', `{"name":"${N}","desc":"a\\"}\\"","value":"${V}"}`],
      ['open brace inside a string field', 'a.json', `{"desc":"{","name":"${N}","value":"${V}"}`],
      ['parenthesis inside a string argument', 'a.py', `create_var(name='${N}', note=')', value='${V}')`],
    ];
    it.each(FINDINGS)('reports: %s', (_label, file, text, rule = PAIR) => {
      expect(rules(file, `${text}\n`)).toContain(rule);
    });

    // The CLI shapes have their own rule.
    const CLI_FINDINGS = [
      ['gh secret set --body', 'a.sh', `gh secret set ${N} --body ${V}`],
      ['gh secret set --body in Markdown, quoted', 'a.md', `gh secret set ${N} --body "${V}"`],
      ['gh secret set -b=', 'a.sh', `gh secret set ${N} -b${''}=${V}`],
      ['gh variable set with --repo', 'a.sh', `gh secret set ${N} --repo o/r --body ${V}`],
      ['vercel env add with a here-string', 'a.sh', `vercel env add ${N} production <<< ${V}`],
      ['vercel env add fed by echo', 'a.sh', `echo ${V} | vercel env add ${N} production`],
      ['vercel env add fed by printf %s', 'a.sh', `printf %s "${V}" | vercel env add ${N} production`],
      ['netlify env:set', 'a.sh', `netlify env:set ${N} ${V}`],
      ['aws ssm put-parameter', 'a.sh', `aws ssm put-parameter --name ${N} --value ${V} --type SecureString`],
      ['aws ssm put-parameter, value first', 'a.sh', `aws ssm put-parameter --value ${V} --name /app/${N.toLowerCase()}`.replace('/app/', '')],
      ['aws ssm inside a JS string', 'a.js', `exec("aws ssm put-parameter --name ${N} --value ${V}");`],
      ['kubectl create secret --from-literal', 'a.sh', `kubectl create secret generic s --from-literal=${N}=${V}`],
      ['heroku config:set in code', 'a.js', `exec('heroku config:set ${N}=${V}');`],
      ['az keyvault secret set', 'a.sh', `az keyvault secret set --vault-name kv --name ${N} --value ${V}`],
    ];
    it.each(CLI_FINDINGS)('reports the command: %s', (_label, file, text) => {
      expect(rules(file, `${text}\n`)).toContain(CLI);
    });

    const CLEAN = [
      ['a placeholder value', 'a.json', `{"name":"${N}","value":"your_secret_here"}`],
      ['a value that is an environment reference', 'a.js', `const x = {key:'${N}',value:process.env.${N}};`],
      ['a bare identifier name in a function body', 'a.js', `function f() {\n const key = API_TOKEN;\n return { value: '${V}' };\n}`],
      ['unrelated objects in one call', 'a.py', `f({name:'${N}'}, {name:'x', value:'${V}'})`],
      ['a different entry after the name entry', 'a.xml', `<add key="${N}"/>\n<add key="other" value="${V}"/>`],
      ['a CSV placeholder', 'a.csv', `${N},changeme`],
      ['a Markdown table cell that is a description', 'a.md', `| ${N} | Signing secret for sessions |`],
      ['a Markdown table label', 'a.md', `| ${N} | string |`],
      ['a nested key with no value field', 'a.yaml', `secrets:\n  ${N}:\n    file: ./secret.txt`],
      ['a nested key whose child is a sibling key', 'a.yaml', `${N}:\nvalue: ${V}`],
      ['a value field that is another name entirely', 'a.json', `{"name":"${N}","valueFrom":"${V}"}`],
      ['a YAML tag on a placeholder', 'a.yaml', `name: ${N}\nvalue: !!str changeme`],
    ];
    it.each(CLEAN)('does not report: %s', (_label, file, text) => {
      expect(rules(file, `${text}\n`)).toEqual([]);
    });

    const CLI_CLEAN = [
      ['an environment reference', `gh secret set ${N} --body "$${N}"`],
      ['a braced environment reference', `gh secret set ${N} --body "\${${N}}"`],
      ['a command substitution', `gh secret set ${N} --body "$(cat secret.txt)"`],
      ['stdin from a file', `gh secret set ${N} < secret.txt`],
      ['a placeholder', `netlify env:set ${N} your_token_here`],
      ['a non-secret name', `gh secret set APP_MODE --body ${V}`],
      ['a piped file, not a literal', `cat token.txt | vercel env add ${N} production`],
      ['a comment after the command', `gh secret set ${N} # ${V}`],
    ];
    it.each(CLI_CLEAN)('does not report the command with %s', (_label, text) => {
      expect(rules('a.sh', `${text}\n`)).toEqual([]);
    });

    it('a finding carries path, line and rule only, on the name line', () => {
      const text = `x = 1\nsecrets:\n  ${N}:\n    value: ${V}\n`;
      expect(scanText('a.yaml', text)).toEqual([{ path: 'a.yaml', line: 3, rule: PAIR }]);
    });

    it('the allow marker silences an XML pair and a CLI command', () => {
      expect(rules('a.xml', `<add key="${N}" value="${V}"/> <!-- ${ALLOW_MARKER} -->\n`)).toEqual([]);
      expect(rules('a.sh', `gh secret set ${N} --body ${V} # ${ALLOW_MARKER}\n`)).toEqual([]);
    });
  });

  describe('(3) passphrase versus sentence, by context', () => {
    // Function-word sentences a person may well have picked as a passphrase.
    const PASSPHRASE_SENTENCES = [
      'the horse is 123',
      'This is the way.',
      'My voice is my password.',
      'My name is Bond, James Bond.',
      'May the force be with you.',
      'One ring to rule them all.',
      'It was the best of times, it was the worst of times.',
      'it is what it is',
      'you shall not pass',
      'to be or not to be',
      'this is my super secret passphrase',
      'I have a dream today',
    ];
    it.each(PASSPHRASE_SENTENCES)('%j is a finding under a strong name in .env, JSON, YAML and TOML', (phrase) => {
      expect(rules('app/.env.x', `${N}="${phrase}"\n`)).toEqual(['secret-assignment']);
      expect(rules('c.json', `{"${N}": "${phrase}"}\n`)).toEqual(['secret-assignment']);
      expect(rules('c.yml', `${N.toLowerCase()}: "${phrase}"\n`)).toEqual(['secret-assignment']);
      expect(rules('c.toml', `${N.toLowerCase()} = "${phrase}"\n`)).toEqual(['secret-assignment']);
    });

    // Documentation about the credential: instructions and references, not a value.
    const DOCUMENTATION = [
      'the password you chose during setup',
      'ask the team lead for the password',
      'the token from step 3',
      'whatever password you set in step 2',
      'same as the postgres password',
      'see the deployment guide for how to generate one',
      'a long random string of at least 32 characters',
      'The password for the database user',
      'Your session token has expired, please sign in again.',
      'see vault for the actual value',
      'set via environment variable at runtime',
    ];
    it.each(DOCUMENTATION)('documentation %j is not a finding in Markdown, .env and YAML', (text) => {
      expect(rules('README.md', `${PASS}="${text}"\n`)).toEqual([]);
      expect(rules('.env.example', `${PASS}="${text}"\n`)).toEqual([]);
      expect(rules('.env.example', `${PASS}=${text}\n`)).toEqual([]);
      expect(rules('config.yml', `${PASS.toLowerCase()}: ${text}\n`)).toEqual([]);
    });

    it('documentation with a random-looking word in it is still a finding', () => {
      expect(rules('README.md', `${PASS}="the password is ${V} see step 3"\n`)).toEqual(['secret-assignment']);
    });

    it('a number that counts nothing is part of a passphrase, a counted number is prose', () => {
      expect(rules('locales/en.json', `{"${N}": "the horse is 123"}\n`)).toEqual(['secret-assignment']);
      expect(rules('locales/en.json', `{"${N}": "Password must be at least 8 characters"}\n`)).toEqual([]);
      expect(rules('locales/en.json', `{"${N}": "Wait 30 seconds and try again"}\n`)).toEqual([]);
      expect(rules('locales/en.json', `{"${N}": "Enter the 6-digit code"}\n`)).toEqual([]);
    });

    it('UI sentences with the newly added vocabulary pass in a message catalog', () => {
      for (const text of ['API key not found', 'Copy the token and paste it here', 'Password must contain at least one number and one symbol.']) {
        expect(rules('locales/en.json', `{"resetToken": "${text}"}\n`), text).toEqual([]);
      }
    });

    it('message catalog paths are recognised by directory and by file name', () => {
      const phrase = 'It is what it is.';
      for (const file of ['i18n/x.json', 'src/locales/x.yml', 'lang/x.json', 'app/messages/x.yml', 'en.json', 'pt-BR.yml', 'messages_de.properties', 'translations.json', 'errors.json']) {
        expect(rules(file, file.endsWith('.json') ? `{"${N}": "${phrase}"}\n` : `${N.toLowerCase()}: "${phrase}"\n`), file).toEqual([]);
      }
      for (const file of ['config.json', 'src/settings.yml', 'app/.env.x', 'enough.json', 'english.json']) {
        expect(rules(file, file.endsWith('.json') ? `{"${N}": "${phrase}"}\n` : `${N.toLowerCase()}: "${phrase}"\n`), file).toEqual(['secret-assignment']);
      }
    });
  });

  describe('(class) a URL that is itself a bearer credential, under a strong name', () => {
    const TOKEN_NAME = ['API_', 'TOKEN'].join('');
    const FINDINGS = [
      ['signed URL in .env', 'a.env', `${TOKEN_NAME}=https://download.internal/file?sig=${V}`],
      ['X-Amz-Signature in .env', 'a.env', `${TOKEN_NAME}=https://download.internal/file?X-Amz-Signature=${V}`],
      ['access_token query in .env', 'a.env', `${TOKEN_NAME}=https://api.internal/v1/export?access_token=${V}`],
      ['webhook path token in .env', 'a.env', `WEBHOOK_TOKEN=https://hooks.example.net/services/${V}`],
      ['signed URL as a JSON value', 'a.json', `{"${TOKEN_NAME}":"https://download.internal/file?sig=${V}"}`],
      ['signed URL as a YAML value', 'a.yaml', `${TOKEN_NAME.toLowerCase()}: https://download.internal/file?sig=${V}`],
      ['signed URL as a quoted YAML value', 'a.yaml', `${TOKEN_NAME.toLowerCase()}: "https://download.internal/file?sig=${V}"`],
      ['Slack webhook as a YAML value', 'a.yaml', `slack_webhook_secret: "https://hooks.slack.com/services/T0AAAAAAA/B0AAAAAAA/${V}"`],
      ['Discord webhook under a strong name', 'a.env', `DISCORD_WEBHOOK_SECRET=https://discord.com/api/webhooks/123456789012/${V}${V}`],
      ['token as the user name of a URL', 'a.env', `${TOKEN_NAME}=https://${V}@api.internal/v1`],
    ];
    it.each(FINDINGS)('reports: %s', (_label, file, text) => {
      expect(rules(file, `${text}\n`)).toContain('secret-assignment');
    });

    it.each([
      ['Slack', `https://hooks.slack.com/services/T0AAAAAAA/B0AAAAAAA/${V}`],
      ['Discord', `https://discord.com/api/webhooks/123456789012/${V}${V}`],
      ['Zapier', `https://hooks.zapier.com/hooks/catch/123456/${V.slice(0, 10)}`],
    ])('a bare %s webhook URL in Markdown is a finding of its own', (_label, url) => {
      expect(rules('a.md', `${url}\n`)).toContain('webhook-url');
    });

    it.each([
      ['a plain endpoint', `${TOKEN_NAME}=https://api.internal/v1/tokens`],
      ['an endpoint with an id and a template', `${TOKEN_NAME}=https://api.internal/v1/users/{userId}/tokens`],
      ['a weak name with a signed URL', `TOKEN_URL=https://download.internal/file?sig=${V}`],
      ['a weak name, endpoint', 'TOKEN_ENDPOINT=https://auth.example.net/oauth/token'],
      ['a page and a language', `${TOKEN_NAME}=https://docs.internal/guide?lang=en&page=2`],
    ])('does not report %s', (_label, text) => {
      expect(rules('a.env', `${text}\n`)).toEqual([]);
    });
  });

  describe('(low) webhook and signed-URL shapes', () => {
    it('a PagerDuty integration URL under a strong name is a finding; a placeholder one is not', () => {
      const key = randomString(32, 811, HEX);
      expect(rules('a.env', `PAGERDUTY_TOKEN=https://events.pagerduty.com/integration/${key}/enqueue\n`)).toContain('secret-assignment');
      expect(rules('a.md', `curl https://events.pagerduty.com/integration/${key}/enqueue\n`)).toContain('webhook-url');
      expect(rules('a.md', 'curl https://events.pagerduty.com/integration/<integration-key>/enqueue\n')).toEqual([]);
    });

    it('a percent-encoded character in a Slack webhook token does not hide it', () => {
      expect(rules('a.env', `WEBHOOK_TOKEN=https://hooks.slack.com/services/T0AAAAAAA/B0AAAAAAA/%41${V}\n`)).not.toEqual([]);
      expect(rules('a.md', `https://hooks.slack.com/services/T0AAAAAAA/B0AAAAAAA/%41${V}\n`)).toContain('webhook-url');
    });

    it('weak names keep the endpoint exemption (a signed URL under TOKEN_URL is an address by design)', () => {
      expect(rules('a.env', `TOKEN_URL=https://x.com/dl?X-Amz-Signature=${randomString(40, 812, HEX)}\n`)).toEqual([]);
      expect(rules('a.env', 'TOKEN_ENDPOINT=https://auth.example.net/oauth/token\n')).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// Skip list and decoding
// ---------------------------------------------------------------------------

// A tracked file NAME is attacker-controlled (a pull request can add any name), and the scanner classifies every
// path with regexes. CodeQL (js/redos) found one whose separator and segment classes overlapped: 'i18n-' plus
// '--' x 22 took 10 to 16 s and doubled with every repeat. The content-based hostile-input tests above never
// exercised this because they vary the file TEXT, not the file PATH.
describe('hostile file paths are classified in linear time', () => {
  // A backtracking regex blocks the JS thread, so Vitest's own timeout cannot interrupt it: if this bug ever came
  // back, an in-process test would hang CI instead of failing. The hostile scans therefore run in a child process
  // with a hard kill timeout, and the test fails cleanly (status null, signal SIGTERM) if the child is killed.
  const CHILD_KILL_MS = 30_000;
  const HOSTILE_PATH_LIMIT_MS = 2000;
  const runHostile = (script) =>
    spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: CHILD_KILL_MS,
    });
  const SCAN_IMPORT = `import { scanText } from ${JSON.stringify(pathToFileURL(SCANNER).href)};`;

  it('the exact CodeQL shapes finish at once (each doubled per repeat before the fix)', SLOW, () => {
    const result = runHostile(`${SCAN_IMPORT}
      const body = 'MSG_TOKEN="This is the way."\\n';
      const makers = [
        (n) => 'i18n-' + '--'.repeat(n) + '!.json',
        (n) => 'messages' + '__'.repeat(n) + '!.json',
        (n) => 'errors' + '_-'.repeat(n) + '!.yaml',
      ];
      const started = performance.now();
      for (const make of makers) { scanText(make(40), body); scanText(make(200), body); }
      console.log(Math.round(performance.now() - started));`);
    expect(result.error, 'the child was killed: a path regex is backtracking').toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(Number(result.stdout.trim())).toBeLessThan(HOSTILE_PATH_LIMIT_MS);
  });

  it('no known path shape backtracks: 3 KB paths built from every name, repeat unit and ending', SLOW, () => {
    const result = runHostile(`${SCAN_IMPORT}
      const body = 'MSG_TOKEN="This is the way."\\n';
      const names = ['netrc', '.netrc', '_netrc', 'pgpass', '.pgpass', '.npmrc', '.yarnrc', '.pypirc', 'credentials',
        'config', 'docker-config', 'kubeconfig', 'htpasswd', '.htpasswd', 'my.cnf', '.s3cfg', 'id_rsa', 'messages',
        'errors', 'strings', 'en', 'locales', 'i18n', 'l10n', 'translations', '.env', 'secrets', 'terraform',
        '.git-credentials', '.curlrc', '.wgetrc', '.vault-token', 'docs/API'];
      const units = ['-', '_', '.', '--', '__', '..', '-_', '_-', '.-', '-.', ' ', 'a-', '.a', 'a_', '/', '/.'];
      let worst = 0; let where = '';
      for (const name of names) for (const unit of units) for (const tail of ['!', '.json', '/x.json']) {
        const hostile = name + unit.repeat(Math.floor(3000 / unit.length)) + tail;
        const started = performance.now(); scanText(hostile, body); const took = performance.now() - started;
        if (took > worst) { worst = took; where = name + ' + ' + JSON.stringify(unit) + ' + ' + tail; }
      }
      console.log(JSON.stringify({ worst: Math.round(worst), where }));`);
    expect(result.error, 'the child was killed: a path regex is backtracking').toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const { worst, where } = JSON.parse(result.stdout.trim());
    expect(worst, `slowest hostile path: ${where}`).toBeLessThan(HOSTILE_PATH_LIMIT_MS);
  });

  it('ordinary message-catalog file names are still recognised after the fix', () => {
    const body = 'MSG_TOKEN="This is the way."\n';
    // A sentence under a token-like name is only exempt inside a message catalog.
    for (const file of [
      'src/messages.en.json', 'errors_en-US.json', 'strings-fr.xml', 'en.json', 'pt-BR.json', 'locales/de/app.json',
      'translations.es.yaml', 'i18n.zh-Hans.json',
    ]) {
      expect(scanText(file, body), file).toEqual([]);
    }
    // Same text in an ordinary config file is still a finding.
    for (const file of ['config.json', 'app.env', 'settings.yaml']) {
      expect(scanText(file, body).length, file).toBeGreaterThan(0);
    }
  });
});

describe('shouldSkipPath', () => {
  it.each([
    'package-lock.json',
    'app/package-lock.json',
    'server/package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'Cargo.lock',
    'go.sum',
  ])('skips the lockfile %s', (p) => {
    expect(shouldSkipPath(p)).toBe(true);
  });

  it.each([
    'app/.env.production',
    'server/server.js',
    'scripts/check-secrets.mjs',
    THIS_FILE_REL,
    'docs/API.md',
    '.claude/settings.json',
    '.claude/skills/tdd/SKILL.md',
    'app/package.json',
    'app/public/logo.png',
    'research/paper.pdf',
    'fonts/x.woff2',
    'secrets.lock',
    'notes/my.lock',
  ])('does not skip %s (content decides, not name or extension)', (p) => {
    expect(shouldSkipPath(p)).toBe(false);
  });
});

describe('decodeText', () => {
  const text = 'A=1\r\nAPI_KEY=abcdef\r\n';

  it('reads UTF-8, with or without a BOM', () => {
    expect(decodeText(Buffer.from(text))).toBe(text);
    expect(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]))).toBe(text);
  });

  it('decodes UTF-16LE and UTF-16BE with a BOM instead of calling them binary', () => {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    expect(decodeText(le)).toBe(text);
    const be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()]);
    expect(decodeText(be)).toBe(text);
  });

  it('decodes BOM-less UTF-16 of ASCII text', () => {
    expect(decodeText(Buffer.from(text, 'utf16le'))).toBe(text);
    expect(decodeText(Buffer.from(text, 'utf16le').swap16())).toBe(text);
  });

  it('still calls real binary content binary', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]), Buffer.alloc(200, 0)]);
    expect(decodeText(png)).toBeNull();
    // ...but a NUL alone is not proof: without a known binary signature the bytes are decoded, NULs removed.
    expect(decodeText(Buffer.from([1, 2, 0, 3, 0, 0, 9, 8, 0, 7, 0, 0, 1]))).toBe('\u0001\u0002\u0003\u0009\u0008\u0007\u0001');
  });

  it('a stray NUL does not make a text file binary, wherever it sits', () => {
    expect(decodeText(Buffer.from(`\0${text}`))).toBe(text);
    expect(decodeText(Buffer.from(`${text}\0`))).toBe(text);
    expect(decodeText(Buffer.from(`API_\0KEY=abcdef\n`))).toBe('API_KEY=abcdef\n');
    expect(isBinaryContent(Buffer.from(`\0${text}`))).toBe(false);
    expect(isBinaryContent(PNG_HEAD)).toBe(true);
  });

  it('decodes UTF-32 with a BOM and without one (LE and BE)', () => {
    const codepoints = [...text].map((c) => c.codePointAt(0));
    const le = Buffer.alloc(codepoints.length * 4);
    const be = Buffer.alloc(codepoints.length * 4);
    codepoints.forEach((cp, i) => {
      le.writeUInt32LE(cp, i * 4);
      be.writeUInt32BE(cp, i * 4);
    });
    expect(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe, 0, 0]), le]))).toBe(text);
    expect(decodeText(Buffer.concat([Buffer.from([0, 0, 0xfe, 0xff]), be]))).toBe(text);
    expect(decodeText(le)).toBe(text);
    expect(decodeText(be)).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// Self-check and the real repository
// ---------------------------------------------------------------------------

describe('this repository', () => {
  it('the scanner and its own test file scan clean', () => {
    const scanner = readFileSync(SCANNER, 'utf8');
    const self = readFileSync(THIS_FILE, 'utf8');
    expect(scanText('scripts/check-secrets.mjs', scanner)).toEqual([]);
    expect(scanText(THIS_FILE_REL, self)).toEqual([]);
  });

  const inGitRepo = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: REPO_ROOT }).status === 0;

  it.skipIf(!inGitRepo)('a full-tree run exits 0 from the repo root', SLOW, () => {
    const result = spawnSync(process.execPath, ['scripts/check-secrets.mjs'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(/^check-secrets: OK \(\d+ files scanned, \d+ skipped/);
    expect(result.status).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CLI behavior in throwaway git repositories
// ---------------------------------------------------------------------------

describe('CLI', () => {
  const dirs = [];
  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
  });

  const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  const scan = (cwd, ...args) => run(process.execPath, [SCANNER, ...args], cwd);
  const git = (cwd, ...args) =>
    run('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], cwd);
  const commit = (cwd, message) => git(cwd, 'commit', '-q', '-m', message);

  function makeRepo() {
    const dir = mkdtempSync(path.join(tmpdir(), 'check-secrets-'));
    dirs.push(dir);
    expect(run('git', ['init', '-q'], dir).status).toBe(0);
    return dir;
  }

  const write = (dir, file, content) => {
    const target = path.join(dir, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  };

  const secret = randomString(32, 61);
  const assignment = `${['API_', 'KEY'].join('')}=${secret}\n`;

  // A text file just over the 5 MB limit, built cheaply: 1 KB lines (few lines keep git's diff and our parser fast), no
  // per-line loop, `first` at the start. Never build these from millions of tiny lines.
  const OVER_LIMIT_LINES = 5 * 1024 + 8;
  const overLimitText = (first = '') => `${first}${`${'x'.repeat(1023)}\n`.repeat(OVER_LIMIT_LINES)}`;

  it.skipIf(!hasGit())('reports path, line and rule, exits 1, and leaks nothing', SLOW, () => {
    const dir = makeRepo();
    write(dir, '.env', `FOO=1\n${assignment}`);
    write(dir, 'README.md', 'nothing here\n');
    // Skipped on purpose: lockfile and real binary content.
    write(dir, 'package-lock.json', assignment);
    write(dir, 'blob.dat', Buffer.concat([PNG_HEAD, Buffer.from(assignment)]));
    run('git', ['add', '-A'], dir);

    const result = scan(dir);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('.env:2  secret-assignment');
    for (const piece of windows(secret)) expect(output).not.toContain(piece);
    expect(output).not.toContain('package-lock.json');
    expect(output).not.toContain('blob.dat');
    expect(output).not.toContain('README.md');
  });

  it.skipIf(!hasGit())('scans skill files, *.lock files and text files with a binary-looking extension', SLOW, () => {
    const dir = makeRepo();
    const awsKey = (seed) => ['AKIA', randomString(16, seed, UPPER_ALNUM)].join('');
    write(dir, '.claude/skills/x/SKILL.md', `${awsKey(62)}\n`);
    write(dir, 'deps.lock', `${awsKey(63)}\n`);
    write(dir, 'logo.png', `${awsKey(64)}\n`);
    run('git', ['add', '-A'], dir);
    const result = scan(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('.claude/skills/x/SKILL.md:1  aws-access-key-id');
    expect(result.stderr).toContain('deps.lock:1  aws-access-key-id');
    expect(result.stderr).toContain('logo.png:1  aws-access-key-id');
  });

  it.skipIf(!hasGit())('scans UTF-16 files (a Windows PowerShell redirect writes UTF-16LE with a BOM)', SLOW, () => {
    const dir = makeRepo();
    writeFileSync(path.join(dir, 'win.env'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`A=1\r\n${assignment}`, 'utf16le')]));
    run('git', ['add', '-A'], dir);
    const result = scan(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('win.env:2  secret-assignment');
  });

  it.skipIf(!hasGit())('says how many files were skipped and why', SLOW, () => {
    const dir = makeRepo();
    write(dir, 'package-lock.json', '{}\n');
    write(dir, 'blob.dat', Buffer.concat([PNG_HEAD, Buffer.from('binary\n')]));
    write(dir, 'src/app.js', 'export const x = 1;\n');
    run('git', ['add', '-A'], dir);
    const result = scan(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/1 files scanned, 2 skipped: /);
    expect(result.stdout).toContain('1 lockfile');
    expect(result.stdout).toContain('1 binary');
  });

  it.skipIf(!hasGit())('fails, and names the file, when a text file is too large to scan', SLOW, () => {
    const dir = makeRepo();
    write(dir, 'data/big.json', overLimitText());
    write(dir, 'data/big.bin', Buffer.concat([PNG_HEAD, Buffer.alloc(5 * 1024 * 1024 + 4096, 0)]));
    run('git', ['add', '-A'], dir);
    const result = scan(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('NOT scanned');
    expect(result.stderr).toContain('data/big.json');
    expect(result.stderr).not.toContain('data/big.bin');
  });

  it.skipIf(!hasGit())('exits 0 on a clean repository and scans from a subdirectory', SLOW, () => {
    const dir = makeRepo();
    write(dir, '.env.example', 'API_KEY=your_api_key_here\n');
    write(dir, 'src/app.js', 'export const x = 1;\n');
    run('git', ['add', '-A'], dir);
    expect(scan(dir).status).toBe(0);
    expect(scan(path.join(dir, 'src')).status).toBe(0);

    write(dir, '.env', assignment);
    run('git', ['add', '-A'], dir);
    expect(scan(path.join(dir, 'src')).status).toBe(1);
  });

  it.skipIf(!hasGit())('does not scan untracked files (tracked files only)', SLOW, () => {
    const dir = makeRepo();
    write(dir, 'tracked.txt', 'ok\n');
    run('git', ['add', '-A'], dir);
    write(dir, '.env', assignment);
    expect(scan(dir).status).toBe(0);
  });

  it.skipIf(!hasGit())('honors the inline allow marker', SLOW, () => {
    const dir = makeRepo();
    write(dir, '.env', `${assignment.trimEnd()} # check-secrets:allow\n`);
    run('git', ['add', '-A'], dir);
    expect(scan(dir).status).toBe(0);
  });

  it.skipIf(!hasGit())('--history finds a removed secret, prints only commit/path/rule/count', SLOW, () => {
    const dir = makeRepo();
    write(dir, '.env', assignment);
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'add config').status).toBe(0);
    const leakingCommit = run('git', ['rev-parse', '--short=7', 'HEAD'], dir).stdout.trim();

    write(dir, '.env', 'API_KEY=your_api_key_here\n');
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'remove secret').status).toBe(0);
    const cleanCommit = run('git', ['rev-parse', '--short=7', 'HEAD'], dir).stdout.trim();

    // The current tree is clean...
    expect(scan(dir).status).toBe(0);
    // ...but history is not.
    const result = scan(dir, '--history');
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${leakingCommit}  .env  secret-assignment  x1`);
    expect(result.stderr).not.toContain(cleanCommit);
    for (const piece of windows(secret)) expect(output).not.toContain(piece);
  });

  it.skipIf(!hasGit())('--history works in a bare mirror clone', SLOW, () => {
    const dir = makeRepo();
    write(dir, '.env', assignment);
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'add config').status).toBe(0);
    const mirror = mkdtempSync(path.join(tmpdir(), 'check-secrets-mirror-'));
    dirs.push(mirror);
    expect(run('git', ['clone', '-q', '--mirror', dir, mirror], tmpdir()).status).toBe(0);
    const result = scan(mirror, '--history');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('.env  secret-assignment  x1');
    // Tree mode needs a work tree and says so instead of crashing.
    expect(scan(mirror).status).toBe(2);
  });

  it.skipIf(!hasGit())('--history exits 0 when no commit ever added a secret, and in an empty repository', SLOW, () => {
    const dir = makeRepo();
    expect(scan(dir, '--history').status).toBe(0);
    write(dir, '.env.example', 'API_KEY=your_api_key_here\n');
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'add template').status).toBe(0);
    const result = scan(dir, '--history');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no hits in 1 commits');
  });

  it.skipIf(!hasGit())('--history fails (exit 2) instead of reporting "no hits" when git log itself fails', SLOW, () => {
    const dir = makeRepo();
    write(dir, '.env.example', 'API_KEY=your_api_key_here\n');
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'add template').status).toBe(0);
    const head = run('git', ['rev-parse', 'HEAD'], dir).stdout.trim();
    rmSync(path.join(dir, '.git', 'objects', head.slice(0, 2), head.slice(2)), { force: true });
    const result = scan(dir, '--history');
    expect(result.status).toBe(2);
    expect(result.stdout).not.toContain('no hits');
    expect(result.stderr).toContain('git log failed');
  });

  it.skipIf(!hasGit())('--history reads a line that follows a lone carriage return', SLOW, () => {
    const dir = makeRepo();
    write(dir, 'lonecr.env', `A=1\r${assignment.replace(/\n/g, '\r')}`);
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'cr').status).toBe(0);
    expect(scan(dir).stderr).toContain('lonecr.env:1  secret-assignment');
    expect(scan(dir, '--history').stderr).toContain('lonecr.env  secret-assignment  x1');
  });

  it.skipIf(!hasGit())('--history reads UTF-16 files that git shows as binary', SLOW, () => {
    const dir = makeRepo();
    writeFileSync(path.join(dir, 'win.env'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`A=1\r\n${assignment}`, 'utf16le')]));
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'utf16').status).toBe(0);
    expect(scan(dir, '--history').stderr).toContain('win.env  secret-assignment  x1');
  });

  it.skipIf(!hasGit())('--history scans a secret that only a merge conflict resolution introduced', SLOW, () => {
    const dir = makeRepo();
    write(dir, '.env', 'A=1\nCONF=base\n');
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'base').status).toBe(0);
    const trunk = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], dir).stdout.trim();
    git(dir, 'checkout', '-q', '-b', 'feature');
    write(dir, '.env', 'A=1\nCONF=feature\n');
    expect(git(dir, 'commit', '-q', '-am', 'feature').status).toBe(0);
    git(dir, 'checkout', '-q', trunk);
    write(dir, '.env', 'A=1\nCONF=trunk\n');
    expect(git(dir, 'commit', '-q', '-am', 'trunk').status).toBe(0);
    expect(git(dir, 'merge', 'feature').status).not.toBe(0); // conflict, resolved below
    write(dir, '.env', `A=1\n${assignment}`);
    git(dir, 'add', '-A');
    expect(commit(dir, 'merge').status).toBe(0);
    const merge = run('git', ['rev-parse', '--short=7', 'HEAD'], dir).stdout.trim();

    const result = scan(dir, '--history');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${merge}  .env  secret-assignment  x1`);
    // The parents' commits added nothing secret-like, so exactly one commit is reported.
    expect(result.stderr).toContain('in 1 of 4 commits');
    for (const piece of windows(secret)) expect(`${result.stdout}${result.stderr}`).not.toContain(piece);
  });

  it.skipIf(!hasGit())('--history catches a value added on its own line under an unchanged secret-like name', SLOW, () => {
    const dir = makeRepo();
    const name = ['JWT_', 'SECRET'].join('');
    const value = randomString(24, 74);
    const manifest = (v) => `env:\n  - name: ${name}\n    value: ${v}\n  - name: PORT\n    value: "3000"\n`;
    write(dir, 'deploy.yaml', manifest('changeme'));
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'add manifest').status).toBe(0);
    write(dir, 'deploy.yaml', manifest(value));
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'leak').status).toBe(0);
    const leakingCommit = run('git', ['rev-parse', '--short=7', 'HEAD'], dir).stdout.trim();
    write(dir, 'deploy.yaml', manifest('changeme'));
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'remove').status).toBe(0);
    const cleanCommit = run('git', ['rev-parse', '--short=7', 'HEAD'], dir).stdout.trim();

    expect(scan(dir).status).toBe(0);
    const result = scan(dir, '--history');
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${leakingCommit}  deploy.yaml  secret-name-value-pair  x1`);
    expect(result.stderr).toContain('in 1 of 3 commits');
    expect(result.stderr).not.toContain(cleanCommit);
    for (const piece of windows(value)) expect(output).not.toContain(piece);
  });

  it.skipIf(!hasGit())('--history does not blame a later commit for an old value that only appears as context', SLOW, () => {
    const dir = makeRepo();
    const name = ['JWT_', 'SECRET'].join('');
    const value = randomString(24, 75);
    write(dir, 'deploy.yaml', `- name: ${name}\n  value: ${value}\nport: 3000\n`);
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'leak').status).toBe(0);
    const leakingCommit = run('git', ['rev-parse', '--short=7', 'HEAD'], dir).stdout.trim();
    // Only the line right under the pair changes; the pair stays as unchanged context inside the same hunk.
    write(dir, 'deploy.yaml', `- name: ${name}\n  value: ${value}\nport: 8080\n`);
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'change port').status).toBe(0);
    const laterCommit = run('git', ['rev-parse', '--short=7', 'HEAD'], dir).stdout.trim();
    const result = scan(dir, '--history');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(leakingCommit);
    expect(result.stderr).not.toContain(laterCommit);
    expect(result.stderr).toContain('in 1 of 2 commits');
  });

  it.skipIf(!hasGit())('--history reads a path that git C-quotes (a double quote in the name) in the right file mode', SLOW, () => {
    const dir = makeRepo();
    const token = randomString(16, 92);
    mkdirSync(path.join(dir, 'we"ird'), { recursive: true });
    write(dir, 'we"ird/a.env', `${['JWT_', 'SECRET'].join('')}=${token}\n`);
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'quoted path').status).toBe(0);
    const result = scan(dir, '--history');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('secret-assignment');
    for (const piece of windows(token)) expect(`${result.stdout}${result.stderr}`).not.toContain(piece);
  });

  it.skipIf(!hasGit())('--history finds a block scalar value added under an unchanged key', SLOW, () => {
    const dir = makeRepo();
    const key = ['jwt_', 'secret'].join('');
    const token = randomString(32, 93);
    write(dir, 'c.yml', `${key}: >-\n  changeme\n`);
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'a').status).toBe(0);
    write(dir, 'c.yml', `${key}: >-\n  ${token}\n`);
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'leak').status).toBe(0);
    const result = scan(dir, '--history');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('c.yml  secret-assignment  x1');
    expect(result.stderr).toContain('in 1 of 2 commits');
  });

  it.skipIf(!hasGit())('--history exits 0 when the split configuration never held a real value', SLOW, () => {
    const dir = makeRepo();
    const name = ['JWT_', 'SECRET'].join('');
    const manifest = (v) => `env:\n  - name: ${name}\n    value: ${v}\n`;
    for (const [v, message] of [['changeme', 'a'], ['your_jwt_secret_here', 'b'], ['changeme', 'c']]) {
      write(dir, 'deploy.yaml', manifest(v));
      run('git', ['add', '-A'], dir);
      expect(commit(dir, message).status).toBe(0);
    }
    const result = scan(dir, '--history');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no hits in 3 commits');
  });


  // ---- review round 5: nothing tracked may go unexamined ----

  const RAW_NAME = Buffer.concat([Buffer.from('bad-'), Buffer.from([0xff]), Buffer.from('.env')]);
  const rawPath = (dir) => Buffer.concat([Buffer.from(`${dir}${path.sep}`), RAW_NAME]);
  const canCreateRawName = (() => {
    const probe = mkdtempSync(path.join(tmpdir(), 'check-secrets-probe-'));
    try {
      writeFileSync(rawPath(probe), 'x');
      return true;
    } catch {
      return false;
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
  })();
  const RAW_SKIP_REASON = 'this file system cannot create a file name that is not valid UTF-8';

  it.skipIf(!hasGit() || !canCreateRawName)(`scans a tracked file whose name is not valid UTF-8 (${RAW_SKIP_REASON})`, SLOW, () => {
    const dir = makeRepo();
    writeFileSync(rawPath(dir), assignment);
    run('git', ['add', '-A'], dir);
    const result = scan(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(':1  secret-assignment');
    expect(result.stderr).toContain('bad-\\xff.env');
    expect(result.stdout).not.toContain('OK');
  });

  it.skipIf(!hasGit() || !canCreateRawName)(`a clean non-UTF-8 file name is counted as scanned, not skipped (${RAW_SKIP_REASON})`, SLOW, () => {
    const dir = makeRepo();
    writeFileSync(rawPath(dir), 'A=1\n');
    run('git', ['add', '-A'], dir);
    const result = scan(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/1 files scanned, 0 skipped/);
  });

  it.skipIf(!hasGit())('fails, and names the count, when a tracked file exists but cannot be read (here: a directory took its place)', SLOW, () => {
    const dir = makeRepo();
    write(dir, 'config.env', assignment);
    write(dir, 'ok.js', 'export const x = 1;\n');
    run('git', ['add', '-A'], dir);
    rmSync(path.join(dir, 'config.env'));
    mkdirSync(path.join(dir, 'config.env'));
    const result = scan(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('1 tracked file could NOT be read');
    expect(result.stderr).toContain('config.env');
    expect(result.stdout).not.toContain('OK');
  });

  it.skipIf(!hasGit())('a tracked file that is deleted in the working tree is scanned from the index, so a staged secret still fails', SLOW, () => {
    const dir = makeRepo();
    write(dir, 'gone.env', assignment);
    run('git', ['add', '-A'], dir);
    rmSync(path.join(dir, 'gone.env'));
    const result = scan(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('gone.env:1  secret-assignment');
  });

  it.skipIf(!hasGit())('a clean deleted-but-listed file passes and the summary says it came from the index', SLOW, () => {
    const dir = makeRepo();
    write(dir, 'gone.env', 'A=1\n');
    write(dir, 'kept.js', 'export const x = 1;\n');
    run('git', ['add', '-A'], dir);
    rmSync(path.join(dir, 'gone.env'));
    const result = scan(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('2 files scanned');
    expect(result.stdout).toContain('1 missing from the working tree and scanned from the index');
  });

  it.skipIf(!hasGit() || process.platform === 'win32')('scans the target text of a tracked symlink instead of skipping it', SLOW, () => {
    const dir = makeRepo();
    symlinkSync(assignment.trim(), path.join(dir, 'link.env'));
    run('git', ['add', '-A'], dir);
    const result = scan(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('link.env:1  secret-assignment');
  });

  it('the unreadable report names the count and paths only', () => {
    const report = formatUnreadableReport(['a.env', 'b.env']);
    expect(report).toContain('2 tracked files could NOT be read');
    expect(report).toContain('  b.env');
  });

  function makeBigVersionRepo() {
    const dir = makeRepo();
    write(dir, 'big.env', overLimitText(assignment)); // just over 5 MB, secret on line 1
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'add big file').status).toBe(0);
    write(dir, 'big.env', 'X=1\n');
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'shrink it').status).toBe(0);
    return dir;
  }

  it.skipIf(!hasGit())('--history is NOT clean (exit 2, no "no hits") when an added version was too large to scan', SLOW, () => {
    const dir = makeBigVersionRepo();
    const result = scan(dir, '--history');
    expect(result.status).toBe(2);
    expect(`${result.stdout}${result.stderr}`).not.toContain('no hits');
    expect(result.stderr).toContain('INCOMPLETE');
    expect(result.stderr).toContain('1 file version NOT scanned');
    expect(result.stderr).toContain('1 over the 5 MB limit');
  });

  it.skipIf(!hasGit())('--history still reports hits (exit 1) and the gap when both happen', SLOW, () => {
    const dir = makeBigVersionRepo();
    write(dir, '.env', assignment);
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'add config').status).toBe(0);
    const result = scan(dir, '--history');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('.env  secret-assignment  x1');
    expect(result.stderr).toContain('NOT scanned');
  });

  it.skipIf(!hasGit())('--history on a shallow clone is incomplete (exit 2), not "no hits"', SLOW, () => {
    const source = makeRepo();
    write(source, 'a.txt', 'one\n');
    run('git', ['add', '-A'], source);
    expect(commit(source, 'one').status).toBe(0);
    write(source, 'a.txt', 'two\n');
    run('git', ['add', '-A'], source);
    expect(commit(source, 'two').status).toBe(0);
    const shallow = path.join(source, '..', `${path.basename(source)}-shallow`);
    dirs.push(shallow);
    expect(run('git', ['clone', '-q', '--depth=1', `file://${source}`, shallow], source).status).toBe(0);
    const result = scan(shallow, '--history');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('shallow clone');
    expect(`${result.stdout}${result.stderr}`).not.toContain('no hits');
  });

  it('the history report counts versions that were not scanned', () => {
    const report = formatHistoryReport([{ commit: 'a'.repeat(40), path: '.env', rule: 'jwt-token', count: 1 }], {
      commits: 3,
      oversize: 1,
      unscanned: 2,
    });
    expect(report).toContain('2 file versions NOT scanned (1 over the 5 MB limit)');
  });

  const utf32 = (text, { bom = false, littleEndian = true } = {}) => {
    const cps = [...text].map((c) => c.codePointAt(0));
    const out = Buffer.alloc(cps.length * 4);
    cps.forEach((cp, i) => (littleEndian ? out.writeUInt32LE(cp, i * 4) : out.writeUInt32BE(cp, i * 4)));
    const mark = littleEndian ? [0xff, 0xfe, 0, 0] : [0, 0, 0xfe, 0xff];
    return bom ? Buffer.concat([Buffer.from(mark), out]) : out;
  };

  it.skipIf(!hasGit())('a stray NUL byte does not exempt a text file (before or after the secret)', SLOW, () => {
    for (const content of [`\0${assignment}`, `${assignment}\0`, `FOO=1\n\0\n${assignment}`]) {
      const dir = makeRepo();
      write(dir, '.env', content);
      run('git', ['add', '-A'], dir);
      const result = scan(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('.env:');
      expect(result.stdout).not.toContain('OK');
    }
  });

  it.skipIf(!hasGit())('scans UTF-32 files with and without a BOM', SLOW, () => {
    for (const options of [{ bom: true }, { bom: true, littleEndian: false }, {}, { littleEndian: false }]) {
      const dir = makeRepo();
      write(dir, '.env', utf32(assignment, options));
      run('git', ['add', '-A'], dir);
      const result = scan(dir);
      expect(result.status, JSON.stringify(options)).toBe(1);
      expect(result.stderr).toContain('.env:1  secret-assignment');
    }
  });

  it.skipIf(!hasGit())('an over-limit file with a NUL near the start is reported as oversize, not skipped as binary', SLOW, () => {
    const dir = makeRepo();
    write(dir, 'big.env', overLimitText(`\0${assignment}`));
    run('git', ['add', '-A'], dir);
    const result = scan(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('big.env');
    expect(result.stderr).toContain('NOT scanned');
  });

  // -------------------------------------------------------------------------
  // Review round 7 (finding 6): the staged (index) version and the working-tree version are both scanned.
  //
  // Class: the two versions of a tracked path can differ. Siblings: secret staged then swapped for a placeholder in
  // the working tree; secret only in the working tree; different secrets in each; several files where one differs;
  // an unmerged path (three stages) resolved to a placeholder in the working tree; an index blob over the size limit
  // under a small working-tree file; line-ending conversion (both versions clean); a deleted working-tree file; a
  // SHA-256 repository; identical versions (a CI checkout) cost nothing extra and print nothing extra.
  // -------------------------------------------------------------------------

  const placeholderLine = `${['API_', 'KEY'].join('')}=your_api_key_here\n`;

  it.skipIf(!hasGit())('scans a secret that is staged even when the working-tree file was swapped for a placeholder', SLOW, () => {
    const dir = makeRepo();
    write(dir, 'x.env', assignment);
    run('git', ['add', '-A'], dir);
    write(dir, 'x.env', placeholderLine);
    const result = scan(dir);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('x.env:1  secret-assignment  (index)');
    expect(result.stderr).not.toContain('(working tree)');
    for (const piece of windows(secret)) expect(output).not.toContain(piece);
  });

  it.skipIf(!hasGit())('scans a secret that exists only in the working tree, and says which version it was in', SLOW, () => {
    const dir = makeRepo();
    write(dir, 'x.env', placeholderLine);
    run('git', ['add', '-A'], dir);
    write(dir, 'x.env', assignment);
    const result = scan(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('x.env:1  secret-assignment  (working tree)');
    expect(result.stderr).not.toContain('(index)');
  });

  it.skipIf(!hasGit())('reports both versions when both hold a (different) secret', SLOW, () => {
    const dir = makeRepo();
    write(dir, 'x.env', assignment);
    run('git', ['add', '-A'], dir);
    write(dir, 'x.env', `${['API_', 'KEY'].join('')}=${randomString(32, 262)}\n`);
    const result = scan(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('x.env:1  secret-assignment  (index)');
    expect(result.stderr).toContain('x.env:1  secret-assignment  (working tree)');
  });

  it.skipIf(!hasGit())('an ordinary checkout (index and working tree identical) prints no version labels and no extra note', SLOW, () => {
    const dir = makeRepo();
    write(dir, 'a.env', placeholderLine);
    write(dir, 'src/app.js', 'export const x = 1;\n');
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'add').status).toBe(0);
    const clean = scan(dir);
    expect(clean.status).toBe(0);
    expect(clean.stdout).not.toContain('differs');
    write(dir, 'b.env', assignment);
    run('git', ['add', '-A'], dir);
    const dirty = scan(dir);
    expect(dirty.status).toBe(1);
    expect(dirty.stderr).toContain('b.env:1  secret-assignment');
    expect(dirty.stderr).not.toContain('(index)');
    expect(dirty.stderr).not.toContain('(working tree)');
  });

  it.skipIf(!hasGit())('finds the one staged secret among many files whose working-tree copies differ', SLOW, () => {
    const dir = makeRepo();
    for (let i = 0; i < 40; i += 1) write(dir, `cfg/f${i}.env`, i === 23 ? assignment : `A=${i}\n`);
    run('git', ['add', '-A'], dir);
    for (let i = 0; i < 40; i += 1) write(dir, `cfg/f${i}.env`, placeholderLine);
    const result = scan(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('1 potential secret found');
    expect(result.stderr).toContain('cfg/f23.env:1  secret-assignment  (index)');
  });

  it.skipIf(!hasGit())('says how many files differ when both versions are clean, and still exits 0', SLOW, () => {
    const dir = makeRepo();
    write(dir, 'x.env', 'A=1\n');
    run('git', ['add', '-A'], dir);
    write(dir, 'x.env', 'A=2\n');
    const result = scan(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1 with a staged version that differs from the working tree (both scanned)');
  });

  it.skipIf(!hasGit())('line-ending conversion alone (core.autocrlf) makes a file differ, and both versions scan clean', SLOW, () => {
    const dir = makeRepo();
    run('git', ['config', 'core.autocrlf', 'true'], dir);
    write(dir, 'x.env', 'A=1\r\nB=2\r\n');
    run('git', ['add', '-A'], dir);
    const result = scan(dir);
    expect(result.status).toBe(0);
  });

  it.skipIf(!hasGit())('a secret staged in a file that was then deleted from the working tree is still found (index only)', SLOW, () => {
    const dir = makeRepo();
    write(dir, 'gone.env', assignment);
    run('git', ['add', '-A'], dir);
    rmSync(path.join(dir, 'gone.env'));
    const result = scan(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('gone.env:1  secret-assignment  (index)');
  });

  it.skipIf(!hasGit())('an unmerged path is scanned in every stage, even when the working tree was resolved to a placeholder', SLOW, () => {
    const dir = makeRepo();
    write(dir, 'x.env', 'A=1\n');
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'base').status).toBe(0);
    run('git', ['checkout', '-q', '-b', 'other'], dir);
    write(dir, 'x.env', `A=3\n${assignment}`);
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'other side').status).toBe(0);
    run('git', ['checkout', '-q', '-'], dir);
    write(dir, 'x.env', 'A=2\n');
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'this side').status).toBe(0);
    expect(git(dir, 'merge', 'other').status).not.toBe(0); // conflict: stages 1, 2 and 3 are in the index
    write(dir, 'x.env', placeholderLine);
    const result = scan(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('x.env:2  secret-assignment  (index)');
  });

  it.skipIf(!hasGit())('an index blob over the size limit under a small working-tree file is reported, not skipped', SLOW, () => {
    const dir = makeRepo();
    write(dir, 'big.env', overLimitText(assignment));
    run('git', ['add', '-A'], dir);
    write(dir, 'big.env', 'A=1\n');
    const result = scan(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('NOT scanned');
    expect(result.stderr).toContain('big.env');
  });

  it.skipIf(!hasGit())('works in a SHA-256 repository (the blob id is computed with the repository hash)', SLOW, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'check-secrets-'));
    dirs.push(dir);
    if (run('git', ['init', '-q', '--object-format=sha256'], dir).status !== 0) return; // git older than 2.29
    write(dir, 'x.env', assignment);
    run('git', ['add', '-A'], dir);
    const staged = scan(dir);
    expect(staged.status).toBe(1);
    expect(staged.stderr).not.toContain('(index)'); // identical versions: no label
    write(dir, 'x.env', placeholderLine);
    const swapped = scan(dir);
    expect(swapped.status).toBe(1);
    expect(swapped.stderr).toContain('x.env:1  secret-assignment  (index)');
  });

  it('the report labels the version and still holds only path, line and rule', () => {
    const report = formatReport([
      { path: 'a.env', line: 3, rule: 'secret-assignment', source: 'index' },
      { path: 'a.env', line: 3, rule: 'secret-assignment', source: 'working tree' },
      { path: 'b.env', line: 1, rule: 'jwt-token' },
    ]);
    expect(report).toContain('  a.env:3  secret-assignment  (index)');
    expect(report).toContain('  a.env:3  secret-assignment  (working tree)');
    expect(report).toContain('  b.env:1  jwt-token\n');
  });

  it('--help exits 0 and unknown arguments exit 2', SLOW, () => {
    const help = scan(REPO_ROOT, '--help');
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('Usage');
    const bad = scan(REPO_ROOT, '--values');
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('unknown argument');
  });
});

function hasGit() {
  return spawnSync('git', ['--version']).status === 0;
}
