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
  HISTORY_CONTEXT,
  isBinaryContent,
  isPlaceholder,
  scanText,
  secretNameKind,
  isLockfile,
  isXmlConfigPath,
  sanitizeLockfile,
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

// A backtracking regex blocks the JS thread, and Vitest's own timeout cannot interrupt it: an in-process hostile-input test
// would hang the worker instead of failing. Hostile scans therefore run in a child process with a hard kill timeout (the
// test then fails cleanly with a null status), and the child reports the time of each case.
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

// Provider token families, one entry per shape (review round 9). Each value is assembled at runtime from a prefix and
// generated characters, so this file holds no token-shaped literal. `rule` is the scanner rule that must report it.
const B64URL = `${ALNUM}_-`;
const PROVIDER_TOKENS = (() => {
  const r = (n, seed, alphabet = ALNUM) => randomString(n, seed, alphabet);
  const digits = (n, seed) => r(n, seed, DIGITS);
  return [
    ['slack-token', 'Slack app-level (xapp-)', () => ['xapp', '-1-A', digits(10, 1001), '-', digits(13, 1002), '-', r(64, 1003, HEX)].join('')],
    ['slack-token', 'Slack configuration (xoxe.xoxp-)', () => ['xoxe', '.xoxp-1-', r(120, 1004, `${ALNUM}-`)].join('')],
    ['slack-token', 'Slack refresh (xoxe-)', () => ['xoxe', '-1-', r(100, 1005, `${ALNUM}-`)].join('')],
    ['slack-token', 'Slack legacy workspace (xoxa-2)', () => ['xox', 'a-2-', digits(12, 1006), '-', r(24, 1007)].join('')],
    ['slack-token', 'Slack legacy (xoxr-)', () => ['xox', 'r-', digits(12, 1008), '-', r(24, 1009)].join('')],
    ['slack-token', 'Slack legacy (xoxo-)', () => ['xox', 'o-', digits(12, 1010), '-', digits(12, 1011), '-', digits(12, 1054), '-', r(32, 1055, HEX)].join('')],
    ['gitlab-token', 'GitLab personal (glpat-)', () => ['gl', 'pat-', r(26, 1012, B64URL)].join('')],
    ['gitlab-token', 'GitLab deploy (gldt-)', () => ['gl', 'dt-', r(26, 1013, B64URL)].join('')],
    ['gitlab-token', 'GitLab runner (glrt-)', () => ['gl', 'rt-', r(26, 1014, B64URL)].join('')],
    ['npm-token', 'npm (npm_)', () => ['npm', '_', r(36, 1015)].join('')],
    ['pypi-token', 'PyPI', () => ['pypi', '-AgEIcHlwaS5vcmc', r(70, 1016, B64URL)].join('')],
    ['stripe-webhook-secret', 'Stripe webhook secret', () => ['whsec', '_', r(32, 1017)].join('')],
    ['twilio-api-key', 'Twilio API key SID', () => ['S', 'K', r(32, 1018, HEX)].join('')],
    ['sendgrid-api-key', 'SendGrid', () => ['SG', '.', r(22, 1019, B64URL), '.', r(43, 1020, B64URL)].join('')],
    ['mailgun-api-key', 'Mailgun', () => ['key', '-', r(32, 1021, HEX)].join('')],
    ['shopify-token', 'Shopify admin (shpat_)', () => ['shp', 'at_', r(32, 1022, HEX)].join('')],
    ['shopify-token', 'Shopify custom app (shpca_)', () => ['shp', 'ca_', r(32, 1023, HEX)].join('')],
    ['shopify-token', 'Shopify partner (shppa_)', () => ['shp', 'pa_', r(32, 1024, HEX)].join('')],
    ['digitalocean-token', 'DigitalOcean (dop_v1_)', () => ['do', 'p_v1_', r(64, 1025, HEX)].join('')],
    ['huggingface-token', 'Hugging Face (hf_)', () => ['hf', '_', r(34, 1026)].join('')],
    ['openai-api-key', 'OpenAI project (sk-proj-)', () => ['sk', '-proj-', r(60, 1027, B64URL)].join('')],
    ['openai-api-key', 'OpenAI legacy (sk-)', () => ['sk', '-', r(48, 1028)].join('')],
    ['anthropic-api-key', 'Anthropic (sk-ant-)', () => ['sk', '-ant-api03-', r(80, 1029, B64URL)].join('')],
    ['google-oauth-secret', 'Google OAuth access token (ya29.)', () => ['ya', '29.', r(60, 1030, B64URL)].join('')],
    ['google-oauth-secret', 'Google OAuth client secret (GOCSPX-)', () => ['GOC', 'SPX-', r(28, 1031, B64URL)].join('')],
    ['azure-storage-key', 'Azure storage connection string', () => ['DefaultEndpointsProtocol=https;AccountName=acct;Account', 'Key=', r(86, 1032, BASE64), '==;EndpointSuffix=core.windows.net'].join(''), (t) => t.match(/Key=([^;]+)/)[1]],
    ['azure-storage-key', 'Azure SAS URL', () => ['https://acct.blob.core.windows.net/c/b?sv=2022-11-02&ss=b&srt=sco&sp=rl&se=2030-01-01T00%3A00%3A00Z&s', 'ig=', r(43, 1033), '%3D'].join(''), (t) => t.match(/sig=(.+)$/)[1]],
    ['heroku-api-key', 'Heroku authorization token (HRKU-)', () => ['HR', 'KU-', r(60, 1034, B64URL)].join('')],
    ['datadog-api-key', 'Datadog API key on a DD_API_KEY name', () => ['DD_API', '_KEY: "', r(32, 1035, HEX), '"'].join(''), (t) => t.slice(-33, -1)],
    ['sentry-token', 'Sentry org auth token (sntrys_)', () => ['sntr', 'ys_', r(60, 1036, B64URL)].join('')],
    ['sentry-token', 'Sentry DSN with its secret half', () => ['https://', r(32, 1037, HEX), ':', r(32, 1056, HEX), '@o123.ingest.sen', 'try.io/456'].join(''), (t) => t.slice(41, 73)],
    ['doppler-token', 'Doppler service token', () => ['dp', '.st.dev.', r(44, 1038)].join('')],
    ['vault-token', 'Vault service token (hvs.)', () => ['hv', 's.', r(90, 1039, B64URL)].join('')],
    ['linear-api-key', 'Linear (lin_api_)', () => ['lin', '_api_', r(40, 1040)].join('')],
    ['notion-token', 'Notion (ntn_)', () => ['nt', 'n_', r(46, 1041)].join('')],
    ['notion-token', 'Notion legacy (secret_)', () => ['sec', 'ret_', r(43, 1042)].join('')],
    ['atlassian-token', 'Atlassian API token (ATATT3)', () => ['AT', 'ATT3', r(70, 1043, `${ALNUM}_=-`)].join('')],
    ['telegram-bot-token', 'Telegram bot token', () => [digits(9, 1057), ':A', 'A', r(33, 1058, B64URL)].join('')],
    ['mapbox-secret-token', 'Mapbox secret token', () => ['sk', '.ey', 'J', r(40, 1059, B64URL), '.', r(22, 1060, B64URL)].join('')],
    ['square-token', 'Square access token (sq0atp-)', () => ['sq0', 'atp-', r(22, 1061, B64URL)].join('')],
    ['square-token', 'Square OAuth secret (sq0csp-)', () => ['sq0', 'csp-', r(43, 1062, B64URL)].join('')],
    ['firebase-fcm-server-key', 'Firebase FCM legacy server key', () => ['AAAA', r(7, 1063, B64URL), ':APA', '91b', r(140, 1064, B64URL)].join('')],
    ['newrelic-key', 'New Relic user key (NRAK-)', () => ['NR', 'AK-', r(27, 1065, UPPER_ALNUM)].join('')],
    ['newrelic-key', 'New Relic ingest key (NRII-)', () => ['NR', 'II-', r(32, 1066, B64URL)].join('')],
    ['cloudflare-token', 'Cloudflare API token (cfut_)', () => ['cf', 'ut_', r(48, 1067)].join('')],
    ['discord-bot-token', 'Discord bot token', () => ['M', r(24, 1068, B64URL), '.', r(6, 1069, B64URL), '.', r(30, 1070, B64URL), '7A'].join('')],
    ['other-provider-token', 'Databricks (dapi)', () => ['da', 'pi', r(32, 1044, HEX)].join('')],
    ['other-provider-token', 'Grafana service account (glsa_)', () => ['gl', 'sa_', r(32, 1045), '_', r(8, 1046, HEX)].join('')],
    ['other-provider-token', 'Supabase (sbp_)', () => ['sb', 'p_', r(40, 1047, HEX)].join('')],
    ['other-provider-token', 'PlanetScale', () => ['psc', 'ale_tkn_', r(40, 1048, B64URL)].join('')],
    ['other-provider-token', 'Docker Hub PAT', () => ['dckr', '_pat_', r(30, 1049, B64URL)].join('')],
    ['other-provider-token', 'RubyGems', () => ['ruby', 'gems_', r(48, 1050, HEX)].join('')],
    ['other-provider-token', 'Terraform Cloud', () => [r(14, 1051), '.atlas', 'v1.', r(70, 1052, B64URL)].join('')],
    ['other-provider-token', 'age secret key', () => ['AGE-SECRET', '-KEY-1', r(58, 1053, 'QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L')].join('')],
  ];
})();

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
    {
      name: 'token as the user name in a lockfile dependency URL',
      rule: 'lockfile-credential',
      path: 'package-lock.json',
      secret: dbPassword,
      text: `{"packages":{"node_modules/x":{"resolved":"https://${dbPassword}@registry.internal/x/-/x-1.0.0.tgz"}}}\n`,
    },
    ...PROVIDER_TOKENS.map(([rule, label, build, secretPart], index) => {
      const token = build();
      return { name: `provider token: ${label}`, rule, path: index % 2 ? 'notes/findings.md' : 'src/data.json', secret: secretPart ? secretPart(token) : token, text: `${index % 2 ? 'see ' : '{"note":"'}${token}${index % 2 ? '' : '"}'}\n` };
    }),
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
        'errors', 'strings', 'en', 'locales', 'res/values', 'settings.xml', 'pom.xml', 'strings.xml', 'package-lock.json', 'yarn.lock', 'Cargo.lock', 'go.sum', 'i18n', 'l10n', 'translations', '.env', 'secrets', 'terraform',
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

