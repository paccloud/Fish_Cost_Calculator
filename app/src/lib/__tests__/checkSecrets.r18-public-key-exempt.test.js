/**
 * Tests for scripts/check-secrets.mjs, review round 18: public verification material is not a secret.
 *   - A name that ends in public/pub + key (public_key, jwtPublicKey, PUB_KEY) is not secret-like.
 *   - A value that is nothing but complete public PEM blocks (PUBLIC KEY, RSA PUBLIC KEY, CERTIFICATE, a certificate chain) is not
 *     judged as a secret under any name, in any of the forms the name-based readers understand.
 *   - Still reported: PRIVATE KEY blocks and provider tokens under a public name (their own rules ignore the name), names that end in a
 *     secret noun (public_key_password, pubkey_secret), and anything that is not provably a complete public block.
 *
 * Every fake credential and every PEM header below is assembled at RUNTIME from pieces, so this file contains no secret-shaped
 * literal and passes the scanner itself. Do not paste a real credential or key here.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { blankPublicPemBlocks, scanText, secretNameKind } from '../../../../scripts/check-secrets.mjs';

const HOSTILE_LIMIT_MS = 8000;
const SLOW_TEST_MS = 120_000;
const SLOW = { timeout: SLOW_TEST_MS };
const CHILD_KILL_MS = 100_000;

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '../../../..');
const SCANNER = path.join(REPO_ROOT, 'scripts', 'check-secrets.mjs');
const SCAN_MODULE_IMPORT = `import { scanText, blankPublicPemBlocks } from ${JSON.stringify(pathToFileURL(SCANNER).href)};`;

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

const join = (...parts) => parts.join('');
const hasGit = () => spawnSync('git', ['--version']).status === 0;

// PEM pieces, built at runtime. `label` is e.g. PUBLIC, CERT or PRIVATE below.
const DASHES = '-'.repeat(5);
const begin = (label) => join(DASHES, 'BEGIN ', label, DASHES);
const end = (label) => join(DASHES, 'END ', label, DASHES);
const PUBLIC = join('PUBLIC', ' KEY');
const RSA_PUBLIC = join('RSA ', 'PUBLIC', ' KEY');
const CERT = 'CERTIFICATE';
const PRIVATE = join('PRIV', 'ATE', ' KEY');
const RSA_PRIVATE = join('RSA ', 'PRIV', 'ATE', ' KEY');
const EC_PRIVATE = join('EC ', 'PRIV', 'ATE', ' KEY');
const ENCRYPTED_PRIVATE = join('ENCRYPTED ', 'PRIV', 'ATE', ' KEY');
// Shaped like a real 2048-bit body: a DER SEQUENCE starts with "MII" in base64, then 64-character lines and a padded last line.
// The rest is random, so every line reads as a random secret to a name-based rule.
const bodyLines = (seed) => [
  join('MII', randomString(61, seed, BASE64)),
  ...[1, 2, 3].map((i) => randomString(64, seed + i, BASE64)),
  join(randomString(20, seed + 9, BASE64), '=='),
];
/** A PEM block as lines (no indentation). */
const pemLines = (label, seed = 18001) => [begin(label), ...bodyLines(seed), end(label)];
const indent = (lines, pad) => lines.map((line) => pad + line).join('\n');
const escaped = (lines) => lines.join('\\n');

