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
import { Buffer } from 'node:buffer';
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
/** `n` deterministic pseudo-random bytes. */
function randomBytes(n, seed) {
  let state = seed;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    out.push(Math.floor(state / 65536) & 255);
  }
  return out;
}
/** The base64 of one whole DER SEQUENCE of `size` bytes (30 82 <length>, then random content), as 64-character lines. */
const derLines = (size, seed) => {
  const content = size - 4;
  const der = Buffer.from([0x30, 0x82, content >> 8, content & 255, ...randomBytes(content, seed)]);
  return der.toString('base64').match(/.{1,64}/g);
};
// Shaped like a real body: one DER SEQUENCE whose stated length is the decoded body (review round 19: a block whose body is not one
// whole DER object is not taken for a public key), "MII" in base64, 64-character lines and a padded last line. The content is
// random, so every line reads as a random secret to a name-based rule.
const bodyLines = (seed) => derLines(208, seed);
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
      // Same length as the line it replaces, and the same first 8 characters (the DER header), so the block stays whole.
      const line = join(pub[1].slice(0, 8), randomString(13, 18520, BASE64), 'a', awsKeyId, 'b', randomString(21, 18530, BASE64));
      expect(line).toHaveLength(pub[1].length);
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
  // Review round 19: the public-name exemption silenced private material that private-key-block could not read (one line, XML
  // entities, double escapes, \u000a, .properties continuations, PuTTY, base64 or bare DER keys, prefixed private keys); public blocks
  // written with `\/`, as a JSON array, as PGP armor or as a CSR / CRL were still judged; a real-size CA chain ran literals out of
  // their bounds; and a password dressed in public BEGIN / END lines passed.
  describe('(4) review round 19', () => {
    const PUBLIC_NAMES = ['public_key', 'PUBLIC_KEY', 'jwtPublicKey'];
    const priv = pemLines(PRIVATE, 19001);
    const openssh = [begin(join('OPENSSH ', PRIVATE)), join('b3BlbnNzaC1rZXktdjE', randomString(200, 19003, BASE64)), end(join('OPENSSH ', PRIVATE))];
    const ppk = [
      'PuTTY-User-Key-File-2: ssh-rsa', 'Encryption: none', 'Comment: k', 'Public-Lines: 2', ...derLines(120, 19005),
      'Private-Lines: 3', ...derLines(180, 19007), join('Private-MAC: ', randomString(40, 19009, '0123456789abcdef')),
    ];
    const SHAPES = [
      ['one line, blanks between (dotenv)', 'app.env', (name) => `${name.toUpperCase()}="${priv.join(' ')}"\n`],
      ['one line, blanks between (YAML)', 'config.yml', (name) => `auth:\n  ${name}: "${priv.join(' ')}"\n`],
      ['.properties continuation', 'app.properties', (name) => `${name}=${priv.join('\\n\\\n    ')}\n`],
      ['XML &#10; entities', 'app.config', (name) => `<cfg>\n<${name}>${priv.join('&#10;')}</${name}>\n</cfg>\n`],
      ['XML &#xA; entities', 'app.config', (name) => `<cfg>\n<${name}>${priv.join('&#xA;')}</${name}>\n</cfg>\n`],
      ['XML add key/value', 'web.config', (name) => `<appSettings>\n<add key="${name}" value="${priv.join('&#10;')}"/>\n</appSettings>\n`],
      ['double-escaped JSON', 'keys.json', (name) => `{"${name}": "${priv.join('\\\\n')}"}\n`],
      ['\\u000a-escaped JSON', 'keys.json', (name) => `{"${name}": "${priv.join('\\u000a')}"}\n`],
      ['PuTTY .ppk in a YAML block', 'config.yml', (name) => `${name}: |\n${indent(ppk, '  ')}\n`],
      ['one-line OpenSSH private key', 'config.yml', (name) => `${name}: "${openssh.join(' ')}"\n`],
      ['base64 of a PEM private key', 'config.yml', (name) => `${name}: ${Buffer.from(priv.join('\n')).toString('base64')}\n`],
    ];
    it.each(SHAPES)('a private key under a public name, %s: private-key-block', (_label, file, make) => {
      for (const name of PUBLIC_NAMES) expect(rules(file, make(name)), name).toContain('private-key-block');
    });

    it('a bare base64 DER private key is reported under any name', () => {
      const der = (hex, n, seed) => Buffer.concat([Buffer.from(hex, 'hex'), Buffer.from(randomBytes(n, seed))]).toString('base64');
      const keys = [
        der('308204bd020100300d06092a864886f70d0101010500048204a7', 1189, 19011), // PKCS#8 rsaEncryption
        der('308204a40201000282010100', 1180, 19013), // PKCS#1 RSAPrivateKey
        der('308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b0201010420', 100, 19015), // PKCS#8 EC P-256
        der('30770201010420', 112, 19017), // SEC1 EC P-256
        der('302e020100300506032b657004220420', 32, 19019), // PKCS#8 Ed25519
      ];
      for (const key of keys) {
        for (const name of ['public_key', 'data']) expect(rules('config.yml', `${name}: ${key}\n`), key.slice(0, 16)).toContain('private-key-block');
      }
    });

    it('prefixed private material under a public name is reported by its token rule', () => {
      const tokens = [
        join('x', 'prv', '9s21ZrQH143K', randomString(95, 19021, '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz')),
        join('ns', 'ec1', randomString(58, 19023, 'qpzry9x8gf2tvdw0s3jn54khce6mua7l')),
        join('PM', 'AK-', randomString(24, 19025, '0123456789abcdef'), '-', randomString(34, 19027, '0123456789abcdef')),
      ];
      for (const token of tokens) expect(rules('config.yml', `public_key: ${token}\n`), token.slice(0, 5)).toContain('other-provider-token');
    });

    const pub = pemLines(PUBLIC, 19031);
    const PGP_LABEL = join('PGP ', 'PUBLIC KEY BLOCK');
    const pgp = [
      begin(PGP_LABEL), 'Version: GnuPG v2', '',
      ...Buffer.from([0x99, 0x01, 0x0d, ...randomBytes(269, 19033)]).toString('base64').match(/.{1,64}/g),
      join('=', randomString(4, 19035)), end(PGP_LABEL),
    ];
    it.each([
      ['PHP / org.json escaped slashes', 'keys.json', `{"jwt_secret":"${pub.map((l) => l.replace(/[\\/]/g, '\\$&')).join('\\n')}"}\n`],
      ['PHP-escaped certificate', 'keys.json', `{"signing_key":"${pemLines(CERT, 19037).map((l) => l.replace(/[\\/]/g, '\\$&')).join('\\n')}"}\n`],
      ['a JSON array of lines', 'keys.json', `{"jwt_secret": [${pub.map((l) => JSON.stringify(l)).join(', ')}]}\n`],
      ['a JSON array of lines, one per line', 'keys.json', `{"jwt_secret": [\n${pub.map((l) => `    ${JSON.stringify(l)}`).join(',\n')}\n]}\n`],
      ['PGP armored public key', 'config.yml', `apt_signing_key: |\n${indent(pgp, '  ')}\n`],
      ['CERTIFICATE REQUEST', 'keys.json', `{"jwt_secret": "${pemLines('CERTIFICATE REQUEST', 19039).join('\\n')}"}\n`],
      ['X509 CRL', 'keys.json', `{"jwt_secret": "${pemLines('X509 CRL', 19041).join('\\n')}"}\n`],
      ['\\u000a-escaped public key', 'keys.json', `{"jwt_secret": "${pub.join('\\u000a')}"}\n`],
    ])('a complete public block is not judged under a secret name: %s', (_label, file, text) => {
      expect(rules(file, text)).toEqual([]);
    });

    // Real-size certificates (~1.6 KB DER, 27 lines each): 8 of them are over 200 lines, 20 escaped on one line are over 32 KB.
    const chain = (n) => Array.from({ length: n }, (_, i) => [begin(CERT), ...derLines(1600, 19100 + i), end(CERT)]).flat();
    const TRIPLE = '"'.repeat(3);
    it.each([
      ['dotenv, quote closed on a later line', 'c.env', (lines) => `CA_BUNDLE_SECRET="${lines.join('\n')}"\n`],
      ['Python triple quotes', 'c.py', (lines) => `TLS_CA_SECRET = ${TRIPLE}${lines.join('\n')}${TRIPLE}\n`],
      ['TOML triple quotes', 'c.toml', (lines) => `tls_ca_secret = ${TRIPLE}\n${lines.join('\n')}\n${TRIPLE}\n`],
      ['HCL heredoc', 'c.tf', (lines) => `${join('ca_', 'secret')} = <<EOT\n${lines.join('\n')}\nEOT\n`],
      ['JS template literal', 'c.js', (lines) => `const CA_SECRET = \`${lines.join('\n')}\`;\n`],
      ['k8s value block', 'c.yml', (lines) => `env:\n  - name: CA_SECRET\n    value: |\n${indent(lines, '      ')}\n`],
      ['YAML block scalar', 'c.yml', (lines) => `ca_secret: |\n${indent(lines, '  ')}\n`],
    ])('a chain of 8 real-size certificates is not judged: %s', (_label, file, make) => {
      expect(chain(8).length).toBeGreaterThan(200);
      expect(rules(file, make(chain(8)))).toEqual([]);
    });
    it('a chain of 20 real-size certificates escaped onto one line is not judged', () => {
      expect(chain(20).join('\\n').length).toBeGreaterThan(32 * 1024);
      expect(rules('c.json', `{"ca_secret": "${chain(20).join('\\n')}"}\n`)).toEqual([]);
      expect(rules('c.env', `CA_SECRET="${chain(20).join('\\n')}"\n`)).toEqual([]);
    });
    it('a secret over more than 200 non-blank lines is still reported, blank lines or not', () => {
      const long = Array.from({ length: 230 }, (_, i) => randomString(30, 19200 + i));
      expect(rules('c.env', `CA_SECRET="${long.join('\n')}"\n`)).toContain('secret-assignment');
      expect(rules('c.env', `CA_SECRET="${long.join('\n\n\n')}"\n`)).toContain('secret-assignment');
    });

    it.each([
      ['an escaped block in a dotenv string', '.env', `DB_PASSWORD="${[begin(PUBLIC), 'MyS3cretPassw0rdA7fK9mQ2', end(PUBLIC)].join('\\n')}"\n`],
      ['a YAML password block in CERTIFICATE lines', 'config.yml', `password: |\n${indent([begin(CERT), 'MyS3cretPassw0rdA7fK9mQ2', end(CERT)], '  ')}\n`],
      ['a body whose DER length is wrong', 'config.yml', `jwt_secret: |\n${indent([begin(PUBLIC), ...derLines(208, 19301).slice(0, -1), end(PUBLIC)], '  ')}\n`],
    ])('a password dressed up as a public block is still reported: %s', (_label, file, text) => {
      expect(rules(file, text)).toContain('secret-assignment');
    });

    it('hostile runs of blanks inside unclosed literals stay fast', SLOW, () => {
      const timings = timeInChild(`
        const blanks = (' '.repeat(60) + '\\n').repeat(60000);
        const texts = {
          dotenv: 'X_SECRET="' + blanks,
          python: 'X_SECRET = ' + '"'.repeat(3) + blanks,
          heredocs: Array.from({ length: 400 }, (_, i) => 'k' + i + '_sec' + 'ret = <<EOT' + i + '\\n').join('') + blanks,
          template: 'const X_SECRET = ' + String.fromCharCode(96) + blanks,
          yaml: 'x_secret: |\\n' + blanks + 'next: 1\\n',
        };
        for (const [name, text] of Object.entries(texts)) {
          for (const file of ['a.env', 'a.py', 'a.tf', 'a.js', 'a.yml']) {
            const start = performance.now();
            scanText(file, text);
            timings.push([name + ' ' + file, performance.now() - start]);
          }
        }
      `);
      for (const [label, ms] of timings) expect(ms, label).toBeLessThan(HOSTILE_LIMIT_MS);
    });

    it.skipIf(!hasGit())('the tree scan, --range and --history report one-line private keys under public names and pass a real CA chain', SLOW, () => {
      const dir = makeRepo();
      const root = commit(dir, { 'README.md': '# demo\n' });
      commit(dir, {
        'b1.env': `PUBLIC_KEY="${priv.join(' ')}"\n`,
        'b2.yml': `auth:\n  public_key: "${priv.join(' ')}"\n`,
        'c1.env': `CA_BUNDLE_SECRET="${chain(8).join('\n')}"\n`,
      });
      for (const args of [[], ['--range', `${root}..HEAD`], ['--history']]) {
        const result = scan(dir, ...args);
        const output = `${result.stdout}\n${result.stderr}`;
        expect(result.status, output).toBe(1);
        expect(output).toContain('b1.env');
        expect(output).toContain('b2.yml');
        expect(output).toContain('private-key-block');
        expect(output).not.toContain('c1.env');
        for (const piece of windows(priv.slice(1, -1).join(''))) expect(output).not.toContain(piece);
      }
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