describe('isLockfile', () => {
  it.each([
    'package-lock.json',
    'app/package-lock.json',
    'server/package-lock.json',
    'npm-shrinkwrap.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'Cargo.lock',
    'Gemfile.lock',
    'poetry.lock',
    'composer.lock',
    'Pipfile.lock',
    'bun.lock',
    'go.sum',
  ])('%s is a lockfile (scanned with the lockfile rules, not skipped)', (p) => {
    expect(isLockfile(p)).toBe(true);
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
  ])('%s is scanned with every rule (content decides, not name or extension)', (p) => {
    expect(isLockfile(p)).toBe(false);
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
      timeout: SLOW_TEST_MS,
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

  const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: SLOW_TEST_MS });
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
    // Skipped on purpose: real binary content. A lockfile is scanned with the lockfile rules only, so a generic name=value
    // (which would be an integrity-hash false positive) is not reported there.
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
    expect(result.stdout).toMatch(/2 files scanned, 1 skipped: /);
    expect(result.stdout).not.toContain('lockfile'); // lockfiles are scanned now, not skipped
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


  // ---- review round 8: --history/--range context, size-limit wording, staged blob versus an oversize working copy ----

  // Class: a split name/value pair whose name and value are lines apart (the pair matcher reads YAML/config mappings up to
  // PAIR_YAML_LINES lines each way, and JSON/HCL/XML objects up to a few hundred characters). The history reader must keep
  // as much unchanged context as the matcher looks across, and blame the commit that added the VALUE line.
  const pairName = ['JWT_', 'SECRET'].join('');
  const filler = (count, make) => Array.from({ length: count }, (_, i) => make(i)).join('');
  const SPLIT_LAYOUTS = [
    ['a YAML item, value 10 lines below its name', 'deploy.yaml', (v) => `env:\n  - name: ${pairName}\n${filler(9, (i) => `    note${i}: ok\n`)}    value: ${v}\n`],
    ['a YAML item, value above its name', 'deploy.yaml', (v) => `env:\n  - value: ${v}\n${filler(9, (i) => `    note${i}: ok\n`)}    name: ${pairName}\n`],
    ['a JSON object, value 40 short lines below its name', 'vars.json', (v) => `{\n  "name": "${pairName}",\n${filler(40, (i) => `  "n${i}": 1,\n`)}  "value": "${v}"\n}\n`],
    ['a JSON object, value 40 short lines above its name', 'vars.json', (v) => `{\n  "value": "${v}",\n${filler(40, (i) => `  "n${i}": 1,\n`)}  "name": "${pairName}"\n}\n`],
    ['a mapping key with the value 10 children down', 'secrets.yaml', (v) => `secrets:\n  ${pairName}:\n${filler(9, (i) => `    note${i}: ok\n`)}    value: ${v}\n`],
  ];

  it.each(SPLIT_LAYOUTS)('--history and --range catch a value added far from an unchanged name (%s)', SLOW, (_label, file, layout) => {
    const dir = makeRepo();
    const value = randomString(24, 81);
    const save = (v, message) => {
      write(dir, file, layout(v));
      run('git', ['add', '-A'], dir);
      expect(commit(dir, message).status).toBe(0);
      return run('git', ['rev-parse', '--short=7', 'HEAD'], dir).stdout.trim();
    };
    const first = save('changeme', 'placeholder');
    const leaking = save(value, 'leak');
    const removed = save('changeme', 'remove');
    expect(scan(dir).status).toBe(0);
    const firstFull = run('git', ['rev-parse', first], dir).stdout.trim();
    for (const args of [['--history'], ['--range', `${firstFull}..HEAD`]]) {
      const result = scan(dir, ...args);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`${leaking}  ${file}  secret-name-value-pair  x1`);
      expect(result.stderr).not.toContain(removed);
      for (const piece of windows(value)) expect(output).not.toContain(piece);
    }
  });

  it.skipIf(!hasGit())('--history does not blame a later commit that adds an unrelated line inside the pair window', SLOW, () => {
    const dir = makeRepo();
    const value = randomString(24, 82);
    const layout = (extra) => `env:\n  - name: ${pairName}\n${filler(4, (i) => `    note${i}: ok\n`)}${extra}    value: ${value}\n`;
    write(dir, 'deploy.yaml', layout(''));
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'leak').status).toBe(0);
    const leaking = run('git', ['rev-parse', '--short=7', 'HEAD'], dir).stdout.trim();
    write(dir, 'deploy.yaml', layout('    extra: 1\n'));
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'unrelated line').status).toBe(0);
    const later = run('git', ['rev-parse', '--short=7', 'HEAD'], dir).stdout.trim();
    const result = scan(dir, '--history');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(leaking);
    expect(result.stderr).not.toContain(later);
  });

  it.skipIf(!hasGit())('--history still reads a lockfile edited in many places without treating it as oversize', SLOW, () => {
    const dir = makeRepo();
    const body = (v) => filler(3000, (i) => `    "dep${i}": { "version": "${v}.${i}" },\n`);
    write(dir, 'package-lock.json', `{\n${body(1)}}\n`);
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'lock').status).toBe(0);
    write(dir, 'package-lock.json', `{\n${body(2)}}\n`);
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'bump').status).toBe(0);
    const result = scan(dir, '--history');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no hits in 2 commits');
  });

  it('the history context is derived from the pair matcher, not a separate number', () => {
    // 12 lines is the YAML window; the character windows (1500 back or forward) can span one line per character (blank lines).
    expect(HISTORY_CONTEXT).toBeGreaterThanOrEqual(12);
    expect(HISTORY_CONTEXT).toBeGreaterThanOrEqual(1500);
  });

  // Class: the pair matcher looks 1,500 CHARACTERS around a JSON/HCL field, and JSON may have blank or one-character lines,
  // so --history/--range must keep unchanged context by characters, not by a count of lines a minimum line length implies.
  const GAP_LAYOUTS = [
    ['500 blank lines', () => '\n'.repeat(500)],
    ['500 one-character lines', () => ' \n'.repeat(500)],
    ['500 CRLF blank lines', () => '\r\n'.repeat(500)],
    ['1,400 blank lines', () => '\n'.repeat(1400)],
    ['mixed blank, one-character and CRLF lines', () => Array.from({ length: 500 }, (_, i) => ['\n', ' \n', '\r\n', ';\n'][i % 4]).join('')],
  ];
  const gapDoc = (gap, v, nameFirst = true) =>
    nameFirst ? `{"name":"${pairName}",\n${gap}"value":"${v}"}\n` : `{"value":"${v}",\n${gap}"name":"${pairName}"}\n`;

  it.each(GAP_LAYOUTS)('the tree scan pairs a name and a value across %s (the layout the history tests use)', (_label, makeGap) => {
    expect(scanText('vars.json', gapDoc(makeGap(), randomString(24, 71))).length).toBeGreaterThan(0);
  });

  it.each(GAP_LAYOUTS)('--history and --range catch a changed value across %s, then a removal', SLOW, (_label, makeGap) => {
    if (!hasGit()) return;
    for (const nameFirst of [true, false]) {
      const dir = makeRepo();
      const value = randomString(24, 72);
      const save = (v, message) => {
        write(dir, 'vars.json', gapDoc(makeGap(), v, nameFirst));
        run('git', ['add', '-A'], dir);
        expect(commit(dir, message).status).toBe(0);
        return run('git', ['rev-parse', '--short=7', 'HEAD'], dir).stdout.trim();
      };
      const first = save('changeme', 'placeholder');
      const leaking = save(value, 'leak');
      save('changeme', 'remove');
      expect(scan(dir).status).toBe(0);
      const firstFull = run('git', ['rev-parse', first], dir).stdout.trim();
      for (const args of [['--history'], ['--range', `${firstFull}..HEAD`]]) {
        const result = scan(dir, ...args);
        const output = `${result.stdout}\n${result.stderr}`;
        expect(result.status, args[0]).toBe(1);
        expect(result.stderr).toContain(`${leaking}  vars.json  secret-name-value-pair  x1`);
        for (const piece of windows(value)) expect(output).not.toContain(piece);
      }
    }
  });

  it.skipIf(!hasGit())('--history and --range catch a value that stays in the tree across blank lines', SLOW, () => {
    const dir = makeRepo();
    const value = randomString(24, 73);
    write(dir, 'vars.json', gapDoc('\n'.repeat(500), 'changeme'));
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'placeholder').status).toBe(0);
    const first = run('git', ['rev-parse', 'HEAD'], dir).stdout.trim();
    write(dir, 'vars.json', gapDoc('\n'.repeat(500), value));
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'leak').status).toBe(0);
    expect(scan(dir).status).toBe(1);
    for (const args of [['--history'], ['--range', `${first}..HEAD`]]) expect(scan(dir, ...args).status, args[0]).toBe(1);
  });

  it.skipIf(!hasGit())('--history does not blame a later commit that adds an unrelated line inside a blank-line gap', SLOW, () => {
    const dir = makeRepo();
    const value = randomString(24, 74);
    const layout = (extra) => gapDoc(`${'\n'.repeat(250)}${extra}${'\n'.repeat(250)}`, value);
    write(dir, 'vars.json', layout(''));
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'leak').status).toBe(0);
    const leaking = run('git', ['rev-parse', '--short=7', 'HEAD'], dir).stdout.trim();
    write(dir, 'vars.json', layout('\n'));
    run('git', ['add', '-A'], dir);
    expect(commit(dir, 'one more blank line').status).toBe(0);
    const later = run('git', ['rev-parse', '--short=7', 'HEAD'], dir).stdout.trim();
    const result = scan(dir, '--history');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(leaking);
    expect(result.stderr).not.toContain(later);
  });

  // Class: the size limit differs by path (5 MB, 16 MB for a lockfile) and the message must name the one that was applied.
  it('the oversize report gives each path the limit and the constant that applies to it', () => {
    const only = formatOversizeReport(['data/big.json']);
    expect(only).toContain('over 5 MB NOT scanned');
    expect(only).toContain('(over 5 MB, MAX_FILE_BYTES)');
    expect(only).not.toContain('16 MB');
    const lock = formatOversizeReport(['package-lock.json']);
    expect(lock).toContain('over 16 MB NOT scanned');
    expect(lock).toContain('(over 16 MB, MAX_LOCKFILE_BYTES)');
    expect(lock).toContain('raise MAX_LOCKFILE_BYTES.');
    expect(lock).not.toContain('5 MB');
    const both = formatOversizeReport(['data/big.json', 'sub/yarn.lock']);
    expect(both).toContain('data/big.json  (over 5 MB, MAX_FILE_BYTES)');
    expect(both).toContain('sub/yarn.lock  (over 16 MB, MAX_LOCKFILE_BYTES)');
    expect(both).toContain('raise MAX_FILE_BYTES / MAX_LOCKFILE_BYTES.');
  });

  it('the history report gives the limit of each kind of oversize version', () => {
    const report = formatHistoryReport([], {
      commits: 4,
      oversize: 3,
      unscanned: 3,
      oversizeLimits: new Map([[5 * 1024 * 1024, 1], [16 * 1024 * 1024, 2]]),
    });
    expect(report).toContain('3 file versions NOT scanned (1 over the 5 MB limit, 2 over the 16 MB lockfile limit)');
    expect(report).toContain('MAX_FILE_BYTES and MAX_LOCKFILE_BYTES');
    const lockOnly = formatHistoryReport([], { commits: 1, oversize: 1, unscanned: 1, oversizeLimits: new Map([[16 * 1024 * 1024, 1]]) });
    expect(lockOnly).toContain('(1 over the 16 MB lockfile limit)');
    expect(lockOnly).not.toContain('5 MB');
  });

  const LOCK_OVER = 16 * 1024 * 1024 + 4096;
  const bigLockfile = () => `{\n${`${'x'.repeat(1023)}\n`.repeat(Math.ceil(LOCK_OVER / 1024))}}\n`;

  it.skipIf(!hasGit())('an oversize lockfile is reported against the lockfile limit, in the tree scan and in --history/--range', SLOW, () => {
    const dir = makeRepo();
    write(dir, 'package-lock.json', bigLockfile());
    run('git', ['add', '-A'], dir);
    const tree = scan(dir);
    expect(tree.status).toBe(1);
    expect(tree.stderr).toContain('package-lock.json  (over 16 MB, MAX_LOCKFILE_BYTES)');
    expect(tree.stderr).not.toContain('5 MB');
    expect(commit(dir, 'big lockfile').status).toBe(0);
    const head = run('git', ['rev-parse', 'HEAD'], dir).stdout.trim();
    for (const args of [['--history'], ['--range', `${'0'.repeat(40)}..${head}`]]) {
      const result = scan(dir, ...args);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('1 over the 16 MB lockfile limit');
      expect(result.stderr).toContain('MAX_LOCKFILE_BYTES');
      expect(result.stderr).not.toContain('5 MB');
    }
  });

  it.skipIf(!hasGit())('an ordinary oversize file is still reported against MAX_FILE_BYTES in --history', SLOW, () => {
    const dir = makeBigVersionRepo();
    const result = scan(dir, '--history');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('1 over the 5 MB limit');
    expect(result.stderr).toContain('MAX_FILE_BYTES');
    expect(result.stderr).not.toContain('MAX_LOCKFILE_BYTES');
  });

  // Class: the staged (index) blob must be compared with the working tree BEFORE any size/binary shortcut, on every path
  // that skips reading the working copy (oversize binary, oversize text, oversize lockfile).
  const bigBinary = (extra = 4096) => Buffer.concat([PNG_HEAD, Buffer.alloc(5 * 1024 * 1024 + extra, 1)]);

  it.skipIf(!hasGit())('a staged secret is still found when the working copy becomes a binary over the size limit', SLOW, () => {
    const dir = makeRepo();
    write(dir, 'x.env', assignment);
    run('git', ['add', '-A'], dir);
    write(dir, 'x.env', bigBinary());
    const result = scan(dir);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('x.env:1  secret-assignment  (index)');
    expect(output).not.toContain('OK (');
    for (const piece of windows(secret)) expect(output).not.toContain(piece);
  });

  it.skipIf(!hasGit())('an unchanged binary over the size limit is still skipped, counted and clean', SLOW, () => {
    const dir = makeRepo();
    write(dir, 'big.bin', bigBinary());
    write(dir, 'ok.txt', 'hello\n');
    run('git', ['add', '-A'], dir);
    const result = scan(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('OK (1 files scanned, 1 skipped: 1 binary)');
  });

  it.skipIf(!hasGit())('a clean staged text file under an oversize binary working copy passes and says the versions differ', SLOW, () => {
    const dir = makeRepo();
    write(dir, 'x.txt', 'hello\n');
    run('git', ['add', '-A'], dir);
    write(dir, 'x.txt', bigBinary());
    const result = scan(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1 with a staged version that differs from the working tree');
  });

  it.skipIf(!hasGit())('fails closed when the staged blob under an oversize binary working copy is itself oversize', SLOW, () => {
    const dir = makeRepo();
    write(dir, 'big.env', overLimitText(assignment));
    run('git', ['add', '-A'], dir);
    write(dir, 'big.env', bigBinary());
    const result = scan(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('big.env  (over 5 MB, MAX_FILE_BYTES)');
  });

  it.skipIf(!hasGit())('a staged secret is found under an oversize TEXT working copy too, and the oversize file is still reported once', SLOW, () => {
    const dir = makeRepo();
    write(dir, 'x.env', assignment);
    run('git', ['add', '-A'], dir);
    write(dir, 'x.env', overLimitText());
    const result = scan(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('x.env:1  secret-assignment  (index)');
    expect(result.stderr.split('x.env  (over 5 MB, MAX_FILE_BYTES)').length - 1).toBe(1);
  });

  it.skipIf(!hasGit())('a staged lockfile credential is found when the working copy becomes a binary over the lockfile limit', SLOW, () => {
    const dir = makeRepo();
    const password = randomString(24, 83);
    write(dir, 'package-lock.json', `{\n "x": {\n  "_authToken": "${password}"\n }\n}\n`);
    run('git', ['add', '-A'], dir);
    expect(scan(dir).status).toBe(1); // the fixture is a finding on its own
    write(dir, 'package-lock.json', Buffer.concat([PNG_HEAD, Buffer.alloc(LOCK_OVER, 1)]));
    const result = scan(dir);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('package-lock.json:3  lockfile-credential  (index)');
    for (const piece of windows(password)) expect(output).not.toContain(piece);
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


// ---------------------------------------------------------------------------
// Review round 9: lockfiles, commit ranges in CI, XML configuration, provider token families
//
// (1) Lockfiles were skipped by name, so a credential in a dependency URL or an auth field was never seen. They are now
//     scanned with targeted rules (URL credentials, auth fields, provider tokens, webhooks, private keys) after ordinary
//     integrity digests are blanked. Siblings: package-lock.json, npm-shrinkwrap.json, yarn.lock (v1 and berry),
//     pnpm-lock.yaml, Cargo.lock, Gemfile.lock, poetry.lock, composer.lock, go.sum, Pipfile.lock, bun.lock; the fields
//     resolved / tarball / url / source / remote / registry; URL password, token as user name, credential query parameter,
//     _authToken / _auth / _password fields; and --history / --range, which read lockfile versions the same way.
// (2) --range <base>..<head>, which CI runs so a secret committed and removed inside a pull request is still found.
// (3) XML configuration files were scanned in code mode (a passphrase with spaces was not a finding). .xml, .config,
//     MSBuild, .plist, .resx, .wsdl and the Maven, Ant, Tomcat and Android files get configuration-value semantics; SVG
//     and HTML stay markup.
// (4) The provider token list: the whole Slack family and the other current families (see PROVIDER_TOKENS).
// ---------------------------------------------------------------------------

const PREFIX_FLOOD_LIMIT_MS = 30_000;
const ALL_HOSTILE_PREFIXES = ['xapp-', 'xoxe.xoxe.', 'xoxo-', 'xoxe-1-', 'xoxb-', 'glpat-', 'sk-', 'sk-ant-', 'sk-proj-', 'hf_', 'secret_', 'ntn_', 'whsec_', 'AccountKey=', 'sig=', 'https://a', 'dp.st.', 'hvs.', 'ATATT3', 'ATBB', 'SG.', 'ya29.', 'GOCSPX-', 'key-', 'lin_api_', 'HEROKU_API_KEY=', 'DD_API_KEY:', 'a.atlasv1.', 'cfut_', 'sq0csp-', 'sk.eyJ', 'NRII-', 'APA91b', 'AAAA1234567:APA91b', '123456789:AA', 'M', 'shpat_', 'npm_', 'github_pat_', 'pypi-AgEIcHlwaS5vcmc', 'sntrys_'];

describe('review round 9', () => {
  const rulesOf = (file, text) => scanText(file, text).map((f) => f.rule);
  const NAME = ['JWT_', 'SECRET'].join('');
  const PASSWORD = ['pass', 'word'].join('');
  const passphrase = 'correct horse battery staple';
  const random = randomString(24, 2001);
  const scheme = ['https', '://'].join('');
  const sha512 = (seed) => `sha512-${randomString(86, seed, `${ALNUM}+/`)}==`;
  const sha1 = (seed) => `sha1-${randomString(27, seed, `${ALNUM}+/`)}=`;
  const hex = (n, seed) => randomString(n, seed, HEX);

  describe('(1) lockfiles', () => {
    // Ordinary content of every lockfile format, integrity hashes included. None of it may be reported.
    const ORDINARY = [
      ['package-lock.json', JSON.stringify({ name: 'x', lockfileVersion: 3, packages: { '': { dependencies: { password: '^1.0.0', token: 'latest', secret: 'npm:other@1' } }, 'node_modules/pkg': { version: '1.0.0', resolved: `${scheme}registry.npmjs.org/pkg/-/pkg-1.0.0.tgz`, integrity: sha512(2101) }, 'node_modules/git-dep': { version: '1.0.0', resolved: `git+ssh://git@github.com/org/repo.git#${hex(40, 2102)}` } } }, null, 2)],
      ['npm-shrinkwrap.json', JSON.stringify({ dependencies: { a: { version: '1.0.0', resolved: `${scheme}registry.npmjs.org/a/-/a-1.0.0.tgz?cache=1`, integrity: sha512(2103) } } }, null, 2)],
      ['yarn.lock', `"a@^1.0.0":\n  version "1.0.0"\n  resolved "${scheme}registry.yarnpkg.com/a/-/a-1.0.0.tgz#${hex(40, 2104)}"\n  integrity ${sha512(2105)}\n\n"b@^2":\n  version "2.0.0"\n  resolved "${scheme}registry.yarnpkg.com/b/-/b-2.0.0.tgz#${hex(40, 2106)}"\n  integrity ${sha1(2107)}\n`],
      ['yarn.lock', `__metadata:\n  version: 8\n"a@npm:^1.0.0":\n  version: 1.0.0\n  resolution: "a@npm:1.0.0"\n  checksum: 10c0/${hex(128, 2108)}\n  languageName: node\n  linkType: hard\n`],
      ['pnpm-lock.yaml', `lockfileVersion: '9.0'\npackages:\n  a@1.0.0:\n    resolution: {integrity: ${sha512(2109)}, tarball: ${scheme}registry.npmjs.org/a/-/a-1.0.0.tgz}\n`],
      ['Cargo.lock', `[[package]]\nname = "a"\nversion = "1.0.0"\nsource = "registry+${scheme}github.com/rust-lang/crates.io-index"\nchecksum = "${hex(64, 2110)}"\n\n[[package]]\nname = "b"\nversion = "0.1.0"\nsource = "git+${scheme}github.com/org/b#${hex(40, 2111)}"\n`],
      ['Gemfile.lock', `GEM\n  remote: ${scheme}rubygems.org/\n  specs:\n    rake (13.0.6)\n\nCHECKSUMS\n  rake (13.0.6) sha256=${hex(64, 2112)}\n`],
      ['poetry.lock', `[[package]]\nname = "requests"\nversion = "2.31.0"\n[package.source]\ntype = "legacy"\nurl = "${scheme}pypi.org/simple"\n[[package.files]]\nfile = "requests-2.31.0.tar.gz"\nhash = "sha256:${hex(64, 2113)}"\n`],
      ['composer.lock', JSON.stringify({ packages: [{ name: 'a/b', version: '1.0.0', source: { type: 'git', url: `${scheme}github.com/a/b.git`, reference: hex(40, 2114) }, dist: { type: 'zip', url: `${scheme}api.github.com/repos/a/b/zipball/${hex(40, 2115)}`, shasum: '' } }] }, null, 2)],
      ['go.sum', `example.com/a v1.0.0 h1:${randomString(43, 2116, `${ALNUM}+/`)}=\nexample.com/a v1.0.0/go.mod h1:${randomString(43, 2117, `${ALNUM}+/`)}=\n`],
      ['Pipfile.lock', JSON.stringify({ default: { requests: { hashes: [`sha256:${hex(64, 2118)}`], index: 'pypi', version: '==2.31.0' } } }, null, 2)],
      ['bun.lock', `{\n  "lockfileVersion": 1,\n  "packages": {\n    "a": ["a@1.0.0", "", {}, "${sha512(2119)}"],\n  }\n}\n`],
    ];
    it.each(ORDINARY)('an ordinary %s (integrity hashes, git dependency, registry URLs) is clean', (file, text) => {
      expect(scanText(file, text)).toEqual([]);
    });

    it('the four real lockfiles of this repository are clean', () => {
      for (const file of ['package-lock.json', 'app/package-lock.json', 'server/package-lock.json', 'shared/package-lock.json']) {
        expect(scanText(file, readFileSync(path.join(REPO_ROOT, file), 'utf8')), file).toEqual([]);
      }
    });

    // The credential shapes, in the form each lockfile format writes its resolved URL.
    const URL_LOCATIONS = [
      ['package-lock.json', (u) => `{"packages":{"node_modules/x":{"resolved":"${u}","integrity":"${sha512(2120)}"}}}\n`],
      ['npm-shrinkwrap.json', (u) => `{"dependencies":{"x":{"version":"1.0.0","resolved":"${u}"}}}\n`],
      ['yarn.lock', (u) => `"x@^1":\n  version "1.0.0"\n  resolved "${u}#${hex(40, 2121)}"\n`],
      ['pnpm-lock.yaml', (u) => `packages:\n  x@1.0.0:\n    resolution: {tarball: ${u}}\n`],
      ['Cargo.lock', (u) => `[[package]]\nname = "x"\nsource = "registry+${u}"\n`],
      ['Gemfile.lock', (u) => `GEM\n  remote: ${u}\n  specs:\n    x (1.0.0)\n`],
      ['poetry.lock', (u) => `[package.source]\ntype = "legacy"\nurl = "${u}"\n`],
      ['composer.lock', (u) => `{"packages":[{"dist":{"type":"zip","url":"${u}"}}]}\n`],
      ['Pipfile.lock', (u) => `{"_meta":{"sources":[{"name":"internal","url":"${u}"}]}}\n`],
      ['bun.lock', (u) => `{"packages":{"x":["x@${u}","",{}]}}\n`],
    ];
    const SHAPES = [
      ['password', `${scheme}user:${random}@registry.internal/x/-/x-1.0.0.tgz`, ['url-password', 'lockfile-credential']],
      ['hex password', `${scheme}user:${hex(64, 2122)}@registry.internal/x/-/x-1.0.0.tgz`, ['url-password']],
      ['token as the user name', `${scheme}${random}@registry.internal/x/-/x-1.0.0.tgz`, ['lockfile-credential']],
      ['token query parameter', `${scheme}registry.internal/x/-/x-1.0.0.tgz?token=${random}`, ['lockfile-credential']],
      ['_authToken query parameter', `${scheme}registry.internal/x/-/x-1.0.0.tgz?_authToken=${random}`, ['lockfile-credential']],
      ['signed URL', `${scheme}registry.internal/x/-/x-1.0.0.tgz?sig=${random}`, ['lockfile-credential']],
    ];
    describe.each(URL_LOCATIONS)('%s', (file, place) => {
      it.each(SHAPES)('finds a credential in a dependency URL: %s', (_label, url, expected) => {
        const found = rulesOf(file, place(url));
        expect(found.some((rule) => expected.includes(rule)), `${file}: ${found.join(',')}`).toBe(true);
      });
    });

    it.each([
      ['a JSON _authToken field', 'package-lock.json', `{"registries":{"//registry.internal/:_authToken":"${random}"},"_authToken":"${random}"}\n`],
      ['an ini _authToken line', 'yarn.lock', `//registry.internal/:_authToken=${random}\n`],
      ['an _auth line', 'yarn.lock', `_auth = ${Buffer.from(`u:${random}`).toString('base64')}\n`],
      ['a _password field', 'package-lock.json', `{"_password":"${random}"}\n`],
      ['a yarn berry npmAuthToken', 'yarn.lock', `npmAuthToken: ${random}\n`],
      ['a password field in TOML', 'poetry.lock', `password = "${random}"\n`],
      ['a bare token field in YAML', 'pnpm-lock.yaml', `token: ${random}\n`],
    ])('finds %s', (_label, file, text) => {
      expect(rulesOf(file, text)).toContain('lockfile-credential');
    });

    it('a placeholder, an environment reference or a dependency specifier in an auth-like field is not a finding', () => {
      for (const value of ['${NPM_TOKEN}', '<your token>', 'your_token_here', '^1.2.3', 'npm:other@1', 'link:../password', 'workspace:*', 'latest', '']) {
        expect(rulesOf('package-lock.json', `{"_authToken":"${value}","password":"${value}"}\n`), value).toEqual([]);
      }
    });

    it('a provider token, a private key block and a webhook URL in a lockfile are found', () => {
      const token = PROVIDER_TOKENS.find(([rule]) => rule === 'github-token' || rule === 'gitlab-token')[2]();
      expect(rulesOf('yarn.lock', `# ${token}\n`)).toContain('gitlab-token');
      const pem = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
      expect(rulesOf('package-lock.json', `{"note":"${pem}\\n${randomString(60, 2123, BASE64)}"}\n`)).toContain('private-key-block');
      const hook = `${scheme}hooks.slack.com/services/T0123ABCD/B0123ABCD/${randomString(24, 2124)}`;
      expect(rulesOf('Cargo.lock', `source = "${hook}"\n`)).toContain('webhook-url');
    });

    it('the generic rules do not run on a lockfile: a hash-like value under a secret-like name is not reported', () => {
      expect(rulesOf('package-lock.json', `{"apiKeyHash":"${hex(64, 2125)}","secretToken":"${random}"}\n`)).toEqual([]);
    });

    it('blanking a digest keeps the text length and the line structure, and leaves a hex password in a URL visible', () => {
      const text = `a ${sha512(2126)} b\nchecksum = "${hex(64, 2127)}"\nx: ${scheme}u:${hex(64, 2128)}@h/y\n`;
      const cleaned = sanitizeLockfile(text);
      expect(cleaned.length).toBe(text.length);
      expect(cleaned.split('\n').length).toBe(text.split('\n').length);
      expect(cleaned).not.toContain('sha512-');
      expect(cleaned.split('\n')[2]).toBe(text.split('\n')[2]);
      expect(cleaned.split('\n')[1]).toBe(`checksum = "${' '.repeat(64)}"`);
    });

    it('the allow marker works on a lockfile line', () => {
      const line = `{"resolved":"${scheme}${random}@registry.internal/x.tgz"} // ${ALLOW_MARKER}\n`;
      expect(scanText('package-lock.json', line)).toEqual([]);
    });

    it('the hostile-input limit holds on lockfile-shaped input (2 MB each)', SLOW, () => {
      const timings = timeInChild(`
        const repeat = (unit) => unit.repeat(Math.ceil((2 * 1024 * 1024) / unit.length));
        for (const text of [repeat('https://a:'), repeat('sha512-'), repeat('_authToken='), repeat('checksum = "a'), repeat('password: '), repeat('git+ssh://a@'), repeat('a://b@c?token='), repeat('password: 1 '), repeat('token=' + ' '.repeat(50))]) {
          const started = performance.now();
          scanText('package-lock.json', text);
          timings.push(Math.round(performance.now() - started));
        }`);
      for (const ms of timings) expect(ms).toBeLessThan(HOSTILE_LIMIT_MS);
    });
  });

  describe('(3) XML configuration files', () => {
    const XML_FILES = [
      'settings.xml', 'pom.xml', 'conf/server.xml', 'web.config', 'app.config', 'App.csproj', 'Directory.Build.props', 'x.targets',
      'Info.plist', 'Strings.resx', 'service.wsdl', 'app/src/main/res/values/strings.xml', 'build.xml',
      'App.vbproj', 'App.fsproj', 'pkg.nuspec', 'Profile.pubxml', 'Settings.settings',
    ];
    it.each(XML_FILES)('%s is classified as configuration', (file) => {
      expect(fileMode(file)).toBe('config');
      expect(isXmlConfigPath(file)).toBe(true);
    });
    it.each(['logo.svg', 'index.html', 'page.htm', 'doc.xhtml', 'notes.md', 'app.js'])('%s stays out of the XML class', (file) => {
      expect(isXmlConfigPath(file)).toBe(false);
      expect(fileMode(file)).not.toBe('config');
    });

    const SHAPES = [
      ['property/name/value', (v) => `<configuration><property><name>${NAME}</name><value>${v}</value></property></configuration>`],
      ['multi-line property', (v) => `<property>\n  <name>${NAME}</name>\n  <value>${v}</value>\n</property>`],
      ['add key/value', (v) => `<appSettings><add key="${NAME}" value="${v}" /></appSettings>`],
      ['attribute', (v) => `<Resource name="jdbc/db" ${PASSWORD}="${v}" />`],
      ['Maven server password', (v) => `<settings><servers><server><id>repo</id><username>bob</username><${PASSWORD}>${v}</${PASSWORD}></server></servers></settings>`],
      ['Maven proxy passphrase element', (v) => `<proxy><${['pass', 'phrase'].join('')}>${v}</${['pass', 'phrase'].join('')}></proxy>`],
      ['Ant property', (v) => `<property name="db.${PASSWORD}" value="${v}"/>`],
      ['Tomcat connector', (v) => `<Connector port="8443" keystorePass="${v}" />`],
      ['plist key/string', (v) => `<dict><key>API_SECRET</key><string>${v}</string></dict>`],
      ['Android string', (v) => `<resources><string name="api_key">${v}</string></resources>`],
      ['resx data', (v) => `<data name="ApiToken" xml:space="preserve"><value>${v}</value></data>`],
    ];
    describe.each(XML_FILES)('in %s', (file) => {
      it.each(SHAPES)('a passphrase with spaces is found: %s', (_label, shape) => {
        expect(scanText(file, `${shape(passphrase)}\n`).length).toBeGreaterThan(0);
      });
      it.each(SHAPES)('a random value is found: %s', (_label, shape) => {
        expect(scanText(file, `${shape(random)}\n`).length).toBeGreaterThan(0);
      });
    });

    it('the reported case: JWT_SECRET in settings.xml is found exactly like in a .config file', () => {
      const text = `<property><name>${NAME}</name><value>${passphrase}</value></property>\n`;
      expect(rulesOf('settings.xml', text)).toEqual(rulesOf('a.config', text));
      expect(rulesOf('settings.xml', text)).toContain('secret-name-value-pair');
    });

    it('svg and html keep code-mode semantics: markup is not noisy', () => {
      const markup = `<input type="${PASSWORD}" name="${PASSWORD}" placeholder="Your ${PASSWORD}"><label>Enter your ${PASSWORD} here</label>\n<${PASSWORD}>${passphrase}</${PASSWORD}>`;
      expect(scanText('form.html', markup)).toEqual([]);
      expect(scanText('icon.svg', `<svg><text id="token">the token is shown here</text><${PASSWORD}>${passphrase}</${PASSWORD}></svg>`)).toEqual([]);
    });

    it.each([
      ['a pom.xml without credentials', 'pom.xml', '<project><dependencies><dependency><groupId>org.x</groupId><artifactId>y</artifactId><version>1.0.0</version></dependency></dependencies><description>Reads the token from the environment</description></project>'],
      ['Maven environment references', 'settings.xml', `<server><id>x</id><${PASSWORD}>\${env.REPO_PASSWORD}</${PASSWORD}></server>`],
      ['a Maven-encrypted password', 'settings.xml', `<server><${PASSWORD}>{${randomString(44, 2201, `${ALNUM}+/=`)}}</${PASSWORD}></server>`],
      ['a placeholder', 'settings.xml', `<server><${PASSWORD}>changeme</${PASSWORD}><${PASSWORD}>your_password_here</${PASSWORD}><${PASSWORD}></${PASSWORD}></server>`],
      ['an Android layout', 'res/layout/login.xml', `<EditText android:id="@+id/${PASSWORD}" android:inputType="text${PASSWORD[0].toUpperCase()}${PASSWORD.slice(1)}" android:hint="Enter your ${PASSWORD}"/>`],
      ['Android UI strings', 'app/src/main/res/values/strings.xml', `<resources><string name="reset_${PASSWORD}">Reset your ${PASSWORD}</string><string name="${PASSWORD}_hint">Enter your ${PASSWORD}</string><string name="${PASSWORD}_mismatch">Passwords do not match</string></resources>`],
      ['a sitemap', 'sitemap.xml', '<urlset><url><loc>https://example.com/a</loc><lastmod>2024-01-01</lastmod></url></urlset>'],
      ['an SVG-like .xml image', 'icon.xml', '<svg viewBox="0 0 10 10"><path d="M0 0h10v10z" fill="#123abc"/></svg>'],
      ['a web.config with connection string references', 'web.config', `<connectionStrings><add name="Db" connectionString="Server=.;Database=app;Integrated Security=true" /></connectionStrings>`],
      ['a plist with ordinary keys', 'Info.plist', '<dict><key>CFBundleName</key><string>Local Catch</string><key>NSCameraUsageDescription</key><string>Scan a label with the camera</string></dict>'],
    ])('%s is clean', (_label, file, text) => {
      expect(scanText(file, `${text}\n`)).toEqual([]);
    });

    it('scans XML in linear time (element matcher on 1 MB)', SLOW, () => {
      const timings = timeInChild(`
        const P = ${JSON.stringify(PASSWORD)};
        const cases = [' '.repeat(1024 * 1024), '<p>'.repeat(300_000), ('<' + P + '>').repeat(150_000), ('<' + P + ' ' + 'a=1 '.repeat(75) + '>').repeat(2000), ('<a ' + 'x'.repeat(2000)).repeat(500),
          ('<wsse:' + P + '><![CDATA[').repeat(80_000), ('<a><![CDATA[').repeat(80_000), ('<a name="' + P + '">').repeat(100_000), ('<entry key="x" value="y"/>' + '<' + 'x:'.repeat(30) + 'a>').repeat(20_000)];
        for (const text of cases) {
          for (const file of ['settings.xml', 'a.vcxproj', 'a.xml.template']) {
            const started = performance.now();
            scanText(file, text);
            timings.push(Math.round(performance.now() - started));
          }
        }`);
      for (const ms of timings) expect(ms).toBeLessThan(HOSTILE_LIMIT_MS);
    });
  });

  describe('(4) provider token families', () => {
    it.each(PROVIDER_TOKENS)('%s: %s is found in JSON, Markdown, source, env and YAML under a non-secret name', (rule, _label, build) => {
      const token = build();
      for (const [file, text] of [
        ['data.json', `{"note":"${token}"}\n`],
        ['notes.md', `Use ${token} for the job.\n`],
        ['src/app.js', `const banner = "${token}";\n`],
        ['app.env', `SOMETHING_ELSE=${token}\n`],
        ['ci.yaml', `description: ${token}\n`],
      ]) {
        expect(rulesOf(file, text), `${file} ${_label}`).toContain(rule);
      }
    });

    it('nothing but path, line and rule is reported for a provider token', () => {
      for (const [, , build, secretPart] of PROVIDER_TOKENS) {
        const token = build();
        const report = formatReport(scanText('notes.md', `x ${token}\n`));
        for (const piece of windows(secretPart ? secretPart(token) : token.slice(4), 10).slice(0, 6)) expect(report).not.toContain(piece);
      }
    });

    it('the rest of the GitHub and Stripe families is found too', () => {
      const r = (n, seed) => randomString(n, seed);
      for (const token of [
        ['gh', 'u_', r(36, 2301)].join(''),
        ['gh', 's_', r(36, 2302)].join(''),
        ['gh', 'r_', r(36, 2303)].join(''),
        ['gh', 'o_', r(36, 2304)].join(''),
        ['github', '_pat_', r(22, 2305), '_', r(59, 2306)].join(''),
        ['r', 'k_live_', r(24, 2307)].join(''),
        ['s', 'k_live_', r(24, 2308)].join(''),
      ]) {
        expect(rulesOf('notes.md', `x ${token}\n`).length, 'a provider token').toBeGreaterThan(0);
      }
    });

    it('the reported case: an app-level Slack token in JSON, Markdown and source', () => {
      const token = PROVIDER_TOKENS.find(([, label]) => label.startsWith('Slack app-level'))[2]();
      expect(rulesOf('a.json', `{"note":"${token}"}\n`)).toContain('slack-token');
      expect(rulesOf('a.md', `token ${token}\n`)).toContain('slack-token');
      expect(rulesOf('a.js', `const t = "${token}";\n`)).toContain('slack-token');
    });

    const pad = (prefix, n, ch = 'x') => `${prefix}${ch.repeat(n)}`;
    const PLACEHOLDERS = [
      pad(['xapp', '-1-A0000000000-0000000000000-'].join(''), 40),
      pad(['xox', 'b-000000000000-'].join(''), 24),
      pad(['xoxe', '.xoxp-1-'].join(''), 40),
      pad(['gl', 'pat-'].join(''), 24),
      pad(['npm', '_'].join(''), 36),
      pad(['pypi', '-AgEIcHlwaS5vcmc'].join(''), 60),
      pad(['whsec', '_'].join(''), 32),
      pad(['S', 'K'].join(''), 32, '0'),
      pad(['key', '-'].join(''), 32, '0'),
      pad(['shp', 'at_'].join(''), 32, '0'),
      pad(['do', 'p_v1_'].join(''), 64, '0'),
      pad(['hf', '_'].join(''), 34),
      pad(['sk', '-proj-'].join(''), 48),
      pad(['sk', '-ant-api03-'].join(''), 60),
      pad(['sk', '-'].join(''), 48),
      pad(['ya', '29.'].join(''), 40),
      pad(['GOC', 'SPX-'].join(''), 28),
      pad(['HR', 'KU-'].join(''), 40),
      pad(['sntr', 'ys_'].join(''), 60),
      pad(['dp', '.st.dev.'].join(''), 44),
      pad(['hv', 's.'].join(''), 40),
      pad(['lin', '_api_'].join(''), 40),
      pad(['nt', 'n_'].join(''), 46),
      pad(['AT', 'ATT3'].join(''), 60),
      ['xapp', '-your-slack-app-token-goes-here'].join(''),
      ['glpat', '-<your-token>'].join(''),
      ['sk', '-ant-...'].join(''),
      `${['xapp', '-1-'].join('')}\${SLACK_APP_TOKEN}`,
    ];
    it.each(PLACEHOLDERS.map((v) => [v.slice(0, 14), v]))('placeholder %s... passes', (_label, value) => {
      for (const [file, text] of [['a.json', `{"note":"${value}"}\n`], ['a.md', `token ${value}\n`], ['a.js', `const t = "${value}";\n`], ['.env', `X=${value}\n`]]) {
        expect(rulesOf(file, text).filter((rule) => PROVIDER_TOKENS.some(([known]) => known === rule)), `${file}: ${_label}`).toEqual([]);
      }
    });

    it.each([
      'Slack app-level tokens start with xapp- and bot tokens with xoxb-, see the Slack docs.',
      'A GitLab token starts with glpat- and a Hugging Face token with hf_.',
      'Set ntn_ or secret_ as the prefix; Vault uses hvs. for service tokens and Doppler dp.st. for service tokens.',
      'Use the sk-ant- prefix check and the whsec_ prefix check in the validator.',
      'xoxo-love-and-hugs-from-the-team-to-you',
      'the key-value store and the key-value-config-option-name-that-is-long',
      'const cache = process.env.npm_config_cache; const v = process.env.npm_package_version_number_x;',
      'from huggingface_hub import hf_hub_download, hf_hub_url',
      'secret_key_base: use a long value; secret_santa_gift_exchange_names_for_the_office',
      'pip install scikit-learn sk-learn skeleton-key-ring ASK-THE-TEAM',
      'ATATT and ATBB are the token prefixes Atlassian uses.',
      'A DSN looks like https://public@sentry.example.com/1 in the docs.',
      'DD_API_KEY is set from the environment; DD-API-KEY: <your key>',
      'Endpoint=sb://x.servicebus.windows.net/;SharedAccessKeyName=root;SharedAccessKey=<key>',
      'https://acct.blob.core.windows.net/c/b?sv=2022-11-02&sp=r&sig=<signature>',
      'HEROKU_API_KEY=<your-key>',
    ])('ordinary prose and code pass: %s', (text) => {
      for (const file of ['a.md', 'a.js', 'a.json', 'docs/setup.txt']) {
        const body = file === 'a.json' ? JSON.stringify({ note: text }) : text;
        expect(rulesOf(file, `${body}\n`).filter((rule) => PROVIDER_TOKENS.some(([known]) => known === rule)), file).toEqual([]);
      }
    });

    it('the repository tree has no provider-token false positive', SLOW, () => {
      const result = spawnSync(process.execPath, [SCANNER], { cwd: REPO_ROOT, encoding: 'utf8', timeout: SLOW_TEST_MS });
      expect(result.status, result.stderr).toBe(0);
    });

    it('scans a megabyte of provider prefixes in linear time', SLOW, () => {
      // Catastrophic backtracking takes minutes on these inputs; the limit is generous because a few of the generic rules
      // (AccountKey=, DD_API_KEY:) legitimately take seconds on a megabyte of one repeated prefix, more on a busy runner.
      const timings = timeInChild(`
        const prefixes = ${JSON.stringify(ALL_HOSTILE_PREFIXES)};
        for (const prefix of prefixes) {
          const text = prefix.repeat(Math.ceil((1024 * 1024) / prefix.length));
          const started = performance.now();
          scanText('a.md', text);
          timings.push([prefix, Math.round(performance.now() - started)]);
        }`);
      for (const [prefix, ms] of timings) expect(ms, prefix).toBeLessThan(PREFIX_FLOOD_LIMIT_MS);
    });

    it('an all-uppercase or single-character token body after every unbounded prefix is linear (was quadratic)', SLOW, () => {
      const timings = timeInChild(`
        const prefixes = ${JSON.stringify(ALL_HOSTILE_PREFIXES)};
        for (const prefix of prefixes) {
          for (const body of ['A', 'ATBB', 'AbC']) {
            const text = prefix + body.repeat(Math.ceil((256 * 1024) / body.length));
            for (const file of ['a.md', 'package-lock.json', 'settings.xml']) {
              const started = performance.now();
              scanText(file, text);
              timings.push([prefix + ' ' + body + ' ' + file, Math.round(performance.now() - started)]);
            }
          }
        }`);
      for (const [label, ms] of timings) expect(ms, label).toBeLessThan(HOSTILE_LIMIT_MS);
    });
  });

  describe('(2) --range and the CI workflow', () => {
    const dirs = [];
    afterEach(() => {
      while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
    });
    const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: SLOW_TEST_MS });
    const scan = (cwd, ...args) => run(process.execPath, [SCANNER, ...args], cwd);
    const git = (cwd, ...args) => run('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], cwd);
    const write = (dir, file, content) => {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), content);
    };
    const commit = (dir, message, files = {}) => {
      for (const [file, content] of Object.entries(files)) write(dir, file, content);
      git(dir, 'add', '-A');
      expect(git(dir, 'commit', '-q', '-m', message).status).toBe(0);
      return git(dir, 'rev-parse', 'HEAD').stdout.trim();
    };
    const makeRepo = () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'check-secrets-range-'));
      dirs.push(dir);
      expect(run('git', ['init', '-q', '-b', 'main'], dir).status).toBe(0);
      return dir;
    };
    const value = randomString(28, 2401);
    const leak = `${['API_', 'KEY'].join('')}=${value}\n`;
    const clean = `${['API_', 'KEY'].join('')}=your_api_key_here\n`;
    const noValue = (result) => {
      const output = `${result.stdout}${result.stderr}`;
      for (const piece of windows(value)) expect(output).not.toContain(piece);
    };

    it.skipIf(!hasGit())('finds a secret committed and removed again inside the range, which the tip scan cannot see', SLOW, () => {
      const dir = makeRepo();
      const base = commit(dir, 'base', { 'base.txt': 'base\n' });
      const leaked = commit(dir, 'add key', { 'x.env': leak });
      const head = commit(dir, 'remove key', { 'x.env': clean });
      expect(scan(dir).status).toBe(0); // the reported gap: the tip is clean
      const result = scan(dir, '--range', `${base}..${head}`);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`${leaked.slice(0, 7)}  x.env  secret-assignment  x1`);
      expect(result.stderr).toContain('--range');
      noValue(result);
    });

    it.skipIf(!hasGit())('accepts --range=<base>..<head> and branch names', SLOW, () => {
      const dir = makeRepo();
      commit(dir, 'base', { 'base.txt': 'base\n' });
      git(dir, 'checkout', '-q', '-b', 'feature');
      commit(dir, 'add key', { 'x.env': leak });
      expect(scan(dir, '--range=main..feature').status).toBe(1);
    });

    it.skipIf(!hasGit())('exits 0 on a clean range and on a range without commits', SLOW, () => {
      const dir = makeRepo();
      const base = commit(dir, 'base', { 'base.txt': 'base\n' });
      const head = commit(dir, 'more', { 'x.env': clean });
      const ok = scan(dir, '--range', `${base}..${head}`);
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain('no hits in 1 commit');
      const empty = scan(dir, '--range', `${head}..${head}`);
      expect(empty.status).toBe(0);
      expect(empty.stdout).toContain('no commits');
      const behind = scan(dir, '--range', `${head}..${base}`); // head is an ancestor of base: nothing new
      expect(behind.status).toBe(0);
    });

    it.skipIf(!hasGit())('reads only the range: a secret in an earlier commit is not blamed, and the walk is as long as the range', SLOW, () => {
      const dir = makeRepo();
      commit(dir, 'old leak', { 'old.env': leak });
      commit(dir, 'old fix', { 'old.env': clean });
      for (let i = 0; i < 40; i += 1) commit(dir, `filler ${i}`, { [`f${i}.txt`]: `${i}\n` });
      const base = git(dir, 'rev-parse', 'HEAD').stdout.trim();
      const head = commit(dir, 'new', { 'new.txt': 'new\n' });
      const result = scan(dir, '--range', `${base}..${head}`);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('no hits in 1 commit ');
      expect(scan(dir, '--history').status).toBe(1); // the full audit still finds the old leak
    });

    it.skipIf(!hasGit())('handles a merge commit inside the range (both sides are scanned, once)', SLOW, () => {
      const dir = makeRepo();
      const base = commit(dir, 'base', { 'base.txt': 'base\n' });
      git(dir, 'checkout', '-q', '-b', 'feature');
      const leaked = commit(dir, 'add key', { 'x.env': leak });
      git(dir, 'checkout', '-q', 'main');
      commit(dir, 'main moves', { 'main.txt': 'm\n' });
      git(dir, 'checkout', '-q', 'feature');
      expect(git(dir, 'merge', '-q', '--no-ff', '-m', 'merge main', 'main').status).toBe(0);
      const head = commit(dir, 'remove key', { 'x.env': clean });
      const result = scan(dir, '--range', `${base}..${head}`);
      expect(result.status).toBe(1);
      expect(result.stderr.match(new RegExp(`${leaked.slice(0, 7)}  x.env`, 'g'))).toHaveLength(1);
    });

    it.skipIf(!hasGit())('a secret only a merge conflict resolution introduced is found in the range', SLOW, () => {
      const dir = makeRepo();
      const base = commit(dir, 'base', { 'x.env': 'A=1\n' });
      git(dir, 'checkout', '-q', '-b', 'feature');
      commit(dir, 'feature edit', { 'x.env': 'A=2\n' });
      git(dir, 'checkout', '-q', 'main');
      commit(dir, 'main edit', { 'x.env': 'A=3\n' });
      git(dir, 'checkout', '-q', 'feature');
      expect(git(dir, 'merge', '-q', 'main').status).not.toBe(0);
      write(dir, 'x.env', `A=4\n${leak}`);
      git(dir, 'add', '-A');
      expect(git(dir, 'commit', '-q', '-m', 'resolve').status).toBe(0);
      const head = git(dir, 'rev-parse', 'HEAD').stdout.trim();
      const result = scan(dir, '--range', `${base}..${head}`);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('x.env  secret-assignment');
    });

    it.skipIf(!hasGit())('uses merge-base semantics: commits only on the base side are not blamed when the base is not an ancestor', SLOW, () => {
      const dir = makeRepo();
      commit(dir, 'root', { 'root.txt': 'r\n' });
      git(dir, 'checkout', '-q', '-b', 'feature');
      const feature = commit(dir, 'feature work', { 'f.txt': 'f\n' });
      git(dir, 'checkout', '-q', 'main');
      const mainLeak = commit(dir, 'main leak', { 'm.env': leak });
      const result = scan(dir, '--range', `${mainLeak}..${feature}`);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('no hits in 1 commit');
    });

    it.skipIf(!hasGit())('sees a PR head that a fork provides only through the merge commit (checkout of refs/pull/N/merge)', SLOW, () => {
      const upstream = makeRepo();
      const base = commit(upstream, 'base', { 'base.txt': 'base\n' });
      git(upstream, 'checkout', '-q', '-b', 'fork-work');
      commit(upstream, 'add key', { 'x.env': leak });
      const head = commit(upstream, 'remove key', { 'x.env': clean });
      git(upstream, 'checkout', '-q', 'main');
      git(upstream, 'merge', '-q', '--no-ff', '-m', 'PR merge', head);
      git(upstream, 'update-ref', 'refs/pull/1/merge', 'HEAD');
      git(upstream, 'reset', '-q', '--hard', base);
      git(upstream, 'branch', '-q', '-D', 'fork-work');
      const runner = mkdtempSync(path.join(tmpdir(), 'check-secrets-range-'));
      dirs.push(runner);
      expect(run('git', ['clone', '-q', upstream, runner], tmpdir()).status).toBe(0);
      expect(git(runner, 'fetch', '-q', 'origin', 'refs/pull/1/merge').status).toBe(0);
      git(runner, 'checkout', '-q', 'FETCH_HEAD');
      expect(scan(runner, '--range', `${base}..${head}`).status).toBe(1);
    });

    it.skipIf(!hasGit())('a shallow clone that holds BOTH commits (a depth-1 fetch of each) still fails closed, never "no hits"', SLOW, () => {
      const upstream = makeRepo();
      const base = commit(upstream, 'base', { 'base.txt': 'base\n' });
      commit(upstream, 'add key', { 'x.env': leak });
      const head = commit(upstream, 'remove key', { 'x.env': clean });
      const shallow = mkdtempSync(path.join(tmpdir(), 'check-secrets-range-'));
      dirs.push(shallow);
      expect(run('git', ['init', '-q'], shallow).status).toBe(0);
      expect(run('git', ['fetch', '-q', '--depth=1', `file://${upstream}`, head], shallow).status).toBe(0);
      expect(run('git', ['fetch', '-q', '--depth=1', `file://${upstream}`, base], shallow).status).toBe(0);
      expect(run('git', ['rev-parse', '--is-shallow-repository'], shallow).stdout.trim()).toBe('true');
      expect(run('git', ['cat-file', '-t', base], shallow).stdout.trim()).toBe('commit'); // both ends are present
      const result = scan(shallow, '--range', `${base}..${head}`);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('shallow');
      expect(result.stdout).not.toContain('no hits');
    });

    it.skipIf(!hasGit())('rejects malformed range specs before git sees them (exit 2, nothing scanned)', SLOW, () => {
      const dir = makeRepo();
      const head = commit(dir, 'base', { 'base.txt': 'base\n' });
      for (const spec of ['--output=/tmp/x..HEAD', `${head}..--all`, `${head}...${head}`, `..${head}`, `${head}..`, 'a..b..c', `${head}`, `${head} ..${head}`, '-x..HEAD', 'HEAD..-x']) {
        const result = scan(dir, '--range', spec);
        expect(result.status, spec).toBe(2);
        expect(result.stderr, spec).toContain('expected <base>..<head>');
        expect(result.stdout, spec).toBe('');
      }
    });

    it.skipIf(!hasGit())('an unreachable base (force-push, partial fetch) or head fails closed with exit 2 and a message', SLOW, () => {
      const dir = makeRepo();
      const head = commit(dir, 'base', { 'base.txt': 'base\n' });
      const missing = '1'.repeat(40);
      const noBase = scan(dir, '--range', `${missing}..${head}`);
      expect(noBase.status).toBe(2);
      expect(noBase.stderr).toContain('INCOMPLETE');
      expect(noBase.stderr).toContain('not in this repository');
      expect(noBase.stdout).not.toContain('no hits');
      const noHead = scan(dir, '--range', `${head}..${missing}`);
      expect(noHead.status).toBe(2);
      expect(noHead.stderr).toContain('INCOMPLETE');
    });

    it.skipIf(!hasGit())('a shallow clone fails closed (exit 2), never "no hits"', SLOW, () => {
      const upstream = makeRepo();
      const base = commit(upstream, 'base', { 'base.txt': 'base\n' });
      const head = commit(upstream, 'add key', { 'x.env': leak });
      const shallow = mkdtempSync(path.join(tmpdir(), 'check-secrets-range-'));
      dirs.push(shallow);
      expect(run('git', ['clone', '-q', '--depth', '1', `file://${upstream}`, shallow], tmpdir()).status).toBe(0);
      const result = scan(shallow, '--range', `${base}..${head}`);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('shallow');
      expect(`${result.stdout}${result.stderr}`).not.toContain('no hits');
    });

    it.skipIf(!hasGit())('an all-zero base (a new branch) scans the tip commit only, and says so', SLOW, () => {
      const dir = makeRepo();
      commit(dir, 'first', { 'old.env': leak });
      const head = commit(dir, 'tip', { 'new.txt': 'n\n' });
      const zero = '0'.repeat(40);
      const clean1 = scan(dir, '--range', `${zero}..${head}`);
      expect(clean1.status).toBe(0);
      expect(clean1.stdout).toContain('tip commit only');
      const leakyTip = commit(dir, 'leaky tip', { 'y.env': leak });
      expect(scan(dir, '--range', `${zero}..${leakyTip}`).status).toBe(1);
      // The root commit has no parent: still scanned.
      const root = git(dir, 'rev-list', '--max-parents=0', 'HEAD').stdout.trim();
      expect(scan(dir, '--range', `${zero}..${root}`).status).toBe(1);
    });

    it.skipIf(!hasGit())('rejects malformed and option-like ranges (exit 2) and never runs shell text', SLOW, () => {
      const dir = makeRepo();
      const head = commit(dir, 'base', { 'base.txt': 'base\n' });
      for (const spec of [`${head}...${head}`, `-x..${head}`, `${head}..--output=x`, `${head}`, '..', `..${head}`, `${head}..`, `a b..${head}`]) {
        const result = scan(dir, '--range', spec);
        expect(result.status, spec).toBe(2);
      }
      expect(scan(dir, '--range').status).toBe(2);
      expect(scan(dir, '--range', `${head}..${head}`, '--history').status).toBe(2);
      expect(scan(dir, '--range', `${head}..${head}`, '--range', `${head}..${head}`).status).toBe(2);
      const inject = scan(dir, '--range', `$(touch pwned)..${head}`);
      expect(inject.status).toBe(2);
      const injectHead = scan(dir, '--range', `${head}..\`touch pwned\``);
      expect(injectHead.status).toBe(2);
      expect(run('ls', [], dir).stdout).not.toContain('pwned');
    });

    it.skipIf(!hasGit())('applies the lockfile rules and the split-pair context to added lines', SLOW, () => {
      const dir = makeRepo();
      const base = commit(dir, 'base', { 'yarn.lock': '# base\n', 'k.yaml': `- name: ${NAME}\n  type: secret\n` });
      const url = `${scheme}${value}@registry.internal/x/-/x-1.0.0.tgz`;
      const withUrl = commit(dir, 'add dependency', { 'yarn.lock': `# base\n"x@^1":\n  version "1.0.0"\n  resolved "${url}"\n` });
      commit(dir, 'drop dependency', { 'yarn.lock': '# base\n' });
      const withValue = commit(dir, 'add the value under the unchanged name', { 'k.yaml': `- name: ${NAME}\n  value: ${value}\n  type: secret\n` });
      commit(dir, 'remove the value', { 'k.yaml': `- name: ${NAME}\n  value: your_value_here\n  type: secret\n` });
      const result = scan(dir, '--range', `${base}..HEAD`);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`${withUrl.slice(0, 7)}  yarn.lock  lockfile-credential`);
      expect(result.stderr).toContain(`${withValue.slice(0, 7)}  k.yaml`);
      noValue(result);
    });

    it.skipIf(!hasGit())('an ordinary lockfile change in the range passes', SLOW, () => {
      const dir = makeRepo();
      const base = commit(dir, 'base', { 'package-lock.json': '{}\n' });
      const head = commit(dir, 'update deps', { 'package-lock.json': `${JSON.stringify({ packages: { 'node_modules/a': { resolved: `${scheme}registry.npmjs.org/a/-/a-1.0.0.tgz`, integrity: sha512(2402) } } }, null, 2)}\n` });
      expect(scan(dir, '--range', `${base}..${head}`).status).toBe(0);
    });

    it.skipIf(!hasGit())('an added file version too large to scan makes the range INCOMPLETE (exit 2)', SLOW, () => {
      const dir = makeRepo();
      const base = commit(dir, 'base', { 'base.txt': 'base\n' });
      const head = commit(dir, 'big', { 'big.json': `${`${'x'.repeat(1023)}\n`.repeat(5 * 1024 + 8)}` });
      const result = scan(dir, '--range', `${base}..${head}`);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('INCOMPLETE');
      expect(result.stdout).not.toContain('no hits');
    });

    it.skipIf(!hasGit())('a lockfile over 5 MB but under the lockfile limit is scanned, not failed', SLOW, () => {
      const dir = makeRepo();
      write(dir, 'package-lock.json', `${`{"a":"${'x'.repeat(1000)}"}\n`.repeat(6 * 1024)}`);
      git(dir, 'add', '-A');
      const result = scan(dir);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('1 files scanned');
    });

    it.skipIf(!hasGit())('a credential in a tracked lockfile fails the tree scan and prints only path, line and rule', SLOW, () => {
      const dir = makeRepo();
      write(dir, 'package-lock.json', `{\n  "resolved": "${scheme}user:${value}@registry.internal/x.tgz"\n}\n`);
      git(dir, 'add', '-A');
      const result = scan(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('package-lock.json:2  url-password');
      noValue(result);
    });

    // The workflow is a security control, so its shape is tested: the range step, full history, least privilege, and no
    // event value interpolated into a shell script.
    describe('the CI workflow', () => {
      const workflow = readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
      const jobBlock = workflow.slice(workflow.indexOf('  secret-scan:'));
      const runScripts = () => {
        const lines = workflow.split('\n');
        const scripts = [];
        for (let i = 0; i < lines.length; i += 1) {
          const match = /^(\s*)(?:- )?run:\s*(.*)$/.exec(lines[i]);
          if (!match) continue;
          const indent = match[1].length;
          let body = match[2];
          if (body === '|' || body === '>') {
            body = '';
            for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || lines[j].search(/\S/) > indent); j += 1) body += `${lines[j]}\n`;
          }
          scripts.push(body);
        }
        return scripts;
      };

      it('scans the full history range in addition to the tip', () => {
        expect(jobBlock).toContain('fetch-depth: 0');
        expect(jobBlock).toContain('node scripts/check-secrets.mjs\n');
        expect(jobBlock).toContain('node scripts/check-secrets.mjs --range "$base..$head"');
        expect(jobBlock).toContain('github.event.pull_request.base.sha');
        expect(jobBlock).toContain('github.event.pull_request.head.sha');
        expect(jobBlock).toContain('github.event.before');
      });
      it('never runs the full-history audit in CI', () => {
        expect(runScripts().join('\n')).not.toContain('--history');
      });
      it('passes event values through env vars and never interpolates an expression into a run script', () => {
        for (const script of runScripts()) expect(script, script).not.toContain('${{');
        expect(jobBlock).toContain('PR_BASE_SHA: ${{ github.event.pull_request.base.sha }}');
      });
      it('refuses an event value that is not a plain commit id (exit 2) before it reaches the scanner', () => {
        const step = jobBlock.slice(jobBlock.indexOf('Scan commits in this change'));
        expect(step).toContain("id_pattern='^([0-9a-f]{40}|[0-9a-f]{64})$'");
        expect(step).toMatch(/if ! \[\[ "\$base" =~ \$id_pattern && "\$head" =~ \$id_pattern \]\]; then[\s\S]*?exit 2\s+fi/);
        expect(step.indexOf('id_pattern')).toBeLessThan(step.indexOf('node scripts/check-secrets.mjs --range'));
      });
      it('keeps least privilege and does not use pull_request_target', () => {
        expect(jobBlock).toMatch(/permissions:\n\s+contents: read/);
        expect(workflow).not.toContain('pull_request_target');
        expect(jobBlock).toContain('persist-credentials: false');
      });
      it('is valid enough to parse: every "run:" block is well-formed and the env names the script reads are all defined', () => {
        const step = jobBlock.slice(jobBlock.indexOf('Scan commits in this change'));
        for (const name of ['EVENT_NAME', 'PR_BASE_SHA', 'PR_HEAD_SHA', 'PUSH_BEFORE_SHA', 'PUSH_AFTER_SHA']) {
          expect(step.match(new RegExp(`${name}: `, 'g')), name).toHaveLength(1);
          expect(step.includes(`"$${name}"`), name).toBe(true);
        }
      });
    });
  });
});

