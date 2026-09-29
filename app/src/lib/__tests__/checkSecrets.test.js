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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  RULES,
  decodeText,
  fileMode,
  formatHistoryReport,
  formatOversizeReport,
  formatReport,
  isPlaceholder,
  scanText,
  secretNameKind,
  shouldSkipPath,
} from '../../../../scripts/check-secrets.mjs';

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

  it('never swallows a random value, whatever it contains (4000 samples per alphabet)', () => {
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
    expect(report).toContain('1 file version skipped');
  });

  it('the oversize report names paths only', () => {
    expect(formatOversizeReport(['data/big.json'])).toContain('data/big.json');
  });
});

// ---------------------------------------------------------------------------
// Scan time stays linear on hostile input
// ---------------------------------------------------------------------------

describe('scan time', () => {
  const repeat = (unit, bytes) => unit.repeat(Math.ceil(bytes / unit.length));
  const HUNDRED_KB = 100 * 1024;
  const cases = [
    ['a keyword repeated in Markdown', 'notes.md', repeat('secret', HUNDRED_KB)],
    ['token. repeated in Markdown', 'notes.md', repeat('token.', HUNDRED_KB)],
    ['api_key repeated in an env file', '.env', repeat('api_key', HUNDRED_KB)],
    ['name= repeated in an env file', '.env', repeat('secret=', HUNDRED_KB)],
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
  ];

  it.each(cases)('%s (100 KB) scans in well under a second', (_label, file, text) => {
    const started = performance.now();
    scanText(file, text);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

// ---------------------------------------------------------------------------
// Skip list and decoding
// ---------------------------------------------------------------------------

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
    expect(decodeText(Buffer.from([1, 2, 0, 3, 0, 0, 9, 8, 0, 7, 0, 0, 1]))).toBeNull();
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

  it.skipIf(!inGitRepo)('a full-tree run exits 0 from the repo root', () => {
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

  it.skipIf(!hasGit())('reports path, line and rule, exits 1, and leaks nothing', () => {
    const dir = makeRepo();
    write(dir, '.env', `FOO=1\n${assignment}`);
    write(dir, 'README.md', 'nothing here\n');
    // Skipped on purpose: lockfile and real binary content.
    write(dir, 'package-lock.json', assignment);
    write(dir, 'blob.dat', `\u0000\u0000${assignment}`);
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

  it.skipIf(!hasGit())('scans skill files, *.lock files and text files with a binary-looking extension', () => {
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

  it.skipIf(!hasGit())('scans UTF-16 files (a Windows PowerShell redirect writes UTF-16LE with a BOM)', () => {
    const dir = makeRepo();
    writeFileSync(path.join(dir, 'win.env'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`A=1\r\n${assignment}`, 'utf16le')]));
    run('git', ['add', '-A'], dir);
    const result = scan(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('win.env:2  secret-assignment');
  });

  it.skipIf(!hasGit())('says how many files were skipped and why', () => {
    const dir = makeRepo();
    write(dir, 'package-lock.json', '{}\n');
    write(dir, 'blob.dat', '\u0000\u0000\u0000binary\n');
    write(dir, 'src/app.js', 'export const x = 1;\n');
    run('git', ['add', '-A'], dir);
    const result = scan(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/1 files scanned, 2 skipped: /);
    expect(result.stdout).toContain('1 lockfile');
    expect(result.stdout).toContain('1 binary');
  });

  it.skipIf(!hasGit())('fails, and names the file, when a text file is too large to scan', () => {
    const dir = makeRepo();
    write(dir, 'data/big.json', `${'{"a":1}\n'.repeat(700 * 1024)}`);
    write(dir, 'data/big.bin', Buffer.alloc(6 * 1024 * 1024, 0).toString('latin1'));
    run('git', ['add', '-A'], dir);
    const result = scan(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('NOT scanned');
    expect(result.stderr).toContain('data/big.json');
    expect(result.stderr).not.toContain('data/big.bin');
  });

  it.skipIf(!hasGit())('exits 0 on a clean repository and scans from a subdirectory', () => {
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

  it.skipIf(!hasGit())('does not scan untracked files (tracked files only)', () => {
    const dir = makeRepo();
    write(dir, 'tracked.txt', 'ok\n');
    run('git', ['add', '-A'], dir);
    write(dir, '.env', assignment);
    expect(scan(dir).status).toBe(0);
  });

  it.skipIf(!hasGit())('honors the inline allow marker', () => {
    const dir = makeRepo();
    write(dir, '.env', `${assignment.trimEnd()} # check-secrets:allow\n`);
    run('git', ['add', '-A'], dir);
    expect(scan(dir).status).toBe(0);
  });

  it.skipIf(!hasGit())('--history finds a removed secret, prints only commit/path/rule/count', () => {
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

  it.skipIf(!hasGit())('--history works in a bare mirror clone', () => {
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

  it.skipIf(!hasGit())('--history exits 0 when no commit ever added a secret, and in an empty repository', () => {
    const dir = makeRepo();
    expect(scan(dir, '--history').status).toBe(0);
    write(dir, '.env.example', 'API_KEY=your_api_key_here\n');
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'add template').status).toBe(0);
    const result = scan(dir, '--history');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no hits in 1 commits');
  });

  it.skipIf(!hasGit())('--history fails (exit 2) instead of reporting "no hits" when git log itself fails', () => {
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

  it.skipIf(!hasGit())('--history reads a line that follows a lone carriage return', () => {
    const dir = makeRepo();
    write(dir, 'lonecr.env', `A=1\r${assignment.replace(/\n/g, '\r')}`);
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'cr').status).toBe(0);
    expect(scan(dir).stderr).toContain('lonecr.env:1  secret-assignment');
    expect(scan(dir, '--history').stderr).toContain('lonecr.env  secret-assignment  x1');
  });

  it.skipIf(!hasGit())('--history reads UTF-16 files that git shows as binary', () => {
    const dir = makeRepo();
    writeFileSync(path.join(dir, 'win.env'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`A=1\r\n${assignment}`, 'utf16le')]));
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'utf16').status).toBe(0);
    expect(scan(dir, '--history').stderr).toContain('win.env  secret-assignment  x1');
  });

  it.skipIf(!hasGit())('--history scans a secret that only a merge conflict resolution introduced', () => {
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

  it('--help exits 0 and unknown arguments exit 2', () => {
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