describe('review round 18: public keys and certificates are not secrets', () => {
  const value = randomString(32, 18100);
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

  // -------------------------------------------------------------------------
  describe('(1) explicitly public names are not secret-like', () => {
    it.each([
      'public_key', 'publicKey', 'PUBLIC_KEY', 'PublicKey', 'public-key', 'public.key', 'pub_key', 'pubKey', 'PUB_KEY', 'pubkey',
      'PUBKEY', 'publickey', 'jwt_public_key', 'JWT_PUBLIC_KEY', 'jwtPublicKey', 'idTokenPublicKey', 'SSH_PUBLIC_KEY', 'ssh_pub_key',
      'public_key_2', 'NEXT_PUBLIC_KEY', 'public_cert', 'certificate', 'cert', 'ca_cert', 'CA_CERT', 'tls_certificate',
      'public_key_pem', 'public_key_id', 'public_keys',
      // Words that say what the public key verifies or encrypts do not make it secret.
      'ID_TOKEN_PUBLIC_KEY', 'token_public_key', 'PASSWORD_ENCRYPTION_PUBLIC_KEY', 'credentials_pub_key',
    ])('%s', (name) => {
      expect(secretNameKind(name)).toBeNull();
    });

    it.each([
      // A name that ENDS in a secret noun is strong whatever comes before it.
      'public_key_password', 'publicKeyPassword', 'PUBLIC_KEY_PASSPHRASE', 'pubkey_secret', 'PUBKEY_SECRET', 'pubKeySecret',
      'public_key_token', 'public_key_pass',
      // <secret qualifier> + key stays strong even with "public" in front of it.
      'public_secret_key', 'PUBLIC_API_KEY', 'public_private_key', 'public_signing_key',
    ])('%s stays strong', (name) => {
      expect(secretNameKind(name)).toBe('strong');
    });

    it.each([
      // An HMAC (HS256) verification key is the shared secret itself: not exempt by name (a PEM value is exempt by value).
      'verification_key', 'jwt_verification_key', 'JWT_VERIFICATION_KEY', 'verify_key',
      // A name that also calls the key secret or private contradicts itself: it is not taken at its word.
      'secret_public_key', 'SECRETS_PUBLIC_KEY', 'private_public_key', 'clientSecretPublicKey', 'privatePubKey',
      // A vendor key with "public" elsewhere in the name is still a bare <vendor>_KEY.
      'public_stripe_key', 'pubsub_key',
    ])('%s stays weak', (name) => {
      expect(secretNameKind(name)).toBe('weak');
    });

    const PUBLIC_NAMES = ['public_key', 'publicKey', 'PUBLIC_KEY', 'JWT_PUBLIC_KEY', 'pub_key', 'ssh_pub_key'];
    it.each([
      ['dotenv', 'app.env', (name) => `${name}=${value}\n`],
      ['YAML', 'config.yml', (name) => `auth:\n  ${name}: ${value}\n`],
      ['JSON', 'config.json', (name) => `{"${name}": "${value}"}\n`],
      ['JS', 'src/keys.js', (name) => `const ${name} = "${value}";\n`],
      ['k8s name/value pair', 'deploy.yml', (name) => `env:\n  - name: ${name}\n    value: "${value}"\n`],
      ['XML element', 'app.config', (name) => `<settings>\n  <${name}>${value}</${name}>\n</settings>\n`],
    ])('a random value under a public name is not reported (%s)', (_label, file, make) => {
      for (const name of PUBLIC_NAMES) expect(rules(file, make(name)), name).toEqual([]);
    });

    it.each([
      ['dotenv', 'app.env', (name) => `${name}=${value}\n`],
      ['YAML', 'config.yml', (name) => `auth:\n  ${name}: ${value}\n`],
      ['JSON', 'config.json', (name) => `{"${name}": "${value}"}\n`],
    ])('a random value under a public-looking secret name is still reported (%s)', (_label, file, make) => {
      for (const name of ['public_key_password', 'pubkey_secret', 'PUBLIC_KEY_TOKEN', 'public_secret_key', 'secret_public_key', 'JWT_VERIFICATION_KEY']) {
        expect(rules(file, make(name)), name).toContain('secret-assignment');
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('(2) a complete public PEM block is not judged under any name', () => {
    // Secret-like names too: a JWT_SECRET that holds a public key is a misnomer, not a leak.
    const NAMES = ['public_key', 'jwt_public_key', 'jwt_secret', 'signing_secret', 'private_key', 'verification_key', 'tls_cert'];
    const LABELS = [PUBLIC, RSA_PUBLIC, CERT];
    const lines = (label) => pemLines(label);
    const FORMS = [
      ['YAML literal block', 'config.yml', (name, label) => `auth:\n  ${name}: |\n${indent(lines(label), '    ')}\n`],
      ['YAML stripped literal block', 'config.yml', (name, label) => `auth:\n  ${name}: |-\n${indent(lines(label), '    ')}\n`],
      ['YAML folded block', 'config.yaml', (name, label) => `${name}: >\n${indent(lines(label), '  ')}\n`],
      ['YAML plain scalar on the next lines', 'config.yaml', (name, label) => `auth:\n  ${name}:\n${indent(lines(label), '    ')}\n  other: plain\n`],
      ['YAML double-quoted, escaped line breaks', 'config.yaml', (name, label) => `${name}: "${escaped(lines(label))}"\n`],
      ['YAML block with CRLF line ends', 'config.yml', (name, label) => `auth:\r\n  ${name}: |\r\n${indent(lines(label), '    ').split('\n').join('\r\n')}\r\n`],
      ['dotenv, escaped line breaks', 'app.env', (name, label) => `${name.toUpperCase()}="${escaped(lines(label))}"\n`],
      ['dotenv, escaped and unquoted', '.env', (name, label) => `${name.toUpperCase()}=${escaped(lines(label))}\nNEXT_VALUE=plain\n`],
      ['dotenv, quote closed on a later line', '.env', (name, label) => `${name.toUpperCase()}="${lines(label).join('\n')}"\n`],
      ['dotenv, CRLF inside the quotes', '.env', (name, label) => `${name.toUpperCase()}="${lines(label).join('\r\n')}"\r\nNEXT_VALUE=plain\r\n`],
      ['JSON, escaped line breaks', 'keys.json', (name, label) => `{\n  "${name}": "${escaped(lines(label))}"\n}\n`],
      ['JSON, escaped CRLF', 'keys.json', (name, label) => `{"${name}": "${lines(label).join('\\r\\n')}\\n"}\n`],
      ['JSON, escaped line breaks before and after the block', 'keys.json', (name, label) => `{"${name}": "\\n\\n${escaped(lines(label))}\\n\\n"}\n`],
      ['k8s name/value pair, block', 'deploy.yml', (name, label) => `env:\n  - name: ${name}\n    value: |\n${indent(lines(label), '      ')}\n`],
      ['k8s name/value pair, escaped', 'deploy.yml', (name, label) => `env:\n  - name: ${name}\n    value: "${escaped(lines(label))}"\n`],
      ['JS template literal', 'src/keys.js', (name, label) => `export const ${name} = \`\n${lines(label).join('\n')}\n\`;\n`],
      ['JS escaped string', 'src/keys.js', (name, label) => `export const ${name} = "${escaped(lines(label))}";\n`],
      ['Python triple quotes', 'settings.py', (name, label) => `${name.toUpperCase()} = """\n${lines(label).join('\n')}\n"""\n`],
      ['TOML triple quotes', 'config.toml', (name, label) => `${name} = """\n${lines(label).join('\n')}\n"""\n`],
      ['HCL heredoc', 'main.tf', (name, label) => `${name} = <<EOT\n${lines(label).join('\n')}\nEOT\n`],
      ['shell heredoc in a command substitution', 'deploy.sh', (name, label) => `export ${name.toUpperCase()}="$(cat <<'EOF'\n${lines(label).join('\n')}\nEOF\n)"\n`],
      ['XML element', 'app.config', (name, label) => `<settings>\n  <${name}>\n${lines(label).join('\n')}\n  </${name}>\n</settings>\n`],
      ['PowerShell here-string', 'setup.ps1', (name, label) => `$env:${name.toUpperCase()} = @"\n${lines(label).join('\n')}\n"@\n`],
      ['fenced env block in Markdown', 'README.md', (name, label) => `\`\`\`env\n${name.toUpperCase()}="${escaped(lines(label))}"\n\`\`\`\n`],
      ['properties backslash continuation', 'app.properties', (name, label) => `${name}=${lines(label).join('\\n\\\n    ')}\n`],
      ['INI, escaped line breaks', 'app.ini', (name, label) => `[auth]\n${name} = "${escaped(lines(label))}"\n`],
    ];

    it.each(FORMS)('%s', (_form, file, make) => {
      for (const name of NAMES) {
        for (const label of LABELS) expect(rules(file, make(name, label)), `${name}, ${label}`).toEqual([]);
      }
    });

    it('a certificate chain is not judged either, even one longer than the YAML block window', () => {
      const chain = (n) => Array.from({ length: n }, (_, i) => pemLines(CERT, 18200 + i * 100)).flat();
      for (const n of [2, 3, 5, 12]) {
        expect(rules('config.yml', `tls:\n  ca_bundle_secret: |\n${indent(chain(n), '    ')}\n`), `${n} certificates`).toEqual([]);
        // The escaped line break between two blocks goes too: left behind, unescaping would read the chain as "n n n ...".
        expect(rules('app.env', `CA_BUNDLE_SECRET="${escaped(chain(n))}\\n"\n`), `${n} certificates`).toEqual([]);
        expect(rules('keys.json', `{"ca_bundle_secret": "${chain(n).join('\\r\\n')}"}\n`), `${n} certificates`).toEqual([]);
        expect(rules('app.properties', `ca_bundle_secret=${chain(n).join('\\n\\\n    ')}\n`), `${n} certificates`).toEqual([]);
      }
    });

    it('blankPublicPemBlocks keeps length and line breaks, and leaves everything that is not a complete public block alone', () => {
      const text = `a: |\n  ${pemLines(PUBLIC).join('\n  ')}\nb: "${escaped(pemLines(CERT, 18250))}"\r\nc: d\n`;
      const blanked = blankPublicPemBlocks(text);
      expect(blanked).toHaveLength(text.length);
      expect([...blanked].map((ch, i) => (ch === '\n' || ch === '\r' ? i : -1)).filter((i) => i >= 0)).toEqual(
        [...text].map((ch, i) => (ch === '\n' || ch === '\r' ? i : -1)).filter((i) => i >= 0),
      );
      // Only the two blocks are gone: the YAML key, the quotes around the escaped block and the next entry are untouched.
      expect(blanked.replace(/\s+/g, ' ')).toBe('a: | b: " " c: d ');
      // The escaped line breaks next to a block go with it; the values on either side are kept whole.
      const glued = `x: "${value}\\n${escaped(pemLines(PUBLIC))}\\r\\n${value}"\n`;
      expect(blankPublicPemBlocks(glued).replace(/\s+/g, ' ')).toBe(`x: "${value} ${value}" `);
      // Not public, not complete or not DER: returned unchanged.
      for (const untouched of [
        `k: |\n  ${pemLines(PRIVATE).join('\n  ')}\n`,
        `k: |\n  ${pemLines(PUBLIC).slice(0, -1).join('\n  ')}\n`,
        `k: |\n  ${[...pemLines(PUBLIC).slice(0, -1), end(CERT)].join('\n  ')}\n`,
        `k: |\n  ${[begin(PUBLIC), join('Q', randomString(63, 18260, BASE64)), end(PUBLIC)].join('\n  ')}\n`,
        `k: "${pemLines(PUBLIC).join(' ')}"\n`,
        'no PEM here\n',
      ]) {
        expect(blankPublicPemBlocks(untouched)).toBe(untouched);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('(3) what is still reported', () => {
    const ghToken = join('gh', 'p_', randomString(36, 18500));
    const awsKeyId = join('AK', 'IA', randomString(16, 18510, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'));

    it.each([
      ['YAML block, PRIVATE KEY', 'config.yml', `auth:\n  public_key: |\n${indent(pemLines(PRIVATE), '    ')}\n`],
      ['YAML block, RSA PRIVATE KEY', 'config.yml', `auth:\n  publicKey: |\n${indent(pemLines(RSA_PRIVATE), '    ')}\n`],
      ['dotenv, escaped EC PRIVATE KEY', 'app.env', `PUBLIC_KEY="${escaped(pemLines(EC_PRIVATE))}"\n`],
      ['JSON, escaped ENCRYPTED PRIVATE KEY', 'keys.json', `{"pubkey": "${escaped(pemLines(ENCRYPTED_PRIVATE))}"}\n`],
      ['JSON, escaped PRIVATE KEY', 'keys.json', `{"public_key": "${escaped(pemLines(PRIVATE))}"}\n`],
      ['a private key after a certificate', 'config.yml', `tls:\n  certificate: |\n${indent([...pemLines(CERT), ...pemLines(PRIVATE, 18600)], '    ')}\n`],
      ['a private key under a certificate name', 'tls.env', `TLS_CERT="${escaped(pemLines(PRIVATE, 18610))}"\n`],
    ])('a private key under a public name: %s', (_label, file, text) => {
      expect(rules(file, text)).toContain('private-key-block');
    });

    it.each([
      ['dotenv', 'app.env', `PUBLIC_KEY=${ghToken}\n`],
      ['YAML', 'config.yml', `auth:\n  public_key: ${ghToken}\n`],
      ['JSON', 'config.json', `{"publicKey": "${ghToken}"}\n`],
      ['JS', 'src/keys.js', `const publicKey = "${ghToken}";\n`],
      ['k8s name/value pair', 'deploy.yml', `env:\n  - name: PUBLIC_KEY\n    value: "${ghToken}"\n`],
    ])('a provider token under a public name (%s)', (_label, file, text) => {
      expect(rules(file, text)).toContain('github-token');
    });

    it('a provider-shaped token inside a public block body is still found: the shape rules read the original text', () => {
      const pub = pemLines(PUBLIC);
      const line = join('MII', randomString(10, 18520, BASE64), 'a', awsKeyId, 'b', randomString(20, 18530, BASE64));
      expect(blankPublicPemBlocks([pub[0], line, ...pub.slice(2)].join('\n')).trim()).toBe('');
      expect(rules('config.yml', `auth:\n  public_key: |\n${indent([pub[0], line, ...pub.slice(2)], '    ')}\n`)).toContain('aws-access-key-id');
    });

    const block = (lines) => `auth:\n  jwt_secret: |\n${indent(lines, '    ')}\n`;
    const pub = pemLines(PUBLIC);
    it.each([
      ['a password line after the public block', block([...pub, value])],
      ['a password line before the public block', block([value, ...pub])],
      ['a public block that is not closed', block(pub.slice(0, -1))],
      ['a public block closed with another label', block([...pub.slice(0, -1), end(CERT)])],
      ['a public block closed as a private key', block([...pub.slice(0, -1), end(PRIVATE)])],
      ['a non-base64 line inside the public block', block([pub[0], `${value}!`, ...pub.slice(1)])],
      ['a header line inside the public block', block([pub[0], join('Proc-Type', ': 4,ENCRYPTED'), ...pub.slice(1)])],
      ['a public block with no body', block([pub[0], pub[pub.length - 1], value])],
      ['a body that is not DER (does not start with M)', block([pub[0], join('Q', randomString(63, 18540, BASE64)), ...pub.slice(2)])],
      ['padding before the last body line', block([pub[0], pub[1], join(randomString(20, 18550, BASE64), '=='), ...pub.slice(2)])],
    ])('a secret-named block that is not only public PEM: %s', (_label, text) => {
      expect(rules('config.yml', text)).toContain('secret-assignment');
    });

    it.each([
      ['text after the escaped block', `JWT_SECRET="${escaped(pub)}\\n${value}"\n`],
      ['text before the escaped block', `JWT_SECRET="${value}\\n${escaped(pub)}"\n`],
      ['text glued to the END line', `JWT_SECRET="${escaped(pub)}${value}"\n`],
      ['an escaped block that is not closed', `JWT_SECRET="${escaped(pub.slice(0, -1))}"\n`],
      ['a block flattened onto one line with blanks', `JWT_SECRET="${pub.join(' ')}"\n`],
    ])('a secret-named inline value that is not only public PEM: %s', (_label, text) => {
      expect(rules('app.env', text)).toContain('secret-assignment');
    });

    it('a secret name with a random value is still reported (no change to ordinary values)', () => {
      expect(count('app.env', `JWT_SECRET=${value}\n`)).toBe(1);
      expect(count('config.yml', `auth:\n  jwt_secret: |\n    ${value}\n`)).toBe(1);
      expect(rules('deploy.yml', `env:\n  - name: JWT_SECRET\n    value: "${value}"\n`)).toContain('secret-name-value-pair');
    });
  });

  // -------------------------------------------------------------------------
  it('hostile input: many unclosed public BEGIN lines, long base64 runs and blank runs stay fast', SLOW, () => {
    const timings = timeInChild(`
      const header = ${JSON.stringify(begin(PUBLIC))};
      const footer = ${JSON.stringify(end(PUBLIC))};
      const line = ${JSON.stringify(join('MII', randomString(61, 18700, BASE64)))};
      const texts = {
        'begin lines only': (header + '\\n').repeat(150000),
        'begin + base64, never closed': (header + '\\n' + line + '\\n').repeat(70000),
        'one begin, long base64 run': header + '\\n' + (line + '\\n').repeat(70000),
        'escaped, never closed': ('X="' + header + '\\\\n' + line + '\\\\n').repeat(50000),
        'blanks without a line break': (header + ' '.repeat(5000)).repeat(800),
        'backslash runs': (header + '\\\\'.repeat(6000)).repeat(500),
        'complete blocks': ('k: |\\n  ' + header + '\\n  ' + line + '\\n  ' + footer + '\\n').repeat(40000),
        'escaped breaks around complete blocks': ('k: "' + '\\\\n'.repeat(3000) + header + '\\\\n' + line + '\\\\n' + footer + '\\\\n'.repeat(3000) + '"\\n').repeat(300),
        'a chain of escaped blocks': 'k: "' + (header + '\\\\n' + line + '\\\\n' + footer + '\\\\n').repeat(40000) + '"\\n',
        'begin prefixes': '-----BEGIN '.repeat(400000),
      };
      for (const [name, text] of Object.entries(texts)) {
        let start = performance.now();
        if (blankPublicPemBlocks(text).length !== text.length) throw new Error('length changed: ' + name);
        timings.push(['blank ' + name, performance.now() - start]);
        start = performance.now();
        scanText('config.yml', text);
        timings.push(['scan ' + name, performance.now() - start]);
      }
    `);
    for (const [label, ms] of timings) expect(ms, label).toBeLessThan(HOSTILE_LIMIT_MS);
  });

  // -------------------------------------------------------------------------
  it.skipIf(!hasGit())('the tree scan and --range pass a committed public key and still report a private one, without printing it', SLOW, () => {
    const dir = makeRepo();
    const root = commit(dir, { 'README.md': '# demo\n' });
    const base = commit(dir, {
      'config.yml': `auth:\n  public_key: |\n${indent(pemLines(PUBLIC), '    ')}\n  jwt_public_key: ${value}\n  jwt_secret: |\n${indent(pemLines(RSA_PUBLIC, 18710), '    ')}\n`,
      'certs/ca.json': `{"ca_bundle_secret": "${escaped([...pemLines(CERT, 18720), ...pemLines(CERT, 18730)])}"}\n`,
      'app.env': `PUBLIC_KEY=${value}\n`,
    });
    expect(scan(dir).status).toBe(0);
    const clean = scan(dir, '--range', `${root}..HEAD`);
    expect(clean.status, `${clean.stdout}\n${clean.stderr}`).toBe(0);

    const privateBody = bodyLines(18800);
    const ghToken = join('gh', 'p_', randomString(36, 18900));
    commit(dir, {
      'deploy/keys.yml': `auth:\n  public_key: |\n${indent([begin(PRIVATE), ...privateBody, end(PRIVATE)], '    ')}\n`,
      'deploy/app.env': `PUBLIC_KEY=${ghToken}\n`,
    });
    for (const args of [[], ['--range', `${base}..HEAD`], ['--range', `${root}..HEAD`]]) {
      const result = scan(dir, ...args);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status, output).toBe(1);
      expect(output).toContain('deploy/keys.yml');
      expect(output).toContain('private-key-block');
      expect(output).toContain('deploy/app.env');
      expect(output).toContain('github-token');
      expect(output).not.toContain('config.yml');
      expect(output).not.toContain('certs/ca.json');
      expect(output).not.toMatch(/(?<!deploy\/)app\.env/);
      for (const piece of [...windows(privateBody.join('')), ...windows(ghToken)]) expect(output).not.toContain(piece);
    }
  });
});