describe('review round 10', () => {
  const rulesOf = (file, text) => scanText(file, text).map((f) => f.rule);
  const PASSWORD = ['pass', 'word'].join('');
  const NAME = ['JWT_', 'SECRET'].join('');
  const passphrase = 'correct horse battery staple';
  const random = randomString(24, 3001);
  const scheme = ['https', '://'].join('');

  describe('lockfile auth fields are judged by the shape of the whole value, not its first character', () => {
    const LOCK_SHAPES = [
      ['package-lock.json password', 'package-lock.json', (v) => `{"a":{"version":"1.0.0","${PASSWORD}":"${v}"}}\n`],
      ['npm-shrinkwrap.json password', 'npm-shrinkwrap.json', (v) => `{"a":{"version":"1.0.0","${PASSWORD}":"${v}"}}\n`],
      ['yarn.lock _authToken', 'yarn.lock', (v) => `//registry.corp.net/:_authToken=${v}\n`],
      ['pnpm-lock.yaml token', 'pnpm-lock.yaml', (v) => `settings:\n  ${['to', 'ken'].join('')}: ${v}\n`],
      ['Pipfile.lock _password', 'Pipfile.lock', (v) => `{"_meta":{"sources":[{"_${PASSWORD}":"${v}"}]}}\n`],
    ];
    describe.each(LOCK_SHAPES)('%s', (_label, file, shape) => {
      it.each(['x', 'X', 'v', 'V', '3', '0', '9', 'q', 'K', '^', '~', '*', '='])('a credential starting with %s is found', (first) => {
        for (let i = 0; i < 6; i += 1) {
          const value = first + randomString(28, 3100 + i * 7 + first.charCodeAt(0));
          expect(rulesOf(file, shape(value)), `${file} ${first}${i}`).toContain('lockfile-credential');
        }
      });
    });

    it.each(['1.0.0', '^1.2.3', '~1.2', '>=1.0.0 <2.0.0', '^1.0.0 || ^2.0.0', '1.x', '1.2.x', 'x', 'X', '*', '^*', 'v2.0.0', '3', '1.0.0-beta.2', '1.0.0-rc1', '1.0.0 - 2.0.0', 'latest', 'next', 'npm:other@1', 'workspace:*', 'link:../x', 'file:../x', './local', '../local', '/abs/path/pkg', 'true', 'catalog:'])('the dependency specifier %s is not a credential', (spec) => {
      expect(scanText('package-lock.json', `{"a":{"${PASSWORD}":"${spec}"}}\n`), spec).toEqual([]);
      expect(scanText('yarn.lock', `${PASSWORD} "${spec}"\n`), spec).toEqual([]);
    });

    it('prose in free-text package metadata is not an auth field', () => {
      for (const [file, text] of [
        ['composer.lock', '"description": "CSRF token: generation and validation for forms",\n'],
        ['composer.lock', '"description": "Store a secret: encrypt at rest",\n'],
        ['poetry.lock', 'description = "Utilities for token: parsing and secret: rotation"\n'],
        ['package-lock.json', '"description": "Token: bucket rate limiter with password: optional",\n'],
        ['yarn.lock', '  summary "The secret: to a good token: cache"\n'],
      ]) {
        expect(scanText(file, text), text).toEqual([]);
      }
    });

    it('a cache-key or sort-key query parameter is an identifier; a credential-qualified key is not', () => {
      const url = (query) => `{"resolved":"${scheme}r.example.org/a.tgz?${query}"}\n`;
      expect(scanText('package-lock.json', url('cache-key=1234567890abcdef'))).toEqual([]);
      expect(scanText('package-lock.json', url('sort-key=1234567890abcdef'))).toEqual([]);
      for (const name of ['api_key', 'access-key', 'sig', 'token']) {
        expect(rulesOf('package-lock.json', url(`${name}=${random}`)), name).toContain('lockfile-credential');
      }
    });

    it('a provider token hidden in an integrity digest is ignored only because digests are blanked', () => {
      // "+" before the prefix satisfies the token's boundary. The same text in a non-lockfile is a finding.
      const digest = `sha512-${randomString(51, 3201, ALNUM)}+${['AT', 'BB'].join('')}${randomString(30, 3202, ALNUM)}==`;
      const line = `{"packages":{"node_modules/x":{"version":"1.0.0","integrity":"${digest}"}}}\n`;
      expect(scanText('package-lock.json', line)).toEqual([]);
      expect(rulesOf('data.json', line)).toContain('atlassian-token');
    });
  });

  describe('XML: namespaced, CDATA and attribute-named elements', () => {
    const CONFIG_XML = [
      'settings.xml', 'pom.xml', 'conf/server.xml', 'web.config', 'app.config', 'App.csproj', 'App.vcxproj', 'x.props', 'x.targets',
      'Info.plist', 'Strings.resx', 'service.wsdl', 'strings.xml', 'gradle.properties.xml', 'App.pubxml',
    ];
    const ELEMENTS = [
      ['CDATA', (v) => `<server><${PASSWORD}><![CDATA[${v}]]></${PASSWORD}></server>`],
      ['CDATA with margins', (v) => `<${PASSWORD}>\n  <![CDATA[${v}]]>\n</${PASSWORD}>`],
      ['WS-Security PasswordText', (v) => `<wsse:Password Type="PasswordText">${v}</wsse:Password>`],
      ['namespace prefix with a declaration', (v) => `<ns:${PASSWORD} xmlns:ns="urn:x">${v}</ns:${PASSWORD}>`],
      ['prefixed CDATA', (v) => `<s:Secret><![CDATA[${v}]]></s:Secret>`],
      ['entry key attribute', (v) => `<entry key="secret">${v}</entry>`],
      ['item name attribute', (v) => `<item name="${PASSWORD}">${v}</item>`],
      ['env name attribute', (v) => `<env name="SECRET_KEY">${v}</env>`],
      ['entry key attribute, single quotes, CDATA', (v) => `<entry key='${PASSWORD}'><![CDATA[${v}]]></entry>`],
    ];
    describe.each(CONFIG_XML)('in %s', (file) => {
      it.each(ELEMENTS)('a random value is found: %s', (_label, shape) => {
        expect(scanText(file, `${shape(random)}\n`).length).toBeGreaterThan(0);
      });
      it.each(ELEMENTS)('a passphrase with spaces is found: %s', (_label, shape) => {
        expect(scanText(file, `${shape(passphrase)}\n`).length).toBeGreaterThan(0);
      });
    });

    it.each([
      ['a placeholder in CDATA', `<${PASSWORD}><![CDATA[your_${PASSWORD}_here]]></${PASSWORD}>`],
      ['an environment reference in CDATA', `<${PASSWORD}><![CDATA[\${env.DB_PASSWORD}]]></${PASSWORD}>`],
      ['an empty prefixed element', `<wsse:Password Type="PasswordText"></wsse:Password>`],
      ['a non-secret attribute-named entry', `<entry key="timeout">${random}</entry>`],
      ['mismatched closing tag', `<${PASSWORD}><![CDATA[${random}]]></other>`],
      ['a CDATA section that never closes', `<${PASSWORD}><![CDATA[${random}</${PASSWORD}>`],
    ])('%s is clean', (_label, text) => {
      expect(scanText('settings.xml', `${text}\n`)).toEqual([]);
    });
  });

  describe('XML-family files outside the first extension list, and template or backup suffixes', () => {
    const CONFIG_EXTENSIONS_AND_NAMES = [
      'App.vcxproj', 'App.sqlproj', 'App.wixproj', 'build.proj', 'App.ccproj', 'App.dcproj', 'App.jsproj', 'App.projitems', 'ServiceConfiguration.cscfg',
      'ServiceDefinition.csdef', 'plan.jmx', 'wifi.mobileconfig', 'app.entitlements', 'module.iml', 'run.launch', 'rules.ruleset',
      'Package.appxmanifest', 'setup.wxs', 'lib-1.0.pom', 'app.jnlp',
      'settings.xml.template', 'settings.xml.dist', 'settings.xml.sample', 'settings.xml.example', 'settings.xml.erb', 'settings.xml.j2',
      'settings.xml.jinja2', 'settings.xml.tpl', 'settings.xml.tmpl', 'settings.xml.bak', 'settings.xml.orig', 'settings.xml.default', 'settings.xml.in',
      'web.config.template', 'App.csproj.erb', 'conf/server.xml.dist.bak',
    ];
    it.each(CONFIG_EXTENSIONS_AND_NAMES)('%s is XML configuration', (file) => {
      expect(isXmlConfigPath(file)).toBe(true);
      expect(fileMode(file)).toBe('config');
      for (const shape of [`<${PASSWORD}>${random}</${PASSWORD}>`, `<${PASSWORD}>${passphrase}</${PASSWORD}>`, `<add key="ApiKey" value="${random}"/>`]) {
        expect(scanText(file, `${shape}\n`).length, `${file}: ${shape}`).toBeGreaterThan(0);
      }
    });

    it('the plist-like Apple profile form <key>Password</key><string>V</string> is found', () => {
      expect(scanText('wifi.mobileconfig', `<dict><key>${['Pass', 'word'].join('')}</key><string>${random}</string></dict>\n`).length).toBeGreaterThan(0);
    });

    it.each(['icon.svg', 'index.html', 'page.htm', 'page.xhtml', 'style.xsl', 'style.xslt', 'View.xaml', 'schema.xsd', 'feed.rss', 'feed.atom', 'map.kml'])('%s stays in code mode (markup and schema, not settings): a form label or a passphrase-like text is not noisy', (file) => {
      expect(isXmlConfigPath(file)).toBe(false);
      expect(fileMode(file)).toBe('code');
      const text = `<${PASSWORD}>${passphrase}</${PASSWORD}>\n<label>Enter your ${PASSWORD} here</label>\n<input type="${PASSWORD}" name="${PASSWORD}" placeholder="Your ${PASSWORD}">\n`;
      expect(scanText(file, text), file).toEqual([]);
    });

    it.each(['notes.md', 'app.js', 'app.js.template', 'x.py.bak'])('%s is not XML configuration', (file) => {
      expect(isXmlConfigPath(file)).toBe(false);
    });

    it('a suffix-only name is not stripped to nothing', () => {
      expect(isXmlConfigPath('.template')).toBe(false);
      expect(isXmlConfigPath('.bak')).toBe(false);
    });
  });

  describe('common non-secret XML is not noisy', () => {
    it.each([
      ['an Android Maps key as a resource reference', 'AndroidManifest.xml', '<meta-data android:name="com.google.android.geo.API_KEY" android:value="@string/maps_key"/>'],
      ['the same tag split over three lines', 'AndroidManifest.xml', '<meta-data\n  android:name="com.google.android.geo.API_KEY"\n  android:value="@string/maps_key"/>'],
      ['a color and an attr reference', 'app/src/main/res/values/styles.xml', '<item name="secretColor">@color/red</item><item name="tokenBg">?attr/colorPrimary</item>'],
      ['an @token@ substitution', 'build.xml', `<${PASSWORD}>@${PASSWORD}@</${PASSWORD}>`],
      ['a #{token} substitution', 'pom.xml', `<${PASSWORD}>#{${PASSWORD}}</${PASSWORD}>`],
      ['a %%TOKEN%% substitution', 'settings.xml', `<${PASSWORD}>%%${PASSWORD.toUpperCase()}%%</${PASSWORD}>`],
      ['a D-Bus interface', 'org.example.Home.xml', '<property name="Foo" type="s" access="read">\n  <annotation name="org.freedesktop.DBus.Property.EmitsChangedSignal" value="invalidates"/>\n</property>\n<method name="Activate">\n  <arg type="s" name="secret" direction="in"/>\n</method>'],
      ['a D-Bus interface with an entry-like tag before', 'org.example.Home.xml', '<property name="A" type="s" access="read"><annotation name="X" value="invalidates"/></property><item><arg type="s" name="secret" direction="in"/></item>'],
      ['Maven reference example blocks', 'conf/settings.xml', `<proxy><id>example-proxy</id><host>proxy.example.com</host><username>proxyuser</username><${PASSWORD}>proxypass</${PASSWORD}></proxy>\n<server><id>siteServer</id><privateKey>/path/to/private/key</privateKey><passphrase>optional; leave empty if not used.</passphrase></server>`],
    ])('%s is clean', (_label, file, text) => {
      expect(scanText(file, `${text}\n`), text).toEqual([]);
    });

    it('a real value is still found next to those examples', () => {
      expect(scanText('AndroidManifest.xml', `<meta-data android:name="com.google.android.geo.API_KEY" android:value="${random}"/>\n`).length).toBeGreaterThan(0);
      expect(scanText('settings.xml', `<server><privateKey>${random}</privateKey></server>\n`).length).toBeGreaterThan(0);
      expect(scanText('settings.xml', `<server><${PASSWORD}>${passphrase}</${PASSWORD}></server>\n`).length).toBeGreaterThan(0);
      expect(scanText('settings.xml', `<property name="Foo" type="s"><annotation name="X" value="y"/></property>\n<add key="${NAME}" value="${random}"/>\n`).length).toBeGreaterThan(0);
    });

    // Class: sentence punctuation is not a documentation cue. A passphrase of plain words stays a finding whatever ends it, in
    // XML (element text, CDATA, a key= entry) and in every other format; only a documentation cue (or a message catalog) exempts.
    const ENDINGS = ['', '!', '.', '?', ',', ';', ':', '...', '\u2026', '!!', '"', ')', ' :)', '\u3002', '\uFF01', '\u{1F600}'];
    const plainPhrase = ['tulip', 'marble', 'sunset', 'harbor'].join(' ');
    const ARRANGEMENTS = [
      ['an XML element', 'settings.xml', (v) => `<server><${PASSWORD}>${v}</${PASSWORD}></server>\n`],
      ['an XML CDATA element', 'settings.xml', (v) => `<server><${PASSWORD}><![CDATA[${v}]]></${PASSWORD}></server>\n`],
      ['an XML key entry', 'app.config', (v) => `<entry key="${PASSWORD}">${v}</entry>\n`],
      ['an XML attribute', 'app.config', (v) => `<add key="${PASSWORD}" value="${v}"/>\n`],
      ['a quoted YAML value', 'config.yml', (v) => `${PASSWORD}: "${v}"\n`],
      ['a bare YAML value', 'config.yml', (v) => `${PASSWORD}: ${v}\n`],
      ['an ini value', 'config.ini', (v) => `${PASSWORD} = ${v}\n`],
      ['a properties value', 'config.properties', (v) => `db.${PASSWORD}=${v}\n`],
      ['a JSON value', 'config.json', (v) => `{"${PASSWORD}": "${v}"}\n`],
      ['a TOML value', 'config.toml', (v) => `${PASSWORD} = "${v}"\n`],
      ['a quoted env value', '.env', (v) => `DB_${PASSWORD.toUpperCase()}="${v}"\n`],
      ['a bare env value', '.env', (v) => `DB_${PASSWORD.toUpperCase()}=${v}\n`],
      ['a CSV cell', 'export.csv', (v) => `name,value\n${PASSWORD},"${v}"\n`],
      ['a Markdown table cell', 'notes.md', (v) => `| Name | Value |\n|---|---|\n| DB_${PASSWORD.toUpperCase()} | \`${v}\` |\n`],
    ];
    describe.each(ARRANGEMENTS)('%s', (_label, file, make) => {
      it.each(ENDINGS)(`a passphrase of plain words ending in %j is found`, (ending) => {
        expect(scanText(file, make(`${plainPhrase}${ending}`)).length).toBeGreaterThan(0);
      });
    });

    it.each([
      'the password you chose during setup.',
      'Enter your password.',
      'Ask your team lead for the password.',
      'Set via environment variable at runtime.',
    ])('documentation prose %j stays exempt in XML, as it does elsewhere', (prose) => {
      expect(scanText('settings.xml', `<server><${PASSWORD}>${prose}</${PASSWORD}></server>\n`)).toEqual([]);
      expect(scanText('config.yml', `${PASSWORD}: "${prose}"\n`)).toEqual([]);
    });

    it('a sentence with a documentation cue plus a random word is still found', () => {
      expect(scanText('settings.xml', `<server><${PASSWORD}>the password you chose is ${random}!</${PASSWORD}></server>\n`).length).toBeGreaterThan(0);
    });

    it('a message catalog keeps its exemption for a punctuated sentence, and the same text elsewhere is found', () => {
      const text = `<resources><string name="${PASSWORD}">This is the way!</string></resources>\n`;
      expect(scanText('app/src/main/res/values/auth.xml', text)).toEqual([]);
      expect(scanText('settings.xml', text).length).toBeGreaterThan(0);
      expect(scanText('i18n/en.json', `{"${PASSWORD}": "${plainPhrase}\u2026"}\n`)).toEqual([]);
    });

    it('a trailing ellipsis still marks a cut-off token as a placeholder', () => {
      expect(scanText('config.yml', `${PASSWORD}: "Bearer ${random.slice(0, 12)}..."\n`)).toEqual([]);
      expect(scanText('config.yml', `${PASSWORD}: "${random.slice(0, 12)}..."\n`)).toEqual([]);
    });

    it('an Android res/values sentence under a password-like name is a message, but the same text elsewhere is a passphrase', () => {
      // Not strings.xml: that name is already a message catalog by its file name, so only the res/values directory rule counts here.
      const text = `<resources><string name="${PASSWORD}">This is the way</string></resources>\n`;
      expect(scanText('app/src/main/res/values/auth.xml', text)).toEqual([]);
      expect(scanText('app/src/main/res/values-fr/auth.xml', text)).toEqual([]);
      expect(scanText('settings.xml', text).length).toBeGreaterThan(0);
    });
  });

  describe('provider tokens: Slack, SendGrid and Sentry shapes', () => {
    const digits = (n, seed) => randomString(n, seed, DIGITS);
    it.each([
      'xoxo-love-and-kisses-2026',
      'xoxo-team-2026-Q1-kickoff-notes',
      'xoxe-1-planning-2026-notes-for-the-quarter-review-meeting-agenda-items-list',
      `${['xapp', '-1-A0000000000-0000000000000-'].join('')}${'0'.repeat(64)}`,
      `${['xox', 'b-000000000000-000000000000-'].join('')}${'x'.repeat(24)}`,
      `${['xox', 'o-'].join('')}${'0'.repeat(12)}-${'0'.repeat(12)}-${'0'.repeat(12)}-${'0'.repeat(32)}`,
      `${['S', 'G.'].join('')}${'x'.repeat(22)}.${'y'.repeat(43)}`,
      `${['S', 'G.'].join('')}${'a'.repeat(22)}.${'b'.repeat(43)}`,
    ])('%s is not a token', (text) => {
      for (const file of ['a.md', 'a.json', 'a.js']) expect(scanText(file, `see ${text} here\n`), file).toEqual([]);
    });

    it('the documented xoxo and xoxe shapes are found', () => {
      const xoxo = `${['xox', 'o-'].join('')}${digits(12, 3301)}-${digits(12, 3302)}-${digits(12, 3303)}-${randomString(32, 3304, HEX)}`;
      const xoxe = `${['xox', 'e-1-'].join('')}${randomString(100, 3305, `${ALNUM}_-`)}`;
      for (const token of [xoxo, xoxe]) for (const file of ['a.md', 'a.json', 'a.js']) expect(rulesOf(file, `see ${token} here\n`)).toContain('slack-token');
    });

    it('a Sentry DSN is reported only when it carries the deprecated secret half', () => {
      const key = randomString(32, 3401, HEX);
      const secret = randomString(32, 3402, HEX);
      const publicDsn = `${scheme}${key}@o123.ingest.sentry.io/456`;
      const secretDsn = `${scheme}${key}:${secret}@o123.ingest.sentry.io/456`;
      for (const file of ['a.js', 'a.json', 'a.md']) {
        expect(rulesOf(file, `Sentry.init({ dsn: '${publicDsn}' });\n`), file).not.toContain('sentry-token');
        expect(rulesOf(file, `Sentry.init({ dsn: '${secretDsn}' });\n`), file).toContain('sentry-token');
      }
    });
  });

  describe('placeholders for the added provider families pass', () => {
    const pad = (prefix, n, ch = 'x') => `${prefix}${ch.repeat(n)}`;
    it.each([
      pad('123456789:A' + 'A', 33),
      pad(['sk', '.eyJ'].join(''), 40) + '.' + 'x'.repeat(22),
      pad(['sq0', 'atp-'].join(''), 22),
      pad(['sq0', 'csp-'].join(''), 43),
      pad(['NR', 'AK-'].join(''), 27, 'X'),
      pad(['cf', 'ut_'].join(''), 48),
      pad(['xox', 'e-1-'].join(''), 100, '0'),
      `M${'x'.repeat(24)}.${'x'.repeat(6)}.${'x'.repeat(30)}`,
    ])('%s... passes', (value) => {
      for (const [file, text] of [['a.json', `{"note":"${value}"}\n`], ['a.md', `token ${value}\n`], ['a.js', `const t = "${value}";\n`]]) {
        expect(rulesOf(file, text), file).toEqual([]);
      }
    });
  });

  describe('the quadratic all-uppercase body is gone', () => {
    it('nameWords-driven placeholder checks stay fast on a long all-uppercase token body (killable child)', SLOW, () => {
      const timings = timeInChild(`
        for (const [label, file, text] of [
          ['ATBB x4096', 'package-lock.json', 'ATBB'.repeat(16 * 256)],
          ['ATBB x64k', 'a.md', 'ATBB'.repeat(16 * 1024)],
          ['glpat A 64k', 'a.md', 'glpat-' + 'A'.repeat(64 * 1024)],
          ['sk-ant A 64k', 'settings.xml', 'sk-ant-' + 'A'.repeat(64 * 1024)],
          ['upper name 64k', 'a.env', 'API_' + 'KEY'.repeat(20000) + '=x'],
        ]) {
          const started = performance.now();
          scanText(file, text);
          timings.push([label, Math.round(performance.now() - started)]);
        }`);
      for (const [label, ms] of timings) expect(ms, label).toBeLessThan(2000);
    });
  });
});

// ---------------------------------------------------------------------------
// Audit round: command-start anchors, unmerged index modes, markers on separated value lines, whole curl -u arguments.
// Every credential below is fake and built at runtime, so no literal in this file is secret-shaped.
// ---------------------------------------------------------------------------
describe('secret-cli-command: the value source may sit anywhere before the pipe', () => {
  const NAME = secretName('JWT_', 'SECRET');
  const value = randomString(24, 8101);
  const rules = (text, file = 'deploy.sh') => scanText(file, text).map((f) => f.rule);

  const positives = [
    ['indented echo', `  echo ${value} | vercel env add ${NAME} production\n`],
    ['tab-indented echo', `\techo ${value} | vercel env add ${NAME}\n`],
    ['CRLF line ending', `  echo ${value} | vercel env add ${NAME}\r\n`],
    ['YAML run block', `jobs:\n  deploy:\n    steps:\n      - run: |\n          echo ${value} | vercel env add ${NAME}\n`],
    ['YAML inline run', `      - run: echo ${value} | vercel env add ${NAME}\n`],
    ['shell function body', `deploy() {\n    echo ${value} | vercel env add ${NAME}\n}\n`],
    ['after &&', `cd app && echo ${value} | vercel env add ${NAME}\n`],
    ['after ||', `cd app || echo ${value} | vercel env add ${NAME}\n`],
    ['after a pipe', `cat x | echo ${value} | vercel env add ${NAME}\n`],
    ['subshell', `(echo ${value} | vercel env add ${NAME})\n`],
    ['command substitution', `$(echo ${value} | vercel env add ${NAME})\n`],
    ['then', `if x; then echo ${value} | vercel env add ${NAME}; fi\n`],
    ['then on its own line', `  then echo ${value} | vercel env add ${NAME}\n`],
    ['do', `for e in a b; do echo ${value} | vercel env add ${NAME}; done\n`],
    ['else', `else echo ${value} | vercel env add ${NAME}\n`],
    ['brace group', `{ echo ${value} | vercel env add ${NAME}; }\n`],
    ['negation', `! echo ${value} | vercel env add ${NAME}\n`],
    ['time prefix', `time echo ${value} | vercel env add ${NAME}\n`],
    ['prompt prefix', `$ echo ${value} | vercel env add ${NAME}\n`],
    ['markdown list item', `- echo ${value} | vercel env add ${NAME}\n`],
    ['/bin/echo', `/bin/echo ${value} | vercel env add ${NAME}\n`],
    ['command echo', `command echo ${value} | vercel env add ${NAME}\n`],
    ['echo -n', `  echo -n ${value} | vercel env add ${NAME}\n`],
    ['echo -n quoted', `  echo -n "${value}" | vercel env add ${NAME}\n`],
    ['no spaces around the pipe', `true &&echo ${value}|vercel env add ${NAME}\n`],
    ['sudo on the CLI', `echo ${value} | sudo vercel env add ${NAME}\n`],
    ['env prefix on the CLI', `echo ${value} | env FOO=1 vercel env add ${NAME}\n`],
    ['bash -c', `bash -c "echo ${value} | vercel env add ${NAME}"\n`],
    ['sh -c single quotes', `sh -c 'echo ${value} | vercel env add ${NAME}'\n`],
    ['value-preserving filter', `  echo ${value} | tr -d '\\n' | vercel env add ${NAME}\n`],
    ['printf %s', `  printf '%s' "${value}" | vercel env add ${NAME}\n`],
    ['printf %s\\n', `  printf '%s\\n' ${value} | vercel env add ${NAME}\n`],
    ['printf with the value as format', `  printf ${value} | vercel env add ${NAME}\n`],
    ['pipe at the end of the previous line', `  echo ${value} |\n    vercel env add ${NAME}\n`],
    ['backslash continuation', `  echo ${value} | \\\n    sudo vercel env add ${NAME}\n`],
    ['gh secret set', `  echo ${value} | gh secret set ${NAME}\n`],
    ['netlify positional', `  echo ${value} | netlify env:set ${NAME}\n`],
    ['here-string, indented', `  vercel env add ${NAME} <<< ${value}\n`],
    ['here-string after sudo', `  sudo vercel env add ${NAME} <<< "${value}"\n`],
    ['cat heredoc into the CLI', `cat <<'EOF' | vercel env add ${NAME}\n${value}\nEOF\n`],
    ['indented cat heredoc', `  cat <<EOF | sudo vercel env add ${NAME}\n${value}\nEOF\n`],
    ['heredoc on the CLI', `vercel env add ${NAME} <<EOF\n${value}\nEOF\n`],
    ['tab-stripping heredoc', `\tvercel env add ${NAME} <<-EOF\n\t\t${value}\n\tEOF\n`],
    ['netlify heredoc', `netlify env:set ${NAME} <<EOF\n${value}\nEOF\n`],
  ];
  it.each(positives)('finds a literal secret: %s', (_label, text) => {
    expect(rules(text)).toContain('secret-cli-command');
  });

  const negatives = [
    ['placeholder value', `  echo your_jwt_secret_here | vercel env add ${NAME}\n`],
    ['environment reference', `  echo "$JWT_VALUE" | vercel env add ${NAME}\n`],
    ['braced reference', `  echo "\${JWT_VALUE}" | vercel env add ${NAME}\n`],
    ['non-secret variable name', `  echo ${value} | vercel env add PUBLIC_URL\n`],
    ['echo feeds a different command, then a separate one runs', `echo ${value} | tee log; vercel env add ${NAME} </dev/null\n`],
    ['echo feeds a command that is followed by &&', `echo ${value} | cat && vercel env add ${NAME}\n`],
    ['echo on an earlier line, no pipe', `echo ${value}\nvercel env add ${NAME}\n`],
    ['heredoc placeholder', `cat <<EOF | vercel env add ${NAME}\nyour_secret_here\nEOF\n`],
    ['heredoc reference', `vercel env add ${NAME} <<EOF\n\${JWT_VALUE}\nEOF\n`],
    ['redirect from a file', `netlify env:set ${NAME} < secret.txt\n`],
  ];
  it.each(negatives)('passes: %s', (_label, text) => {
    expect(rules(text)).toEqual([]);
  });

  it('stays fast on a long line of echo words', SLOW, () => {
    const started = performance.now();
    scanText('a.sh', `${'echo | '.repeat(20000)}vercel env add ${NAME} x\n`);
    scanText('a.sh', `${'echo '.repeat(20000)}| vercel env add ${NAME} x\n`);
    expect(performance.now() - started).toBeLessThan(HOSTILE_LIMIT_MS);
  });
});

describe('unmerged index entries: only a gitlink stage is skipped', () => {
  const NAME = secretName('JWT_', 'SECRET');
  const value = randomString(28, 8203);
  const gitlinkId = 'a'.repeat(40);
  const dirs = [];
  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
  });

  const run = (cmd, args, cwd, input) => spawnSync(cmd, args, { cwd, encoding: 'utf8', input, timeout: SLOW_TEST_MS });

  /** stages: [stage, mode, content | null]; a null content is a gitlink. `working`: what the working tree holds. */
  function scenario(stages, working) {
    const dir = mkdtempSync(path.join(tmpdir(), 'check-secrets-'));
    dirs.push(dir);
    expect(run('git', ['init', '-q'], dir).status).toBe(0);
    const lines = stages.map(([stage, mode, content]) => {
      const id = content === null ? gitlinkId : run('git', ['hash-object', '-w', '--stdin'], dir, content).stdout.trim();
      return `${mode} ${id} ${stage}\tapp.env\n`;
    });
    expect(run('git', ['update-index', '--index-info'], dir, lines.join('')).status).toBe(0);
    if (working === 'file') writeFileSync(path.join(dir, 'app.env'), `${NAME}=changeme\n`);
    if (working === 'symlink') symlinkSync('target.txt', path.join(dir, 'app.env'));
    if (working === 'directory') {
      mkdirSync(path.join(dir, 'app.env'));
      writeFileSync(path.join(dir, 'app.env', 'x.txt'), 'x\n');
    }
    const result = run(process.execPath, [SCANNER], dir);
    return { result, output: `${result.stdout}\n${result.stderr}` };
  }

  const leaky = `${NAME}=${value}\n`;
  const clean = `${NAME}=changeme\n`;
  const cases = [
    ['gitlink stage 1 hides a regular stage 2', [[1, '160000', null], [2, '100644', leaky]], 'none'],
    ['... with a regular working file', [[1, '160000', null], [2, '100644', leaky]], 'file'],
    ['... with a directory in the working tree', [[1, '160000', null], [2, '100644', leaky]], 'directory'],
    ['gitlink stage 2, executable stage 3', [[2, '160000', null], [3, '100755', leaky]], 'none'],
    ['gitlink stage 3 after a leaky stage 2', [[2, '100644', leaky], [3, '160000', null]], 'file'],
    ['symlink stage 1, regular stage 2', [[1, '120000', 'target.txt'], [2, '100644', leaky]], 'file'],
    ['symlink stage 1, regular stage 2, nothing in the working tree', [[1, '120000', 'target.txt'], [2, '100644', leaky]], 'none'],
    ['executable stage 1, symlink stage 2, symlink in the working tree', [[1, '100755', leaky], [2, '120000', 'target.txt']], 'symlink'],
    ['leaky symlink stage 1, clean regular stage 2', [[1, '120000', leaky], [2, '100644', clean]], 'symlink'],
    ['three stages, three modes', [[1, '160000', null], [2, '120000', 'target.txt'], [3, '100755', leaky]], 'none'],
  ];
  it.skipIf(!hasGit()).each(cases)('%s is reported and leaks nothing', SLOW, (_label, stages, working) => {
    const { result, output } = scenario(stages, working);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('app.env:1  secret-assignment');
    for (const piece of windows(value)) expect(output).not.toContain(piece);
  });

  it.skipIf(!hasGit())('a path that is a gitlink in every stage is still skipped and counted', SLOW, () => {
    const { result } = scenario([[1, '160000', null], [2, '160000', null]], 'none');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1 skipped: 1 submodule');
  });

  it.skipIf(!hasGit())('clean stages of mixed modes pass', SLOW, () => {
    const { result } = scenario([[1, '100755', clean], [2, '100644', clean]], 'file');
    expect(result.status).toBe(0);
  });
});

describe('allow marker on the value line of a separated name/value pair', () => {
  const NAME = secretName('JWT_', 'SECRET');
  const value = randomString(26, 8307);
  const M = ALLOW_MARKER;
  const count = (file, text) => scanText(file, text).length;

  const suppressed = [
    ['YAML list item, adjacent', 'd.yaml', `- name: ${NAME}\n  value: ${value} # ${M}\n`],
    ['YAML list item, other fields between', 'd.yaml', `- name: ${NAME}\n  type: plain\n  note: x\n  value: ${value} # ${M}\n`],
    ['YAML list item, value first', 'd.yaml', `- value: ${value} # ${M}\n  type: plain\n  name: ${NAME}\n`],
    ['Kubernetes env entry', 'd.yaml', `env:\n  - name: ${NAME}\n    value: ${value} # ${M}\n`],
    ['JSON object, value last', 'd.json', `{\n  "key": "${NAME}",\n  "type": "plain",\n  "value": "${value}" // ${M}\n}\n`],
    ['JSON object, value first', 'd.json', `{\n  "value": "${value}", // ${M}\n  "type": "plain",\n  "key": "${NAME}"\n}\n`],
    ['XML property, value last', 'd.xml', `<property>\n<name>${NAME}</name>\n<description>d</description>\n<value>${value}</value> <!-- ${M} -->\n</property>\n`],
    ['XML property, value first', 'd.xml', `<property>\n<value>${value}</value> <!-- ${M} -->\n<description>d</description>\n<name>${NAME}</name>\n</property>\n`],
    ['mapping key with a nested value', 'd.yaml', `${NAME}:\n  description: x\n  value: ${value} # ${M}\n`],
    ['HCL block', 'main.tf', `variable "x" {\n  name = "${NAME}"\n  description = "d"\n  value = "${value}" # ${M}\n}\n`],
  ];
  it.each(suppressed)('a marker on the value line suppresses: %s', (_label, file, text) => {
    expect(count(file, text)).toBe(0);
    // the same document without the marker is a finding (the fixture is real)
    expect(count(file, text.replaceAll(M, 'note'))).toBe(1);
  });

  const notSuppressed = [
    ['YAML list item', 'd.yaml', `- name: ${NAME}\n  type: plain # ${M}\n  value: ${value}\n`],
    ['YAML list item, value first', 'd.yaml', `- value: ${value}\n  type: plain # ${M}\n  name: ${NAME}\n`],
    ['JSON object', 'd.json', `{\n  "key": "${NAME}",\n  "type": "plain", // ${M}\n  "value": "${value}"\n}\n`],
    ['mapping key with a nested value', 'd.yaml', `${NAME}:\n  description: x # ${M}\n  value: ${value}\n`],
    ['HCL block', 'main.tf', `variable "x" {\n  name = "${NAME}"\n  description = "d" # ${M}\n  value = "${value}"\n}\n`],
  ];
  it.each(notSuppressed)('a marker on an unrelated line in between does not suppress: %s', (_label, file, text) => {
    expect(count(file, text)).toBe(1);
  });

  it('a marker on one pair does not hide the next pair', () => {
    const other = randomString(26, 8309);
    const text = `- name: ${NAME}\n  value: ${value} # ${M}\n- name: ${secretName('API_', 'TOKEN')}\n  value: ${other}\n`;
    const found = scanText('d.yaml', text);
    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(3);
  });

  it('a marker elsewhere in the file does not suppress a finding whose value range is the whole window', () => {
    const escaped = `{"a":"{\\"key\\":\\"${NAME}\\",\\"value\\":\\"${value}\\"}",\n"b":"x"}\n# ${M}\n`;
    expect(count('d.json', escaped)).toBe(1);
  });
});

describe('curl -u and the other password flags judge the whole argument', () => {
  const host = 'https://api.internal.corp/v1';
  const first = ['pass', 'word'].join(''); // a placeholder-like first word
  const phrase = `${first} ${['correct', 'horse', 'battery'].join(' ')} 123!`;
  const token = randomString(20, 8419);
  const rules = (text, file = 'run.sh') => scanText(file, text).map((f) => f.rule);
  const escapedPhrase = phrase.replaceAll(' ', '\\ ');

  const positives = [
    ['double quotes', `curl -u "admin:${phrase}" ${host}\n`],
    ['single quotes', `curl -u 'admin:${phrase}' ${host}\n`],
    ['ANSI-C quotes', `curl -u $'admin:${phrase}' ${host}\n`],
    ['escaped spaces', `curl -u admin:${escapedPhrase} ${host}\n`],
    ['--user', `curl --user "admin:${phrase}" ${host}\n`],
    ['--user=', `curl --user="admin:${phrase}" ${host}\n`],
    ['-u attached to its quote', `curl -u"admin:${phrase}" ${host}\n`],
    ['-u attached to a bare value', `curl -uadmin:${token} ${host}\n`],
    ['a flag cluster ending in u', `curl -sSu "admin:${phrase}" ${host}\n`],
    ['--proxy-user', `curl --proxy-user "admin:${phrase}" ${host}\n`],
    ['--proxy-user, bare', `curl --proxy-user admin:${token} ${host}\n`],
    ['-U', `curl -U "admin:${phrase}" ${host}\n`],
    ['-U, bare', `curl -U admin:${token} ${host}\n`],
    ['a reference plus literal words', `curl -u "admin:\${API_PASS} extra words here 9" ${host}\n`], // check-secrets:allow
    ['curl --pass phrase', `curl --cert c.pem --pass "${phrase}" ${host}\n`],
    ['wget --password', `wget --user=admin --password "${phrase}" ${host}\n`],
    ['wget --password=', `wget --password="${phrase}" ${host}\n`],
    ['wget --http-password', `wget --http-password='${phrase}' ${host}\n`],
    ['wget --ftp-password', `wget --ftp-password ${token} ftp://h/x\n`],
    ['wget --proxy-password', `wget --proxy-password=${token} ${host}\n`],
    ['httpie -a', `http -a "admin:${phrase}" ${host}\n`],
    ['httpie --auth', `http --auth 'admin:${phrase}' ${host}\n`],
    ['httpie -a, bare', `http -a admin:${token} ${host}\n`],
    ['https -a', `https -a admin:${token} api.internal.corp/x\n`],
    ['xh -a', `xh -a admin:${token} ${host}\n`],
    ['httpie bearer token', `http -A bearer -a ${token} ${host}\n`],
    ['mysql -p attached', `mysql -u root -p${token} db\n`],
    ['mysql -p quoted', `mysql -u root -p'${phrase}' db\n`],
    ['mysql --password=', `mysql --password="${phrase}" db\n`],
    ['mysqldump -p', `mysqldump -u root -p${token} db\n`],
    ['mongosh --password', `mongosh --username u --password "${phrase}"\n`],
    ['mongosh -p', `mongosh -u u -p ${token}\n`],
    ['redis-cli -a', `redis-cli -a ${token} ping\n`],
    ['redis-cli -a quoted', `redis-cli -a "${phrase}" ping\n`],
    ['redis-cli --pass', `redis-cli --pass ${token} ping\n`],
    ['sshpass -p', `sshpass -p ${token} ssh u@h\n`],
    ['sshpass -p quoted', `sshpass -p "${phrase}" ssh u@h\n`],
    ['smbclient -U user%password', `smbclient -U 'admin%${token}' //h/s\n`],
    ['ldapsearch -w', `ldapsearch -D cn=x -w ${token}\n`],
  ];
  it.each(positives)('finds the password: %s', (_label, text) => {
    expect(rules(text)).toContain('url-password');
  });

  const negatives = [
    ['placeholder password', `curl -u admin:${first} ${host}\n`],
    ['placeholder in quotes', `curl -u "admin:your_password_here" ${host}\n`],
    ['angle-bracket placeholder', `curl -u "admin:<password>" ${host}\n`],
    ['environment reference', `curl -u "admin:$API_PASS" ${host}\n`],
    ['braced reference', `curl -u "admin:\${API_PASS}" ${host}\n`],
    ['user only (prompts)', `curl -u admin ${host}\n`],
    ['docker -u uid', 'docker run -u root:root img\n'],
    ['documentation about the password', `curl -u "user:the password you chose during setup" ${host}\n`],
    ['an unterminated quote belongs to the surrounding string', `x: 'curl -u user:${first}', ${host}\n`],
    ['mysql -p prompts', 'mysql -u root -p db\n'],
    ['mysql --password without a value', 'mysql --password db\n'],
    ['httpie -a placeholder', `http -a user:${first} ${host}\n`],
    ['httpie -a without a password', `http -a admin ${host}\n`],
    ['redis-cli reference', 'redis-cli -a "$REDIS_PASS" ping\n'],
    ['wget reference', 'wget --password="$FTP_PASS" ftp://h/x\n'],
    ['sshpass reference', 'sshpass -p "${SSH_PASS}" ssh u@h\n'],
  ];
  it.each(negatives)('passes: %s', (_label, text) => {
    expect(rules(text)).toEqual([]);
  });

  it('never prints or stores the password, whole or in part', () => {
    const found = scanText('run.sh', `curl -u "admin:${phrase}" ${host}\n`);
    expect(JSON.stringify(found)).not.toContain('battery');
    expect(Object.keys(found[0]).sort()).toEqual(['line', 'path', 'rule']);
  });

  it('stays fast on hostile flag lines', SLOW, () => {
    const started = performance.now();
    for (const text of [
      `curl ${'-u '.repeat(30000)}\n`,
      `curl -u${' '.repeat(100000)}x\n`,
      `curl -u "${'a:'.repeat(50000)}\n`,
      `${'wget --password '.repeat(5000)}\n`,
      `${'mysql -p'.repeat(20000)}\n`,
      `${'http '.repeat(50000)}-a\n`,
    ]) {
      scanText('a.sh', text);
    }
    expect(performance.now() - started).toBeLessThan(HOSTILE_LIMIT_MS);
  });
});

// ---------------------------------------------------------------------------
// Review round 11
//   (1) command-style assignments: shell syntaxes that set a variable without "name=value"
//   (2) values that span lines: heredocs, triple quotes, template literals, quotes closed later, continuations
//   (3) --range / --history: a verified binary is skipped whatever its size; text over the limit still fails closed
// Every fixture is assembled at runtime from pieces (this file holds no secret-shaped literal).
// ---------------------------------------------------------------------------

describe('review round 11 (1): command-style assignments without "="', () => {
  const NAME = ['API_', 'TOKEN'].join('');
  const LOWER_NAME = ['api', 'token'].join('_');
  const PASSWORD_NAME = ['DB_', 'PASSWORD'].join('');
  const value = randomString(24, 8101);
  const passphrase = ['correct', 'horse', 'battery', 'staple'].join(' ');
  const placeholder = ['your', 'token', 'here'].join('_');
  const count = (file, text) => scanText(file, text).length;

  // [label, file, text]: each is a secret and must be reported by the scanner.
  const flagged = [
    // fish: every flag spelling, quoted and unquoted values, several values
    ['fish -gx', 'config.fish', `set -gx ${NAME} ${value}\n`],
    ['fish long flags and a passphrase', 'config.fish', `set --global --export ${NAME} "${passphrase}"\n`],
    ['fish single-quoted passphrase', 'config.fish', `set -x ${NAME} '${passphrase}'\n`],
    ['fish -Ux', 'config.fish', `set -Ux ${NAME} ${value}\n`],
    ['fish -U', 'config.fish', `set -U ${NAME} ${value}\n`],
    ['fish -l', 'config.fish', `set -l ${PASSWORD_NAME} ${value}\n`],
    ['fish --universal --export', 'config.fish', `set --universal --export ${NAME} ${value}\n`],
    ['fish --local', 'config.fish', `set --local ${NAME} ${value}\n`],
    ['fish --append', 'config.fish', `set --append ${NAME} ${value}\n`],
    ['fish --prepend', 'config.fish', `set --prepend ${NAME} ${value}\n`],
    ['fish without flags', 'config.fish', `set ${NAME} ${value}\n`],
    ['fish list written as an unquoted passphrase', 'config.fish', `set -gx ${NAME} ${passphrase}\n`],
    ['fish list whose second element is the secret', 'config.fish', `set -gx ${NAME} short ${value}\n`],
    ['fish inside fish -c in a shell script', 'setup.sh', `fish -c 'set -gx ${NAME} ${value}'\n`],
    ['fish after && on a line', 'setup.sh', `mkdir -p x && set -gx ${NAME} ${value}\n`],
    ['fish in a heredoc that a shell script writes', 'setup.sh', `cat > ~/.config/fish/config.fish <<'EOF'\nset -gx ${NAME} ${value}\nEOF\n`],
    ['fish in a heredoc in a CI step', 'ci.yml', `steps:\n  - run: |\n      cat > c.fish <<EOF\n      set -gx ${NAME} "${passphrase}"\n      EOF\n`],
    ['fish in a Python string', 'tool.py', `SCRIPT = """\nset -gx ${NAME} ${value}\n"""\n`],
    ['fish in a fenced Markdown block', 'README.md', `Add to config:\n\n\`\`\`fish\nset -gx ${NAME} ${value}\n\`\`\`\n`],
    ['fish in an untagged fence', 'README.md', `\`\`\`\nset -gx ${NAME} ${value}\n\`\`\`\n`],
    ['fish universal variables file', 'fish_variables', `SETUVAR --export ${NAME}:${value}\n`],
    ['fish dotfile name', '.config/fish/conf.d/x.fish', `set -gx ${NAME} ${value}\n`],
    // csh / tcsh
    ['csh setenv', 'env.csh', `setenv ${NAME} ${value}\n`],
    ['csh setenv passphrase', 'env.csh', `setenv ${NAME} "${passphrase}"\n`],
    ['.cshrc setenv', '.cshrc', `setenv ${NAME} ${value}\n`],
    ['tcsh set name = value', '.tcshrc', `set ${LOWER_NAME} = ${value}\n`],
    ['tcsh set name = passphrase', 'env.tcsh', `set ${LOWER_NAME} = "${passphrase}"\n`],
    ['tcsh set name=value', 'env.tcsh', `set ${LOWER_NAME}=${value}\n`],
    ['setenv in a Dockerfile RUN', 'Dockerfile', `RUN setenv ${NAME} ${value}\n`],
    // PowerShell
    ['ps $env:NAME', 'setup.ps1', `$env:${NAME} = '${value}'\n`],
    ['ps $env:NAME passphrase', 'setup.ps1', `$env:${NAME} = "${passphrase}"\n`],
    ['ps ${env:NAME}', 'setup.ps1', `\${env:${NAME}} = '${passphrase}'\n`],
    ['ps $Env:NAME without blanks', 'setup.ps1', `$Env:${NAME}="${value}"\n`],
    ['ps += ', 'setup.ps1', `$env:${NAME} += '${value}'\n`],
    ['ps SetEnvironmentVariable', 'setup.ps1', `[Environment]::SetEnvironmentVariable('${NAME}', '${value}')\n`],
    ['ps [System.Environment]::SetEnvironmentVariable with a scope', 'setup.ps1', `[System.Environment]::SetEnvironmentVariable("${NAME}", "${passphrase}", "User")\n`],
    ['ps Set-Item -Path Env:', 'setup.ps1', `Set-Item -Path Env:${NAME} -Value '${value}'\n`],
    ['ps Set-Item Env:\\', 'setup.ps1', `Set-Item Env:\\${NAME} "${passphrase}"\n`],
    ['ps New-Item Env:', 'setup.ps1', `New-Item -Path Env:${NAME} -Value '${value}'\n`],
    ['ps in a Markdown fence', 'README.md', `\`\`\`powershell\n$env:${NAME} = '${value}'\n\`\`\`\n`],
    ['ps in a JavaScript string', 'tool.js', `const s = "$env:${NAME} = '${value}'";\n`],
    // Windows cmd
    ['cmd set NAME=value', 'setup.bat', `set ${NAME}=${value}\n`],
    ['cmd set "NAME=passphrase"', 'setup.cmd', `set "${NAME}=${passphrase}"\n`],
    ['setx', 'setup.bat', `setx ${NAME} ${value}\n`],
    ['setx with a passphrase and /M', 'setup.bat', `setx ${NAME} "${passphrase}" /M\n`],
    ['setx /M first', 'setup.bat', `setx /M ${NAME} ${value}\n`],
    ['setx in a .ps1', 'run.ps1', `setx ${NAME} ${value}\n`],
    ['setx in a CI step', 'ci.yml', `steps:\n  - run: setx ${NAME} ${value}\n`],
    // sh
    ['export NAME value', 'env.sh', `export ${NAME} ${value}\n`],
    ['export NAME passphrase', 'env.sh', `export ${NAME} "${passphrase}"\n`],
    ['export -n NAME value', 'env.sh', `export -n ${NAME} ${value}\n`],
    ['export in .bashrc (an extensionless start-up file is configuration)', '.bashrc', `export ${NAME}=${value}\n`],
    ['export NAME=value in .zshrc', '.zshrc', `export ${NAME}=${value}\n`],
    ['export NAME=value in .profile', '.profile', `export ${NAME}=${value}\n`],
    ['Dockerfile ONBUILD ENV', 'Dockerfile', `ONBUILD ENV ${NAME} ${value}\n`],
    ['Dockerfile ENV NAME value', 'Dockerfile', `ENV ${NAME} ${value}\n`],
  ];
  it.each(flagged)('reports: %s', (_label, file, text) => {
    const found = scanText(file, text);
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(found[0]).sort()).toEqual(['line', 'path', 'rule']); // never the matched text
  });

  const clean = [
    ['fish placeholder', 'config.fish', `set -gx ${NAME} ${placeholder}\n`],
    ['fish angle-bracket placeholder', 'config.fish', `set -gx ${NAME} <your-token>\n`],
    ['fish variable reference', 'config.fish', `set -gx ${NAME} $OTHER_VALUE\n`],
    ['fish quoted variable reference', 'config.fish', `set -gx ${NAME} "$OTHER_VALUE"\n`],
    ['fish command substitution', 'config.fish', `set -gx ${NAME} (cat ~/.token)\n`],
    ['fish quoted command substitution', 'config.fish', `set -gx ${NAME} "(cat ~/.token)"\n`],
    ['fish erase', 'config.fish', `set -e ${NAME}\n`],
    ['fish query', 'config.fish', `set -q ${NAME}\n`],
    ['fish show', 'config.fish', `set --show ${NAME}\n`],
    ['fish PATH', 'config.fish', 'set -gx PATH $PATH /usr/local/bin\n'],
    ['fish weak name with an address', 'config.fish', 'set -gx TOKEN_ENDPOINT https://auth.example.net/oauth/token\n'],
    ['fish comment', 'config.fish', `# set -gx ${NAME} ${value}\n`],
    ['fish allow marker', 'config.fish', `set -gx ${NAME} ${value} # ${ALLOW_MARKER}\n`],
    ['fish SETUVAR placeholder', 'fish_variables', `SETUVAR --export ${NAME}:${placeholder}\n`],
    ['fish placeholder in a fence', 'README.md', `\`\`\`fish\nset -gx ${NAME} ${placeholder}\n\`\`\`\n`],
    ['the verb "set" in prose outside a fence', 'README.md', `Please set ${LOWER_NAME} ${value} in your shell\n`],
    ['"set token" in a sentence', 'README.md', 'We set token verification on the server.\n'],
    ['a Python sentence', 'tool.py', 'x = "set up token verification"\n'],
    ['a YAML list item that starts with Set', 'ci.yml', '- Set token expiration in the dashboard\n'],
    ['a YAML description', 'ci.yml', 'description: Set token expiration in the dashboard\n'],
    ['bash set -euo pipefail', 'env.sh', 'set -euo pipefail\nset -x\n'],
    ['bash set --', 'env.sh', `set -- "$${NAME}"\n`],
    ['bash set +x NAME', 'env.sh', `set +x ${NAME}\n`],
    ['csh placeholder', 'env.csh', `setenv ${NAME} ${placeholder}\n`],
    ['csh reference', 'env.csh', `setenv ${NAME} $HOME/x\n`],
    ['csh PATH', 'env.csh', 'setenv PATH /usr/bin\n'],
    ['tcsh reference', 'env.tcsh', `set ${LOWER_NAME} = $other\n`],
    ['tcsh command substitution', 'env.tcsh', `set ${LOWER_NAME} = \`cat ~/.tok\`\n`],
    ['sh command substitution in backticks', 'env.sh', `${NAME}=\`cat ~/.tok\`\n`],
    ['ps variable', 'setup.ps1', `$env:${NAME} = $secret\n`],
    ['ps sub-expression', 'setup.ps1', `$env:${NAME} = "$($x.Token)"\n`],
    ['ps placeholder', 'setup.ps1', `$env:${NAME} = '${placeholder}'\n`],
    ['ps Read-Host', 'setup.ps1', `$env:${NAME} = Read-Host "token"\n`],
    ['ps SetEnvironmentVariable with a variable', 'setup.ps1', `[Environment]::SetEnvironmentVariable("${NAME}", $val, "User")\n`],
    ['ps SetEnvironmentVariable placeholder', 'setup.ps1', `[Environment]::SetEnvironmentVariable('${NAME}', '${placeholder}')\n`],
    ['cmd %reference%', 'setup.bat', `set ${NAME}=%SECRET_VAL%\n`],
    ['cmd placeholder', 'setup.bat', `set ${NAME}=${placeholder}\n`],
    ['cmd set /p prompt', 'setup.bat', `set /p ${NAME}=Enter token: \n`],
    ['setx reference', 'setup.bat', `setx ${NAME} %TOKEN_SRC%\n`],
    ['setx placeholder', 'setup.bat', `setx ${NAME} ${placeholder}\n`],
    ['export of two variable names', 'env.sh', `export ${NAME} OTHER_TOKEN\n`],
    ['export of one name', 'env.sh', `export ${NAME}\n`],
    ['export placeholder', 'env.sh', `export ${NAME} ${placeholder}\n`],
    ['Dockerfile ARG without a value', 'Dockerfile', `ARG ${NAME}\n`],
    ['Dockerfile ENV reference', 'Dockerfile', `ENV ${NAME} $\{OTHER}\n`],
    ['JavaScript Set', 'app.js', `const s = new Set(['${NAME}', '${value}']);\n`],
    ['Python set()', 'app.py', `s = {'${NAME}', '${value}'}\nx = set(${LOWER_NAME}, ${value})\n`],
  ];
  it.each(clean)('passes: %s', (_label, file, text) => {
    expect(count(file, text)).toBe(0);
  });

  it('only the distinctive forms are read in source code, and set/export without flags need a shell context', () => {
    expect(count('tool.py', `x = "set ${NAME} ${value}"\n`)).toBe(0); // a bare set in code is not a command
    expect(count('tool.py', `x = "export ${NAME} ${value}"\n`)).toBe(0);
    expect(count('tool.py', `x = "setenv ${NAME} ${value}"\n`)).toBeGreaterThan(0); // setenv is distinctive
  });

  it('fileMode: shell start-up files and the classic shells are configuration', () => {
    for (const file of ['.bashrc', '.zshrc', '.profile', '.bash_profile', '.zshenv', '.cshrc', '.tcshrc', 'env.ksh', 'env.csh', 'env.tcsh', 'setup.bat', 'setup.cmd', 'fish_variables']) {
      expect(fileMode(file), file).toBe('config');
    }
  });

  it('a hostile line of set/setenv/export/flags/quotes is scanned in linear time', SLOW, () => {
    const started = performance.now();
    for (const [file, text] of [
      ['a.fish', `set -gx ${NAME} a `.repeat(50000)],
      ['a.fish', `set ${'-a '.repeat(100000)}${NAME}`],
      ['a.fish', `set${' '.repeat(200000)}x`],
      ['a.csh', `setenv ${NAME} $HOME\n`.repeat(20000)],
      ['a.sh', `export ${NAME} ${'a '.repeat(100000)}`],
      ['a.sh', `${'set '.repeat(50000)}${NAME}`],
      ['a.ps1', `Set-Item${' '.repeat(50000)}Env:${NAME}`],
      ['a.ps1', `${'Set-Item '.repeat(20000)}\n`],
      ['a.ps1', `[Environment]::SetEnvironmentVariable(${"'".repeat(100000)}`],
      ['a.md', `${'```sh\n'.repeat(30000)}set -gx ${NAME} x\n`],
      ['a.md', `${'`'.repeat(200000)}\n`],
      ['fish_variables', `SETUVAR ${NAME}:x\n`.repeat(20000)],
    ]) {
      scanText(file, text);
    }
    expect(performance.now() - started).toBeLessThan(HOSTILE_LIMIT_MS);
  });
});

describe('review round 11 (2): values that span lines', () => {
  const NAME = ['API_', 'TOKEN'].join('');
  const SECRET = ['jwt_', 'secret'].join('');
  const value = randomString(24, 8102);
  const passphrase = ['correct', 'horse', 'battery', 'staple'].join(' ');
  const placeholder = ['your', 'secret', 'here'].join('_');
  const Q3 = '"'.repeat(3);
  const S3 = "'".repeat(3);
  const count = (file, text) => scanText(file, text).length;

  const flagged = [
    // HCL / Terraform heredocs
    ['tf heredoc', 'main.tf', `${SECRET} = <<EOF\n${value}\nEOF\n`],
    ['tf <<- with indentation', 'main.tf', `${SECRET} = <<-EOF\n  ${passphrase}\n  EOF\n`],
    ['tf double-quoted tag', 'main.tf', `${SECRET} = <<"EOF"\n${passphrase}\nEOF\n`],
    ['tf single-quoted tag', 'main.tf', `${SECRET} = <<'EOF'\n${passphrase}\nEOF\n`],
    ['tfvars, the secret on the second line', 'vars.tfvars', `${SECRET} = <<EOT\na line of filler text\n${value}\nEOT\n`],
    ['hcl', 'x.hcl', `${SECRET} = <<EOF\n${passphrase}\nEOF\n`],
    ['tf CRLF line ends', 'main.tf', `${SECRET} = <<EOF\r\n${passphrase}\r\nEOF\r\n`],
    ['tf: a plain heredoc closed only by an indented tag never ends (fail closed)', 'main.tf', `${SECRET} = <<EOF\n${passphrase}\n  EOF\nmore\n`],
    ['tf: an unterminated heredoc is reported (fail closed)', 'main.tf', `${SECRET} = <<EOF\n${passphrase}\n`],
    // TOML
    ['toml """ on one line', 'cfg.toml', `${SECRET} = ${Q3}${passphrase}${Q3}\n`],
    ['toml """ over lines', 'cfg.toml', `${SECRET} = ${Q3}\n${passphrase}\n${Q3}\n`],
    ["toml ''' on one line", 'cfg.toml', `${SECRET} = ${S3}${passphrase}${S3}\n`],
    ["toml ''' over lines, the secret on line two", 'cfg.toml', `${SECRET} = ${S3}\nfiller line\n${value}\n${S3}\n`],
    ['toml line-ending backslash', 'cfg.toml', `${SECRET} = ${Q3}\ncorrect horse \\\n    battery staple${Q3}\n`],
    ['toml: an escaped quote does not close the string early', 'cfg.toml', `${SECRET} = ${Q3}decoy\\${Q3}\n${value}${Q3}\n`],
    ['toml: an unterminated string is reported (fail closed)', 'cfg.toml', `${SECRET} = ${Q3}\nunterminated ${value}\n`],
    // Python, JS, Go
    ['python triple quotes', 'app.py', `${SECRET.toUpperCase()} = ${Q3}\n${value}\n${Q3}\n`],
    ['python raw triple quotes', 'app.py', `${SECRET.toUpperCase()} = r${Q3}${value}${Q3}\n`],
    ["python ''' on one line", 'app.py', `${SECRET.toUpperCase()} = ${S3}${value}${S3}\n`],
    ['js template literal over lines', 'app.js', `const ${SECRET} = \`\n${value}\n\`;\n`],
    ['ts template literal, typed', 'app.ts', `let ${SECRET}: string = \`\nline\n${value}\n\`;\n`],
    ['go raw string', 'app.go', `${SECRET} := \`\n${value}\n\`\n`],
    // Ruby, Perl, PHP heredocs
    ['ruby <<~', 'app.rb', `${SECRET.toUpperCase()} = <<~EOS\n  ${value}\nEOS\n`],
    ['ruby <<-', 'app.rb', `${SECRET.toUpperCase()} = <<-EOS\n  ${value}\n  EOS\n`],
    ['ruby <<', 'app.rb', `${SECRET.toUpperCase()} = <<EOS\n${value}\nEOS\n`],
    ['ruby quoted tag', 'app.rb', `${SECRET.toUpperCase()} = <<~'EOS'\n  ${value}\nEOS\n`],
    ['perl <<"EOT"', 'app.pl', `my $${SECRET} = <<"EOT";\n${value}\nEOT\n`],
    ['perl <<EOT', 'app.pl', `$${SECRET} = <<EOT;\n${value}\nEOT\n`],
    ['php heredoc', 'app.php', `$${SECRET} = <<<EOT\n${value}\nEOT;\n`],
    ['php nowdoc', 'app.php', `$${SECRET} = <<<'EOT'\n${value}\nEOT;\n`],
    // PowerShell here-strings
    ['ps here-string', 'a.ps1', `$${SECRET} = @'\n${value}\n'@\n`],
    ['ps here-string with double quotes', 'a.ps1', `$${SECRET} = @"\n${value}\n"@\n`],
    // quotes closed on a later line
    ['sh single quote over lines', 'a.sh', `${NAME}='first line\n${passphrase}'\n`],
    ['sh double quote over lines', 'a.sh', `${NAME}="first line\n${value}"\n`],
    ['sh double quote, the value on the next line', 'a.sh', `${NAME}="\n${passphrase}\n"\n`],
    ['dotenv value over lines', '.env', `${NAME}="line1\nline2 ${passphrase}"\n`],
    ['sh: an unterminated quote is reported (fail closed)', 'a.sh', `${NAME}="unterminated\nfoo\n`],
    ['yaml double-quoted scalar over lines', 'a.yml', `${NAME}: "folded\n  ${passphrase}"\n`],
    ['yaml single-quoted scalar over lines', 'a.yml', `${NAME}: 'folded\n  ${passphrase}'\n`],
    // continuation lines
    ['properties backslash continuation of a passphrase', 'app.properties', `jwt.secret=correct horse \\\n  battery staple\n`],
    ['properties continuation joins the lines', 'app.properties', `jwt.secret=abc\\\n${value}\n`],
    ['sh unquoted backslash continuation', 'a.sh', `${NAME}=abcd\\\n${value}\n`],
    ['json5 backslash-newline in a string', 'a.json5', `{ ${SECRET}: "abcd\\\n${value}" }\n`],
    ['json5 single-quoted with a continuation', 'a.json5', `{ ${SECRET}: 'abcd\\\n${passphrase}' }\n`],
    ['ini continuation line', 'a.ini', `[s]\n${SECRET} = first\n    ${passphrase}\n`],
    ['cfg continuation line with a tab', 'a.cfg', `[s]\n${SECRET} = f\n\t${value}\n`],
    ['ini: the value starts on the next line', 'a.ini', `[s]\n${NAME} =\n    ${value}\n`],
    ['yaml plain scalar folded over lines', 'a.yml', `${NAME}: first\n  ${passphrase}\n`],
    ['yaml: the scalar starts on the next line', 'a.yml', `${NAME}:\n  ${passphrase}\n`],
    ['yaml block scalar (existing behaviour)', 'a.yml', `${NAME}: |\n  ${passphrase}\n`],
  ];
  it.each(flagged)('reports: %s', (_label, file, text) => {
    expect(count(file, text)).toBeGreaterThanOrEqual(1);
  });

  const clean = [
    ['tf placeholder', 'main.tf', `${SECRET} = <<EOF\n${placeholder}\nEOF\n`],
    ['tf interpolation', 'main.tf', `${SECRET} = <<EOF\n$\{var.jwt}\nEOF\n`],
    ['tf empty heredoc', 'main.tf', `${SECRET} = <<EOF\nEOF\n`],
    ['tf heredoc under a name that is not secret-like', 'main.tf', 'user_data = <<EOF\n#!/bin/bash\necho hi\nEOF\n'],
    ['tf text after a closed heredoc is not part of it', 'main.tf', `${SECRET} = <<EOF\nEOF\nother = "${passphrase}x"\n`],
    ['toml placeholder', 'cfg.toml', `${SECRET} = ${Q3}${placeholder}${Q3}\n`],
    ['toml empty string', 'cfg.toml', `${SECRET} = ${Q3}${Q3}\n`],
    ['python placeholder', 'app.py', `${SECRET.toUpperCase()} = ${Q3}${placeholder}${Q3}\n`],
    ['python prose docstring under a secret name (code mode)', 'app.py', `${SECRET.toUpperCase()} = ${Q3}this is help text about the secret${Q3}\n`],
    ['python triple quotes under a name that is not secret-like', 'app.py', `DOC = ${Q3}${value}${Q3}\n`],
    ['js template with interpolation only', 'app.js', `const ${SECRET} = \`\nhello \${name}\n\`;\n`],
    ['ruby non-secret name', 'app.rb', 'GREETING = <<~EOS\n  hello there friend\nEOS\n'],
    ['dotenv multi-line placeholder', '.env', `${NAME}="line1\nline2 ${placeholder}"\nOTHER=1\n`],
    ['yaml escaped single quote', 'a.yml', `${NAME}: 'it''s fine'\n`],
    ['sh: a value closed on its line, then another assignment', 'a.sh', `${NAME}="$\{OTHER}"\nNEXT="${passphrase}"\n`],
    ['properties placeholder', 'app.properties', `jwt.secret=${placeholder}\n`],
    ['ini: the next key is not a continuation', 'a.ini', `[s]\n${SECRET} = short\nnext = other line\n`],
    ['yaml: a nested mapping is not a folded scalar', 'a.yml', `${NAME}: abc\n  nested: value\n`],
    ['yaml: a sibling key is not a continuation', 'a.yml', `${NAME}: placeholder\nother: ${passphrase}\n`],
    ['yaml: a fixture list under a key named pass', 'a.yml', 'pass:\n  - "(arg: boolish)"\nfail:\n  - "(arg: bool)"\n'],
  ];
  it.each(clean)('passes: %s', (_label, file, text) => {
    expect(count(file, text)).toBe(0);
  });

  it('a body inside the bound is read to its last line; one past the bound is reported instead of skipped', () => {
    const filler = 'a line of ordinary filler text\n';
    // 150 lines, the secret on the last one: read in full
    expect(count('main.tf', `${SECRET} = <<EOF\n${filler.repeat(149)}${value}\nEOF\n`)).toBeGreaterThanOrEqual(1);
    // 400 lines and a terminator: past the 200-line bound, so it cannot be verified and is reported
    expect(count('main.tf', `${SECRET} = <<EOF\n${filler.repeat(400)}EOF\n`)).toBeGreaterThanOrEqual(1);
    expect(count('cfg.toml', `${SECRET} = ${Q3}\n${filler.repeat(400)}${Q3}\n`)).toBeGreaterThanOrEqual(1);
    expect(count('a.sh', `${NAME}="\n${filler.repeat(400)}"\n`)).toBeGreaterThanOrEqual(1);
  });

  it('the allow marker on a line of a multi-line literal silences it', () => {
    expect(count('main.tf', `${SECRET} = <<EOF # ${ALLOW_MARKER}\n${passphrase}\nEOF\n`)).toBe(0);
  });

  it('reports only the name line, the rule and the count: never the value', () => {
    const found = scanText('main.tf', `${SECRET} = <<EOF\n${value}\nEOF\n`);
    expect(found).toEqual([{ path: 'main.tf', line: 1, rule: 'secret-assignment' }]);
    expect(JSON.stringify(found)).not.toContain(value.slice(0, 8));
  });

  it('a file full of unterminated literals is read within a budget and reported, not searched forever', SLOW, () => {
    for (const [file, opener] of [
      ['a.tf', `${SECRET} = <<EOF\n`],
      ['a.toml', `${SECRET} = ${Q3}\n`],
      ['a.sh', `${NAME}="x\n`],
      ['a.properties', `${SECRET}=abc\\\n`],
      ['a.ps1', `$${SECRET} = @'\n`],
      ['a.yml', `${NAME}:\n`],
    ]) {
      const started = performance.now();
      const found = scanText(file, opener.repeat(60000));
      expect(performance.now() - started, file).toBeLessThan(HOSTILE_LIMIT_MS);
      if (file !== 'a.yml') expect(found.length, file).toBeGreaterThanOrEqual(1);
    }
  });

  it('quotes and continuation lines stay linear on one huge line', SLOW, () => {
    const started = performance.now();
    for (const [file, text] of [
      ['a.sh', `${NAME}='${"a'b".repeat(300000)}`],
      ['a.toml', `${SECRET} = ${Q3}${'\\'.repeat(400000)}`],
      ['a.js', `const ${SECRET} = \`${'\\`'.repeat(200000)}`],
      ['a.properties', `${SECRET}=${'\\'.repeat(400000)}\n`],
    ]) {
      scanText(file, text);
    }
    expect(performance.now() - started).toBeLessThan(HOSTILE_LIMIT_MS);
  });
});

describe('review round 11 (3): --range and --history skip a verified binary of any size', () => {
  const dirs = [];
  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
  });
  const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: SLOW_TEST_MS, maxBuffer: 64 * 1024 * 1024 });
  const scan = (cwd, ...args) => run(process.execPath, [SCANNER, ...args], cwd);
  const git = (cwd, ...args) => run('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], cwd);
  const write = (dir, file, content) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  };
  const commit = (dir, message, files = {}) => {
    for (const [file, content] of Object.entries(files)) write(dir, file, content);
    git(dir, 'add', '-A');
    expect(git(dir, 'commit', '-q', '-m', message).status).toBe(0);
    return git(dir, 'rev-parse', 'HEAD').stdout.trim();
  };
  const makeRepo = () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'check-secrets-bin-'));
    dirs.push(dir);
    expect(run('git', ['init', '-q', '-b', 'main'], dir).status).toBe(0);
    return dir;
  };
  const OVER = 5 * 1024 * 1024 + 4096;
  // PNG-headed content with a NUL in it, N bytes of pseudo-random data (newlines every few hundred bytes, like a real image)
  const png = (size, seed = 1) => {
    const body = Buffer.alloc(size);
    let state = seed;
    for (let i = 0; i < size; i += 1) {
      state = (state * 1103515245 + 12345) % 2147483648;
      body[i] = (state >>> 16) & 0xff;
    }
    return Buffer.concat([PNG_HEAD, body]);
  };
  const constantPng = (size) => Buffer.concat([PNG_HEAD, Buffer.alloc(size, 1)]); // one enormous "line": no newline byte at all
  const textOver = (first = '') => `${first}${`${'x'.repeat(1023)}\n`.repeat(5 * 1024 + 8)}`;
  const secretLine = `${['API_', 'KEY'].join('')}=${randomString(32, 8103)}\n`;
  const base = (dir) => commit(dir, 'base', { 'base.txt': 'base\n' });

  it.skipIf(!hasGit())('the tree scan already skips the same asset (the behaviour --range and --history now match)', SLOW, () => {
    const dir = makeRepo();
    commit(dir, 'asset', { 'logo.png': png(OVER) });
    const result = scan(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1 skipped: 1 binary');
  });

  it.skipIf(!hasGit())('--range: adding a binary over the size limit exits 0 and counts it as skipped: binary', SLOW, () => {
    const dir = makeRepo();
    const from = base(dir);
    const head = commit(dir, 'add image', { 'assets/logo.png': png(OVER) });
    const result = scan(dir, '--range', `${from}..${head}`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('no hits in 1 commit');
    expect(result.stdout).toContain('1 skipped: 1 binary');
    expect(result.stderr).not.toContain('INCOMPLETE');
  });

  it.skipIf(!hasGit())('--history: adding a binary over the size limit exits 0 and counts it as skipped: binary', SLOW, () => {
    const dir = makeRepo();
    base(dir);
    commit(dir, 'add image', { 'assets/logo.png': png(OVER) });
    const result = scan(dir, '--history');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('no hits in 2 commits');
    expect(result.stdout).toContain('1 skipped: 1 binary');
  });

  it.skipIf(!hasGit())('--range and --history: modifying a binary over the size limit (both versions large)', SLOW, () => {
    const dir = makeRepo();
    commit(dir, 'add image', { 'logo.png': png(OVER, 1) });
    const from = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    const head = commit(dir, 'change image', { 'logo.png': png(OVER, 2) });
    const range = scan(dir, '--range', `${from}..${head}`);
    expect(range.status, range.stderr).toBe(0);
    expect(range.stdout).toContain('1 skipped: 1 binary');
    const history = scan(dir, '--history');
    expect(history.status, history.stderr).toBe(0);
    expect(history.stdout).toContain('2 skipped: 2 binary');
  });

  it.skipIf(!hasGit())('--range: renaming a large binary is judged by the new version, and is skipped', SLOW, () => {
    const dir = makeRepo();
    const from = commit(dir, 'add image', { 'logo.png': png(OVER) });
    git(dir, 'mv', 'logo.png', 'brand.png');
    expect(git(dir, 'commit', '-q', '-m', 'rename').status).toBe(0);
    const result = scan(dir, '--range', `${from}..HEAD`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('1 skipped: 1 binary');
  });

  it.skipIf(!hasGit())('--range: a small binary is skipped and counted, like the tree scan does', SLOW, () => {
    const dir = makeRepo();
    const from = base(dir);
    const head = commit(dir, 'add icon', { 'icon.png': png(2000) });
    const result = scan(dir, '--range', `${from}..${head}`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('1 skipped: 1 binary');
  });

  it.skipIf(!hasGit())('--range: a large binary with no newline byte at all is skipped, and the reader keeps its memory bounded', SLOW, () => {
    const dir = makeRepo();
    const from = base(dir);
    const head = commit(dir, 'add blob', { 'blob.bin': constantPng(20 * 1024 * 1024) });
    const result = scan(dir, '--range', `${from}..${head}`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('1 skipped: 1 binary');
  });

  it.skipIf(!hasGit())('--range: text over the size limit still exits 2 (--range and --history)', SLOW, () => {
    const dir = makeRepo();
    const from = base(dir);
    const head = commit(dir, 'add big text', { 'big.txt': textOver() });
    for (const args of [['--range', `${from}..${head}`], ['--history']]) {
      const result = scan(dir, ...args);
      expect(result.status, args.join(' ')).toBe(2);
      expect(result.stderr).toContain('INCOMPLETE');
      expect(result.stderr).toContain('1 over the 5 MB limit');
    }
  });

  it.skipIf(!hasGit())('--range: a single added line over the size limit is unscanned too (it used to pass as clean)', SLOW, () => {
    const dir = makeRepo();
    const from = base(dir);
    const head = commit(dir, 'add one huge line', { 'big.env': `${'y'.repeat(20 * 1024 * 1024)}\n` });
    const result = scan(dir, '--range', `${from}..${head}`);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('INCOMPLETE');
  });

  it.skipIf(!hasGit())('--range: a lockfile over its limit still exits 2, a binary next to it does not hide it', SLOW, () => {
    const dir = makeRepo();
    const from = base(dir);
    const head = commit(dir, 'add both', { 'logo.png': png(OVER), 'package-lock.json': `${'x'.repeat(1023)}\n`.repeat(16 * 1024 + 8) });
    const result = scan(dir, '--range', `${from}..${head}`);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('1 file version NOT scanned');
    expect(result.stderr).toContain('1 over the 16 MB lockfile limit');
  });

  it.skipIf(!hasGit())('a NUL prefix without a known signature is NOT binary: small text with a secret is found, large text is oversize (as in the tree scan)', SLOW, () => {
    const dir = makeRepo();
    const from = base(dir);
    const head = commit(dir, 'nul prefix', { 'x.env': Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from(secretLine)]) });
    const found = scan(dir, '--range', `${from}..${head}`);
    expect(found.status).toBe(1);
    expect(found.stderr).toContain('x.env  secret-assignment');
    expect(scan(dir).status).toBe(1); // the tree scan agrees
    const big = commit(dir, 'nul prefix, big', { 'big.dat': Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from(textOver())]) });
    const oversize = scan(dir, '--range', `${head}..${big}`);
    expect(oversize.status).toBe(2);
    expect(oversize.stderr).toContain('1 over the 5 MB limit');
    expect(scan(dir).status).toBe(1); // the tree scan reports it as oversize too
  });

  it.skipIf(!hasGit())('a PNG-headed file that holds a text secret is handled exactly as the tree scan handles it (skipped, no bypass of a NUL-only file)', SLOW, () => {
    const dir = makeRepo();
    const from = base(dir);
    const head = commit(dir, 'png with text', { 'blob.dat': Buffer.concat([PNG_HEAD, Buffer.from(secretLine)]) });
    const range = scan(dir, '--range', `${from}..${head}`);
    const tree = scan(dir);
    expect(tree.status).toBe(0);
    expect(tree.stdout).toContain('1 skipped: 1 binary');
    expect(range.status).toBe(0);
    expect(range.stdout).toContain('1 skipped: 1 binary');
  });

  it.skipIf(!hasGit())('a binary version does not hide a secret in the same commit', SLOW, () => {
    const dir = makeRepo();
    const from = base(dir);
    const head = commit(dir, 'both', { 'logo.png': png(OVER), 'x.env': secretLine });
    const result = scan(dir, '--range', `${from}..${head}`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('x.env  secret-assignment  x1');
  });

  it.skipIf(!hasGit())('a lowered core.bigFileThreshold changes nothing: the binary is still skipped, a text version is still scanned', SLOW, () => {
    const dir = makeRepo();
    git(dir, 'config', 'core.bigFileThreshold', '1k');
    const from = base(dir);
    const head = commit(dir, 'add', { 'logo.png': png(100 * 1024) });
    const skipped = scan(dir, '--range', `${from}..${head}`);
    expect(skipped.status, skipped.stderr).toBe(0);
    expect(skipped.stdout).toContain('1 skipped: 1 binary');
    const leak = commit(dir, 'add text', { 'x.env': `${'# filler line\n'.repeat(400)}${secretLine}` });
    const found = scan(dir, '--range', `${head}..${leak}`);
    expect(found.status).toBe(1);
    expect(found.stderr).toContain('x.env  secret-assignment  x1');
  });

  it.skipIf(!hasGit())('the report and the summary never contain the file content', SLOW, () => {
    const dir = makeRepo();
    const from = base(dir);
    const head = commit(dir, 'add', { 'logo.png': png(OVER), 'x.env': secretLine });
    const result = scan(dir, '--range', `${from}..${head}`);
    const output = `${result.stdout}${result.stderr}`;
    for (const piece of windows(secretLine.split('=')[1].trim())) expect(output).not.toContain(piece);
  });
});

function hasGit() {
  return spawnSync('git', ['--version']).status === 0;
}

// ---------------------------------------------------------------------------
// Review round 12: assignment operators, block scalars in split pairs, SQL password literal forms, heredoc bodies.
// Every value is assembled at runtime; the fixtures hold no secret-shaped literal.
// ---------------------------------------------------------------------------

describe('review round 12', () => {
  const NAME = secretName('JWT_', 'SECRET');
  const camel = secretName('jwt', 'Secret');
  const value = randomString(24, 12001);
  const passphrase = ['correct', 'horse', 'battery', 'staple'].join(' ');
  const placeholder = ['your', 'secret', 'here'].join('_');
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
    const dir = mkdtempSync(path.join(tmpdir(), 'check-secrets-r12-'));
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
  describe('(1) every assignment operator', () => {
    const q = (v) => `'${v}'`;
    const dq = (v) => `"${v}"`;
    const flagged = [
      ['JS ||= on process.env', 'a.js', `process.env.${NAME} ||= ${q(value)};\n`],
      ['TS ||= double quotes', 'a.ts', `process.env.${NAME} ||= ${dq(value)};\n`],
      ['Ruby ||= on ENV[]', 'a.rb', `ENV['${NAME}'] ||= ${q(value)}\n`],
      ['JS ??= on a config object', 'a.js', `config.${NAME} ??= ${q(value)};\n`],
      ['JS ??= without blanks', 'a.js', `config.${NAME}??=${q(value)};\n`],
      ['JS &&=', 'a.js', `config.${NAME} &&= ${q(value)};\n`],
      ['Go :=', 'a.go', `${NAME} := ${dq(value)}\n`],
      ['Python walrus', 'a.py', `if (${camel} := ${dq(value)}):\n    pass\n`],
      ['Make :=', 'Makefile', `${NAME} := ${value}\n`],
      ['Make ::=', 'Makefile', `${NAME} ::= ${value}\n`],
      ['Make ?=', 'Makefile', `${NAME} ?= ${value}\n`],
      ['shell +=', 'a.sh', `${NAME}+=${value}\n`],
      ['JS +=', 'a.js', `${camel} += ${dq(value)};\n`],
      ['JS -=', 'a.js', `${camel} -= ${dq(value)};\n`],
      ['JS *=', 'a.js', `${camel} *= ${dq(value)};\n`],
      ['JS **=', 'a.js', `${camel} **= ${dq(value)};\n`],
      ['JS |=', 'a.js', `${camel} |= ${dq(value)};\n`],
      ['PHP .=', 'a.php', `$${camel} .= ${q(value)};\n`],
      ['PHP .= without a blank', 'a.php', `$${camel}.=${q(value)};\n`],
      ['Perl .=', 'a.pl', `$${camel} .= ${dq(value)};\n`],
      ['R <-', 'a.R', `${camel} <- ${dq(value)}\n`],
      ['R <- without blanks', 'a.R', `${camel}<-${q(value)}\n`],
      ['R <<-', 'a.R', `${camel} <<- ${dq(value)}\n`],
      ['PHP array =>', 'a.php', `'${NAME}' => ${q(value)},\n`],
      ['Ruby hash =>', 'a.rb', `{ :${camel} => ${q(value)} }\n`],
      ['Scala ->', 'a.scala', `Map(${dq(NAME)} -> ${dq(value)})\n`],
      ['Kotlin to', 'a.kt', `mapOf(${dq(NAME)} to ${dq(value)})\n`],
      ['plain = with blanks', 'a.js', `${camel}   =   ${dq(value)};\n`],
      ['JSON colon', 'a.json', `{"${NAME}": ${dq(value)}}\n`],
      ['Lua local', 'a.lua', `local ${camel} = ${dq(value)}\n`],
      ['Lua table key', 'a.lua', `config[${dq(NAME)}] = ${dq(value)}\n`],
      ['Lua attribute', 'a.lua', `local ${camel} <const> = ${dq(value)}\n`],
      ['Nim export marker', 'a.nim', `const ${camel}* = ${dq(value)}\n`],
      ['Nim let', 'a.nim', `let ${camel} = ${dq(value)}\n`],
      ['Kotlin val', 'a.kt', `val ${camel} = ${dq(value)}\n`],
      ['Kotlin const val', 'a.kt', `const val ${NAME} = ${dq(value)}\n`],
      ['Kotlin typed nullable', 'a.kt', `val ${camel}: String? = ${dq(value)}\n`],
      ['Elixir keyword', 'a.ex', `config :app, ${camel}: ${dq(value)}\n`],
      ['Elixir module attribute', 'a.ex', `@${camel} ${dq(value)}\n`],
      ['Elixir map arrow', 'a.ex', `%{${dq(NAME)} => ${dq(value)}}\n`],
      ['Scala val', 'a.scala', `val ${camel}: String = ${dq(value)}\n`],
      ['Swift let', 'a.swift', `let ${camel} = ${dq(value)}\n`],
      ['Swift static let typed', 'a.swift', `static let ${camel}: String = ${dq(value)}\n`],
      ['Rust const &str', 'a.rs', `const ${NAME}: &str = ${dq(value)};\n`],
      ['Rust static with a lifetime', 'a.rs', `static ${NAME}: &'static str = ${dq(value)};\n`],
      ['Go const', 'a.go', `const ${NAME} = ${dq(value)}\n`],
      ['Go const typed', 'a.go', `const ${NAME} string = ${dq(value)}\n`],
      ['Go var typed', 'a.go', `var ${NAME} string = ${dq(value)}\n`],
      ['Java static final', 'a.java', `static final String ${NAME} = ${dq(value)};\n`],
      ['Java private static final', 'a.java', `private static final String ${NAME} = ${dq(value)};\n`],
      ['C# const', 'a.cs', `const string ${NAME} = ${dq(value)};\n`],
      ['C char array', 'a.c', `static const char ${NAME}[] = ${dq(value)};\n`],
      ['Zig slice type', 'a.zig', `const ${camel}: []const u8 = ${dq(value)};\n`],
      ['Clojure def', 'a.clj', `(def ${camel} ${dq(value)})\n`],
      ['Clojure keyword map', 'a.clj', `{:${camel} ${dq(value)}}\n`],
      ['Lisp setq', 'a.el', `(setq ${camel} ${dq(value)})\n`],
    ];
    it.each(flagged)('reports: %s', (_label, file, text) => {
      expect(rules(file, text)).toContain('secret-assignment');
    });

    it.each(flagged.filter((_case, index) => index % 5 === 0))('reports through --range: %s', SLOW, (_label, file, text) => {
      const dir = makeRepo();
      const from = commit(dir, { 'base.txt': 'base\n' });
      const head = commit(dir, { [file]: text });
      const found = scan(dir, '--range', `${from}..${head}`);
      expect(found.status, found.stderr).toBe(1);
      expect(`${found.stdout}${found.stderr}`).not.toContain(value);
      expect(scan(dir).status).toBe(1);
    });

    const passes = [
      ['||= a reference to another variable', 'a.js', `process.env.${NAME} ||= process.env.OTHER_SECRET;\n`],
      ['??= the same variable', 'a.js', `config.${NAME} ??= process.env.${NAME};\n`],
      ['Ruby ||= ENV', 'a.rb', `ENV['${NAME}'] ||= ENV['OTHER']\n`],
      ['??= a placeholder', 'a.js', `config.${NAME} ??= ${q(placeholder)};\n`],
      ['??= an angle-bracket marker', 'a.js', `config.${NAME} ??= '<jwt secret>';\n`],
      ['??= a phrase in code (text, as with =)', 'a.js', `config.${NAME} ??= ${dq(passphrase)};\n`],
      ['Go := reading the environment', 'a.go', `${NAME} := os.Getenv(${dq(NAME)})\n`],
      ['R <- reading the environment', 'a.R', `${camel} <- Sys.getenv(${dq(NAME)})\n`],
      ['Rust const from env!', 'a.rs', `const ${NAME}: &str = env!(${dq(NAME)});\n`],
      ['+= a number', 'a.js', `${camel} += 1;\n`],
      ['a comparison is not an assignment', 'a.js', `if (${camel} != ${dq(value)}) {}\n`],
      ['-> without a quote after it', 'a.php', `$this->${camel} = $other;\n`],
      ['a Go channel send of a name that is not secret-like', 'a.go', `events <- ${dq(value)}\n`],
      ['to as an ordinary word in prose', 'a.md', `send the ${camel} to "${value}"\n`],
      ['=> in a lambda over an identifier', 'a.js', `const f = (${camel}) => ${camel}.length;\n`],
    ];
    it.each(passes)('passes: %s', (_label, file, text) => {
      expect(count(file, text)).toBe(0);
    });

    it('a type word or annotation in front of the operator does not hide a later assignment', () => {
      expect(count('a.rs', `const A: &str = "x";\nconst ${NAME}: &str = ${dq(value)};\n`)).toBe(1);
      expect(count('a.go', `var A string\nvar ${NAME} string = ${dq(value)}\n`)).toBe(1);
    });

    it('the new forms stay linear on hostile lines', SLOW, () => {
      const hostile = [
        ['a.ts', `${camel}: ${"&'a mut str ".repeat(30000)}\n`],
        ['a.go', `${`${camel} string `.repeat(30000)}\n`],
        ['a.js', `${`${camel} ||= ??= &&= ::= `.repeat(20000)}\n`],
        ['a.kt', `${`${dq(camel)} to `.repeat(30000)}\n`],
        ['a.clj', `${`(def ^:a ^:b ${camel} `.repeat(20000)}\n`],
        ['a.ex', `${`@${camel} `.repeat(30000)}\n`],
        ['a.nim', `${`${camel}* ${camel}? ${camel}[] ${camel} <const> `.repeat(15000)}\n`],
        ['a.R', `${`${camel} <<- `.repeat(30000)}\n`],
        ['a.js', `${camel}${' '.repeat(300000)}x\n`],
      ];
      const started = performance.now();
      for (const [file, text] of hostile) scanText(file, text);
      expect(performance.now() - started).toBeLessThan(HOSTILE_LIMIT_MS);
    });
  });

  // -------------------------------------------------------------------------
  describe('(2) block scalars and multi-line values in split name/value pairs', () => {
    const markers = ['|', '>', '|-', '>-', '|+', '>+', '|2', '|2-', '>-2'];
    const bodies = [
      ['a passphrase', passphrase],
      ['a random token', value],
    ];
    const cases = markers.flatMap((marker) =>
      bodies.flatMap(([kind, body]) => [
        [`Kubernetes name then value ${marker}, ${kind}`, 'd.yaml', `env:\n  - name: ${NAME}\n    value: ${marker}\n      ${body}\n`],
        [`value ${marker} before the name, ${kind}`, 'd.yaml', `env:\n  - value: ${marker}\n      ${body}\n    name: ${NAME}\n`],
      ]),
    );
    it.each(cases)('reports: %s', (_label, file, text) => {
      expect(rules(file, text)).toContain('secret-name-value-pair');
    });

    const siblings = [
      ['secret on the second body line', 'd.yaml', `- name: ${NAME}\n  value: |\n    a line of ordinary text\n    ${value}\n`],
      ['passphrase on the second body line', 'd.yaml', `- name: ${NAME}\n  value: |\n    first words\n    ${passphrase}\n`],
      ['CRLF line ends', 'd.yaml', `- name: ${NAME}\r\n  value: |-\r\n    ${passphrase}\r\n`],
      ['a YAML anchor before the header', 'd.yaml', `- name: ${NAME}\n  value: &a |\n    ${value}\n`],
      ['a comment after the header', 'd.yaml', `- name: ${NAME}\n  value: | # note\n    ${passphrase}\n`],
      ['Helm values: mapping key with a nested value block', 'values.yaml', `${NAME}:\n  value: |\n    ${passphrase}\n`],
      ['Helm values: the same one level down', 'values.yaml', `secrets:\n  ${NAME}:\n    value: |-\n      ${value}\n`],
      ['mapping key with a !!str value block', 'a.yaml', `${NAME}:\n  value: !!str |\n    ${value}\n`],
      ['GitHub Actions with: name and value', '.github/workflows/ci.yml', `        with:\n          name: ${NAME}\n          value: |\n            ${value}\n`],
      ['GitHub Actions with: value before name', '.github/workflows/ci.yml', `        with:\n          value: >-\n            ${passphrase}\n          name: ${NAME}\n`],
      ['CloudFormation Value: !Sub |', 'stack.yaml', `Variables:\n  - Name: ${NAME}\n    Value: !Sub |\n      ${value}\n`],
      ['CloudFormation Value: !Sub > passphrase', 'stack.yaml', `- Name: ${NAME}\n  Value: !Sub >-\n    ${passphrase}\n`],
      ['CloudFormation Value first', 'stack.yaml', `- Value: !Sub |\n    ${value}\n  Name: ${NAME}\n`],
      ['CloudFormation ParameterKey / ParameterValue', 'stack.yaml', `- ParameterKey: ${NAME}\n  ParameterValue: |\n    ${value}\n`],
      ['docker-compose environment list of name/value maps', 'docker-compose.yml', `services:\n  a:\n    environment:\n      - name: ${NAME}\n        value: |\n          ${passphrase}\n`],
      ['docker-compose environment map', 'docker-compose.yml', `services:\n  a:\n    environment:\n      ${NAME}: |\n        ${passphrase}\n`],
      ['GitHub Actions env: map', '.github/workflows/ci.yml', `    env:\n      ${NAME}: >-\n        ${value}\n`],
      ['a quote closed on a later line', 'a.yaml', `- name: ${NAME}\n  value: "first line\n    ${passphrase}"\n`],
      ['a plain scalar folded over lines', 'a.yaml', `- name: ${NAME}\n  value: first\n    ${passphrase}\n`],
      ['Terraform heredoc value after the name', 'a.tf', `variable {\n  name  = "${NAME}"\n  value = <<EOT\n${passphrase}\nEOT\n}\n`],
      ['Terraform heredoc value before the name', 'a.tf', `x {\n  value = <<-EOT\n    ${value}\n  EOT\n  name  = "${NAME}"\n}\n`],
      ['JSON string with \\n escapes, the secret on a later line', 'a.json', `[{"name":"${NAME}","value":"intro line\\n${value}"}]\n`],
      ['JSON string with \\n escapes, a passphrase line', 'a.json', `{"name":"${NAME}","value":"${passphrase}\\nsecond line"}\n`],
      ['JSON document stored as a string, escaped', 'a.json', `"{\\"name\\":\\"${NAME}\\",\\"value\\":\\"first\\\\n${passphrase}\\"}"\n`],
      ['XML value element over lines', 'a.xml', `<property><name>${NAME}</name><value>\n  first\n  ${passphrase}\n</value></property>\n`],
      ['value-first with a body of 30 lines', 'd.yaml', `env:\n  - value: |\n${'      a filler line of text\n'.repeat(30)}      ${passphrase}\n    name: ${NAME}\n`],
      ['value-first with a blank line in the body', 'd.yaml', `env:\n  - value: |\n      first\n\n      ${passphrase}\n    name: ${NAME}\n`],
      ['name-first with a body of 150 lines, the secret last', 'd.yaml', `env:\n  - name: ${NAME}\n    value: |\n${'      a filler line of text\n'.repeat(150)}      ${value}\n`],
    ];
    it.each(siblings)('reports: %s', (_label, file, text) => {
      expect(count(file, text)).toBeGreaterThanOrEqual(1);
    });

    const clean = [
      ['a placeholder body', 'd.yaml', `- name: ${NAME}\n  value: |\n    ${placeholder}\n`],
      ['an empty block followed by a dedented key', 'd.yaml', `- name: ${NAME}\n  value: |\nnext: ${value}\n`],
      ['documentation about the credential', 'd.yaml', `- name: ${NAME}\n  value: >\n    Set this to the signing secret from the dashboard.\n`],
      ['a body that ends before a secret in a sibling key', 'd.yaml', `- name: ${NAME}\n  value: |\n    ${placeholder}\n  other: ${value}\n`],
      ['a name that is not secret-like', 'd.yaml', `- name: FEATURE_FLAGS\n  value: |\n    ${passphrase}\n`],
      ['a path in a *_FILE variable', 'd.yaml', `- name: ${NAME}_FILE\n  value: |\n    /var/run/secrets/jwt/key\n`],
      ['valueFrom instead of a value', 'd.yaml', `- name: ${NAME}\n  valueFrom:\n    secretKeyRef:\n      name: app\n      key: jwt\n`],
      ['a template reference', 'values.yaml', `${NAME}:\n  value: |\n    {{ .Values.jwt }}\n`],
      ['a CloudFormation reference', 'stack.yaml', `- Name: ${NAME}\n  Value: !Sub |\n    \${SecretParam}\n`],
      ['prose lines in an escaped JSON string', 'a.json', `[{"name":"${NAME}","value":"Set the value of this secret\\nfrom the dashboard"}]\n`],
      ['a later, unrelated pair', 'd.yaml', `- name: ${NAME}\n  valueFrom: x\n- name: NOTE\n  value: |\n    ${passphrase}\n`],
    ];
    it.each(clean)('passes: %s', (_label, file, text) => {
      expect(count(file, text)).toBe(0);
    });

    it('an allow marker on the header line, on a body line or on the name line silences the pair', () => {
      const M = ALLOW_MARKER;
      expect(count('d.yaml', `- name: ${NAME}\n  value: | # ${M}\n    ${passphrase}\n`)).toBe(0);
      expect(count('d.yaml', `- name: ${NAME}\n  value: |\n    ${passphrase} # ${M}\n`)).toBe(0);
      expect(count('d.yaml', `- name: ${NAME}\n  value: |\n    ${passphrase}\n    # ${M}\n`)).toBe(0);
      expect(count('d.yaml', `- name: ${NAME} # ${M}\n  value: |\n    ${passphrase}\n`)).toBe(0);
      // the fixtures are real: without the marker they are findings
      expect(count('d.yaml', `- name: ${NAME}\n  value: |\n    ${passphrase} # note\n`)).toBe(1);
    });

    it('a marker on an unrelated line does not silence it', () => {
      expect(count('d.yaml', `# ${ALLOW_MARKER}\n- name: ${NAME}\n  type: plain\n  value: |\n    ${passphrase}\n`)).toBe(1);
    });

    it('a block that does not end within the bounds is reported (fail closed), not skipped', () => {
      const filler = '      a filler line of ordinary text\n';
      expect(count('d.yaml', `env:\n  - name: ${NAME}\n    value: |\n${filler.repeat(300)}`)).toBeGreaterThanOrEqual(1);
      // a long body under a name that is not secret-like is not reported
      expect(count('d.yaml', `env:\n  - name: FEATURE_FLAGS\n    value: |\n${filler.repeat(300)}`)).toBe(0);
    });

    it('the report names the pair rule and the name line, never the value', () => {
      const found = scanText('d.yaml', `env:\n  - name: ${NAME}\n    value: |\n      ${value}\n`);
      expect(found).toEqual([{ path: 'd.yaml', line: 2, rule: 'secret-name-value-pair' }]);
      expect(JSON.stringify(found)).not.toContain(value.slice(0, 8));
    });

    const order = ['name-first', 'value-first'];
    const doc = (which, { name, marker, body }) =>
      which === 'name-first'
        ? `env:\n  - name: ${name}\n    value: ${marker}\n      ${body}\n`
        : `env:\n  - value: ${marker}\n      ${body}\n    name: ${name}\n`;
    const changes = [
      ['the commit adds the body', { name: NAME, marker: '>-', body: placeholder }, { name: NAME, marker: '>-', body: passphrase }],
      ['the commit adds the name', { name: 'FEATURE_NAME', marker: '>-', body: passphrase }, { name: NAME, marker: '>-', body: passphrase }],
      ['the commit adds the marker', { name: NAME, marker: 'plain', body: passphrase }, { name: NAME, marker: '>-', body: passphrase }],
    ];
    const fixed = { name: 'FEATURE_NAME', marker: '|', body: 'unrelated' };
    const historyCases = order.flatMap((which) => changes.flatMap(([label, before, after]) => ['--history', '--range'].map((mode) => [`${which}: ${label} (${mode})`, which, before, after, mode])));
    it.each(historyCases)('blames the right commit: %s', SLOW, (_label, which, before, after, mode) => {
      const dir = makeRepo();
      const first = commit(dir, { 'd.yaml': doc(which, before) });
      const leak = commit(dir, { 'd.yaml': doc(which, after) });
      const tip = commit(dir, { 'd.yaml': doc(which, fixed) });
      const args = mode === '--range' ? ['--range', `${first}..${tip}`] : ['--history'];
      const found = scan(dir, ...args);
      expect(found.status, found.stderr).toBe(1);
      expect(`${found.stdout}${found.stderr}`).not.toContain(passphrase);
      // a range that starts after the leak, and the clean tip itself, report nothing
      expect(scan(dir, '--range', `${leak}..${tip}`).status).toBe(0);
      expect(scan(dir).status).toBe(0);
    });

    it('the tree scan and --range agree on a block scalar pair', SLOW, () => {
      const dir = makeRepo();
      const from = commit(dir, { 'base.txt': 'base\n' });
      const head = commit(dir, { 'k8s/deploy.yaml': doc('name-first', { name: NAME, marker: '|', body: passphrase }) });
      expect(scan(dir).status).toBe(1);
      const found = scan(dir, '--range', `${from}..${head}`);
      expect(found.status).toBe(1);
      expect(found.stderr).toContain('k8s/deploy.yaml  secret-name-value-pair');
    });

    it('dense secret-like names with block scalars are read within a budget', SLOW, () => {
      const started = performance.now();
      for (const text of [
        `- name: ${NAME}\n  value: |\n`.repeat(20000),
        `- value: |\n      x\n    name: ${NAME}\n`.repeat(20000),
        `  ${NAME}:\n    value: |\n      a b\n`.repeat(20000),
        `- name: ${NAME}\n  value: "a\n`.repeat(20000),
        `      filler\n`.repeat(50000) + `    name: ${NAME}\n`,
        `- name: ${NAME}\n  value: |\n${'      some words here\n'.repeat(40000)}`,
      ]) {
        scanText('d.yaml', text);
      }
      expect(performance.now() - started).toBeLessThan(HOSTILE_LIMIT_MS);
    });
  });

  // -------------------------------------------------------------------------
  describe('(3) SQL password literals in every quoted and unquoted form', () => {
    const H = ['*', randomString(40, 12002, HEX.toUpperCase())].join('');
    const newer = randomString(12, 12003);
    const shortWord = ['hunter', '2hunter2'].join('');
    const ref = (name) => ['$', '{', name, '}'].join('');
    const D = '$';
    const flagged = [
      ['Oracle, double quotes', 'a.sql', `CREATE USER app IDENTIFIED BY "${value}";\n`],
      ['Oracle, double quotes in a .txt', 'a.txt', `CREATE USER app IDENTIFIED BY "${value}";\n`],
      ['Oracle, double quotes in Markdown', 'a.md', `CREATE USER app IDENTIFIED BY "${value}";\n`],
      ['Oracle, double quotes inside Python', 'a.py', `cur.execute('create user app identified by "${value}"')\n`],
      ['Oracle, unquoted', 'a.sql', `CREATE USER app IDENTIFIED BY ${value};\n`],
      ['Oracle, unquoted in Markdown', 'a.md', `ALTER USER app IDENTIFIED BY ${value};\n`],
      ['Oracle, GRANT with an unquoted password', 'a.md', `GRANT CONNECT TO app IDENTIFIED BY ${value};\n`],
      ['Oracle, REPLACE clause (old password)', 'a.sql', `ALTER USER app IDENTIFIED BY '${newer}' REPLACE '${value}';\n`],
      ['Oracle, unquoted REPLACE', 'a.sql', `ALTER USER app IDENTIFIED BY ${newer} REPLACE ${value};\n`],
      ['Oracle, IDENTIFIED BY VALUES hash', 'a.sql', `CREATE USER app IDENTIFIED BY VALUES 'S:${value}';\n`],
      ['MySQL, single quotes', 'a.sql', `CREATE USER 'app'@'%' IDENTIFIED BY '${value}';\n`],
      ['MySQL, double quotes', 'a.sql', `CREATE USER 'app'@'%' IDENTIFIED BY "${value}";\n`],
      ['MySQL, backticks', 'a.sql', `CREATE USER 'app'@'%' IDENTIFIED BY \`${value}\`;\n`],
      ['MySQL, IDENTIFIED WITH plugin BY', 'a.sql', `CREATE USER 'app'@'%' IDENTIFIED WITH caching_sha2_password BY '${value}';\n`],
      ['MySQL, IDENTIFIED WITH plugin AS hash', 'a.sql', `CREATE USER 'app'@'%' IDENTIFIED WITH mysql_native_password AS '${H}';\n`],
      ['MySQL, IDENTIFIED BY PASSWORD hash', 'a.sql', `GRANT ALL ON *.* TO 'app'@'%' IDENTIFIED BY PASSWORD '${H}';\n`],
      ['MySQL, GRANT ... IDENTIFIED BY', 'a.sql', `GRANT ALL ON db.* TO 'app'@'%' IDENTIFIED BY '${value}';\n`],
      ['MariaDB, IDENTIFIED VIA ... USING PASSWORD()', 'a.sql', `CREATE USER app IDENTIFIED VIA mysql_native_password USING PASSWORD('${value}');\n`],
      ['MySQL, SET PASSWORD FOR ... = PASSWORD()', 'a.sql', `SET PASSWORD FOR 'app'@'%' = PASSWORD('${value}');\n`],
      ['MySQL, SET PASSWORD FOR ... = PASSWORD() inside Java', 'A.java', `stmt.execute("SET PASSWORD FOR 'app'@'%' = PASSWORD('${value}')");\n`],
      ['MySQL, OLD_PASSWORD()', 'a.sql', `SET PASSWORD FOR 'app'@'%' = OLD_PASSWORD('${value}');\n`],
      ['MySQL, SET PASSWORD FOR ... = literal', 'a.sql', `SET PASSWORD FOR 'app'@'%' = '${value}';\n`],
      ['MySQL, SET PASSWORD = literal inside Python', 'a.py', `cur.execute("SET PASSWORD = '${value}'")\n`],
      ['MySQL, ALTER USER ... IDENTIFIED BY', 'a.sql', `ALTER USER 'app'@'localhost' IDENTIFIED BY '${value}';\n`],
      ['MySQL, UPDATE mysql.user SET ... = PASSWORD()', 'a.sql', `UPDATE mysql.user SET authentication_string=PASSWORD('${value}') WHERE User='root';\n`],
      ['MySQL, UPDATE mysql.user inside PHP', 'a.php', `$db->query("UPDATE mysql.user SET Password=PASSWORD('${value}') WHERE User='root'");\n`],
      ['PostgreSQL, single quotes', 'a.sql', `ALTER ROLE app WITH PASSWORD '${value}';\n`],
      ['PostgreSQL, double quotes', 'a.sql', `ALTER ROLE app WITH PASSWORD "${value}";\n`],
      ['PostgreSQL, $$dollar$$ quoting', 'a.sql', `ALTER ROLE app WITH PASSWORD ${D}${D}${value}${D}${D};\n`],
      ['PostgreSQL, $tag$dollar$tag$ quoting', 'a.sql', `ALTER ROLE app WITH PASSWORD ${D}pw${D}${value}${D}pw${D};\n`],
      ['PostgreSQL, E string', 'a.sql', `ALTER ROLE app WITH PASSWORD E'${value}';\n`],
      ['PostgreSQL, N string', 'a.sql', `ALTER ROLE app WITH PASSWORD N'${value}';\n`],
      ['PostgreSQL, U& string', 'a.sql', `ALTER ROLE app WITH PASSWORD U&'${value}';\n`],
      ['PostgreSQL, ENCRYPTED PASSWORD', 'a.sql', `CREATE ROLE app WITH LOGIN ENCRYPTED PASSWORD '${value}';\n`],
      ['PostgreSQL, ENCRYPTED PASSWORD without WITH', 'a.sql', `ALTER ROLE app ENCRYPTED PASSWORD '${value}';\n`],
      ['PostgreSQL, UNENCRYPTED PASSWORD', 'a.sql', `CREATE ROLE app UNENCRYPTED PASSWORD '${value}';\n`],
      ['PostgreSQL, LOGIN PASSWORD in Markdown', 'a.md', `CREATE ROLE app LOGIN PASSWORD '${value}';\n`],
      ['PostgreSQL, CREATE USER with options and double quotes', 'a.md', `CREATE USER app SUPERUSER CREATEDB PASSWORD "${value}";\n`],
      ['ALTER USER ... SET PASSWORD (Snowflake)', 'a.sql', `ALTER USER app SET PASSWORD = '${value}';\n`],
      ['ALTER USER ... SET PASSWORD in Markdown', 'a.md', `ALTER USER app SET PASSWORD = '${value}';\n`],
      ['ALTER USER ... SET PASSWORD with backticks', 'a.md', `ALTER USER app SET PASSWORD = \`${value}\`;\n`],
      ['CREATE USER ... PASSWORD = (Snowflake)', 'a.md', `CREATE USER app PASSWORD = '${value}' MUST_CHANGE_PASSWORD = TRUE;\n`],
      ['SQL Server, WITH PASSWORD =', 'a.sql', `CREATE LOGIN app WITH PASSWORD = '${value}';\n`],
      ['SQL Server, N string', 'a.sql', `CREATE LOGIN app WITH PASSWORD = N'${value}';\n`],
      ['SQL Server, N string in Markdown', 'a.md', `CREATE LOGIN app WITH PASSWORD = N'${value}' MUST_CHANGE;\n`],
      ['SQL Server, CREATE USER WITH PASSWORD', 'a.md', `CREATE USER app WITH PASSWORD = '${value}';\n`],
      ['SQL Server, OLD_PASSWORD', 'a.md', `ALTER LOGIN app WITH PASSWORD = '${newer}' OLD_PASSWORD = '${value}';\n`],
      ['SQL Server, LOGIN ... PASSWORD with double quotes', 'a.md', `CREATE LOGIN app LOGIN PASSWORD = "${value}";\n`],
      ['MongoDB, createUser with double quotes', 'a.js', `db.createUser({user: "app", pwd: "${value}", roles: ["readWrite"]});\n`],
      ['MongoDB, createUser with single quotes', 'a.js', `db.createUser({user: 'app', pwd: '${value}', roles: []});\n`],
      ['MongoDB, createUser with quoted keys', 'a.js', `db.createUser({"user": "app", "pwd": "${value}"});\n`],
      ['MongoDB, a passphrase over lines', 'init.js', `db.getSiblingDB("admin").createUser({\n  user: "root",\n  pwd: "${passphrase}",\n  roles: ["root"]\n});\n`],
      ['MongoDB, a short non-random password', 'init.js', `db.createUser({user: "u", pwd: "${shortWord}"});\n`],
      ['MongoDB, mongosh --eval', 'init.sh', `mongosh --eval 'db.createUser({user:"app",pwd:"${value}",roles:[]})'\n`],
      ['MongoDB, updateUser', 'a.js', `db.updateUser("app", {pwd: "${value}"});\n`],
      ['MongoDB, changeUserPassword', 'a.js', `db.changeUserPassword("app", "${value}");\n`],
    ];
    it.each(flagged)('reports: %s', (_label, file, text) => {
      expect(rules(file, text)).toContain('sql-password-literal');
    });

    it.each(flagged.filter((_case, index) => index % 6 === 0))('reports through --range: %s', SLOW, (_label, file, text) => {
      const dir = makeRepo();
      const from = commit(dir, { 'base.txt': 'base\n' });
      const head = commit(dir, { [file]: text });
      const found = scan(dir, '--range', `${from}..${head}`);
      expect(found.status, found.stderr).toBe(1);
      expect(found.stderr).toContain('sql-password-literal');
      expect(`${found.stdout}${found.stderr}`).not.toContain(value);
    });

    const clean = [
      ['Oracle placeholder in angle brackets', 'a.sql', `CREATE USER app IDENTIFIED BY '<password>';\n`],
      ['Oracle placeholder in double quotes', 'a.sql', `CREATE USER app IDENTIFIED BY "<password>";\n`],
      ['Oracle ${...} reference', 'a.sql', `CREATE USER app IDENTIFIED BY "${ref('DB_PASSWORD')}";\n`],
      ['Oracle bind :name', 'a.sql', 'CREATE USER app IDENTIFIED BY :pw;\n'],
      ['quoted :name', 'a.sql', `ALTER ROLE app WITH PASSWORD ':pw';\n`],
      ['question mark', 'a.sql', `ALTER ROLE app WITH PASSWORD '?';\n`],
      ['positional $1, quoted', 'a.sql', `ALTER ROLE app WITH PASSWORD '${D}1';\n`],
      ['positional $1, bare', 'a.sql', `ALTER ROLE app WITH PASSWORD ${D}1;\n`],
      ['%s format marker', 'a.py', `cur.execute("ALTER ROLE app WITH PASSWORD '%s'")\n`],
      ['Oracle ?', 'a.sql', 'CREATE USER app IDENTIFIED BY ?;\n'],
      ['SQL*Plus &var', 'a.sql', 'CREATE USER app IDENTIFIED BY &pw;\n'],
      ['SQL*Plus &&var', 'a.sql', 'CREATE USER app IDENTIFIED BY &&pw;\n'],
      ['changeme in double quotes', 'a.sql', `CREATE USER app IDENTIFIED BY "changeme";\n`],
      ['your_password unquoted', 'a.sql', 'CREATE USER app IDENTIFIED BY your_password;\n'],
      ['a placeholder in $$ quoting', 'a.sql', `ALTER ROLE app WITH PASSWORD ${D}${D}<password>${D}${D};\n`],
      ['a placeholder in backticks', 'a.sql', "CREATE USER 'a'@'%' IDENTIFIED BY `changeme`;\n"],
      ['MongoDB placeholder', 'a.js', 'db.createUser({user: "app", pwd: "<password>", roles: []});\n'],
      ['MongoDB env reference', 'a.js', 'db.createUser({user: "app", pwd: process.env.MONGO_PWD, roles: []});\n'],
      ['MongoDB ${...} reference', 'a.js', `db.createUser({user: "app", pwd: "${ref('MONGO_PWD')}", roles: []});\n`],
      ['PASSWORD() with a placeholder', 'a.sql', `SET PASSWORD FOR 'a'@'h' = PASSWORD('<password>');\n`],
      ['prose: identified by', 'a.md', 'Users are identified by their email address.\n'],
      ['prose: identified by a word', 'a.md', `Each user is identified by ${value} in the logs.\n`],
      ['prose: a bare password in Markdown', 'a.md', `the password '${value}' was shown\n`],
      ['password_encryption setting', 'a.sql', "SET password_encryption = 'scram-sha-256';\n"],
      ['IDENTIFIED BY VALUES with nothing after', 'a.sql', 'CREATE USER app IDENTIFIED BY VALUES ;\n'],
      ['IDENTIFIED EXTERNALLY', 'a.sql', 'CREATE USER app IDENTIFIED EXTERNALLY;\n'],
      ['IDENTIFIED BY RANDOM PASSWORD', 'a.sql', 'CREATE USER app IDENTIFIED BY RANDOM PASSWORD;\n'],
      ['IDENTIFIED WITH a plugin only', 'a.sql', 'CREATE USER app IDENTIFIED WITH auth_socket;\n'],
      ['Markdown code spans around the word password', 'a.md', 'Use `WITH PASSWORD` and then `the value` in the statement.\n'],
      ['a password() helper in JavaScript', 'a.js', `form.password('${value}');\n`],
      ['set password in prose', 'a.md', "Then set password to something else, for example 'x1'\n"],
    ];
    it.each(clean)('passes: %s', (_label, file, text) => {
      expect(rules(file, text)).not.toContain('sql-password-literal');
    });

    it('the report names the rule and the line, never the password', () => {
      const found = scanText('a.sql', `-- users\nCREATE USER app IDENTIFIED BY "${value}";\n`);
      expect(found).toEqual([{ path: 'a.sql', line: 2, rule: 'sql-password-literal' }]);
    });

    it('an allow marker silences a statement', () => {
      expect(count('a.sql', `CREATE USER app IDENTIFIED BY "${value}"; -- ${ALLOW_MARKER}\n`)).toBe(0);
    });

    it('the new forms stay linear on hostile input', SLOW, () => {
      const rep = (s, n) => s.repeat(n);
      const hostile = [
        rep('create user ', 30000),
        rep('identified by ', 30000),
        rep('identified with a by ', 20000),
        rep('password ', 30000),
        rep('set password for ', 20000),
        `set password for ${rep("'a' ", 60000)}`,
        rep(`password ${D}a${D}`, 20000),
        rep(`password ${D}${D}${'x'.repeat(4000)}\n`, 300),
        `password '${"''".repeat(150000)}`,
        `identified by "${'a'.repeat(300000)}`,
        `identified by \`${'a'.repeat(300000)}`,
        `identified by ${rep('replace ', 30000)}`,
        rep('pwd: ', 60000),
        `createUser ${rep('pwd: ', 60000)}`,
        rep('db.auth(', 40000),
        rep('password(', 40000),
      ];
      const started = performance.now();
      for (const file of ['a.sql', 'a.md', 'a.js']) for (const text of hostile) scanText(file, text);
      expect(performance.now() - started).toBeLessThan(HOSTILE_LIMIT_MS);
    });
  });

  // -------------------------------------------------------------------------
  describe('(4) heredoc bodies with whitespace in secret CLI commands', () => {
    const tools = [
      ['vercel env add', `vercel env add ${NAME} production`],
      ['gh secret set', `gh secret set ${NAME}`],
      ['wrangler secret put', `wrangler secret put ${NAME}`],
      ['fly secrets set', `fly secrets set ${NAME}`],
      ['docker secret create', `docker secret create ${NAME} -`],
      ['firebase functions:secrets:set', `firebase functions:secrets:set ${NAME}`],
      ['netlify env:set', `netlify env:set ${NAME}`],
      ['doppler secrets set', `doppler secrets set ${NAME}`],
      ['heroku config:set', `heroku config:set ${NAME}`],
      ['railway variables set', `railway variables set ${NAME}`],
    ];
    const tags = [
      ['plain tag', '<<EOF', 'EOF', ''],
      ['<<- with a tab-indented body', '<<-EOF', '\tEOF', '\t'],
      ['single-quoted tag', "<<'EOF'", 'EOF', ''],
      ['double-quoted tag', '<<"END"', 'END', ''],
    ];
    const direct = tools.flatMap(([tool, command]) =>
      tags.map(([tag, opener, closer, indent]) => [`${tool}, ${tag}`, `${command} ${opener}\n${indent}${passphrase}\n${closer}\n`]),
    );
    it.each(direct)('reports a passphrase body: %s', (_label, text) => {
      expect(rules('deploy.sh', text)).toContain('secret-cli-command');
    });

    const piped = tools.flatMap(([tool, command]) =>
      tags.map(([tag, opener, closer, indent]) => [`cat ${opener} | ${tool}, ${tag}`, `cat ${opener} | ${command}\n${indent}${passphrase}\n${closer}\n`]),
    );
    it.each(piped)('reports a passphrase body piped in: %s', (_label, text) => {
      expect(rules('deploy.sh', text)).toContain('secret-cli-command');
    });

    const hereStrings = tools.flatMap(([tool, command]) => [
      [`${tool}, double-quoted here-string`, `${command} <<< "${passphrase}"\n`],
      [`${tool}, single-quoted here-string`, `${command} <<< '${passphrase}'\n`],
      [`${tool}, ANSI-C here-string`, `${command} <<< $'${passphrase}'\n`],
    ]);
    it.each(hereStrings)('reports a here-string: %s', (_label, text) => {
      expect(rules('deploy.sh', text)).toContain('secret-cli-command');
    });

    const bodies = [
      ['a multi-line body, the passphrase on the last line', `vercel env add ${NAME} <<EOF\nsome intro words\n${passphrase}\nEOF\n`],
      ['a single random token (as before)', `vercel env add ${NAME} <<EOF\n${value}\nEOF\n`],
      ['a body with padding blanks', `vercel env add ${NAME} <<EOF\n  ${passphrase}  \nEOF\n`],
      ['CRLF line ends', `vercel env add ${NAME} <<EOF\r\n${passphrase}\r\nEOF\r\n`],
      ['a value-preserving filter in the pipe', `cat <<EOF | tr -d '\\n' | ${tools[0][1]}\n${passphrase}\nEOF\n`],
      ['code lines before and after the command', `echo start\ncat <<EOF | vercel env add ${NAME}\n${value}\nEOF\necho done with the deploy step here\nls -la /tmp\n`],
      ['an earlier, unrelated heredoc', `cat <<A >/dev/null\nnoise\nA\nvercel env add ${NAME} <<B\n${passphrase}\nB\n`],
    ];
    it.each(bodies)('reports: %s', (_label, text) => {
      expect(rules('deploy.sh', text)).toContain('secret-cli-command');
    });

    it('reports in a CI step, a Markdown fence and through --range', SLOW, () => {
      const inner = `vercel env add ${NAME} <<EOF\n${passphrase}\nEOF\n`;
      expect(rules('ci.yml', `steps:\n  - run: |\n${inner.replace(/^/gm, '      ')}`)).toContain('secret-cli-command');
      expect(rules('README.md', `\`\`\`bash\n${inner}\`\`\`\n`)).toContain('secret-cli-command');
      const dir = makeRepo();
      const from = commit(dir, { 'base.txt': 'base\n' });
      const head = commit(dir, { 'scripts/deploy.sh': inner });
      const found = scan(dir, '--range', `${from}..${head}`);
      expect(found.status, found.stderr).toBe(1);
      expect(found.stderr).toContain('scripts/deploy.sh  secret-cli-command');
      expect(`${found.stdout}${found.stderr}`).not.toContain(passphrase);
      // the finding is blamed on the body line as well: a commit that only adds the body to an existing command is reported
      const only = makeRepo();
      const first = commit(only, { 'deploy.sh': `vercel env add ${NAME} <<EOF\n${placeholder}\nEOF\n` });
      const second = commit(only, { 'deploy.sh': inner });
      expect(scan(only, '--range', `${first}..${second}`).status).toBe(1);
      expect(scan(only, '--history').status).toBe(1);
    });

    const clean = [
      ['a placeholder body', `vercel env add ${NAME} <<EOF\nyour secret here\nEOF\n`],
      ['a documentation body', `vercel env add ${NAME} <<EOF\nEnter the signing secret from the dashboard.\nEOF\n`],
      ['a name that is not secret-like', `vercel env add FEATURE_NAME <<EOF\n${passphrase}\nEOF\n`],
      ['prose after the terminator is not part of the body', `vercel env add ${NAME} <<EOF\n${placeholder}\nEOF\nnpm run build --prefix app and then deploy it now\n`],
      ['a template reference', `vercel env add ${NAME} <<EOF\n$\{JWT_FROM_VAULT}\nEOF\n`],
    ];
    it.each(clean)('passes: %s', (_label, text) => {
      expect(count('deploy.sh', text)).toBe(0);
    });

    it('a body without a terminator, or with one beyond the bounds, is reported (fail closed)', () => {
      expect(count('deploy.sh', `vercel env add ${NAME} <<EOF\n${passphrase}\n`)).toBe(1);
      expect(count('deploy.sh', `vercel env add ${NAME} <<EOF\n${placeholder}\nnpm run build now please\n`)).toBe(1);
      expect(count('deploy.sh', `vercel env add ${NAME} <<EOF\n${'filler text here\n'.repeat(300)}EOF\n`)).toBe(1);
      // inside the bound it is judged as a body, not reported for its length
      expect(count('deploy.sh', `vercel env add ${NAME} <<EOF\n${'filler text here\n'.repeat(100)}EOF\n`)).toBe(0);
      // a name that is not secret-like is never reported for a missing terminator
      expect(count('deploy.sh', `vercel env add FEATURE_NAME <<EOF\n${passphrase}\n`)).toBe(0);
    });

    it('an allow marker on the command line or on a body line silences it', () => {
      expect(count('deploy.sh', `vercel env add ${NAME} <<EOF # ${ALLOW_MARKER}\n${passphrase}\nEOF\n`)).toBe(0);
      expect(count('deploy.sh', `vercel env add ${NAME} <<EOF\n${passphrase} # ${ALLOW_MARKER}\nEOF\n`)).toBe(0);
    });

    it('many heredoc commands are read within a budget', SLOW, () => {
      const started = performance.now();
      scanText('deploy.sh', `vercel env add ${NAME} <<EOF\n`.repeat(60000));
      scanText('deploy.sh', `cat <<EOF | vercel env add ${NAME}\n`.repeat(60000));
      scanText('deploy.sh', `vercel env add ${NAME} <<EOF\n${'some words here\n'.repeat(150)}EOF\n`.repeat(2000));
      expect(performance.now() - started).toBeLessThan(HOSTILE_LIMIT_MS);
    });
  });
});
