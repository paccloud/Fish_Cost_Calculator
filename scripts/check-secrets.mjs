#!/usr/bin/env node
/**
 * check-secrets.mjs - dependency-free secret scanner for git-tracked files.
 *
 * Usage (from anywhere inside the repository):
 *   node scripts/check-secrets.mjs             scan every git-tracked text file (this is what CI runs)
 *   node scripts/check-secrets.mjs --history   scan the ADDED lines of every commit on every ref
 *   node scripts/check-secrets.mjs --range <base>..<head>   scan the ADDED lines of the commits in that range (CI)
 *   node scripts/check-secrets.mjs --help
 *
 * Exit codes: 0 = clean, 1 = potential secret found (or a tracked file that could not be scanned:
 * text over the size limit, unreadable), 2 = usage or git error, or a --history / --range audit that did
 * not look at everything (version over the size limit, shallow clone, a commit that is not present).
 *
 * Fail closed: the only content skipped on purpose is gitlinks (submodule
 * pointers) and verified-binary files (a NUL byte in the first 8 KB AND a known binary signature such as PNG,
 * ZIP or PDF; a stray NUL alone never exempts a file), and the OK line counts them. Everything else that cannot
 * be examined makes the run fail with a message; nothing is skipped quietly.
 *
 * Redaction guarantee: findings carry only { path, line, rule }. The matched text is
 * never stored, printed or logged, not even partially. Keep it that way.
 *
 * Placeholders: values such as your_..., change-me, user:password@host, example,
 * xxxx, <...>, ..., REDACTED, empty values and process.env / import.meta.env
 * references are ignored (see isPlaceholder). To silence a single false positive,
 * put `check-secrets:allow` in a comment on the same line (any line of a multi-line
 * match works, and so does the value line of a name/value pair split across lines);
 * it stays visible in review.
 *
 * How name = value assignments are judged (rule `secret-assignment`):
 *   - The NAME is split into words (JWT_SECRET, jwtSecret, jwt-secret). A name that ENDS in
 *     a secret noun (secret, password, pass, pwd, token, api/private/signing/... key) is
 *     "strong"; a name that merely contains one (TOKEN_ENDPOINT) is "weak".
 *   - Env, config and Markdown files: a strong name with any non-placeholder value of 8+
 *     characters is a finding (no entropy test, so short passwords and passphrases count).
 *     A weak name needs a random-looking value.
 *   - Everything else (source code, SQL, HTML, ...): only a QUOTED literal that looks random,
 *     so ordinary identifiers and test fixtures do not trip it.
 *   - A value with spaces is exempt only as text: a sentence (looksLikeSentence) inside a message catalog path, or
 *     documentation about the credential (looksLikeDocumentation) anywhere; a passphrase that merely contains common words
 *     ("correct horse battery and staple", "This is the way.") is a finding.
 *   - A URL value is judged only under a strong name, and only for credential-looking parts (signed-URL parameters,
 *     webhook path tokens, a token as the user name). Webhook URLs are also a rule of their own (webhook-url).
 *   - Native credential files (.netrc, .pgpass, .git-credentials, .npmrc, .pypirc, .aws/credentials, docker config,
 *     kubeconfig, .htpasswd, .my.cnf, .s3cfg, Terraform, .curlrc, .vault-token) have path-specific matchers
 *     (rule credential-file) and a 4-character value minimum; netrc, pgpass and docker auth are also recognised by
 *     content in any file (notes, scripts that write them).
 *   - Shell syntaxes with no "=" are read too: fish `set -gx NAME value ...`, csh `setenv NAME value`, Windows `setx` and
 *     `set "NAME=value"`, `export NAME value`, PowerShell `$env:NAME = 'v'` / SetEnvironmentVariable / Set-Item Env:NAME, fish_variables
 *     SETUVAR lines, in shell scripts, config files, heredocs written into them and fenced Markdown blocks.
 *   - Literals over several lines are judged like a quoted value: TOML/Python triple quotes, HCL/Ruby/Perl/PHP heredocs, PowerShell
 *     here-strings, template literals, quotes closed on a later line, backslash / INI continuation lines, YAML scalars on the next line.
 *     They are read up to 200 lines / 32 KB; a literal that does not end within that is reported (fail closed).
 *   - Credentials that are not `name = value`: HTTP `Authorization` values with a scheme (http-auth-credential; Basic is decoded and
 *     judged by its password), Terraform `variable "api_token" { default = ... }` labels, and whitespace-delimited service directives
 *     keyed on their own names (config-directive-secret: Redis requirepass / ACL, HAProxy userlist, Mosquitto, nginx / Apache header
 *     and SetEnv directives, ...). Only literals count; references, placeholders and paths pass.
 *   - Name and value fields in one JSON/YAML/HCL/XML object or call are matched in either order (secret-name-value-pair),
 *     and secrets passed on a command line (gh secret set, vercel env add, aws ssm put-parameter, ...) are their own rule.
 *
 * The index blob AND the working-tree file are both scanned whenever they differ (compared by git blob id).
 * --history and --range skip a file version that is verified binary (the same test as above, on the version's own first 8 KB) and
 * count it as skipped, so a large image never fails a run as "oversize"; a text version over the size limit still exits 2.
 *
 * --history is for the repository owner to run locally. CI does NOT run it: the known
 * leak from issue #22 lives in history forever and would fail every build. A shallow
 * clone only has part of the history, so an incomplete audit (shallow, or any version not
 * scanned) exits 2 and never prints "no hits".
 */

import { spawn, spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { closeSync, lstatSync, openSync, readFileSync, readlinkSync, readSync, realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Skip list and file decoding
// ---------------------------------------------------------------------------

const ALLOW_MARKER = 'check-secrets:allow';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const SNIFF_BYTES = 8000;

// Lockfiles are full of integrity hashes that look like high-entropy secrets, so the generic entropy and secret-name
// rules do not run on them. They are NOT skipped: a dependency URL can carry a credential (https://user:<password>@registry/...),
// and a lockfile can hold an auth field. Only rules flagged `lockfile: true` (URL passwords, private keys, provider-shaped
// tokens, webhook URLs) and the targeted `lockfile-credential` rule run on them, after ordinary digests are blanked
// (sanitizeLockfile). Exact names only: other *.lock files are scanned with every rule.
const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  'composer.lock',
  'gemfile.lock',
  'cargo.lock',
  'poetry.lock',
  'pipfile.lock',
  'go.sum',
]);

/** True for lockfiles (exact base names). They are scanned with the lockfile rules only, not skipped. */
export function isLockfile(filePath) {
  const base = path.posix.basename(filePath.split(path.sep).join('/')).toLowerCase();
  return LOCKFILE_NAMES.has(base);
}

// A lockfile is machine-generated and can be far larger than a source file; it gets a higher (still fail-closed) limit.
const MAX_LOCKFILE_BYTES = 16 * 1024 * 1024;
const sizeLimit = (filePath) => (isLockfile(filePath) ? MAX_LOCKFILE_BYTES : MAX_FILE_BYTES);

// Ordinary digests, blanked (same length, so line numbers stay) before the lockfile rules run. Every quantifier is a
// fixed count or a bounded class run, so this is linear. Only digests of the exact size of their algorithm are blanked:
// a longer or shorter string after "sha512-" is not an integrity value and stays visible to the token rules.
const LOCKFILE_DIGESTS = [
  /sha512-[A-Za-z0-9+/]{86}={0,2}/g,
  /sha384-[A-Za-z0-9+/]{64}={0,2}/g,
  /sha256-[A-Za-z0-9+/]{43}={0,2}/g,
  /sha1-[A-Za-z0-9+/]{27}={0,2}/g,
  /\bh1:[A-Za-z0-9+/]{43}=/g, // go.sum
  /(?<![A-Za-z0-9])(?:sha(?:1|224|256|384|512)|md5)[:=][0-9a-fA-F]{32,128}(?![0-9A-Za-z])/g, // poetry, Pipfile.lock, Gemfile CHECKSUMS
];
// A hex digest is blanked only after a checksum-like key (Cargo `checksum = "..."`, composer `"shasum": "..."`, yarn berry
// `checksum: 10c0/...`) or after "#" (a git commit in a URL fragment).
const LOCKFILE_HEX_DIGEST =
  /((?:checksum|shasum|hash|integrity|digest|reference|commit|revision|rev|sha256|sha1|sha512)["']?[ \t]*[:=][ \t]*["']?(?:[0-9a-z]{1,8}\/)?|#)([0-9a-fA-F]{32,128})(?![0-9A-Za-z])/gi;

/** The lockfile text with ordinary integrity digests blanked. Offsets and line breaks are unchanged. */
export function sanitizeLockfile(text) {
  let out = text;
  for (const pattern of LOCKFILE_DIGESTS) out = out.replace(pattern, (m) => ' '.repeat(m.length));
  return out.replace(LOCKFILE_HEX_DIGEST, (m, lead, hex) => lead + ' '.repeat(hex.length));
}

// Leading bytes of common binary formats. A file is "verified binary" only when it has a NUL byte in its first
// 8 KB AND starts with one of these; a NUL alone proves nothing (a stray NUL must not exempt an .env file).
const BINARY_SIGNATURES = [
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  [0x47, 0x49, 0x46, 0x38], // GIF
  [0x50, 0x4b, 0x03, 0x04], // ZIP, jar, docx, xlsx, ...
  [0x50, 0x4b, 0x05, 0x06],
  [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0xca, 0xfe, 0xba, 0xbe], // Mach-O fat / Java class
  [0xcf, 0xfa, 0xed, 0xfe], // Mach-O
  [0x00, 0x61, 0x73, 0x6d], // WebAssembly
  [0x1f, 0x8b, 0x08], // gzip
  [0x42, 0x5a, 0x68, 0x39, 0x31, 0x41, 0x59], // bzip2 (level 9 block header)
  [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], // xz
  [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], // 7z
  [0x28, 0xb5, 0x2f, 0xfd], // zstd
  [0x52, 0x61, 0x72, 0x21], // Rar!
  [0x77, 0x4f, 0x46, 0x46], // wOFF
  [0x77, 0x4f, 0x46, 0x32], // wOF2
  [0x00, 0x01, 0x00, 0x00], // TrueType
  [0x4f, 0x54, 0x54, 0x4f], // OpenType
  [0x00, 0x00, 0x01, 0x00], // ico
  [0x49, 0x49, 0x2a, 0x00], // TIFF
  [0x4d, 0x4d, 0x00, 0x2a],
  [0x52, 0x49, 0x46, 0x46], // RIFF (webp, wav, avi)
  [0x4f, 0x67, 0x67, 0x53], // Ogg
  [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66], // SQLite
].map((bytes) => Buffer.from(bytes));

const hasSignature = (head) =>
  BINARY_SIGNATURES.some((sig) => head.length >= sig.length && head.subarray(0, sig.length).equals(sig)) ||
  (head.length >= 12 && head[0] === 0 && head[1] === 0 && head.subarray(4, 8).toString('latin1') === 'ftyp'); // mp4, heic, avif

// BOM-less UTF-16 of mostly ASCII text has a NUL in every other byte and none in the rest.
function guessBomlessUtf16(head) {
  const pairs = head.length >> 1;
  if (pairs < 4) return null;
  let evenNuls = 0;
  let oddNuls = 0;
  for (let i = 0; i + 1 < head.length; i += 2) {
    if (head[i] === 0) evenNuls += 1;
    if (head[i + 1] === 0) oddNuls += 1;
  }
  if (oddNuls >= pairs * 0.3 && evenNuls <= pairs * 0.02) return 'le';
  if (evenNuls >= pairs * 0.3 && oddNuls <= pairs * 0.02) return 'be';
  return null;
}

// BOM-less UTF-32 of mostly ASCII text: three NULs in every four bytes (the last three for LE, the first three for BE).
function guessBomlessUtf32(head) {
  const quads = head.length >> 2;
  if (quads < 4) return null;
  let le = 0;
  let be = 0;
  for (let i = 0; i + 3 < head.length; i += 4) {
    if (head[i] !== 0 && head[i + 1] === 0 && head[i + 2] === 0 && head[i + 3] === 0) le += 1;
    if (head[i] === 0 && head[i + 1] === 0 && head[i + 2] === 0 && head[i + 3] !== 0) be += 1;
  }
  if (le >= quads * 0.7) return 'le';
  if (be >= quads * 0.7) return 'be';
  return null;
}

const swapped = (bytes) => Buffer.from(bytes.subarray(0, bytes.length & ~1)).swap16();

function decodeUtf32(bytes, littleEndian) {
  const parts = [];
  let chunk = [];
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    const cp = littleEndian ? bytes.readUInt32LE(i) : bytes.readUInt32BE(i);
    chunk.push(cp <= 0x10ffff ? cp : 0xfffd);
    if (chunk.length === 4096) {
      parts.push(String.fromCodePoint(...chunk));
      chunk = [];
    }
  }
  parts.push(String.fromCodePoint(...chunk));
  return parts.join('');
}

/** Which multi-byte Unicode encoding `buffer` is in, by BOM first and then by the NUL pattern of its first 8 KB. */
function detectWideEncoding(buffer) {
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xfe && buffer[2] === 0 && buffer[3] === 0) return 'utf32le-bom';
  if (buffer.length >= 4 && buffer[0] === 0 && buffer[1] === 0 && buffer[2] === 0xfe && buffer[3] === 0xff) return 'utf32be-bom';
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return 'utf16le-bom';
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return 'utf16be-bom';
  const head = buffer.subarray(0, SNIFF_BYTES);
  if (!head.includes(0)) return null;
  const wide32 = guessBomlessUtf32(head);
  if (wide32) return `utf32${wide32}`;
  const wide16 = guessBomlessUtf16(head);
  return wide16 ? `utf16${wide16}` : null;
}

/**
 * True only for content that is positively binary: a NUL byte in the first 8 KB, not a UTF-16/32 text file, and a
 * known binary signature at the start. `head` is the first bytes of the file (8 KB is enough).
 */
export function isBinaryContent(head) {
  const sniff = head.subarray(0, SNIFF_BYTES);
  return sniff.includes(0) && detectWideEncoding(sniff) === null && hasSignature(sniff);
}

/**
 * Decode file bytes to text. UTF-8 (with or without BOM), UTF-16 and UTF-32 (with or without BOM) are decoded.
 * Any other content, including text with a stray NUL byte, is decoded as UTF-8 with the NULs removed and scanned.
 * Returns null only for verified-binary content (see isBinaryContent). A secret is ASCII, so the invalid-UTF-8
 * replacement of non-UTF-8 text encodings does not hide one.
 */
export function decodeText(buffer) {
  if (isBinaryContent(buffer)) return null;
  const wide = detectWideEncoding(buffer);
  let text;
  if (wide === 'utf32le-bom') text = decodeUtf32(buffer.subarray(4), true);
  else if (wide === 'utf32be-bom') text = decodeUtf32(buffer.subarray(4), false);
  else if (wide === 'utf32le') text = decodeUtf32(buffer, true);
  else if (wide === 'utf32be') text = decodeUtf32(buffer, false);
  else if (wide === 'utf16le-bom') text = buffer.subarray(2, 2 + ((buffer.length - 2) & ~1)).toString('utf16le');
  else if (wide === 'utf16be-bom') text = swapped(buffer.subarray(2)).toString('utf16le');
  else if (wide === 'utf16le') text = buffer.subarray(0, buffer.length & ~1).toString('utf16le');
  else if (wide === 'utf16be') text = swapped(buffer).toString('utf16le');
  else {
    const hasUtf8Bom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
    text = buffer.toString('utf8', hasUtf8Bom ? 3 : 0);
  }
  // A NUL that is left over (a stray byte, or a mixed-encoding file) must not split a name or a value.
  return text.includes('\u0000') ? text.replace(/\u0000/g, '') : text;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** Lower-case words of an identifier: JWT_SECRET, jwtSecret, jwt-secret, jwt.secret all give jwt, secret. */
function nameWords(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])(?=[A-Z][a-z])/g, '$1 ')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

// A name whose LAST word is one of these holds a secret.
const STRONG_LAST_WORDS = new Set([
  'secret', 'password', 'passwd', 'pwd', 'pass', 'passphrase', 'token',
]);
// ...as does <qualifier> + "key" (apiKey, PRIVATE_KEY, signing_key, ...).
const KEY_QUALIFIERS = new Set([
  'api', 'private', 'secret', 'access', 'signing', 'encryption', 'auth', 'master', 'session', 'hmac', 'role',
]);
const STRONG_MERGED_SUFFIX =
  /(?:secret|password|passwd|pwd|token|apikey|privatekey|secretkey|accesskey|signingkey|encryptionkey|authkey|masterkey|sessionkey|hmackey)$/;
// Words that make a name "weak": it mentions a secret without ending in one (TOKEN_ENDPOINT, PASSWORD_HINT).
const WEAK_WORDS = new Set([
  'secret', 'secrets', 'password', 'passwords', 'passwd', 'pwd', 'pass', 'passphrase', 'token', 'tokens',
  'credential', 'credentials', 'salt', 'pepper',
]);
const WEAK_MERGED_SUBSTRING = /secret|passw(?:or)?d|token|privatekey|apikey|credential/;
// Credential variables whose names do not end in a secret noun: sshpass reads SSHPASS, redis-cli reads REDISCLI_AUTH, Dovecot's LDAP bind is dnpass.
const EXACT_STRONG_MERGED = new Set(['sshpass', 'rediscliauth', 'dnpass']);

/** @returns {'strong' | 'weak' | null} how secret-like an identifier is (see the file header) */
export function secretNameKind(name) {
  const words = nameWords(name);
  while (words.length > 1 && /^\d+$/.test(words[words.length - 1])) words.pop();
  if (words.length === 0) return null;
  const bare = words.map((w) => w.replace(/\d+$/, ''));
  const last = bare[bare.length - 1];
  const merged = bare.join('');
  if (STRONG_LAST_WORDS.has(last) || STRONG_MERGED_SUFFIX.test(merged) || EXACT_STRONG_MERGED.has(merged)) return 'strong';
  if (last === 'key' && KEY_QUALIFIERS.has(bare[bare.length - 2])) return 'strong';
  // A bare "<vendor>_KEY" (SENDGRID_KEY, STRIPE_KEY) may be a credential or a cache key: only a random-looking value counts.
  if (last === 'key' && bare.length > 1) return 'weak';
  if (bare.some((w) => WEAK_WORDS.has(w)) || WEAK_MERGED_SUBSTRING.test(merged)) return 'weak';
  for (let i = 0; i + 1 < bare.length; i += 1) {
    if (bare[i + 1] === 'key' && KEY_QUALIFIERS.has(bare[i])) return 'weak';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Placeholder detection
// ---------------------------------------------------------------------------

// Spans that stand in for the real value: <x>, [YOUR-KEY], ..., ***, ___, xxx.
const MARKER_SPANS = /<[^<>\n]{1,80}>|\[[A-Za-z][A-Za-z _-]{0,60}\]|\.{3,}|…|\*{3,}|_{3,}|x{3,}|X{3,}/g;

// Template and environment references. Interpolation syntax is unambiguous, so it counts anywhere;
// a bare $NAME counts only when the WHOLE value is that shape, so `$` + random letters does not.
const INTERPOLATION = /\$\{|\{\{|#\{|^\$\(|^`/;
const WHOLE_REFERENCE =
  /^(?:\$[A-Z_][A-Z0-9_]*|\$[a-z][a-z0-9]*_[a-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%|%%[A-Za-z_][A-Za-z0-9_.-]*%%|@[A-Za-z_][A-Za-z0-9_.-]*@|[@?]\+?(?:[a-z]+:)?[a-z]+\/[A-Za-z0-9_.]+)$/;
// (%%NAME%% and @NAME@ are build-time substitution tokens (Ant, Maven filtering, autoconf); @string/name and ?attr/name are Android resource references.)
const CODE_REFERENCE = /process\.env|import\.meta\.env|os\.environ|\bgetenv|\bENV\[/;
// Encrypted or hashed forms are not plaintext credentials.
const NON_SECRET_FORMS = /^(?:ENC\[|\$ANSIBLE_VAULT|\$2[abxy]?\$\d{2}\$|\$argon2|\$pbkdf2|\$scrypt|\$apr1\$|\{SHA\})/;
// AWS documentation keys end in EXAMPLE / EXAMPLEKEY.
const EXAMPLE_SUFFIX = /EXAMPLE(?:KEY)?$/;
// "Bearer eyJhbGciOi..." A trailing ellipsis means the author cut the value off, so it cannot be a working credential.
const TRUNCATED = /(?:\.{3,}|…)$/;
// Three or more plain words are a passphrase with a trailing ellipsis, not a cut-off token: "correct horse battery..." is
// judged as a phrase like the same words without the dots.
const PLAIN_PHRASE_WORD = /^\p{L}[\p{L}'’-]*$/u;
function isTruncated(value) {
  if (!TRUNCATED.test(value)) return false;
  const pieces = value.replace(TRUNCATED, '').trim().split(/\s+/);
  return !(pieces.length >= 3 && pieces.every((piece) => PLAIN_PHRASE_WORD.test(piece)));
}

// A letter run equal to one of these makes the value a placeholder wherever it sits.
const VERY_STRONG_RUNS = new Set([
  'example', 'examples', 'dummy', 'placeholder', 'redacted', 'changeme', 'replaceme',
]);
// Separator- or camelCase-delimited words that make the value a placeholder ("your_key", "fake_token_1").
// Deliberately NOT here: change, enter, here, todo, foo, bar, none. Those only count in the phrases
// below or when the whole value is made of label words, so Change2024! or Spring_2024_todo stay real.
const SEGMENT_WORDS = new Set(['your', 'yours', 'sample', 'fake', 'mock']);
const PLACEHOLDER_PHRASES =
  /(?:^|[^a-z])(?:change|replace)[-_ ]?(?:me|this|it|with)(?:[^a-z]|$)|(?:^|[^a-z])(?:enter|insert|paste|put|add|set|type)[-_ ](?:your|the|a|an|my)(?:[^a-z]|$)|[-_ ]here$/;
// A value made ONLY of these words (plus separators and pure numbers) is a label, e.g. "password", "new_secret_key".
const LABEL_WORDS = new Set([
  'password', 'passwd', 'pass', 'pwd', 'secret', 'key', 'token', 'user', 'username', 'host', 'hostname',
  'db', 'dbname', 'database', 'value', 'string', 'name', 'id', 'api', 'jwt', 'apikey', 'credentials',
  'required', 'optional', 'hidden', 'masked', 'empty', 'unset', 'boolean', 'number', 'base64',
  'long', 'random', 'generated', 'enter', 'insert', 'paste', 'here', 'change', 'replace', 'todo', 'tbd',
  'fixme', 'foo', 'bar', 'baz', 'none', 'null', 'undefined', 'your', 'yours', 'sample', 'fake', 'mock',
  'a', 'an', 'the', 'of', 'to', 'for', 'in', 'is', 'this', 'that', 'with', 'and', 'my', 'new', 'old', 'me', 'it',
]);

function isMostlyMarkers(value) {
  let covered = 0;
  for (const m of value.matchAll(MARKER_SPANS)) covered += m[0].length;
  if (covered === 0) return false;
  // A marker only counts when it stands for most of the value ("AIza...", "xxxxxxxx", "<token>"),
  // not when it trails a long real-looking string.
  return value.length - covered <= 8 || covered * 2 >= value.length;
}

function isPlaceholderWords(value) {
  if (EXAMPLE_SUFFIX.test(value)) return true;
  const lower = value.toLowerCase();
  if (PLACEHOLDER_PHRASES.test(lower)) return true;
  if (lower.split(/[^a-z]+/).some((run) => VERY_STRONG_RUNS.has(run))) return true;
  const words = nameWords(value);
  if (words.some((w) => SEGMENT_WORDS.has(w))) return true;
  return (
    /^[A-Za-z0-9 _.-]+$/.test(value) &&
    words.some((w) => !/^\d+$/.test(w)) &&
    words.every((w) => /^\d+$/.test(w) || LABEL_WORDS.has(w))
  );
}

/** True when `raw` is empty, a template reference, or an obvious dummy value. */
export function isPlaceholder(raw) {
  const value = String(raw ?? '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
  if (value === '' || !/[A-Za-z0-9]/.test(value)) return true;
  if (INTERPOLATION.test(value) || WHOLE_REFERENCE.test(value) || CODE_REFERENCE.test(value)) return true;
  if (NON_SECRET_FORMS.test(value) || isTruncated(value) || isMostlyMarkers(value)) return true;
  return isPlaceholderWords(value);
}

// Exact sample values that appear in documentation, scoped to the file that shows them.
// Keep this tiny: each entry silences one string in one file, never a pattern or a whole file.
// The sample must be the ENTIRE assigned value (optionally quoted): "password": "<sample>" is exempt,
// PASSWORD=<sample>!more or PASSWORD=prefix-<sample> is not.
const PATH_SAMPLES = [
  // Sample registration/login request body for the example user "fisherman_joe".
  { path: 'docs/API.md', value: 'securePassword123' },
].map((sample) => ({
  ...sample,
  pattern: new RegExp(
    String.raw`^[\x22'\x60]?[\w$.-]{1,81}[\x22'\x60]?[ \t]*(?:=>|:=|=|:)[ \t]*[\x22'\x60]?${sample.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\x22'\x60]?$`,
  ),
}));

const isPathSample = (filePath, matchedText) =>
  PATH_SAMPLES.some((sample) => sample.path === filePath && sample.pattern.test(matchedText));

// Only reserved documentation hosts and loopback may hide a password. A host that merely
// contains the word "example" (an RDS or Neon endpoint named after the app) may not.
function isDocumentationHost(rawHost) {
  const host = rawHost.toLowerCase().replace(/:\d*$/, '').replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    /(?:^|\.)example(?:\.(?:com|org|net))?$/.test(host) ||
    host.endsWith('.test') ||
    host.endsWith('.invalid')
  );
}

// ---------------------------------------------------------------------------
// Randomness
// ---------------------------------------------------------------------------

function shannonEntropy(text) {
  const counts = new Map();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

const URL_PREFIX = /^[a-z][a-z0-9+.-]*:\/\//i;

// A bare value that is really code: a call (getToken(), localStorage.getItem('x');) or a member chain (req.body.token).
const CALL_EXPRESSION = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\(/;
const MEMBER_CHAIN = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+;?$/;
const IDENTIFIER_PART = /^(?:[a-z_$][a-z0-9_$]*|[A-Z_][A-Z0-9_]*|[a-z]+(?:[A-Z][a-z0-9]*)+)$/;
function looksLikeExpression(value) {
  if (CALL_EXPRESSION.test(value)) return true;
  return MEMBER_CHAIN.test(value) && value.replace(/;$/, '').split('.').every((part) => IDENTIFIER_PART.test(part));
}

// kebab-case or snake_case phrases ("test-signing-key-for-ci!!", "fishCalcState_v2"): every part is a word
// (lower-case, Capitalized, camelCase or ALL-CAPS, with an optional small number) or a bare/version number.
const WORD_PART = /^\d{0,4}(?:[a-z]{2,}(?:[A-Z][a-z]+)*|[A-Z][a-z]+(?:[A-Z][a-z]+)*|[A-Z]{2,})\d{0,4}$/;
const NUMBER_PART = /^v?\d{1,4}$/i;
function isWordIdentifier(value) {
  const parts = value.replace(/[!?.]+$/, '').split(/[-_.:/]+/).filter(Boolean);
  return parts.length >= 2 && parts.every((p) => NUMBER_PART.test(p) || WORD_PART.test(p));
}

// Average length of the word-like pieces of a value. CamelCase identifiers score 4+, random mixed-case runs about 2.
function averagePieceLength(value) {
  const pieces = value.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g) ?? [];
  return pieces.length === 0 ? 0 : value.length / pieces.length;
}

/**
 * A whitespace-free literal that looks machine-generated. Digit-only values need 20+ digits and
 * hex-only values 20+ characters (short ones are ids and hashes). Word-like values are excluded:
 * kebab-case phrases, CamelCase identifiers and "word + number" passwords such as admin1234567 have long
 * letter runs, while random text averages about 2 characters per run. Digit-free single-case values
 * (a-z only) must be 24+ characters with high entropy.
 */
function looksRandom(value, { minLength, minEntropy }) {
  if (value.length < minLength || /\s/.test(value)) return false;
  if (URL_PREFIX.test(value) || isPlaceholder(value)) return false;
  if (/^\d+$/.test(value)) return value.length >= 20;
  if (/^[0-9a-f]+$/i.test(value)) return value.length >= Math.max(minLength, 20);
  if (isWordIdentifier(value)) return false;
  const hasDigit = /\d/.test(value);
  const mixedCase = /[a-z]/.test(value) && /[A-Z]/.test(value);
  const entropy = shannonEntropy(value);
  if (!hasDigit && !mixedCase) return value.length >= Math.max(minLength, 24) && entropy >= Math.max(minEntropy, 3.6);
  if (averagePieceLength(value) >= (hasDigit ? 4.0 : 3.0)) return false;
  return entropy >= minEntropy;
}

const GATES = {
  configWeak: { minLength: 12, minEntropy: 3.0 },
  codeStrong: { minLength: 12, minEntropy: 3.1 },
  codeWeak: { minLength: 20, minEntropy: 3.6 },
};
const MIN_STRONG_CONFIG_LENGTH = 8;

// Words that appear in UI and error sentences ("Invalid or expired token", "Passwords do not match") far more often
// than in a passphrase: function words plus the vocabulary of validation and sign-in messages. Message catalogs
// (en.json, messages.yml) use keys such as password/token/apiKey a lot. Credential-like nouns (password, token, secret)
// are deliberately NOT here: they say nothing about whether the text is a sentence.
const PROSE_WORDS = new Set([
  'is', 'are', 'was', 'be', 'been', 'not', 'no', 'do', 'does', 'did', 'the', 'a', 'an', 'or', 'and', 'of', 'to',
  'for', 'in', 'on', 'at', 'by', 'as', 'if', 'it', 'its', 'this', 'that', 'these', 'those', 'your', 'you', 'my',
  'please', 'must', 'should', 'cannot', 'can', 'will', 'has', 'have', 'least', 'most', 'than', 'below', 'above',
  'enter', 'choose', 'select', 'type', 'invalid', 'expired', 'missing', 'required', 'incorrect', 'match',
  'matches', 'characters', 'forgot', 'reset', 'confirm', 'wrong', 'empty', 'too', 'short', 'long', 'weak',
  'we', 'our', 'us', 'they', 'their', 'them', 'he', 'she', 'his', 'her', 'so', 'but', 'then', 'when', 'while',
  'because', 'until', 'after', 'before', 'over', 'under', 'out', 'up', 'off', 'yet', 'still', 'also', 'only', 'just',
  'now', 'any', 'all', 'some', 'each', 'every', 'both', 'more', 'less', 'other', 'another', 'such', 'what', 'which',
  'who', 'how', 'why', 'where', 'there', 'am', 'were', 'being', 'had', 'having', 'would', 'could', 'may', 'might',
  'shall', 'let', 'get', 'got', 'make', 'made', 'use', 'used', 'using', 'need', 'needs', 'needed', 'unable',
  'failed', 'error', 'try', 'again', 'later', 'sign', 'with', 'from', 'into', 'about', 'sent', 'check', 'contact',
  'support', 'session', 'log', 'logged', 'expire', 'expires', 'click', 'link', 'email', 'address', 'provided',
  'provide', 'valid', 'value', 'field', 'set', 'updated', 'saved', 'changed', 'successfully', 'successful',
  'new', 'old', 'current', 'first', 'last', 'name', 'account', 'user', 'requested', 'request', 'expected',
  'copy', 'paste', 'one', 'number', 'symbol', 'contain', 'contains', 'found', 'must', 'be', 'at', 'least',
]);

// Words that make a sentence read as DOCUMENTATION about a credential ("the password you chose during setup", "see the
// deployment guide", "ask the team lead"): instructions and references, not a secret. A passphrase written as a sentence
// of function words ("This is the way.") has none of them.
const DOC_CUE_WORDS = new Set([
  'see', 'ask', 'refer', 'docs', 'documentation', 'readme', 'guide', 'step', 'steps', 'setup', 'install', 'installed',
  'configure', 'configured', 'configuration', 'generate', 'generated', 'obtain', 'retrieve', 'contact', 'admin',
  'administrator', 'team', 'vault', 'dashboard', 'console', 'portal', 'environment', 'variable', 'variables', 'runtime',
  'deployment', 'deploy', 'chose', 'chosen', 'choose', 'whatever', 'same', 'actual', 'real', 'random', 'string',
  'provided', 'supplied', 'stored', 'store', 'set', 'database', 'value', 'manager', 'instructions', 'above', 'below',
]);
// "the password", "a random token", "your API key": a determiner, up to two words, then a credential noun.
const CREDENTIAL_NOUN_PHRASE =
  /(?:^|[^A-Za-z])(?:the|a|an|your|this|that|its|any|each|every|new|correct|current)[ \t]+(?:[A-Za-z-]+[ \t]+){0,2}(?:password|passphrase|passwd|token|secret|key|credentials?)(?![A-Za-z])/i;

function hasDocumentationCue(text) {
  if (CREDENTIAL_NOUN_PHRASE.test(text)) return true;
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((word) => DOC_CUE_WORDS.has(word));
}

// A bare number in a sentence is prose only in a counting context ("at least 8 characters", "step 3", "3 attempts");
// "the horse is 123" is a passphrase with a number in it.
const NUMBER_LEAD_WORDS = new Set([
  'step', 'steps', 'least', 'most', 'than', 'minimum', 'maximum', 'min', 'max', 'over', 'under', 'exactly', 'between',
  'within', 'section', 'part', 'page', 'version', 'line', 'chapter', 'item', 'option', 'top', 'next', 'last', 'every',
  'each', 'first',
]);
const NUMBER_UNIT_WORDS = new Set([
  'character', 'characters', 'chars', 'char', 'digit', 'digits', 'letter', 'letters', 'symbol', 'symbols', 'number',
  'numbers', 'word', 'words', 'byte', 'bytes', 'kb', 'mb', 'minute', 'minutes', 'hour', 'hours', 'day', 'days',
  'second', 'seconds', 'ms', 'time', 'times', 'attempt', 'attempts', 'item', 'items', 'entries', 'percent',
]);
const plainWord = (piece) => (piece ?? '').replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '').toLowerCase();

const MESSAGE_CATALOG_DIRS = /(?:^|\/)(?:i18n|l10n|locales?|_locales|lang|langs|languages?|messages?|translations?|intl|strings|res\/values(?:-[A-Za-z0-9]+)*)(?:\/|$)/;
// Segments are [A-Za-z0-9]+ after ONE separator char: the separator class and the segment class must not overlap,
// or a hostile file name ('i18n-' + '--' x 30) backtracks exponentially (CodeQL js/redos; this runs on tracked paths).
const MESSAGE_CATALOG_FILE =
  /^(?:(?:messages?|strings|translations?|locales?|i18n|l10n|errors?)(?:[._-][A-Za-z0-9]+)*|[a-z]{2,3}(?:[-_][A-Za-z]{2,4})?)\.(?:json|jsonc|json5|ya?ml|properties|po|pot|xlf|xliff|toml|ini|arb|resx|strings|xml)$/i;

/** Is this path a message catalog (i18n, locales, messages, en.json, ...), where UI sentences under key names are normal? */
function isMessageCatalogPath(filePath) {
  const normalized = filePath.split(path.sep).join('/').toLowerCase();
  return MESSAGE_CATALOG_DIRS.test(`/${normalized}`) || MESSAGE_CATALOG_FILE.test(path.posix.basename(normalized));
}

// Whitespace-separated pieces of a sentence: a word in any script (apostrophes and hyphens inside, punctuation
// around), a short number ("at least 8 characters", "6-digit"), or a translation placeholder (%s, {name}, {{count}}, :attr).
const SENTENCE_WORD = /^["'(\[“‘]*(?:\p{L}[\p{L}'’-]*|\d{1,3}-\p{L}+)["')\]”’]*[.,;:!?…]*$/u;
const SENTENCE_NUMBER = /^["'(\[]*\d{1,4}[)"'.,;:%]*$/;
const SENTENCE_PLACEHOLDER = /^["'(]*(?:%(?:\d\$)?[sd]|\{\{?[\w.-]{1,30}\}\}?|\{\d{1,2}\}|:[a-z_]{1,30})[)"'.,;:!?]*$/;

/**
 * Is this quoted, whitespace-containing text a natural-language sentence (a UI or error message) rather than a passphrase?
 * Deliberately strict, because a passphrase such as "correct horse battery and staple" is made of ordinary words:
 *   - every piece must be a plain word, a short number or a translation placeholder. A piece that mixes letters
 *     with digits or symbols ("Passw0rd!", "123!") is credential-shaped, so the whole text is not prose;
 *   - most of the words must be sentence vocabulary (PROSE_WORDS): at least half when the text is written like a
 *     sentence (capital first letter or closing punctuation), at least two thirds when it is not;
 *   - text with non-ASCII letters made of plain words counts as prose in another language (message catalogs);
 *   - a bare number that counts nothing ("the horse is 123") is a non-prose word.
 * Being sentence-like is necessary, not sufficient: isPhraseSecret exempts it only in a message catalog path (i18n,
 * locales, messages, en.json, ...) or when it reads as documentation (hasDocumentationCue).
 * Tradeoff: a passphrase that is a sentence and also mentions "the password" or an instruction word passes; a UI sentence
 * outside a message catalog that has neither is reported (add the allow marker, or a placeholder value), and so is an
 * ASCII sentence in a language other than English.
 */
function looksLikeSentence(text) {
  const trimmed = text.trim();
  const pieces = trimmed.split(/\s+/);
  if (pieces.length < 2) return false;
  let counted = 0;
  let prose = 0;
  for (let i = 0; i < pieces.length; i += 1) {
    const piece = pieces[i];
    if (SENTENCE_PLACEHOLDER.test(piece)) continue;
    if (SENTENCE_NUMBER.test(piece)) {
      // A number counts against the sentence unless it counts something ("at least 8 characters", "step 3").
      const counting = NUMBER_LEAD_WORDS.has(plainWord(pieces[i - 1])) || NUMBER_UNIT_WORDS.has(plainWord(pieces[i + 1])) || /%/.test(piece);
      if (!counting) counted += 1;
      continue;
    }
    if (!SENTENCE_WORD.test(piece)) return false;
    counted += 1;
    if (PROSE_WORDS.has(plainWord(piece))) prose += 1;
  }
  if (counted === 0) return false;
  if (pieces.length >= 3 && /[^\x00-\x7f]/.test(trimmed)) return true;
  const sentenceShaped = /^["'(“‘]*[A-Z]/.test(trimmed) || /[.!?…:]["')”’]*$/.test(trimmed);
  return sentenceShaped ? prose * 2 >= counted : prose * 3 >= counted * 2;
}

/**
 * Documentation about a credential, outside a message catalog ("the password you chose during setup", "see the
 * deployment guide", "set via environment variable at runtime"): three or more plain words (no mixed letter/digit/symbol
 * piece, no stray number), at least one instruction or reference cue, and a third or more of them sentence vocabulary.
 */
function looksLikeDocumentation(text) {
  const pieces = text.trim().split(/\s+/);
  if (pieces.length < 3 || !hasDocumentationCue(text)) return false;
  let counted = 0;
  let prose = 0;
  for (let i = 0; i < pieces.length; i += 1) {
    const piece = pieces[i];
    if (SENTENCE_PLACEHOLDER.test(piece)) continue;
    if (SENTENCE_NUMBER.test(piece)) {
      if (!(NUMBER_LEAD_WORDS.has(plainWord(pieces[i - 1])) || NUMBER_UNIT_WORDS.has(plainWord(pieces[i + 1])) || /%/.test(piece))) return false;
      continue;
    }
    if (!SENTENCE_WORD.test(piece)) return false;
    counted += 1;
    if (PROSE_WORDS.has(plainWord(piece))) prose += 1;
  }
  return counted >= 3 && prose * 3 >= counted;
}

/**
 * A value with whitespace in it (a quoted passphrase, or the rest of a YAML/ini line). It is a finding when a
 * word in it is random-looking, or, for a strong name, when it is not a sentence and is long enough.
 */
function isPhraseSecret({ kind, text, minLength = MIN_STRONG_CONFIG_LENGTH, catalog = false }) {
  const words = text
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z0-9]+|[.,;:!?)]+$/g, ''))
    .filter(Boolean);
  if (words.some((w) => looksRandom(w, GATES.configWeak))) return true;
  // In a message catalog (its whole job is UI text) a sentence is exempt. Anywhere else only text that reads as
  // documentation about the credential is: a sentence of common words ("This is the way.") is a passphrase until an
  // allow marker says otherwise.
  if (catalog ? looksLikeSentence(text) : looksLikeDocumentation(text)) return false;
  return kind === 'strong' && text.length >= minLength;
}

const stripQuotes = (text) => text.trim().replace(/^["'`]+|["'`]+$/g, '');

// Query and fragment parameter names that carry a credential: sig, signature, X-Amz-Signature, token, access_token,
// key, api_key, secret, password, auth, ...
const CREDENTIAL_PARAM = /(?:^|[-_.])(?:sig|signature|token|secret|key|apikey|password|passwd|pwd|auth|authorization|jwt|bearer|sas)$/i;

const safeDecode = (text) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

// A path segment written as a template ({token}, :token, <token>, ${TOKEN}) stands for a value, it is not one.
const isTemplateSegment = (segment) => /[{}<>$]|^:/.test(segment) || isPlaceholder(segment);

/**
 * Does a URL that is the VALUE of a strong secret name (API_TOKEN, WEBHOOK_SECRET, ...) carry a credential itself?
 * Signed URLs (?sig=..., X-Amz-Signature), webhook URLs (/services/T000/B000/<token>) and token-as-username URLs
 * (https://<token>@host) are bearer credentials. A URL whose parts are all ordinary words, ids and template
 * placeholders is just an address. Weak names (TOKEN_URL, TOKEN_ENDPOINT) never reach this: they name an endpoint.
 * The password of user:password@ is url-password's business, not judged here.
 */
function urlCarriesCredential(url) {
  const rest = url.replace(URL_PREFIX, '');
  const authorityEnd = rest.search(/[/?#]/);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  const afterAuthority = authorityEnd === -1 ? '' : rest.slice(authorityEnd);
  const at = authority.lastIndexOf('@');
  if (at > 0) {
    const userinfo = authority.slice(0, at);
    if (!userinfo.includes(':') && userinfo.length >= 8 && !isTemplateSegment(userinfo) && !isWordIdentifier(userinfo)) return true;
  }
  const hashAt = afterAuthority.indexOf('#');
  const beforeFragment = hashAt === -1 ? afterAuthority : afterAuthority.slice(0, hashAt);
  const fragment = hashAt === -1 ? '' : afterAuthority.slice(hashAt + 1);
  const queryAt = beforeFragment.indexOf('?');
  const pathPart = queryAt === -1 ? beforeFragment : beforeFragment.slice(0, queryAt);
  const query = queryAt === -1 ? '' : beforeFragment.slice(queryAt + 1);
  for (const segment of pathPart.split('/')) {
    const decoded = safeDecode(segment);
    if (decoded.length >= 16 && !isTemplateSegment(decoded) && looksRandom(decoded, { minLength: 16, minEntropy: 3.0 })) return true;
  }
  for (const pair of `${query}&${fragment}`.split(/[&;]/)) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    const name = eq === -1 ? '' : safeDecode(pair.slice(0, eq));
    const value = safeDecode(eq === -1 ? pair : pair.slice(eq + 1));
    if (value === '' || isTemplateSegment(value)) continue;
    if (CREDENTIAL_PARAM.test(name)) {
      if (value.length >= 8 && !isWordIdentifier(value)) return true;
    } else if (looksRandom(value, { minLength: 20, minEntropy: 3.5 })) {
      return true;
    }
  }
  return false;
}

/**
 * Decide whether a value assigned to a secret-like name is a finding.
 * @param {{kind: 'strong'|'weak', value: string, quoted: boolean, separator: string, mode: string, minLength?: number}} input
 * `minLength` is the shortest value a strong name may hold (8; credential files such as .npmrc use 4).
 */
function isSecretValue({ kind, value, quoted, separator, mode, minLength = MIN_STRONG_CONFIG_LENGTH, catalog = false }) {
  let text = value;
  if (!quoted) {
    if (mode === 'code') return false; // a bare token in source code is an expression, not a literal
    if (looksLikeExpression(text)) return false;
    if (mode === 'prose') text = text.replace(/[`*)>\].,;:!?]+$/, '');
  } else {
    text = text.trim(); // a quoted value is the whole quoted string, spaces included
  }
  // Shell/Compose/env files: ${VAR:-literal} hides a real default inside the expansion, and a literal can sit
  // right next to a reference (${A}literal). Operands are judged as whole strings.
  if (mode === 'config' && text.includes('${')) {
    const operand = (literal) =>
      isSecretValue({ kind, value: stripQuotes(literal), quoted: true, separator: '=', mode, minLength, catalog });
    if (expansionLiterals(text).some(operand)) return true;
    const glued = stripQuotes(withoutExpansions(text));
    if (glued === '') return false;
    return URL_PREFIX.test(glued) ? kind === 'strong' && urlCarriesCredential(glued) : looksRandom(glued, GATES.configWeak);
  }
  if (URL_PREFIX.test(text)) {
    // A URL value is an address for weak names (TOKEN_URL, TOKEN_ENDPOINT) and for URLs with nothing credential-like in them,
    // but a bearer credential when it sits in a strong name and a part of it is one (signed URL, webhook path token).
    return kind === 'strong' && !/\s/.test(text) && urlCarriesCredential(text);
  }
  if (text === '' || isPlaceholder(text)) return false;
  if (/\s/.test(text)) {
    // Only a quoted value (or a whole-line value) may contain spaces; in code a spaced string is text.
    return quoted && mode !== 'code' && isPhraseSecret({ kind, text, minLength, catalog });
  }
  if (mode === 'code') return looksRandom(text, kind === 'strong' ? GATES.codeStrong : GATES.codeWeak);
  // Prose such as "Token: something" is common, so an unquoted `name: word` needs a random-looking word.
  const proseColon = mode === 'prose' && !quoted && separator !== '=';
  if (kind === 'strong' && !proseColon) return text.length >= minLength;
  return looksRandom(text, GATES.configWeak);
}

// YAML node properties (tags and anchors) in front of a scalar: `!!str`, `!vault`, `&default`, one or more, then a blank.
const YAML_NODE_PROPERTIES = /(?:(?:![^\s]{0,60}|&[A-Za-z0-9_-]{1,60})[ \t]+)+(?=\S)/y;

/** Index of the "}" that closes the "${" at `open`, or -1. Nesting-aware, linear. */
function closingBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '$' && text[i + 1] === '{') {
      depth += 1;
      i += 1;
    } else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `text` with every ${...} removed. An unbalanced one is dropped up to the end of the text (its operand is judged separately). */
function withoutExpansions(text) {
  let out = '';
  let i = 0;
  for (let open = text.indexOf('${'); open !== -1; open = text.indexOf('${', i)) {
    const end = closingBrace(text, open);
    out += text.slice(i, open);
    if (end === -1) return out;
    i = end + 1;
  }
  return out + text.slice(i);
}

const MAX_EXPANSION_DEPTH = 8;

/**
 * Literal default/alternate operands of shell parameter expansions (:- - := = :+ +), nested ones included.
 * A pure ${VAR}, $VAR or ${VAR:?message} has none, so it is never a candidate secret.
 * Fails closed: past the depth cap, or in an unterminated expansion, the remaining literal text is a candidate.
 */
function expansionLiterals(text, depth = 0) {
  const literals = [];
  if (depth > MAX_EXPANSION_DEPTH) {
    const flat = text.replace(/\$\{[A-Za-z_][A-Za-z0-9_]{0,1023}(?::?[-=+?])?|\}/g, '').trim();
    if (flat !== '') literals.push(flat);
    return literals;
  }
  let i = 0;
  for (let open = text.indexOf('${', i); open !== -1; open = text.indexOf('${', i)) {
    const end = closingBrace(text, open);
    const inner = text.slice(open + 2, end === -1 ? text.length : end);
    const operation = /^[A-Za-z_][A-Za-z0-9_]{0,1023}:?[-=+]([\s\S]*)$/.exec(inner);
    if (operation) {
      const literal = withoutExpansions(operation[1]).trim();
      if (literal !== '') literals.push(literal);
      literals.push(...expansionLiterals(operation[1], depth + 1));
    }
    if (end === -1) break;
    i = end + 1;
  }
  return literals;
}

// End (exclusive) of a shell word starting at `start`: stops at whitespace outside any ${...}, or at the end of the line.
function bareShellWordEnd(input, start) {
  let depth = 0;
  let i = start;
  for (; i < input.length && i - start < 8192; i += 1) {
    const ch = input[i];
    if (ch === '\n') break;
    if (ch === '$' && input[i + 1] === '{') {
      depth += 1;
      i += 1;
    } else if (ch === '}' && depth > 0) {
      depth -= 1;
    } else if (depth === 0 && (ch === ' ' || ch === '\t' || ch === '\r')) {
      break;
    }
  }
  return i;
}

// Files whose unquoted values run to the end of the line (YAML plain scalars, ini, properties, dotenv).
const REST_OF_LINE_EXTENSIONS = new Set(['.yml', '.yaml', '.ini', '.cfg', '.conf', '.config', '.properties', '.toml', '.env']);
const REST_OF_LINE_FORMATS = ['npmrc', 'pypirc', 'awscreds', 'mycnf', 's3cfg', 'wgetrc', 'terraformrc'];
function valueRunsToEndOfLine(filePath) {
  const base = path.posix.basename(filePath).toLowerCase();
  if (REST_OF_LINE_EXTENSIONS.has(path.posix.extname(base)) || base === '.env' || base.startsWith('.env.') || base.endsWith('.env')) return true;
  const formats = credentialFormats(filePath);
  return REST_OF_LINE_FORMATS.some((tag) => formats.has(tag));
}

/**
 * Extra candidate values for an unquoted `name: value` / `name = value`, where the first whitespace-free token
 * (the regex capture) is not the whole value. Returns [{ value, end }] with `end` the index the value reaches.
 *  - the rest of the line, comment removed (a plain scalar or ini value with spaces)
 *  - the indented lines of a YAML block scalar (`|`, `>`, `|-`, `>-`, ...)
 */
function unquotedContinuations(ctx, input, matchIndex, tokenEnd, token) {
  // Line boundaries come from the per-file newline index (binary search), never from a scan: a one-line file with
  // thousands of matches must stay linear.
  const lineEnd = ctx.lineEnd(tokenEnd);
  const results = [];
  if (/^[|>][-+0-9]*$/.test(token)) {
    const lineStart = ctx.lineStart(matchIndex);
    const keyIndent = /^[ \t]*/.exec(input.slice(lineStart, matchIndex + 1))[0].length;
    let cursor = lineEnd + 1;
    const collected = [];
    let end = lineEnd;
    for (let n = 0; n < 60 && cursor <= input.length; n += 1) {
      let next = input.indexOf('\n', cursor);
      if (next === -1) next = input.length;
      const line = input.slice(cursor, next).replace(/\r$/, '');
      if (line.trim() !== '') {
        if (/^[ \t]*/.exec(line)[0].length <= keyIndent) break;
        collected.push(line.trim());
        end = next;
      }
      if (next >= input.length) break;
      cursor = next + 1;
    }
    for (const line of collected) results.push({ value: line, end });
    if (collected.length > 1) results.push({ value: collected.join(' '), end });
    return results;
  }
  if (!ctx.runsToEndOfLine || /^[!&*'"`{[]/.test(token) || token.endsWith(',')) return results;
  const rest = input.slice(tokenEnd, Math.min(lineEnd, tokenEnd + 400));
  if (!/^[ \t]+[^\s#]/.test(rest)) return results;
  const whole = (token + rest).replace(/\r$/, '').replace(/[ \t]+#.*$/, '').trim();
  if (/[{}[\]]/.test(whole)) return results;
  results.push({ value: whole, end: tokenEnd + rest.length });
  return results;
}

// ---------------------------------------------------------------------------
// File modes
// ---------------------------------------------------------------------------

const PROSE_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc']);
const CONFIG_EXTENSIONS = new Set([
  '.env', '.ini', '.cfg', '.conf', '.config', '.properties', '.toml', '.yml', '.yaml', '.json', '.jsonc',
  '.json5', '.sh', '.bash', '.zsh', '.fish', '.ksh', '.csh', '.tcsh', '.bat', '.cmd', '.tf', '.tfvars', '.hcl', '.example',
  '.sample', '.template', '.dist', '.cnf', '.tfstate', '.kubeconfig', '.acl',
]);
// XML configuration formats: Maven settings.xml and pom.xml, Ant, Tomcat server.xml, Android strings.xml, .NET
// web.config / app.config (.config is above), MSBuild (.csproj, .props, .targets), .plist, .resx, .wsdl. These hold settings
// the same way an ini or YAML file does, so they get configuration-value semantics (a quoted value with spaces or a
// passphrase is a secret, not text). .svg, .html and .xhtml stay in code mode: they are markup, not settings.
const XML_CONFIG_EXTENSIONS = new Set([
  '.xml', '.csproj', '.vbproj', '.fsproj', '.props', '.targets', '.plist', '.resx', '.wsdl', '.nuspec', '.pubxml', '.settings',
  // MSBuild siblings (any *proj is added by isXmlConfigPath), Azure service configuration, JMeter, Apple profiles and
  // entitlements, IDE and analyser settings, Windows packaging, Maven POM files.
  '.projitems', '.cscfg', '.csdef', '.jmx', '.mobileconfig', '.entitlements', '.iml', '.launch', '.ruleset', '.appxmanifest',
  '.wxs', '.wxi', '.pom', '.jnlp',
]);
// Markup and schema formats stay in code mode on purpose: .svg .html .htm .xhtml .xsl .xslt .xaml .xsd .rss .atom .kml hold
// content, styling or structure, not settings, and a <password> label or a form field there is not a credential.
// A template or backup suffix (settings.xml.template, web.xml.erb, pom.xml.bak) does not change what the file is.
const TEMPLATE_SUFFIX = /\.(?:template|dist|sample|example|erb|j2|jinja2?|tpl|tmpl|bak|orig|old|default|in)$/i;

/** The file name without trailing template or backup suffixes (at most two), lower-cased. */
function baseWithoutTemplateSuffix(base) {
  let name = base.toLowerCase();
  for (let i = 0; i < 2 && TEMPLATE_SUFFIX.test(name) && name.replace(TEMPLATE_SUFFIX, '') !== ''; i += 1) name = name.replace(TEMPLATE_SUFFIX, '');
  return name;
}

/** True for XML configuration files (see XML_CONFIG_EXTENSIONS) and .NET *.config files. */
export function isXmlConfigPath(filePath) {
  const base = path.posix.basename(filePath.split(path.sep).join('/'));
  const ext = path.posix.extname(baseWithoutTemplateSuffix(base));
  return XML_CONFIG_EXTENSIONS.has(ext) || ext === '.config' || /^\.[a-z]*proj$/.test(ext);
}

const CONFIG_BASENAMES = new Set([
  '.npmrc', '.yarnrc', '.netrc', '.pgpass', '.envrc', 'makefile', 'gnumakefile', 'procfile', 'credentials', 'config',
  // Shell start-up files have no extension: `export API_TOKEN=...` in them is a setting, not a code expression.
  '.bashrc', '.bash_profile', '.bash_login', '.bash_aliases', '.profile', '.zshrc', '.zshenv', '.zprofile', '.zlogin',
  '.kshrc', '.cshrc', '.tcshrc', '.login', 'fish_variables',
  // Whitespace-delimited service settings without an extension (see the config-directive-secret rule).
  '.htaccess', 'msmtprc', '.msmtprc', 'mpoprc', '.mpoprc', 'fetchmailrc', '.fetchmailrc',
]);

const WHOLE_FILE_SECRET_NAME = /^(?:\.?erlang\.cookie|(?:mongo(?:db)?[._-])?keyfile|mongo(?:db)?\.key)$/;
const NETRC_NAME = /(?:^|[._-])netrc(?:$|[._-])/;
const PGPASS_NAME = /(?:^|[._-])pgpass(?:$|[._-])/;
const GITCRED_NAME = /(?:^|[._-])git-credentials(?:$|[._-])/;
const DOCKER_NAME = /(?:^|[._-])(?:dockercfg|dockerconfigjson|dockerconfig|docker-config)(?:$|[._-])/;

/**
 * Which native credential-file formats a path is, by its base name and directories (all lower-case tags):
 *   netrc pgpass gitcred npmrc pypirc awscreds docker kube htpasswd mycnf s3cfg terraformrc curlrc wgetrc vault
 * A path can carry several. These files have their own syntax (`password <value>`, host:port:db:user:password,
 * URL lines, `_authToken=`, user:hash) and are scanned by the credential-file rule, with lower value-length limits.
 */
export function credentialFormats(filePath) {
  const normalized = filePath.split(path.sep).join('/').toLowerCase();
  const base = path.posix.basename(normalized);
  const dirs = `/${normalized}`;
  const tags = new Set();
  // Backups and variants reach a repository under names like netrc.txt, .netrc.bak, .netrc.prod, dot-netrc, pgpass.local:
  // the name is matched as a whole word (separated by . _ or -), not as an exact base name.
  if (NETRC_NAME.test(base)) tags.add('netrc');
  if (PGPASS_NAME.test(base)) tags.add('pgpass');
  if (GITCRED_NAME.test(base)) tags.add('gitcred');
  if (/^\.?(?:npmrc|yarnrc)(?:\.|$)/.test(base)) tags.add('npmrc');
  if (/^\.?pypirc(?:\.|$)/.test(base)) tags.add('pypirc');
  if (base === 'credentials' || (base === 'config' && dirs.includes('/.aws/')) || base === '.aws-credentials') tags.add('awscreds');
  if (DOCKER_NAME.test(base) || dirs.includes('/.docker/')) tags.add('docker');
  if (base === 'kubeconfig' || base.endsWith('.kubeconfig') || base.startsWith('kubeconfig.') || dirs.includes('/.kube/')) tags.add('kube');
  if (/^\.?ht(?:passwd|digest)(?:\.|$)/.test(base)) tags.add('htpasswd');
  if (/^\.?(?:my|mylogin|mysql)\.cnf$/.test(base)) tags.add('mycnf');
  if (base === '.s3cfg' || base === 's3cfg' || base === '.boto' || base === 'boto.cfg') tags.add('s3cfg');
  if (base === '.terraformrc' || base === 'terraform.rc' || base.endsWith('.tfrc.json') || base.endsWith('.tfrc') || base.includes('.tfstate')) tags.add('terraformrc');
  if (/^[._]?curlrc$/.test(base)) tags.add('curlrc');
  if (base === '.wgetrc' || base === 'wgetrc') tags.add('wgetrc');
  // Files whose whole content is the secret: a Vault token, a MongoDB replica-set key file, an Erlang (RabbitMQ) cookie.
  if (base === '.vault-token' || base === 'vault-token' || WHOLE_FILE_SECRET_NAME.test(base)) tags.add('vault');
  return tags;
}

// Formats in which every `name = value` is a credential setting: the value-length limit drops from 8 to 4 and
// auth-style names (auth, npmAuthIdent, client-key-data) count as secret names.
const STRICT_CREDENTIAL_FORMATS = ['npmrc', 'pypirc', 'awscreds', 'docker', 'kube', 'mycnf', 's3cfg', 'terraformrc', 'wgetrc', 'curlrc'];
const CREDENTIAL_FILE_MIN_LENGTH = 4;
const CREDENTIAL_FILE_NAMES = new Set(['auth', 'authident', 'npmauthident', 'clientkeydata', 'clientkey', 'authorization', 'basicauth']);

// Dovecot keeps settings in dovecot.conf, dovecot-sql.conf.ext, dovecot-ldap.conf.ext: `.ext` alone says nothing about a file.
const DOVECOT_CONFIG = /^dovecot[a-z0-9._-]{0,60}\.conf(?:\.ext)?$/;

/**
 * 'prose'  Markdown and text: docs paste real values into code fences.
 * 'config' env files, YAML, JSON, INI, shell, Terraform, Makefile, credential files, ...: bare KEY=value lines.
 * 'code'   everything else (JS, TS, Python, SQL, HTML, ...): only quoted, random-looking literals.
 */
export function fileMode(filePath) {
  const base = path.posix.basename(filePath.split(path.sep).join('/')).toLowerCase();
  const ext = path.posix.extname(base);
  if (PROSE_EXTENSIONS.has(ext)) return 'prose';
  if (
    base === '.env' ||
    base.startsWith('.env.') ||
    base.includes('.env.') ||
    base.endsWith('.env') ||
    base.startsWith('env.') ||
    base.startsWith('docker-compose') ||
    base.startsWith('dockerfile') ||
    DOVECOT_CONFIG.test(base) ||
    CONFIG_BASENAMES.has(base) ||
    CONFIG_EXTENSIONS.has(ext) ||
    XML_CONFIG_EXTENSIONS.has(ext) ||
    isXmlConfigPath(filePath) ||
    CONFIG_EXTENSIONS.has(path.posix.extname(baseWithoutTemplateSuffix(base))) ||
    credentialFormats(filePath).size > 0
  ) {
    return 'config';
  }
  return 'code';
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

// One or more line breaks (real or JSON-escaped). Unambiguous on purpose, to avoid regex backtracking blow-ups.
const PEM_SEPARATOR = String.raw`(?:[ \t]*(?:\\r|\r)?(?:\\n|\n))+[ \t]*`;
const SECRET_HINT = /secret|passw|pwd|pass|token|credential|salt|pepper|key|auth/i;
const ENV_ROOT = String.raw`(?:process\.env|import\.meta\.env)`;
// A "/" in a URL, or the same "/" escaped for JSON (\/).
const SLASH = String.raw`\\?\/`;

// `sign(payload, KEY, ...)`: is the text before the literal exactly one top-level argument?
function isSecondArgument(prefix) {
  let depth = 0;
  for (const ch of prefix) {
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) return false;
    if (depth < 0) return false;
  }
  return depth === 0;
}

// The text of the match's own line, bounded to 200 characters before and 400 after so a huge single line stays cheap.
function nearbyLineText(m) {
  const before = m.input.slice(Math.max(0, m.index - 200), m.index);
  const after = m.input.slice(m.index + m[0].length, m.index + m[0].length + 400);
  const lineBreak = after.indexOf('\n');
  return before.slice(before.lastIndexOf('\n') + 1) + m[0] + (lineBreak === -1 ? after : after.slice(0, lineBreak));
}

// The value after `name =`, read at a given position: "quoted", 'quoted' or `quoted` (with backslash escapes)
// in groups 1-3, otherwise the bare whitespace-free token in group 4.
const valueAt = (bareMax) =>
  new RegExp(
    String.raw`"((?:[^"\\\n]|\\[\s\S]){0,4096})"|'((?:[^'\\\n]|\\[\s\S]){0,4096})'|\x60((?:[^\x60\\\n]|\\[\s\S]){0,4096})\x60|(\S{1,${bareMax}})`,
    'y',
  );
const NESTED_VALUE_CHARS = 64;
const VALUE_AT = valueAt(4096);
const NESTED_VALUE_AT = valueAt(NESTED_VALUE_CHARS);

/** Undo backslash escapes inside a quoted value (\" \\ \'), so an escaped quote cannot hide the rest of the string. */
const unescapeQuoted = (text) => text.replace(/\\\r?\n[ \t]*/g, '').replace(/\\(.)/g, '$1');

/**
 * A password taken from a URL or `curl -u`. A password with no ${...} is judged as a whole. One with an expansion
 * is judged like a secret-like assignment: a reference alone (${DB_PASSWORD}) passes, but a literal default
 * (${DB_PASSWORD:-hunter2}) or literal text next to a reference (${A}suffix) is a candidate password.
 */
function urlPasswordIsSecret(password) {
  if (!password.includes('${')) {
    if (isPlaceholder(password)) return false;
    // A quoted password may hold spaces (a curl user argument written as one quoted string). The whole argument is judged like a
    // quoted passphrase: a placeholder-like first word does not hide the rest, and documentation about a password passes.
    return /\s/.test(password) ? isPhraseSecret({ kind: 'strong', text: password }) : true;
  }
  if (expansionLiterals(password).some((literal) => !isPlaceholder(stripQuotes(literal)))) return true;
  const glued = stripQuotes(withoutExpansions(password));
  return glued !== '' && !isPlaceholder(glued);
}

/**
 * The first shell word at `start` (quotes honoured, at most one line and 4096 characters read).
 * @returns {{text: string, length: number, quoted: boolean} | null} `length` is how much input the word's source covers
 */
function shellArgument(input, start) {
  let end = input.indexOf('\n', start);
  if (end === -1 || end - start > 4096) end = Math.min(input.length, start + 4096);
  let source = input.slice(start, end);
  // The word's source ends at the first unquoted blank.
  let quote = null;
  let openedAt = -1;
  let i = 0;
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (quote !== null) {
      if (ch === '\\' && (quote === '"' || quote === "'") && i + 1 < source.length) i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      openedAt = i;
    } else if (ch === '\\') i += 1;
    else if (ch === ' ' || ch === '\t' || ch === '\r') break;
  }
  // A quote that never closes on the line is not a quoted argument: the text stands in a string of the surrounding code
  // ('curl -u user:pass', "..."), so the word ends at that quote character.
  if (quote !== null) {
    source = source.slice(0, openedAt);
    i = openedAt;
  }
  const words = shellWords(source);
  if (words.length === 0) return null;
  return { text: words[0], length: Math.min(i, source.length), quoted: /["']/.test(source.slice(0, i)) };
}

// Commands that take a password on their command line, and the rest of that line (see cliPasswordArguments).
const CLI_PASSWORD_COMMAND =
  /(?<![A-Za-z0-9_.-])(?:curl|wget2?|mysql(?:dump|admin|pump|import|show|check|slap)?|mariadb(?:-dump|-admin)?|mongo(?:sh|dump|restore|export|import|stat|top)?|redis6?-cli|valkey-cli|sshpass|smbclient|xhs?|https?|ldap(?:search|modify|add|delete|passwd|compare|whoami)|mosquitto_(?:pub|sub|rr|passwd)|htpasswd|rabbitmq(?:ctl|admin)|sqlcmd|keytool|gpg2?|(?:docker|podman|az|vault)(?=[ \t]+login))(?=[ \t])[^\n]{0,600}/g;

/** The password arguments of one command line for the tools in CLI_PASSWORD_COMMAND (`words` are its shell words, tool first). */
function cliPasswordArguments(allWords) {
  // A quote that never closes on the line belongs to the code around the command (`'wget --password', ...`): the word it
  // swallowed is not an argument.
  const words = allWords.open ? allWords.slice(0, -1) : allWords;
  if (words.length === 0) return [];
  const tool = words[0].replace(/[0-9]+$/, '');
  const found = [];
  const next = (i) => (i + 1 < words.length && !words[i + 1].startsWith('-') ? words[i + 1] : null);
  // A password given as a shell variable ($PW, %PW%) is a reference, not a literal.
  const literal = (value) => {
    if (value !== null && value !== undefined && !SHELL_REFERENCE.test(value)) found.push(value);
  };
  const auth = (value) => {
    // user:password; a value without a colon is a bearer token only when the command says so.
    const colon = value.indexOf(':');
    if (colon !== -1) found.push(value.slice(colon + 1));
    else if (words.some((w, k) => /^(?:-A|--auth-type)(?:=|$)/.test(w) && /bearer/i.test(w.includes('=') ? w : (words[k + 1] ?? '')))) found.push(value);
  };
  for (let i = 1; i < words.length; i += 1) {
    const word = words[i];
    const eq = word.indexOf('=');
    const flag = eq === -1 ? word : word.slice(0, eq);
    const inline = eq === -1 ? null : word.slice(eq + 1);
    const value = () => inline ?? next(i);
    if (tool === 'curl') {
      if (flag === '--pass' || flag === '--proxy-pass') found.push(value() ?? '');
    } else if (tool.startsWith('wget')) {
      if (/^--(?:http-|ftp-|proxy-)?password$/.test(flag)) found.push(value() ?? '');
    } else if (/^(?:mysql|mariadb)/.test(tool)) {
      if (flag === '--password' && inline !== null) found.push(inline);
      else if (/^-p./.test(word) && !word.startsWith('--')) found.push(word.slice(2)); // `-p` alone prompts
    } else if (tool.startsWith('mongo')) {
      if (flag === '--password') found.push(value() ?? '');
      else if (word === '-p') found.push(next(i) ?? '');
      else if (/^-p./.test(word) && !word.startsWith('--')) found.push(word.slice(2));
    } else if (tool === 'redis-cli' || tool === 'redis6-cli' || tool === 'valkey-cli') {
      if (word === '-a' || flag === '--pass') found.push(value() ?? '');
    } else if (tool === 'sshpass') {
      if (word === '-p') found.push(next(i) ?? '');
      else if (/^-p./.test(word)) found.push(word.slice(2));
    } else if (tool === 'xh' || tool === 'xhs' || tool === 'http' || tool === 'https') {
      if (word === '-a' || flag === '--auth') auth(value() ?? '');
      else if (/^-a./.test(word) && !word.startsWith('--')) auth(word.slice(2));
    } else if (tool === 'smbclient') {
      if (word === '-U' || flag === '--user') {
        const login = value() ?? ''; // user%password
        if (login.includes('%')) found.push(login.slice(login.indexOf('%') + 1));
      }
    } else if (tool.startsWith('ldap')) {
      if (word === '-w') found.push(next(i) ?? '');
      else if (/^-w./.test(word)) found.push(word.slice(2));
    } else if (tool === 'mosquitto_pub' || tool === 'mosquitto_sub' || tool === 'mosquitto_rr') {
      if (word === '-P' || flag === '--pw') literal(value());
    } else if (tool === 'mosquitto_passwd') {
      // mosquitto_passwd -b [-c] passwordfile username password  (without -b the password is prompted for)
      if (/^-[A-Za-z]*b[A-Za-z]*$/.test(word)) {
        const operands = words.slice(i + 1).filter((w) => !w.startsWith('-'));
        if (operands.length >= 3) literal(operands[2]);
      }
    } else if (tool === 'htpasswd') {
      // htpasswd -b[cmBdps] passwordfile username password;  -nb username password
      if (/^-[A-Za-z]*b[A-Za-z]*$/.test(word)) {
        const operands = words.slice(i + 1).filter((w) => !w.startsWith('-'));
        const password = /^-[A-Za-z]*n/.test(word) ? operands[1] : operands[2];
        if (password !== undefined) literal(password);
      }
    } else if (tool === 'rabbitmqctl') {
      // rabbitmqctl add_user USER PASSWORD, change_password USER PASSWORD, authenticate_user USER PASSWORD
      if (/^(?:add_user|change_password|authenticate_user)$/.test(word) && i + 2 < words.length) literal(words[i + 2]);
    } else if (tool === 'rabbitmqadmin') {
      if (word === '-p' || flag === '--password') literal(value());
    } else if (tool === 'sqlcmd') {
      if (word === '-P') literal(next(i));
    } else if (tool === 'keytool') {
      if (/^-(?:store|key|deststore|destkey|srcstore|srckey)pass$/.test(word)) literal(next(i));
    } else if (tool === 'gpg' || tool === 'gpg2') {
      if (flag === '--passphrase') literal(value());
    } else if (tool === 'docker' || tool === 'podman') {
      if (words[1] === 'login' && (word === '-p' || flag === '--password')) literal(value());
    } else if (tool === 'az') {
      if (words[1] === 'login' && (word === '-p' || flag === '--password')) literal(value());
    } else if (tool === 'vault') {
      // vault login TOKEN: the first operand that is not a flag or a key=value option
      if (words[1] === 'login' && i === 2 && !word.startsWith('-') && !word.includes('=') && looksRandom(word, GATES.configWeak)) found.push(word);
    }
  }
  return found.filter((password) => password !== '');
}

// ---------------------------------------------------------------------------
// Name/value pairs split across fields (JSON, YAML, HCL objects), in any order
// ---------------------------------------------------------------------------

const PAIR_BACK_CHARS = 1500; // how far before the name field the enclosing "{" or "(" is looked for
const PAIR_FORWARD_CHARS = 1500; // ... and how far after it the enclosing "}" or ")" is looked for
const PAIR_YAML_LINES = 12; // lines above and below the name line that can belong to the same YAML mapping
const PAIR_LINE_CHARS = 2000; // only this much of a YAML line is read
const PAIR_XML_CHARS = 600; // an XML entry (<add key= value=/>, <property><name/><value/></property>) is read up to this size
const PAIR_BUDGET_CHARS = 24_000_000; // per file: characters the window search may read before it gives up (and reports)

/**
 * The text of the innermost `{ ... }` around `index` by naive brace counting (null when there is none in range) and the
 * characters it cost. Reads at most PAIR_BACK_CHARS + PAIR_FORWARD_CHARS. Braces inside strings are counted, which
 * a JSON string such as "a } b" can exploit; stringAwareWindow covers that, and both are searched.
 */
function braceWindow(input, index) {
  // Native indexOf/lastIndexOf jump between braces, so a window without many braces costs a couple of memchr calls.
  const from = Math.max(0, index - PAIR_BACK_CHARS);
  const back = input.slice(from, index);
  let open = -1;
  let nearOpen = back.lastIndexOf('{');
  let nearClose = back.lastIndexOf('}');
  let depth = 0;
  while (nearOpen !== -1) {
    if (nearClose > nearOpen) {
      depth += 1;
      nearClose = nearClose === 0 ? -1 : back.lastIndexOf('}', nearClose - 1);
    } else {
      if (depth === 0) {
        open = from + nearOpen;
        break;
      }
      depth -= 1;
      nearOpen = nearOpen === 0 ? -1 : back.lastIndexOf('{', nearOpen - 1);
    }
  }
  if (open === -1) return { text: null, cost: 64 };
  const forward = input.slice(index, Math.min(input.length, index + PAIR_FORWARD_CHARS));
  let end = index + forward.length;
  let nextOpen = forward.indexOf('{');
  let nextClose = forward.indexOf('}');
  depth = 0;
  while (nextClose !== -1) {
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      nextOpen = forward.indexOf('{', nextOpen + 1);
    } else {
      if (depth === 0) {
        end = index + nextClose + 1;
        break;
      }
      depth -= 1;
      nextClose = forward.indexOf('}', nextClose + 1);
    }
  }
  return { text: input.slice(open, end), start: open, cost: end - open };
}

/**
 * Bracket tracking that knows about strings: a `}` or `)` inside "..." or '...' (backslash escapes honoured; a string
 * never runs past a line break, so an apostrophe in a comment cannot swallow the file) does not close anything.
 * `state` = { braces: [], parens: [] } holds the positions of the still-open brackets. With `stopAt` ('}' or ')'), the scan
 * ends at the first such closer that closes nothing opened inside `text` and returns its index (otherwise -1).
 */
function scanBrackets(text, offset, state, stopAt) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === '\\') i += 1;
      else if (ch === quote || ch === '\n') quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '{') {
      state.braces.push(offset + i);
    } else if (ch === '(') {
      state.parens.push(offset + i);
    } else if (ch === '}') {
      if (state.braces.length === 0 && stopAt === '}') return i;
      state.braces.pop();
    } else if (ch === ')') {
      if (state.parens.length === 0 && stopAt === ')') return i;
      state.parens.pop();
    }
  }
  return -1;
}

/**
 * The string-aware innermost enclosing bracket pair around `index`: `{ ... }` for a JSON/JS/Go/HCL object, or `( ... )`
 * for a call (create_var(name='X', value='Y')) when that is the innermost one. Returns { text, cost } (text null when
 * there is no enclosing pair in range). Bounded to PAIR_BACK_CHARS + PAIR_FORWARD_CHARS characters.
 */
function stringAwareWindow(input, index) {
  const from = Math.max(0, index - PAIR_BACK_CHARS);
  const back = input.slice(from, index);
  if (!back.includes('{') && !back.includes('(')) return { text: null, cost: 64 };
  const state = { braces: [], parens: [] };
  scanBrackets(back, from, state, null);
  const brace = state.braces[state.braces.length - 1] ?? -1;
  const paren = state.parens[state.parens.length - 1] ?? -1;
  const open = Math.max(brace, paren);
  if (open === -1) return { text: null, cost: index - from };
  const openChar = open === brace ? '{' : '(';
  // Forward: brackets opened after the name field must be closed first; the first unmatched closer of our kind ends it.
  const forward = input.slice(index, Math.min(input.length, index + PAIR_FORWARD_CHARS));
  const ahead = { braces: [], parens: [] };
  let end = index + forward.length;
  const hit = scanBrackets(forward, index, ahead, openChar === '{' ? '}' : ')');
  if (hit !== -1) end = index + hit + 1;
  return { text: input.slice(open, end), start: open, cost: index - from + (end - index) };
}

/**
 * The lines of the YAML mapping (a list item, or a plain block) that the name line belongs to: the item's own first line
 * and its sibling keys, in either direction, up to PAIR_YAML_LINES lines each way. An item ends at the next `- ` at
 * or left of it, a dedent, or a document marker. Returns null when the key is not at the start of its line.
 * Every search for a line break is bounded to PAIR_LINE_CHARS, so a huge single line costs a constant amount.
 * Returns { text, lines } where `lines` are the [start offset in input, text offset] of each line, for locating a match.
 */
/** Join lines ({ text, start }) with "\n" into a window that remembers where each line came from. */
function joinLines(lines) {
  let offset = 0;
  const parts = lines.map((line) => {
    const part = { start: line.start, at: offset };
    offset += line.text.length + 1;
    return part;
  });
  return { text: lines.map((line) => line.text).join('\n'), parts };
}

/** The offset in the scanned input of `index` in a window's text (a window is one run of input, or a run per line). */
function inputOffset(window, index) {
  if (window.parts === undefined) return window.start + index;
  let found = window.parts[0];
  for (const part of window.parts) {
    if (part.at > index) break;
    found = part;
  }
  return found.start + (index - found.at);
}

function yamlBlockWindow(input, index) {
  // Start of the line holding `at`, or -1 when the line is longer than PAIR_LINE_CHARS (not a YAML block line).
  const startOfLine = (at) => {
    const from = Math.max(0, at - PAIR_LINE_CHARS);
    const found = input.slice(from, at).lastIndexOf('\n');
    return found !== -1 ? from + found + 1 : from === 0 ? 0 : -1;
  };
  // The line starting at `start`: its text and where the next line starts (input.length + 1 when there is none in range).
  const lineFrom = (start) => {
    const chunk = input.slice(start, start + PAIR_LINE_CHARS + 1);
    const newline = chunk.indexOf('\n');
    if (newline === -1) return { text: chunk.replace(/\r$/, ''), start, next: input.length + 1 };
    return { text: chunk.slice(0, newline).replace(/\r$/, ''), start, next: start + newline + 1 };
  };
  const indentOf = (text) => /^[ \t]*/.exec(text)[0].length;
  const isDash = (text) => /^[ \t]*-(?:[ \t]|$)/.test(text);
  const isMarker = (text) => /^(?:---|\.\.\.)[ \t]*$/.test(text);

  const lineStart = startOfLine(index);
  if (lineStart === -1) return null;
  const prefix = input.slice(lineStart, index);
  if (!/^[ \t]*(?:-[ \t]+)*$/.test(prefix)) return null;
  const keyCol = prefix.length;
  const ownItem = prefix.includes('-');
  const own = lineFrom(lineStart);
  const above = [];
  if (!ownItem) {
    let cursor = lineStart;
    // Lines indented deeper than the key (the body of a block scalar such as `value: |` above the name) do not use up the
    // PAIR_YAML_LINES allowance, so a long body cannot push its `value:` header out of the window; they have their own bound,
    // and a blank line inside such a body (legal in a block scalar) does not end the walk.
    let ordinary = 0;
    let deep = 0;
    let insideBody = false;
    while (cursor > 0 && ordinary < PAIR_YAML_LINES && deep < MULTILINE_MAX_LINES) {
      const previousStart = startOfLine(cursor - 1);
      if (previousStart === -1) break;
      const line = lineFrom(previousStart);
      cursor = previousStart;
      if (line.text.trim() === '') {
        if (!insideBody) break;
        deep += 1;
        continue;
      }
      if (isMarker(line.text)) break;
      if (isDash(line.text) && /^[ \t]*-[ \t]+/.exec(line.text)[0].length === keyCol) {
        above.push(line);
        break;
      }
      if (indentOf(line.text) < keyCol || (isDash(line.text) && indentOf(line.text) <= keyCol)) break;
      above.push(line);
      if (indentOf(line.text) > keyCol) {
        insideBody = true;
        deep += 1;
      } else {
        insideBody = false;
        ordinary += 1;
      }
    }
  }
  const below = [];
  let cursor = own.next;
  for (let n = 0; n < PAIR_YAML_LINES && cursor <= input.length; n += 1) {
    const line = lineFrom(cursor);
    cursor = line.next;
    if (line.text.trim() === '') continue;
    if (isMarker(line.text)) break;
    const indent = indentOf(line.text);
    if (indent < keyCol || (isDash(line.text) && indent === keyCol && !ownItem)) break;
    below.push(line);
  }
  return joinLines([...above.reverse(), own, ...below]);
}

// The entry tags of XML/properties-style configuration: <add key= value=/>, <setting name=><value/></setting>,
// <property><name/><value/></property>, <entry key=>V</entry>.
const XML_ENTRY_TAG = /<(?:add|setting|property|entry|item|param|parameter|variable|var|env|envvar|option|appsetting|pair|element|secret)(?![A-Za-z0-9_-])/gi;

const XML_ENTRY_CLOSE = /<\/(?:add|setting|property|entry|item|param|parameter|variable|var|env|envvar|option|appsetting|pair|element|secret)[ \t\r\n]*>/gi;
const XML_ENTRY_CLOSE_ONCE = /<\/(?:add|setting|property|entry|item|param|parameter|variable|var|env|envvar|option|appsetting|pair|element|secret)[ \t\r\n]*>/i;
/**
 * The XML entry around `index`: from the nearest opening entry tag before it (or the tag that holds it) to the end of that
 * entry (`/>`, or its closing tag, or the start of the next entry), at most PAIR_XML_CHARS. Null when `index` is not in XML.
 */
function xmlWindow(input, index) {
  const from = Math.max(0, index - PAIR_XML_CHARS);
  const back = input.slice(from, index);
  if (!back.includes('<')) return null;
  let start = -1;
  for (const tag of back.matchAll(XML_ENTRY_TAG)) start = from + tag.index;
  if (start === -1) start = from + back.lastIndexOf('<');
  // An entry that already ended before `index` (a "/>" or a closing entry tag between its start and `index`) is a different
  // element: the window starts at the first tag after that end, so its value= is never paired with a later name=.
  const between = input.slice(start, index);
  let ended = between.lastIndexOf('/>');
  if (ended !== -1) ended += 2;
  for (const close of between.matchAll(XML_ENTRY_CLOSE)) ended = Math.max(ended, close.index + close[0].length);
  if (ended > 0) {
    const nextTag = between.indexOf('<', ended);
    // No tag between the end and `index`: `index` is in text after the entry, nothing pairs with it.
    start = nextTag === -1 ? index : start + nextTag;
  }
  const forward = input.slice(index, Math.min(input.length, index + PAIR_XML_CHARS));
  let end = forward.length;
  const selfClose = forward.indexOf('/>');
  if (selfClose !== -1) end = Math.min(end, selfClose + 2);
  const closing = XML_ENTRY_CLOSE_ONCE.exec(forward);
  if (closing) end = Math.min(end, closing.index + closing[0].length);
  XML_ENTRY_TAG.lastIndex = 0;
  const next = XML_ENTRY_TAG.exec(forward);
  if (next && next.index > 0) end = Math.min(end, next.index);
  XML_ENTRY_TAG.lastIndex = 0;
  return { text: input.slice(start, index + end), start };
}

// The value-carrying field of a name/value object. `valueFrom`, `values` and other longer names do not match. A YAML tag
// or anchor before the scalar (`!!str V`, `&a V`) is skipped.
const PAIR_VALUE_FIELD =
  /(?<![A-Za-z0-9_$.-])(["']?)(?:value|val|secret|secretvalue|stringvalue|plaintext|content|data|default|defaultvalue|parametervalue)\1[ \t]*[:=][ \t]*(?:(?:![^\s,}\]]{0,60}|&[A-Za-z0-9_-]{1,60})[ \t]+){0,3}(?:"((?:[^"\\\n]|\\.){0,4096})"|'((?:[^'\\\n]|\\.){0,4096})'|([^\s,}\]"']{1,4096}))/gi;
// The same field as an XML element: <value>V</value>
const PAIR_XML_VALUE = /<(?:value|val|secret|content|data|default|string)(?:[ \t][^<>]{0,80})?>[ \t\r\n]*([^<>]{1,4096}?)[ \t\r\n]*<\//gi;

// Where a value begins (the same field names as PAIR_VALUE_FIELD, whatever follows): read again from the input when it runs over
// several lines (a YAML block scalar, a quote closed on a later line, a folded scalar, a heredoc).
const PAIR_VALUE_START =
  /(?<![A-Za-z0-9_$.-])(["']?)(?:value|val|secret|secretvalue|stringvalue|plaintext|content|data|default|defaultvalue|parametervalue)\1[ \t]*[:=][ \t]*(?:(?:![^\s,}\]]{0,60}|&[A-Za-z0-9_-]{1,60})[ \t]+){0,3}(?=\S)/gi;
// A YAML block scalar header: | or > with an optional chomping (+ -) and indentation (1-9) indicator, then only a comment.
const BLOCK_SCALAR_HEADER = /[|>](?:[-+][1-9]?|[1-9][-+]?)?(?=[ \t]*(?:#[^\n]*)?(?:\r?\n|$))/y;

/**
 * The body of a YAML block scalar whose header ends at `afterHeader`: the following lines indented deeper than the key (blank
 * lines belong to it), as candidate values (each line, and all of them joined). Bounded like the other multi-line readers; a body
 * that does not end within the bounds (or the file's budget) is reported as exhausted so the caller fails closed.
 * @returns {{values: string[], end: number, exhausted: boolean, budget?: boolean}}
 */
function blockScalarValue(ctx, input, afterHeader, keyColumn) {
  if (budgetSpent(ctx)) return exhaustedLiteral(ctx, input, afterHeader);
  const lines = [];
  let at = input.indexOf('\n', afterHeader);
  let end = afterHeader;
  let closed = at === -1;
  let chars = 0;
  at += 1;
  for (let n = 0; !closed && n < MULTILINE_MAX_LINES && chars <= MULTILINE_MAX_CHARS; n += 1) {
    if (at >= input.length) {
      closed = true;
      break;
    }
    const next = input.indexOf('\n', at);
    const stop = next === -1 ? input.length : next;
    const raw = input.slice(at, Math.min(stop, at + 4096)).replace(/\r$/, '');
    chars += stop - at + 1;
    if (raw.trim() !== '') {
      if (/^[ \t]*/.exec(raw)[0].length <= keyColumn) {
        closed = true;
        break;
      }
      lines.push(raw.trim());
      end = stop;
    }
    if (next === -1) {
      closed = true;
      break;
    }
    at = next + 1;
  }
  if (!closed) return exhaustedLiteral(ctx, input, afterHeader);
  if (!spendMultiline(ctx, end - afterHeader + 1)) return exhaustedLiteral(ctx, input, afterHeader);
  return { values: bodyValues(lines.join('\n')), end, exhausted: false };
}

/** The lines of a JSON string value whose line breaks are written as \n escapes, as candidate values (each line, and all joined). */
function escapedLineValues(raw) {
  if (!/\\[nr]/.test(raw)) return [];
  const lines = raw.split(/\\r\\n|\\n|\\r/).map((line) => unescapeQuoted(line).trim()).filter((line) => line !== '');
  return lines.length > 1 ? [...lines, lines.join(' ')] : [];
}

/**
 * Value fields of the window whose value is not on the field's line: a block scalar (`value: |`, `>-`, `|2`, after a tag such as
 * `!Sub`), a quote closed on a later line, a heredoc or triple-quoted string, a scalar folded over indented lines. The value is
 * read from the input (the window only says where it starts) and judged like a quoted value. Returns a hit ({ abs }), an
 * unverifiable read ({ exhausted }) or null.
 */
function multilineFieldSecret(window, kind, ctx, input, read) {
  for (const start of window.text.matchAll(PAIR_VALUE_START)) {
    const keyAt = inputOffset(window, start.index);
    const valueAt = inputOffset(window, start.index + start[0].length);
    if (read.has(valueAt)) continue;
    read.add(valueAt);
    const keyColumn = keyAt - ctx.lineStart(keyAt);
    BLOCK_SCALAR_HEADER.lastIndex = valueAt;
    const header = BLOCK_SCALAR_HEADER.exec(input);
    const body =
      header !== null
        ? blockScalarValue(ctx, input, valueAt + header[0].length, keyColumn)
        : (multilineValue(ctx, input, valueAt) ?? continuedValue(ctx, input, keyAt, valueAt));
    if (body === null) continue;
    if (body.exhausted) return { exhausted: true, budget: body.budget === true };
    const judged = body.values.some((value) =>
      isSecretValue({ kind, value, quoted: true, separator: ':', mode: ctx.mode, minLength: ctx.minStrong, catalog: ctx.catalog }),
    );
    if (judged) return { abs: { start: valueAt, end: body.end } };
  }
  return null;
}

/**
 * Is any value field (either order) in the window text a non-placeholder secret? Returns where it sits ({ index, length } in the
 * window text, or { abs } for a value read from the input), { exhausted } when a multi-line value cannot be verified, or null.
 */
function windowHoldsSecretValue(window, kind, ctx, escaped, input, read = new Set()) {
  const text = window.text;
  const unescaped = escaped ? text.replace(/\\(["'])/g, '$1') : text;
  // Where the offending value sits (offset and length in the window's text). An escaped window changes its length, so the
  // whole window stands for it then.
  const at = (field) => (escaped ? { index: 0, length: text.length } : { index: field.index, length: field[0].length });
  const judge = (value, quoted) =>
    isSecretValue({ kind, value, quoted, separator: ':', mode: ctx.mode, minLength: ctx.minStrong, catalog: ctx.catalog });
  for (const field of unescaped.matchAll(PAIR_VALUE_FIELD)) {
    const quotedValue = field[2] ?? field[3];
    const quoted = quotedValue !== undefined;
    if (quoted ? judge(unescapeQuoted(quotedValue), true) || escapedLineValues(quotedValue).some((line) => judge(line, true)) : judge(field[4], false)) {
      return at(field);
    }
  }
  if (unescaped.includes('</')) {
    for (const field of unescaped.matchAll(PAIR_XML_VALUE)) {
      if (judge(field[1], true) || bodyValues(field[1]).some((line) => judge(line, true))) return at(field);
    }
  }
  if (!escaped) return multilineFieldSecret(window, kind, ctx, input, read);
  return null;
}

/**
 * Record on the match where the VALUE field sits (the name field is the match itself), which can be lines away from the
 * name. --history and --range report a finding when the commit added a line of the match or a line of the value, not a
 * line in between (the reported line and `spanEnd` are untouched, so the tree report and the inline allow marker behave as before).
 */
function attributeTo(m, window, found, coarse = false) {
  if (found.abs !== undefined) {
    // A value read straight from the input (a block scalar, a multi-line literal): the marker line through its last line.
    m.attrStart = found.abs.start;
    m.attrEnd = Math.max(found.abs.end, found.abs.start + 1);
    m.attrCoarse = false;
    return;
  }
  const first = inputOffset(window, found.index);
  const last = inputOffset(window, found.index + Math.max(found.length - 1, 0));
  m.attrStart = first;
  m.attrEnd = last + 1;
  // A coarse range (a whole escaped window, the whole file) does not say which line holds the value, so an allow marker
  // on a line of it must not suppress the finding.
  m.attrCoarse = coarse;
}

/** The window search ran out of budget: the finding rests on the whole file (a history scan blames any added line). */
function attributeToFile(m) {
  m.attrStart = 0;
  m.attrEnd = m.input.length;
  m.attrCoarse = true;
}

/**
 * Judge a name/value object whose secret-like name field is at `m`: is any value field in the same bounded JSON/HCL/YAML/
 * XML object or call (either order, other fields in between) a non-placeholder secret? Reads are budgeted per file;
 * running out of budget reports the file once (hostile input must not be silently skipped).
 */
function pairValueIsSecret(m, kind, ctx) {
  if (ctx.pairExhausted) return false; // already reported for this file, and nothing more is read
  ctx.pairBudget ??= PAIR_BUDGET_CHARS;
  const windows = []; // { text, start } for one run of the input, { text, parts } for a run per line
  const brace = braceWindow(m.input, m.index);
  ctx.pairBudget -= brace.cost;
  if (brace.text !== null) windows.push(brace);
  const aware = stringAwareWindow(m.input, m.index);
  ctx.pairBudget -= aware.cost;
  if (aware.text !== null && aware.text !== brace.text) windows.push(aware);
  const yaml = yamlBlockWindow(m.input, m.index);
  if (yaml !== null) {
    ctx.pairBudget -= yaml.text.length;
    windows.push(yaml);
  }
  const xml = xmlWindow(m.input, m.index);
  if (xml !== null) {
    ctx.pairBudget -= xml.text.length;
    windows.push(xml);
  }
  if (ctx.pairBudget < 0) {
    // Out of budget: the file is too dense with secret-like names to verify. Report it (once: one finding fails the run).
    ctx.pairExhausted = true;
    attributeToFile(m);
    return true;
  }
  const escaped = m[1].startsWith('\\'); // a JSON document stored as a string: {\"key\":\"X\",\"value\":\"Y\"}
  const read = new Set(); // the same value is found through several windows: read it once
  for (const window of windows) {
    const found = windowHoldsSecretValue(window, kind, ctx, escaped, m.input, read);
    if (found !== null) return pairHit(m, window, found, ctx, escaped);
  }
  return false;
}

/** A window search found a value (or could not verify one): record where, and report the pair. */
function pairHit(m, window, found, ctx, coarse = false) {
  if (found.exhausted !== true) {
    attributeTo(m, window, found, coarse);
    return true;
  }
  // A multi-line value that does not end within the bounds cannot be verified: reported (fail closed), once per file when the
  // file's budget is what ran out.
  attributeToFile(m);
  if (!found.budget) return true;
  if (ctx.multilineReported) return false;
  ctx.multilineReported = true;
  return true;
}

/** Value fields inside the child block or object that belongs to a name: `NAME:` followed by indented lines, or `NAME: {`. */
function childHoldsSecretValue(m, kind, ctx, keyIndent) {
  if (ctx.pairExhausted) return false;
  ctx.pairBudget ??= PAIR_BUDGET_CHARS;
  const input = m.input;
  const after = m.index + m[0].length;
  let window;
  if (input[after] === '{') {
    const forward = input.slice(after + 1, Math.min(input.length, after + 1 + PAIR_FORWARD_CHARS));
    const state = { braces: [], parens: [] };
    const hit = scanBrackets(forward, after + 1, state, '}');
    window = { text: forward.slice(0, hit === -1 ? forward.length : hit), start: after + 1 };
  } else {
    const lines = [];
    // `after` sits at the end of the name line (or a comment before its line break): the children are the following,
    // more indented lines. Each line is cut at PAIR_LINE_CHARS, so a huge line costs a constant amount.
    let lineBreak = input.indexOf('\n', after);
    let childIndent = -1; // only the direct children count: `secrets:` is not the name of a value nested two levels down
    for (let n = 0; n < PAIR_YAML_LINES * 2 && lineBreak !== -1 && lines.length < PAIR_YAML_LINES; n += 1) {
      const from = lineBreak + 1;
      const next = input.indexOf('\n', from);
      const line = input.slice(from, next === -1 ? Math.min(input.length, from + PAIR_LINE_CHARS) : Math.min(next, from + PAIR_LINE_CHARS)).replace(/\r$/, '');
      lineBreak = next;
      if (line.trim() === '') continue;
      const indent = /^[ \t]*/.exec(line)[0].length;
      if (/^(?:---|\.\.\.)[ \t]*$/.test(line) || indent <= keyIndent) break;
      if (childIndent === -1) childIndent = indent;
      if (indent === childIndent) lines.push({ text: line, start: from });
    }
    window = joinLines(lines);
  }
  ctx.pairBudget -= window.text.length + 64;
  if (ctx.pairBudget < 0) {
    ctx.pairExhausted = true;
    attributeToFile(m);
    return true;
  }
  const found = windowHoldsSecretValue(window, kind, ctx, false, input);
  return found !== null && pairHit(m, window, found, ctx);
}

// ---------------------------------------------------------------------------
// Secrets passed on a command line: gh secret set NAME --body V, netlify env:set NAME V, aws ssm put-parameter ...
// ---------------------------------------------------------------------------

// Flags that carry the variable name, and flags that carry its value, in the CLIs above.
const CLI_NAME_FLAGS = new Set(['--name', '--key', '--secret-name', '--parameter-name']);
const CLI_VALUE_FLAGS = new Set(['--body', '-b', '--value', '--secret-string', '--string-value', '--secret-value', '--plaintext']);
// Flags that take a separate argument but are neither of the above (so it is not mistaken for a name or a value).
const CLI_OTHER_ARG_FLAGS = new Set([
  '--type', '--description', '--env', '--environment', '--app', '-a', '--repo', '-R', '--org', '-o', '--vault-name', '--region',
  '--profile', '--scope', '--context', '--site', '-s', '--project', '--secret-id', '--tags', '--kms-key-id', '--key-id',
  '--visibility', '--repos', '--user', '--env-file', '--config', '--namespace', '-n', '--from-file', '--tier', '--data-type',
]);

/** Shell words of one command line: quotes honoured, stops at an unquoted pipe, ;, &, > or comment. `<<<` is a word of its own. */
function shellWords(line) {
  const words = [];
  let word = null;
  let quote = null;
  let ansi = false; // inside $'...': backslash escapes work there
  const push = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote !== null) {
      if (ch === '\\' && (quote === '"' || ansi) && i + 1 < line.length) {
        word += line[i + 1];
        i += 1;
      } else if (ch === quote) {
        quote = null;
        ansi = false;
      } else word += ch;
    } else if (ch === '$' && (line[i + 1] === "'" || line[i + 1] === '"')) {
      quote = line[i + 1]; // $'...' (ANSI-C) and $"..." (locale) quote like '...' and "..."; the $ is not part of the word
      ansi = quote === "'";
      word ??= '';
      i += 1;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      word ??= '';
    } else if (ch === ' ' || ch === '\t' || ch === '\r') {
      push();
    } else if (ch === '|' || ch === ';' || ch === '&' || ch === '>' || (ch === '#' && word === null)) {
      break;
    } else if (ch === '<' && line.startsWith('<<<', i)) {
      push();
      words.push('<<<');
      i += 2;
    } else if (ch === '\\' && i + 1 < line.length) {
      word = (word ?? '') + line[i + 1];
      i += 1;
    } else {
      word = (word ?? '') + ch;
    }
  }
  push();
  words.open = quote !== null; // the line ended inside a quote: the last word is cut off (usually a string in surrounding code)
  return words;
}

/**
 * The (name, value) pairs of one CLI invocation. `verb` names the tool (see CLI_TOOLS): `positionalValue` tools take
 * `NAME VALUE`; every tool takes --name/--value style flags, --from-literal=K=V, a `<<<` here-string or an
 * `echo V |` pipe for its first positional name. `K=V` positionals are pairs only where `assignments` is true.
 */
function cliPairs(words, { positionalValue, assignments }, piped) {
  const pairs = [];
  const positional = [];
  let flagName = null;
  let flagValue = null;
  let hereString = null;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (word === '<<<') {
      hereString = words[i + 1] ?? null;
      i += 1;
    } else if (word.startsWith('<<<') && word.length > 3) {
      hereString = word.slice(3);
    } else if (word.startsWith('<<')) {
      if (word === '<<' || word === '<<-') i += 1; // a heredoc delimiter, not a positional; its body is read separately
    } else if (word === '<') {
      i += 1; // a redirect from a file
    } else if (word.startsWith('--from-literal=')) {
      const eq = word.indexOf('=', 15);
      if (eq !== -1) pairs.push([word.slice(15, eq), word.slice(eq + 1)]);
    } else if (word === '--from-literal') {
      const literal = words[i + 1] ?? '';
      const eq = literal.indexOf('=');
      if (eq !== -1) pairs.push([literal.slice(0, eq), literal.slice(eq + 1)]);
      i += 1;
    } else if (word.startsWith('-')) {
      const eq = word.indexOf('=');
      const flag = eq === -1 ? word : word.slice(0, eq);
      const inline = eq === -1 ? null : word.slice(eq + 1);
      const take = () => (inline !== null ? inline : ((i += 1), words[i] ?? null));
      if (CLI_NAME_FLAGS.has(flag)) flagName = take();
      else if (CLI_VALUE_FLAGS.has(flag)) flagValue = take();
      else if (CLI_OTHER_ARG_FLAGS.has(flag)) take();
    } else if (assignments && /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      pairs.push([word.slice(0, word.indexOf('=')), word.slice(word.indexOf('=') + 1)]);
    } else {
      positional.push(word);
    }
  }
  const name = flagName ?? positional[0] ?? null;
  const value = flagValue ?? hereString ?? (positionalValue ? positional[1] : null) ?? piped;
  if (name !== null && value !== null && value !== undefined && !name.includes('=')) pairs.push([name, value]);
  return pairs;
}

// A pipeline stage between the source of a value and the CLI that leaves the text as it is (or close enough to still be the secret).
const PIPE_FILTER = /^(?:cat|tee|tr|head|tail|sed|awk|cut|base64|paste|rev|iconv)(?![A-Za-z0-9_-])/;

/** Index of the first unquoted single `|` in `text`, or -1 when a `;`, `&`, `||` or the end comes first. */
function firstPipe(text) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === '\\' && quote === '"') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '\\') i += 1;
    else if (ch === '|') return text[i + 1] === '|' ? -1 : i;
    else if (ch === ';' || ch === '&') return -1;
  }
  return -1;
}

/**
 * Is the text after a pipe a run of value-preserving filters followed by the stage that holds the CLI (a wrapper such as
 * `sudo`, `env A=1`, `time`, `sh -c "`)? A stage that chains another command (`;`, `&&`, `||`) is not.
 */
function pipeTailReachesCli(tail) {
  const stages = tail.split('|');
  const last = stages.pop();
  return stages.every((stage) => PIPE_FILTER.test(stage.trim())) && /^[^;&<>]{0,200}$/.test(last);
}

/**
 * The body of a heredoc that starts at `from`, up to the line that is its delimiter. Reads at most MULTILINE_MAX_LINES lines /
 * MULTILINE_MAX_CHARS characters (and the file's multi-line budget). `closed` is false when the delimiter is not found within
 * those bounds: the body cannot be verified, so the caller fails closed. `end` is the index where the read stopped.
 * @returns {{lines: string[], end: number, closed: boolean}}
 */
function heredocBody(ctx, input, from, word) {
  if (budgetSpent(ctx)) return { lines: [], end: from, closed: false }; // nothing left to read with: unverified
  const lines = [];
  let at = from;
  let closed = false;
  let end = from;
  for (let n = 0; n < MULTILINE_MAX_LINES && at <= input.length && at - from <= MULTILINE_MAX_CHARS; n += 1) {
    const lineEnd = input.indexOf('\n', at);
    const stop = lineEnd === -1 ? input.length : lineEnd;
    const line = input.slice(at, Math.min(stop, at + 4096)).replace(/\r$/, '');
    end = stop;
    if (line.trim() === word) {
      closed = true;
      break;
    }
    lines.push(line);
    if (lineEnd === -1) break;
    at = lineEnd + 1;
  }
  if (!spendMultiline(ctx, end - from)) closed = false;
  return { lines, end, closed };
}

/**
 * The values a CLI match receives on standard input, from the same command line: `echo V | cli`, `printf '%s' V | cli`
 * (also mid-line after any `;`, `&&`, `||`, `|`, `(`, `then`, `do`, `sudo`, `env A=1`, a `bash -c "` quote or a YAML `run:`;
 * the source only has to be the word `echo`/`printf` before the pipe, so indentation, tabs, CRLF and list prefixes do not
 * matter), through value-preserving filters (`| tr -d '\n' |`), across a `\` or `|` line continuation, and heredocs
 * (`cat <<EOF | cli`, `cli <<EOF`, the body being the value). A heredoc body is judged as a whole value, like a quoted one (its
 * lines and all of them joined), so a passphrase is found as well as a single token. `unterminated`: a heredoc whose delimiter is
 * not found within the bounds cannot be verified. `end`: where the last heredoc body read stops (0 when there is none).
 * @returns {{values: string[], end: number, unterminated: boolean}}
 */
function stdinValues(m, ctx) {
  const input = m.input;
  const lineStart = ctx.lineStart(m.index);
  let before = input.slice(Math.max(lineStart, m.index - 400), m.index);
  // The source can sit on the previous line(s) of a continuation: `echo V | \` / `echo V |` newline `cli`.
  for (let hops = 0, start = lineStart; hops < 3 && start > 0 && !before.includes('|'); hops += 1) {
    const prevEnd = start - 1;
    const prevStart = input.lastIndexOf('\n', prevEnd - 1) + 1;
    const previous = input.slice(Math.max(prevStart, prevEnd - 400), prevEnd).replace(/\r$/, '');
    if (!/(?:\\|\|)[ \t]*$/.test(previous)) break;
    before = `${previous.replace(/\\[ \t]*$/, '')} ${before}`;
    start = prevStart;
  }
  const values = [];
  const heredoc = { end: 0, unterminated: false };
  const bodyStart = ctx.lineEnd(m.index) + 1;
  const readHeredoc = (word) => {
    const body = heredocBody(ctx, input, bodyStart, word);
    heredoc.end = Math.max(heredoc.end, body.end);
    if (!body.closed) heredoc.unterminated = true;
    values.push(...bodyValues(body.lines.join('\n')));
  };
  // echo / printf: the last usable source before the pipe.
  const sources = [...before.matchAll(/(?<![A-Za-z0-9_$.-])(echo|printf)(?![A-Za-z0-9_-])/g)];
  for (let k = sources.length - 1; k >= 0 && k >= sources.length - 4 && values.length === 0; k -= 1) {
    const rest = before.slice(sources[k].index + sources[k][0].length);
    const pipe = firstPipe(rest);
    if (pipe === -1 || !pipeTailReachesCli(rest.slice(pipe + 1))) continue;
    const words = shellWords(rest.slice(0, pipe));
    while (words.length > 0 && /^(?:-[A-Za-z]+|--)$/.test(words[0])) words.shift();
    if (words.length === 0) continue;
    if (sources[k][1] === 'echo') values.push(words.join(' '));
    else if (/%[-+ #0-9.]*[sbqdi]/.test(words[0])) values.push(...words.slice(1)); // printf FORMAT ARGS: the arguments
    else values.push(words[0].replace(/(?:\\[nr])+$/, '')); // printf 'V\n'
  }
  // Heredocs: the body starts on the line after the one holding the CLI.
  const opener = /(?<!<)<<(-?)[ \t]*(["']?)([A-Za-z_][A-Za-z0-9_]*)\2/g;
  const piped = [...before.matchAll(opener)].pop();
  if (piped !== undefined && /^[ \t]*\|/.test(before.slice(piped.index + piped[0].length))) {
    const tail = before.slice(piped.index + piped[0].length).replace(/^[ \t]*\|/, '');
    if (pipeTailReachesCli(tail)) readHeredoc(piped[3]);
  }
  const attached = new RegExp(opener.source).exec(m[0]);
  if (attached !== null) readHeredoc(attached[3]);
  return { values, end: heredoc.end, unterminated: heredoc.unterminated };
}

// Stands in for the value of a heredoc that could not be read to its end (never a real value: it is compared by identity).
const HEREDOC_UNVERIFIED = ['\0heredoc', 'unverified'].join('');

const CLI_TOOLS = [
  [/^gh[ \t]+(?:secret|variable)[ \t]+set/, {}],
  [/^netlify[ \t]+env:set/, { positionalValue: true }],
  [/^vercel[ \t]+env[ \t]+(?:add|update)/, {}],
  [/^heroku[ \t]+config:set/, {}],
  [/^fly(?:ctl)?[ \t]+secrets[ \t]+set/, {}],
  [/^wrangler[ \t]+secret[ \t]+put/, {}],
  [/^railway[ \t]+variables[ \t]+set/, {}],
  [/^doppler[ \t]+secrets[ \t]+set/, { positionalValue: true }],
  [/^aws[ \t]+ssm[ \t]+put-parameter/, {}],
  [/^aws[ \t]+secretsmanager[ \t]+(?:create-secret|put-secret-value)/, {}],
  [/^firebase[ \t]+functions:secrets:set/, {}],
  [/^az[ \t]+keyvault[ \t]+secret[ \t]+set/, {}],
  [/^kubectl[ \t]+create[ \t]+secret[ \t]+generic/, {}],
  [/^docker[ \t]+secret[ \t]+create/, {}],
  // `pulumi config set [--secret] NAME VALUE`: with --secret the value is a secret whatever the name says.
  [/^pulumi[ \t]+config[ \t]+set(?![A-Za-z-])/, { positionalValue: true, secretFlag: '--secret' }],
  [/^aws[ \t]+configure[ \t]+set/, { positionalValue: true }],
];

/** Secret-name kind, with the extra auth-style names that only mean a credential inside a credential file. */
function nameKindFor(name, ctx) {
  const kind = secretNameKind(name);
  if (kind === 'strong' || !ctx.strict) return kind;
  return CREDENTIAL_FILE_NAMES.has(nameWords(name).join('')) ? 'strong' : kind;
}

/** A value in a native credential file: any non-placeholder of 4+ characters (the file's name already says it is a credential). */
const credentialValueIsSecret = (raw) => {
  const value = stripQuotes(String(raw ?? '').replace(/\r$/, '').trim());
  return value.length >= CREDENTIAL_FILE_MIN_LENGTH && !isPlaceholder(value);
};

// netrc tokens are separated by blanks or line breaks; scripts write them with printf and a literal \n.
const NETRC_SEP = String.raw`(?:[ \t\r\n]|\\[nr]){1,64}`;

/** The anonymous-FTP convention (`password guest@`, `anonymous`): not a secret. */
const isAnonymousFtpValue = (value) => /@$/.test(value) || /^(?:anonymous|guest)$/i.test(value);

/** True when the match sits on a line whose first non-blank character is `#` (a comment in credential files). */
function onCommentLine(m, ctx) {
  const start = ctx.lineStart(m.index);
  return /^[ \t]*#/.test(m.input.slice(start, m.index + 1));
}

// ---------------------------------------------------------------------------
// Command-style assignments: shell syntaxes that set a variable WITHOUT "name=value"
//   fish   set -gx NAME value [value ...]        csh/tcsh  setenv NAME value       Windows  setx NAME value, set "NAME=value"
//   sh     export NAME value                     PowerShell  $env:NAME = 'v', [Environment]::SetEnvironmentVariable('NAME','v'),
//   fish universal variables file   SETUVAR --export NAME:value            Set-Item Env:NAME 'v'
// Judged like every other assignment (same name kinds, placeholder and passphrase logic), in shell-like contexts only:
// shell script and config files, fenced blocks of Markdown, and the distinctive forms (a flagged fish `set`, setenv, setx,
// PowerShell) anywhere, so a script written by heredoc into a YAML step or a Python string is read too.
// ---------------------------------------------------------------------------

const SHELL_SCRIPT_EXTENSIONS = new Set(['.sh', '.bash', '.zsh', '.fish', '.ksh', '.csh', '.tcsh', '.bat', '.cmd', '.ps1', '.psm1', '.nu', '.envrc']);
const SHELL_FENCE_LANGS = /^(?:|sh|bash|zsh|fish|ksh|csh|tcsh|shell|shellscript|shell-session|console|terminal|bat|batch|cmd|powershell|pwsh|ps1|posh|nu|nushell|dockerfile|docker|yaml|yml|env|dotenv|ini|toml|makefile|make|text|txt|plaintext)$/i;
const SHELL_DOTFILE = /^\.(?:bash|zsh|ksh|csh|tcsh)?[a-z_]*(?:rc|profile|login|zshenv|aliases)$/;
const isShellScriptPath = (filePath) => {
  const base = path.posix.basename(filePath.split(path.sep).join('/')).toLowerCase();
  return SHELL_SCRIPT_EXTENSIONS.has(path.posix.extname(base)) || SHELL_DOTFILE.test(base);
};

// What may stand before a command on its line: nothing, a list dash, a run-like YAML key, a prompt, RUN, `@` (batch), an
// opening quote; or a separator / `-c` / then / do when the command follows another one.
const COMMAND_AT_LINE_START = /^[ \t]*(?:[-*][ \t]+)?(?:(?:run|script|command|cmd|entrypoint|shell|args):[ \t]+)?(?:RUN[ \t]+|[$>%][ \t]+|@)?["']?$/i;
const COMMAND_AFTER_SEPARATOR = /(?:[;&|({"'`]|\b(?:then|do|else|and|or|begin)|[ \t]-c|--command)[ \t]*["']?$/;
// `export A B` exports the variables A and B: words shaped like variable names (UPPER_SNAKE or lower_snake) are names, not a value.
const SHELL_VARIABLE_NAME = /^(?:[A-Z_][A-Z0-9_]*|[a-z_][a-z0-9_]*)$/;
const SHELL_REFERENCE = /^(?:\$[A-Za-z_{(@*#?0-9]|%[^%\s]{1,100}%$|![^!\s]{1,100}!$)/;

/** The blank-separated words of the rest of one line, quotes honoured (see the class comment above). At most 32 words, 4096 characters. */
function shellTail(input, start) {
  let end = input.indexOf('\n', start);
  if (end === -1 || end - start > 4096) end = Math.min(input.length, start + 4096);
  const line = input.slice(start, end).replace(/\r$/, '');
  const words = [];
  let text = null;
  let quoted = false;
  let expr = false; // the word holds a command substitution or a group: a reference, not a literal
  let quote = null;
  let openLength = 0;
  let depth = 0;
  let tick = false;
  const push = () => {
    if (text !== null) words.push({ text, quoted, expr: expr || text.includes('$(') });
    text = null;
    quoted = false;
    expr = false;
  };
  let i = 0;
  for (; i < line.length && words.length < 32; i += 1) {
    const ch = line[i];
    if (quote !== null) {
      if (ch === '\\' && quote === '"' && i + 1 < line.length) {
        text += line[i + 1];
        i += 1;
      } else if (ch === quote) quote = null;
      else text += ch;
    } else if (tick) {
      if (ch === '`') tick = false;
      text += ch;
    } else if (depth > 0) {
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      text += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      openLength = (text ?? '').length;
      text ??= '';
      quoted = true;
    } else if (ch === '`') {
      tick = true;
      expr = true;
      text = (text ?? '') + ch;
    } else if (ch === '(') {
      depth = 1;
      expr = true;
      text = (text ?? '') + ch;
    } else if (ch === ' ' || ch === '\t') push();
    else if (ch === ';' || ch === '&' || ch === '|' || ch === '>' || ch === '<' || (ch === '#' && text === null)) break;
    else if (ch === '\\' && i + 1 < line.length) {
      text = (text ?? '') + line[i + 1];
      i += 1;
    } else text = (text ?? '') + ch;
  }
  // A quote that never closes belongs to the string around the command (`fish -c "set -gx NAME 'v'"`): what it opened is dropped.
  if (quote !== null) {
    text = text.slice(0, openLength);
    quoted = false;
    if (text === '') text = null;
  }
  push();
  return words;
}

/** Is any word (or all of them together, as one passphrase) a secret value for a name of this kind? */
function shellWordsAreSecret(kind, words, ctx) {
  const literal = words.filter(
    (w) => !w.expr && !SHELL_REFERENCE.test(w.text) && !/^\(.*\)$/.test(w.text) && !(!w.quoted && (w.text === '=' || /^\/[A-Za-z]$/.test(w.text))),
  );
  const judge = (value, quoted) =>
    isSecretValue({ kind, value, quoted, separator: '=', mode: 'config', minLength: ctx.minStrong, catalog: ctx.catalog });
  if (literal.some((w) => (w.text !== '' || w.quoted) && judge(w.text, w.quoted))) return true;
  // fish: `set -gx NAME correct horse battery staple` is a list, and a passphrase written without quotes.
  return literal.length > 1 && literal.length === words.length && judge(literal.map((w) => w.text).join(' '), true);
}

/** Is the command at `index` in a place a command can start (see COMMAND_AT_LINE_START)? */
function startsCommand(m, ctx) {
  const lineStart = ctx.lineStart(m.index);
  if (m.index - lineStart > 400) return COMMAND_AFTER_SEPARATOR.test(m.input.slice(m.index - 400, m.index));
  const before = m.input.slice(lineStart, m.index);
  return COMMAND_AT_LINE_START.test(before) || COMMAND_AFTER_SEPARATOR.test(before);
}

/**
 * May a command-style assignment at this match be judged? `distinctive` syntax (a fish set with flags, setenv, setx, the
 * PowerShell forms) is judged in every kind of file except plain prose, where only fenced blocks count. The bare
 * `set NAME value` / `export NAME value` also need a shell-like file, a fenced shell block, or a run-like line.
 */
function commandContextOk(m, ctx, distinctive) {
  if (ctx.mode === 'prose') return ctx.fenceLang(m.index) !== undefined && SHELL_FENCE_LANGS.test(ctx.fenceLang(m.index));
  if (!startsCommand(m, ctx)) return false;
  if (distinctive) return true;
  if (isShellScriptPath(ctx.path)) return true;
  const before = m.input.slice(Math.max(ctx.lineStart(m.index), m.index - 400), m.index);
  return /(?:^[ \t]*(?:[-*][ \t]+)?(?:run|script|command|cmd|entrypoint|shell|args):[ \t]+|^[ \t]*RUN[ \t]+|[$>][ \t]+|[;&|({][ \t]*|\b(?:then|do)[ \t]+|[ \t]-c[ \t]+)["']?$/i.test(before);
}

/** The value of a PowerShell string literal starting at `start` ('...' doubles its quote; "..." escapes with a backtick), or null. */
function powershellString(input, start) {
  const quote = input[start];
  if (quote !== "'" && quote !== '"') return null;
  let out = '';
  for (let i = start + 1; i < input.length && i - start < 4098; i += 1) {
    const ch = input[i];
    if (ch === '\n') return null;
    if (ch === quote) {
      if (input[i + 1] === quote) {
        out += quote;
        i += 1;
      } else return { text: out, end: i + 1, expandable: quote === '"' };
    } else if (ch === '`' && quote === '"' && i + 1 < input.length) {
      out += input[i + 1];
      i += 1;
    } else out += ch;
  }
  return null;
}

/** A PowerShell literal is a candidate value unless it is a variable or a sub-expression ("$env:HOME", "$($x.Token)"). */
function powershellValueIsSecret(kind, literal, ctx) {
  if (literal === null || SHELL_REFERENCE.test(literal.text) || literal.text.includes('$(')) return false;
  return isSecretValue({ kind, value: literal.text, quoted: true, separator: '=', mode: 'config', minLength: ctx.minStrong, catalog: ctx.catalog });
}

/** fish `set` flags that read or remove a variable instead of assigning it (-e -q -S -n -h and their long forms). */
function fishFlagsAssign(flags) {
  return !flags.split(/[ \t]+/).some((flag) => (flag.startsWith('--') ? /^--(?:erase|query|show|names|help|list)$/.test(flag) : /^-[A-Za-z]*[eqSnh]/.test(flag)));
}

// ---------------------------------------------------------------------------
// Values that span lines
//   TOML """...""" and '''...''' (also Python, Kotlin, Java text blocks), HCL / Ruby / Perl / PHP heredocs (<<EOF, <<-EOF, <<~EOS,
//   <<"EOF", <<<EOT), PowerShell here-strings (@' ... '@), JS / Go template and raw literals (`...` over several lines),
//   shell / dotenv / YAML quotes that are closed on a later line, backslash continuations (properties files, shell, JSON5),
//   INI continuation lines and YAML plain scalars folded over indented lines.
// The body is judged like a quoted value: each line, and all lines joined by a blank. Every read is bounded (lines, characters,
// and a per-file budget); when a bound is hit before the literal ends, the assignment is reported (fail closed).
// ---------------------------------------------------------------------------

const MULTILINE_MAX_LINES = 200;
const MULTILINE_MAX_CHARS = 32_768;
const MULTILINE_BUDGET_CHARS = 24_000_000; // per file: characters the multi-line readers may look at before the file is reported
const TRIPLE_QUOTE = /[rRbBfFuU]{0,2}("""|''')/y;
const HEREDOC_OPENER = /<<(?:<|[-~])?(["']?)([A-Za-z_][A-Za-z0-9_]{0,63})\1/y;
const HERE_STRING_OPENER = /@(["'])[ \t]*\r?\n/y;

/** The lines of a multi-line literal as candidate values: every non-blank line, trimmed, and all of them joined by a blank. */
function bodyValues(body) {
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
  return lines.length > 1 ? [...lines, lines.join(' ')] : lines;
}

/** Charge `n` characters against the file's multi-line budget. False once it is used up. */
function spendMultiline(ctx, n) {
  ctx.multilineBudget = (ctx.multilineBudget ?? MULTILINE_BUDGET_CHARS) - n;
  return ctx.multilineBudget >= 0;
}

/** The literal does not end within the bounds (or the file's budget is gone: `budget`): it cannot be verified, so it is reported. */
function exhaustedLiteral(ctx, input, from) {
  const budget = !spendMultiline(ctx, MULTILINE_MAX_CHARS);
  return { values: [], end: Math.min(input.length, from + MULTILINE_MAX_CHARS), exhausted: true, budget };
}
const budgetSpent = (ctx) => (ctx.multilineBudget ?? MULTILINE_BUDGET_CHARS) < 0;

/**
 * The verdict for a multi-line read that ran out of a bound: reported at the first such literal of a file, and once the file's
 * whole budget is gone, once (the run fails on one finding; nothing more is read).
 */
function exhaustedVerdict(m, ctx, read) {
  if (!read.budget) return true;
  if (ctx.multilineReported) return false;
  ctx.multilineReported = true;
  attributeToFile(m);
  return true;
}

/**
 * Index of the closing `quote` of a string body that starts at `from`, or -1 when it does not close within the bounds.
 * `escapes`: a backslash makes the next character part of the string (so an escaped quote does not close it).
 * `pair`: a doubled quote is one quote of the content (YAML 'it''s'). `tripled`: the closing delimiter is three quotes.
 * `stop`: do not look at or beyond this index.
 */
function closingQuote(input, from, quote, { escapes, pair = false, tripled = false, stop = input.length }) {
  const limit = Math.min(stop, from + MULTILINE_MAX_CHARS);
  let lines = 0;
  for (let i = from; i < limit; i += 1) {
    const ch = input[i];
    if (ch === '\n') {
      lines += 1;
      if (lines > MULTILINE_MAX_LINES) return -1;
    } else if (ch === '\\' && escapes) i += 1;
    else if (ch === quote) {
      if (tripled) {
        if (input[i + 1] === quote && input[i + 2] === quote) return i;
      } else if (pair && input[i + 1] === quote) i += 1;
      else return i;
    }
  }
  return -1;
}

/** Undo the escapes of a multi-line basic string: a line-ending backslash joins the lines, and \x is x. */
const unescapeMultiline = (text) => text.replace(/\\\r?\n[ \t\r\n]*/g, '').replace(/\\(.)/g, '$1');

/**
 * A literal that starts at `valueStart` and runs over more than one line (or is written in a form the one-line value reader
 * cannot see), or null when the value is an ordinary one-line value.
 * @returns {{values: string[], end: number, exhausted: boolean} | null}
 */
function multilineValue(ctx, input, valueStart) {
  const first = input[valueStart];
  // TOML / Python / Kotlin triple quotes, on one line or several.
  TRIPLE_QUOTE.lastIndex = valueStart;
  const triple = TRIPLE_QUOTE.exec(input);
  if (triple !== null) {
    if (budgetSpent(ctx)) return exhaustedLiteral(ctx, input, valueStart);
    const quote = triple[1];
    const bodyStart = valueStart + triple[0].length;
    const literalToml = quote === "'''" && /\.toml$/i.test(ctx.path);
    const close = closingQuote(input, bodyStart, quote[0], { escapes: !literalToml, tripled: true });
    if (close === -1 || !spendMultiline(ctx, close - bodyStart)) return exhaustedLiteral(ctx, input, bodyStart);
    const raw = input.slice(bodyStart, close).replace(/^\r?\n/, '');
    const isRawString = /[rR]/.test(triple[0].slice(0, -3));
    return { values: bodyValues(quote === '"""' && !isRawString ? unescapeMultiline(raw) : raw), end: close + 2, exhausted: false };
  }
  // Heredocs: HCL <<EOF / <<-EOF, Ruby <<~EOS, Perl <<"EOT", PHP <<<EOT. The body starts on the line after the opener.
  if (first === '<') {
    HEREDOC_OPENER.lastIndex = valueStart;
    const opener = HEREDOC_OPENER.exec(input);
    if (opener !== null) {
      const lineEnd = input.indexOf('\n', valueStart + opener[0].length);
      if (lineEnd === -1) return null;
      if (budgetSpent(ctx)) return exhaustedLiteral(ctx, input, valueStart);
      const indented = /^<<(?:<|[-~])/.test(opener[0]);
      const tag = opener[2];
      const body = [];
      let at = lineEnd + 1;
      for (let n = 0; n < MULTILINE_MAX_LINES && at <= input.length; n += 1) {
        let next = input.indexOf('\n', at);
        if (next === -1) next = input.length;
        const line = input.slice(at, next).replace(/\r$/, '');
        const head = indented ? line.trimStart() : line;
        if (head.startsWith(tag) && /^[ \t;,)]*$/.test(head.slice(tag.length))) {
          if (!spendMultiline(ctx, next - lineEnd)) return exhaustedLiteral(ctx, input, lineEnd);
          return { values: bodyValues(body.join('\n')), end: next, exhausted: false };
        }
        body.push(line);
        if (next >= input.length || next - lineEnd > MULTILINE_MAX_CHARS) break;
        at = next + 1;
      }
      return exhaustedLiteral(ctx, input, lineEnd);
    }
  }
  // PowerShell here-string: @' ... '@ and @" ... "@ (the closing mark starts a line).
  if (first === '@') {
    HERE_STRING_OPENER.lastIndex = valueStart;
    const opener = HERE_STRING_OPENER.exec(input);
    if (opener !== null) {
      if (budgetSpent(ctx)) return exhaustedLiteral(ctx, input, valueStart);
      const bodyStart = valueStart + opener[0].length;
      const window = input.slice(bodyStart, bodyStart + MULTILINE_MAX_CHARS);
      const found = new RegExp(String.raw`^${opener[1]}@`, 'm').exec(window);
      if (found === null || !spendMultiline(ctx, found.index)) return exhaustedLiteral(ctx, input, bodyStart);
      return { values: bodyValues(window.slice(0, found.index)), end: bodyStart + found.index + 1, exhausted: false };
    }
  }
  // A template / raw literal over several lines: JS `...`, Go `...`. (One line is read as an ordinary quoted value.)
  if (first === '`' && ctx.mode === 'code') {
    if (budgetSpent(ctx)) return exhaustedLiteral(ctx, input, valueStart);
    const close = closingQuote(input, valueStart + 1, '`', { escapes: true });
    if (close === -1) return exhaustedLiteral(ctx, input, valueStart);
    const body = input.slice(valueStart + 1, close);
    if (!body.includes('\n')) return null;
    if (!spendMultiline(ctx, body.length)) return exhaustedLiteral(ctx, input, valueStart);
    return { values: bodyValues(body.replace(/\\\r?\n[ \t]*/g, '')).filter((line) => !line.includes('${')), end: close, exhausted: false };
  }
  // A quote that is not closed on its line: shell NAME='a<newline>b', dotenv and YAML flow scalars over several lines.
  if ((first === '"' || first === "'") && ctx.mode === 'config') {
    const lineEnd = ctx.lineEnd(valueStart);
    const sameLine = closingQuote(input, valueStart + 1, first, { escapes: first === '"', pair: first === "'", stop: lineEnd });
    if (sameLine !== -1) return null;
    if (budgetSpent(ctx)) return exhaustedLiteral(ctx, input, valueStart);
    const close = closingQuote(input, valueStart + 1, first, { escapes: first === '"', pair: first === "'" });
    if (close === -1 || !spendMultiline(ctx, close - valueStart)) return exhaustedLiteral(ctx, input, valueStart);
    const body = input.slice(valueStart + 1, close);
    return { values: bodyValues(first === '"' ? unescapeMultiline(body) : body.replace(/''/g, "'")), end: close, exhausted: false };
  }
  return null;
}

const ENDS_IN_BACKSLASH = /(?:^|[^\\])(?:\\\\)*\\$/;

/**
 * The lines that continue an unquoted value of a configuration file after its first line:
 *  - a trailing backslash (properties files, shell scripts): the next line follows without a break;
 *  - an INI value (configparser) or a YAML plain scalar folded over indented lines: the following lines indented deeper than the key.
 * @returns {{values: string[], end: number, exhausted: boolean} | null}
 */
function continuedValue(ctx, input, matchIndex, valueStart) {
  const lineEnd = ctx.lineEnd(valueStart);
  const first = input.slice(valueStart, Math.min(lineEnd, valueStart + 4096)).replace(/\r$/, '');
  const pieces = [];
  let end = lineEnd;
  if (ENDS_IN_BACKSLASH.test(first)) {
    if (budgetSpent(ctx)) return exhaustedLiteral(ctx, input, valueStart);
    pieces.push(first.slice(0, -1));
    let at = lineEnd + 1;
    let closed = false;
    for (let n = 0; n < MULTILINE_MAX_LINES && at <= input.length; n += 1) {
      let next = input.indexOf('\n', at);
      if (next === -1) next = input.length;
      const line = input.slice(at, Math.min(next, at + 4096)).replace(/\r$/, '');
      end = next;
      const more = ENDS_IN_BACKSLASH.test(line);
      pieces.push((more ? line.slice(0, -1) : line).trimStart());
      if (!more || next >= input.length) {
        closed = true;
        break;
      }
      at = next + 1;
    }
    if (!closed) return exhaustedLiteral(ctx, input, valueStart);
    if (!spendMultiline(ctx, end - valueStart)) return exhaustedLiteral(ctx, input, valueStart);
    return { values: [pieces.join(''), ...pieces.map((piece) => piece.trim()).filter((piece) => piece !== '')], end, exhausted: false };
  }
  if (!/\.(?:ini|cfg|conf|ya?ml)$/i.test(ctx.path)) return null;
  if (budgetSpent(ctx)) return exhaustedLiteral(ctx, input, valueStart);
  const yaml = /\.ya?ml$/i.test(ctx.path);
  const lineStart = ctx.lineStart(matchIndex);
  const keyIndent = /^[ \t]*/.exec(input.slice(lineStart, matchIndex + 1))[0].length;
  let at = lineEnd + 1;
  for (let n = 0; n < 20 && at <= input.length; n += 1) {
    let next = input.indexOf('\n', at);
    if (next === -1) next = input.length;
    const line = input.slice(at, Math.min(next, at + 4096)).replace(/\r$/, '');
    if (line.trim() === '' || /^[ \t]*[#;]/.test(line) || /^[ \t]*/.exec(line)[0].length <= keyIndent) break;
    if (yaml && /^[ \t]*(?:[^\s#][^:]*:(?:[ \t]|$)|-[ \t])/.test(line)) break; // a mapping entry or a list item, not a folded scalar
    pieces.push(line.trim());
    end = next;
    if (next >= input.length) break;
    at = next + 1;
  }
  if (pieces.length === 0) return null;
  if (!spendMultiline(ctx, end - valueStart)) return exhaustedLiteral(ctx, input, valueStart);
  return { values: [`${first.trim()} ${pieces.join(' ')}`.trim(), ...pieces], end, exhausted: false };
}

const hasFormat = (tag) => (ctx) => ctx.formats.has(tag);

/** Any secret-like environment variable name, strong or weak. */
const isSecretLikeName = (name) => secretNameKind(name) !== null;

// ---------------------------------------------------------------------------
// The `name <operator> value` shape of secret-assignment
// ---------------------------------------------------------------------------

// What may sit between a name and its assignment operator, by language:
//   a type annotation:  `: string`, `: &str`, `: &'static str`, `: []const u8`, `: String?` (TypeScript, Rust, Zig, Kotlin, Swift, Scala)
//   a type word alone:  `NAME string = ...` (Go var / const), `NAME char = ...`
//   a marker:           Nim `NAME* =`, TypeScript `name?: T =` / `name!: T =`, C `NAME[] =`, Lua `NAME <const> =`
// Every part is bounded, starts with a character the previous part cannot end in, and is optional as a whole.
const ASSIGN_TYPE_COLON = String.raw`:[ \t]*(?:&(?:'[A-Za-z_]{1,16}[ \t]{1,4}|mut[ \t]{1,4})?|\*(?:const[ \t]{1,4}|mut[ \t]{1,4})?|\[\d{0,4}\](?:const[ \t]{1,4})?)?[A-Za-z_][A-Za-z0-9_<>[\]|.?!&*]{0,40}(?!:\/\/)`;
const ASSIGN_TYPE_WORD = String.raw`[ \t]{1,4}(?:\*|\[\d{0,4}\])?(?:string|String|str|byte|bytes|char|text|any|auto|dynamic|object|Object)(?![A-Za-z0-9_])`;
const ASSIGN_MARKER = String.raw`(?:\*|[?!](?=[ \t]*:)|\[[A-Za-z0-9_]{0,20}\]|[ \t]*<(?:const|close)>)`;
// Every assignment operator that carries a value: = := ::= ?= += -= .= *= **= |= &= ^= %= ||= &&= ??= => and the arrows <- <<- -> (R, Scala) and the
// infix `to` (Kotlin `"NAME" to "value"`). An arrow or `to` counts only in front of a quote, so `a->b`, `x<-1` and prose stay out.
const ASSIGN_OPERATOR = String.raw`(\|\|=|&&=|\?\?=|\*\*=|:{1,3}=|\?=|[-+.*|&^%]=|=>|<{1,2}-(?=[ \t]*["'\x60])|->(?=[ \t]*["'\x60])|(?<=["'\x60][ \t]{1,8})to(?=[ \t]{1,8}["'\x60])|=|:(?!:))`;
const ASSIGNMENT_PATTERN = new RegExp(
  String.raw`(?<![A-Za-z0-9_$.-])(?<!\$\{|:\/\/)(["'\x60]?)([A-Za-z_$][A-Za-z0-9_$.-]{0,1023})\1(?:(?<=["'\x60])[ \t]*\])?${ASSIGN_MARKER}?(?:[ \t]*${ASSIGN_TYPE_COLON}|${ASSIGN_TYPE_WORD}(?=[ \t]*=(?!=)))?[ \t]*${ASSIGN_OPERATOR}[ \t]*(?=\S)`,
  'g',
);

// ---------------------------------------------------------------------------
// SQL statements that set a password to a literal
// ---------------------------------------------------------------------------

// Every literal form a SQL dialect accepts for a password: 'single' (also N'national', U&'unicode'), E'escape', "double"
// (Oracle), `backtick` (MySQL / MariaDB) and $$dollar$$ / $tag$dollar$tag$ (PostgreSQL). Each alternative is a named group; every
// character has exactly one reading (a doubled quote is the escape), so a match is linear in the literal.
const SQL_QUOTED = String.raw`(?:(?:[Nn]|[Uu]&)?'(?<sq>(?:[^'\n]|''){1,4096})'|[Ee]'(?<esc>(?:[^'\\\n]|''|\\.){1,4096})'|"(?<dq>(?:[^"\n]|""){1,4096})"|\x60(?<bt>(?:[^\x60\n]|\x60\x60){1,4096})\x60|\$(?<tag>[A-Za-z_][A-Za-z0-9_]{0,32})?\$(?<dl>(?:(?!\$\k<tag>\$)[^\n]){1,4096}?)\$\k<tag>\$)`;
// Oracle also takes the password as a bare identifier: IDENTIFIED BY hunter2 (only read inside a CREATE / ALTER / GRANT statement).
const SQL_BARE = String.raw`(?<id>[A-Za-z][A-Za-z0-9_#$]{0,127})`;
// Words that follow IDENTIFIED BY and are syntax, not a password.
const SQL_SYNTAX_WORDS = new Set(['values', 'password', 'random', 'externally', 'globally', 'replace', 'default', 'null', 'using', 'with']);
// Bind parameters and substitution variables: ?, $1, :name, :1, @name, %s, %(name)s, %L, {0}, {name}, &pw (SQL*Plus).
const SQL_PARAMETER =
  /^(?:\?|\$\d{1,3}|:[A-Za-z_][A-Za-z0-9_]{0,63}|:\d{1,3}|@[A-Za-z_][A-Za-z0-9_]{0,63}|%(?:\([A-Za-z_][A-Za-z0-9_]{0,63}\))?[sdLI]|\{\d{0,3}\}|\{[A-Za-z_][A-Za-z0-9_.]{0,63}\}|&&?[A-Za-z_][A-Za-z0-9_]{0,63}\.?)$/;

/** The password literal of a SQL match, unquoted (doubled quotes undone), or undefined. */
function sqlLiteral(groups) {
  if (groups.sq !== undefined) return groups.sq.replace(/''/g, "'");
  if (groups.esc !== undefined) return groups.esc.replace(/''/g, "'").replace(/\\(.)/g, '$1');
  if (groups.dq !== undefined) return groups.dq.replace(/""/g, '"');
  if (groups.bt !== undefined) return groups.bt.replace(/\x60\x60/g, '\x60');
  return groups.dl ?? groups.id;
}

const isSqlPath = (ctx) => /\.(?:sql|psql|pgsql|mysql|ddl)$/i.test(ctx.path);

/** The statement text before the match (back to the previous `;`, at most 400 characters). */
function sqlStatementBefore(m) {
  const before = m.input.slice(Math.max(0, m.index - 400), m.index);
  return before.slice(before.lastIndexOf(';') + 1);
}

const sqlValueIsSecret = (value) => value !== undefined && !placeholderOf(value) && !SQL_PARAMETER.test(value.trim());

const SQL_RULE = {
  id: 'sql-password-literal',
  description:
    "SQL statement that sets a role or user password to a literal (ALTER ROLE ... PASSWORD '...', CREATE USER ... IDENTIFIED BY \"...\", MongoDB createUser({pwd: \"...\"}))",
  matchers: [
    {
      // Oracle / MySQL / MariaDB: IDENTIFIED BY '<pw>' / "<pw>" / <pw>, IDENTIFIED WITH plugin BY '<pw>' | AS '<hash>', IDENTIFIED BY PASSWORD '<hash>',
      // IDENTIFIED VIA plugin USING PASSWORD('<pw>'); also in GRANT ... IDENTIFIED BY. A hash is judged like any other literal.
      hint: /identified/i,
      pattern: new RegExp(
        String.raw`\bidentified[ \t]+(?:(?:with|via)[ \t]+[A-Za-z_][A-Za-z0-9_]{0,63}[ \t]+(?:by|as|using)|by)[ \t]+(?:(?:values|password)[ \t]*(?:\([ \t]*)?)?(?:${SQL_QUOTED}|${SQL_BARE})`,
        'gi',
      ),
      accept: (m, ctx) => {
        if (m.groups.id !== undefined) {
          // A bare word is a password only in a statement (a .sql file, or CREATE / ALTER / GRANT before it), never in prose.
          const id = m.groups.id.toLowerCase();
          if (SQL_SYNTAX_WORDS.has(id) || !(isSqlPath(ctx) || /\b(?:create|alter|grant)\b/i.test(sqlStatementBefore(m)))) return false;
        }
        return sqlValueIsSecret(sqlLiteral(m.groups));
      },
    },
    {
      // PostgreSQL / SQL Server / Snowflake / MySQL: [CREATE|ALTER USER|ROLE|LOGIN ...] [WITH] [ENCRYPTED] PASSWORD [=] '<pw>',
      // SET PASSWORD [FOR user] = '<pw>' | PASSWORD('<pw>'), OLD_PASSWORD = '<pw>'. A bare `password '...'` is only SQL in a .sql file.
      hint: /password/i,
      pattern: new RegExp(
        String.raw`\b(?<pre>(?:alter|create)[ \t]+(?:user|role|login|group|server)\b[^;'\n]{0,160}?\b|with[ \t]+(?:(?:encrypted|unencrypted)[ \t]+)?|login[ \t]+(?:(?:encrypted|unencrypted)[ \t]+)?|(?:encrypted|unencrypted)[ \t]+|old_|set[ \t]+)?password(?![A-Za-z0-9_])(?:[ \t]+(?<for>for[ \t]+[^=;\s][^=;\n]{0,119})=[ \t]*|[ \t]*(?<eq>=[ \t]*)?(?<=[ \t=]))(?:(?:old_)?password[ \t]*\([ \t]*)?${SQL_QUOTED}`,
        'gi',
      ),
      accept: (m, ctx) => {
        const pre = m.groups.pre ?? '';
        const qualified = /^(?:alter|create|with|login)\b/i.test(pre) || (/^set\b/i.test(pre) && (m.groups.for !== undefined || m.groups.eq !== undefined));
        if (!qualified && !isSqlPath(ctx)) return false;
        return sqlValueIsSecret(sqlLiteral(m.groups));
      },
    },
    {
      // MySQL / MariaDB: UPDATE mysql.user SET authentication_string = PASSWORD('<pw>'), ... USING PASSWORD('<pw>').
      hint: /password[ \t]*\(/i,
      pattern: new RegExp(String.raw`(?<![A-Za-z0-9_])(?:old_)?password[ \t]*\([ \t]*${SQL_QUOTED}`, 'gi'),
      accept: (m, ctx) => {
        const before = m.input.slice(Math.max(0, m.index - 16), m.index);
        if (!isSqlPath(ctx) && !/(?:=|\b(?:using|by|as))[ \t]*$/i.test(before)) return false;
        return sqlValueIsSecret(sqlLiteral(m.groups));
      },
    },
    {
      // Oracle / MySQL: IDENTIFIED BY '<new>' REPLACE '<old>' (the old password is a password too).
      hint: /replace/i,
      pattern: new RegExp(String.raw`\breplace[ \t]+(?:${SQL_QUOTED}|${SQL_BARE})`, 'gi'),
      accept: (m) => {
        if (!/\bidentified\b/i.test(sqlStatementBefore(m))) return false;
        if (m.groups.id !== undefined && SQL_SYNTAX_WORDS.has(m.groups.id.toLowerCase())) return false;
        return sqlValueIsSecret(sqlLiteral(m.groups));
      },
    },
    {
      // MongoDB: db.createUser({user: "a", pwd: "<pw>", roles: [...]}), db.updateUser("a", {pwd: "<pw>"}); the key is `pwd`.
      hint: /pwd/i,
      pattern: new RegExp(String.raw`(?<![A-Za-z0-9_$.-])["']?pwd["']?[ \t]*:[ \t]*${SQL_QUOTED}`, 'gi'),
      accept: (m, ctx) => {
        const near = ['createUser', 'updateUser', 'changeUserPassword', 'addUser'].some((call) => ctx.hasBefore(call, m.index, 2000));
        return near && sqlValueIsSecret(sqlLiteral(m.groups));
      },
    },
    {
      // MongoDB legacy helpers: db.changeUserPassword("user", "<pw>"), db.addUser("user", "<pw>"), db.auth("user", "<pw>").
      hint: /changeUserPassword|addUser|\.auth\(/,
      pattern: new RegExp(String.raw`\b(?:changeUserPassword|addUser|db\.auth)[ \t]*\([ \t]*(?:"[^"\n]{1,200}"|'[^'\n]{1,200}')[ \t]*,[ \t]*${SQL_QUOTED}`, 'g'),
      accept: (m) => sqlValueIsSecret(sqlLiteral(m.groups)),
    },
  ],
};

/**
 * Each rule: id, description, matchers[{ pattern (global regex), accept(match, ctx), optional appliesTo(ctx) and hint }],
 * optional appliesTo(ctx) and hint (a cheap regex the file must match before the rule runs).
 * ctx is { path, mode, formats, strict, minStrong }. accept() returns false for placeholders and other non-secrets.
 * Every quantifier that can meet attacker-shaped text is bounded, so scan time stays linear.
 */

// Provider-specific token shapes. Each is recognised by its fixed prefix and length wherever it appears (any file, any
// name), so a token under a non-secret name or in prose is found. Boundaries use lookbehind and a class that cannot
// overlap the prefix, so each match attempt is bounded and the scan stays linear. `lockfile: true`: these also run on
// lockfiles. A value that is a documentation placeholder (xxxx, your_..., <...>) passes.
// Long token bodies are judged by their head and tail (a placeholder marker is at the ends), so the cost of the placeholder
// check does not grow with an attacker-sized match.
const placeholderOf = (text) => isPlaceholder(text.length > 512 ? text.slice(0, 256) + text.slice(-256) : text);
const notPlaceholder = (m) => !placeholderOf(m[0]);
const mixedCase = (text) => /[A-Z]/.test(text) && /[a-z]/.test(text);
// A run of one or two repeated characters (000000...) is a placeholder, not a hex token.
const varied = (text) => new Set(text).size >= 8;
const hasDigitAndLetter = (text) => /\d/.test(text) && /[A-Za-z]/.test(text);
const tokenRule = (id, description, hint, patterns, accept = notPlaceholder) => ({
  id,
  description,
  lockfile: true,
  hint,
  matchers: (Array.isArray(patterns) ? patterns : [patterns]).map((pattern) => ({ pattern, accept })),
});
const PROVIDER_RULES = [
  tokenRule(
    'gitlab-token',
    'GitLab personal, deploy, runner, trigger, feed or agent token (glpat-, gldt-, glrt-, ...)',
    /gl[a-z]{2,6}-/,
    /(?<![A-Za-z0-9_-])(?:glpat|gldt|glrt|glptt|glft|glimt|glagent|glcbt|glsoat|gloas|glffct)-[A-Za-z0-9_.-]{20,}/g,
  ),
  tokenRule('npm-token', 'npm access token (npm_ prefix)', /npm_/, /(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{36}(?![A-Za-z0-9_])/g, (m) => !placeholderOf(m[0]) && hasDigitAndLetter(m[0].slice(4))),
  tokenRule('pypi-token', 'PyPI API token (pypi- prefix)', /pypi-/, /(?<![A-Za-z0-9_-])pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}/g),
  tokenRule('stripe-webhook-secret', 'Stripe webhook signing secret (whsec_ prefix)', /whsec_/, /(?<![A-Za-z0-9_])whsec_[A-Za-z0-9+/=]{24,}/g),
  tokenRule('twilio-api-key', 'Twilio API key SID (SK + 32 hex)', /SK[0-9a-f]{32}/, /(?<![A-Za-z0-9])SK[0-9a-f]{32}(?![A-Za-z0-9])/g, (m) => !placeholderOf(m[0]) && varied(m[0])),
  tokenRule(
    'sendgrid-api-key',
    'SendGrid API key (SG. prefix)',
    /SG\./,
    /(?<![A-Za-z0-9_.-])SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g,
    (m) => !placeholderOf(m[0]) && varied(m[0].slice(3)),
  ),
  tokenRule('mailgun-api-key', 'Mailgun private API key (key- + 32 hex)', /key-[0-9a-f]{32}/, /(?<![A-Za-z0-9_-])key-[0-9a-f]{32}(?![A-Za-z0-9_-])/g, (m) => !placeholderOf(m[0]) && varied(m[0])),
  tokenRule(
    'shopify-token',
    'Shopify access token (shpat_, shpca_, shppa_, shpss_)',
    /shp(?:at|ca|pa|ss)_/,
    /(?<![A-Za-z0-9_])shp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}(?![A-Za-z0-9_])/g,
    (m) => !placeholderOf(m[0]) && varied(m[0]),
  ),
  tokenRule(
    'digitalocean-token',
    'DigitalOcean token (dop_v1_, doo_v1_, dor_v1_)',
    /do[opr]_v1_/,
    /(?<![A-Za-z0-9_])do[opr]_v1_[a-f0-9]{64}(?![A-Za-z0-9_])/g,
    (m) => !placeholderOf(m[0]) && varied(m[0]),
  ),
  tokenRule(
    'huggingface-token',
    'Hugging Face access token (hf_ prefix)',
    /hf_|api_org_/,
    /(?<![A-Za-z0-9_])(?:hf|api_org)_[A-Za-z0-9]{30,}(?![A-Za-z0-9_])/g,
    (m) => !placeholderOf(m[0]) && mixedCase(m[0]),
  ),
  tokenRule(
    'openai-api-key',
    'OpenAI API key (project, service-account, admin and legacy keys)',
    /sk-/,
    [
      /(?<![A-Za-z0-9_-])sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{32,}/g,
      /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}(?![A-Za-z0-9_-])/g,
      /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9]{48}(?![A-Za-z0-9_-])/g,
    ],
    (m) => !placeholderOf(m[0]) && (m[0].includes('-proj-') || m[0].includes('-svcacct-') || m[0].includes('-admin-') || (mixedCase(m[0]) && /\d/.test(m[0]))),
  ),
  tokenRule('anthropic-api-key', 'Anthropic API key (sk-ant- prefix)', /sk-ant-/, /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{40,}/g),
  tokenRule(
    'google-oauth-secret',
    'Google OAuth access token (ya29.) or client secret (GOCSPX-)',
    /ya29\.|GOCSPX-/,
    /(?<![A-Za-z0-9_-])(?:ya29\.[A-Za-z0-9_-]{30,}|GOCSPX-[A-Za-z0-9_-]{20,})/g,
  ),
  {
    id: 'azure-storage-key',
    description: 'Azure storage, Service Bus or Event Hubs shared key in a connection string, or a shared-access signature in a SAS URL',
    lockfile: true,
    hint: /AccountKey|SharedAccessKey|PrimaryKey|SecondaryKey|sig=/i,
    matchers: [
      {
        pattern: /(?<![A-Za-z0-9_])(?:AccountKey|SharedAccessKey|PrimaryKey|SecondaryKey)[ \t]*=[ \t]*([A-Za-z0-9+/]{40,}={0,2})(?![A-Za-z0-9+/=])/gi,
        accept: (m) => !placeholderOf(m[1]) && /\d/.test(m[1]) && mixedCase(m[1]),
      },
      {
        // A SAS URL: ...?sv=2022-11-02&ss=b&srt=sco&sp=rwl&se=2030-01-01T00:00:00Z&sig=<base64, URL-encoded>
        pattern: /[?&;]sig=([A-Za-z0-9%+/_-]{40,})/g,
        accept: (m) => {
          const around = m.input.slice(Math.max(0, m.index - 400), m.index + 400);
          return /[?&;](?:sv|se|sp|srt|ss|spr)=/.test(around) && !placeholderOf(m[1]);
        },
      },
    ],
  },
  {
    id: 'heroku-api-key',
    description: 'Heroku authorization token (HRKU- prefix) or HEROKU_API_KEY set to a UUID',
    lockfile: true,
    hint: /HRKU-|HEROKU/i,
    matchers: [
      { pattern: /(?<![A-Za-z0-9_-])HRKU-[A-Za-z0-9_-]{30,}/g, accept: notPlaceholder },
      {
        pattern: /(?<![A-Za-z0-9_])HEROKU[_-]?API[_-]?KEY["']?[ \t]*[:=][ \t]*["']?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-f-])/gi,
        accept: (m) => !placeholderOf(m[1]) && new Set(m[1]).size > 6,
      },
    ],
  },
  {
    id: 'datadog-api-key',
    description: 'Datadog API or application key (32 or 40 hex) set on a Datadog key name',
    lockfile: true,
    hint: /(?:DD|DATADOG)[_-](?:API|APP)/i,
    matchers: [
      {
        pattern: /(?<![A-Za-z0-9_])(?:DD|DATADOG)[_-](?:API|APP|APPLICATION)[_-]KEY["']?[ \t]*[:=][ \t]*["']?([0-9a-f]{40}|[0-9a-f]{32})(?![0-9a-f])/gi,
        accept: (m) => !placeholderOf(m[1]) && new Set(m[1].toLowerCase()).size > 6,
      },
    ],
  },
  {
    id: 'sentry-token',
    description: 'Sentry auth token (sntrys_, sntryu_) or a DSN carrying its secret half (key:secret@)',
    lockfile: true,
    hint: /sntry|sentry/i,
    matchers: [
      { pattern: /(?<![A-Za-z0-9_])sntrys_[A-Za-z0-9+/=_-]{40,}/g, accept: notPlaceholder },
      { pattern: /(?<![A-Za-z0-9_])sntryu_[a-f0-9]{64}(?![A-Za-z0-9_])/g, accept: notPlaceholder },
      {
        // https://<32 hex key>:<32 hex secret>@o123.ingest.sentry.io/456. Only a DSN that still carries the deprecated SECRET
        // half is a credential: the public key of a modern DSN ships in every browser bundle and is safe to expose by design.
        pattern: /(?<![A-Za-z0-9])https?:\/\/[0-9a-f]{32}:([0-9a-f]{32})@[A-Za-z0-9.-]{0,80}sentry[A-Za-z0-9.-]{0,80}\/\d{1,12}/g,
        accept: (m) => !placeholderOf(m[1]) && new Set(m[1]).size > 6,
      },
    ],
  },
  tokenRule(
    'doppler-token',
    'Doppler token (dp.st., dp.pt., dp.ct., dp.sa., ...)',
    /dp\./,
    /(?<![A-Za-z0-9_.])dp\.(?:st|pt|ct|scim|audit|sa)\.(?:[A-Za-z0-9_-]{1,40}\.)?[A-Za-z0-9]{40,}/g,
  ),
  tokenRule(
    'vault-token',
    'HashiCorp Vault token (hvs., hvb., hvr.)',
    /hv[sbr]\./,
    /(?<![A-Za-z0-9_.-])hv[sbr]\.[A-Za-z0-9_-]{24,}/g,
    (m) => !placeholderOf(m[0]) && hasDigitAndLetter(m[0].slice(4)),
  ),
  tokenRule('linear-api-key', 'Linear API key or OAuth token', /lin_/, /(?<![A-Za-z0-9_])lin_(?:api|oauth)_[A-Za-z0-9]{32,}/g),
  tokenRule(
    'notion-token',
    'Notion integration secret (ntn_ or secret_ prefix)',
    /ntn_|secret_/,
    [/(?<![A-Za-z0-9_])ntn_[A-Za-z0-9]{40,}/g, /(?<![A-Za-z0-9_])secret_[A-Za-z0-9]{43}(?![A-Za-z0-9_])/g],
    (m) => !placeholderOf(m[0]) && (m[0].startsWith('ntn_') || (hasDigitAndLetter(m[0].slice(7)) && mixedCase(m[0].slice(7)))),
  ),
  tokenRule(
    'atlassian-token',
    'Atlassian API token (ATATT) or Bitbucket app password (ATBB)',
    /ATATT|ATBB/,
    /(?<![A-Za-z0-9_-])(?:ATATT3[A-Za-z0-9_=-]{50,}|ATBB[A-Za-z0-9_=-]{30,})/g,
  ),
  tokenRule(
    'telegram-bot-token',
    'Telegram bot token (<bot id>:AA + 33 characters)',
    /:AA/,
    /(?<![A-Za-z0-9_:])\d{8,10}:AA[A-Za-z0-9_-]{33}(?![A-Za-z0-9_-])/g,
    (m) => !placeholderOf(m[0]) && varied(m[0].slice(m[0].indexOf(':') + 1)),
  ),
  tokenRule(
    'mapbox-secret-token',
    'Mapbox secret access token (sk.eyJ...)',
    /sk\.eyJ/,
    /(?<![A-Za-z0-9_.-])sk\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])/g,
  ),
  tokenRule(
    'square-token',
    'Square access token or OAuth secret (sq0atp-, sq0csp-)',
    /sq0/,
    [/(?<![A-Za-z0-9_-])sq0atp-[A-Za-z0-9_-]{22}(?![A-Za-z0-9_-])/g, /(?<![A-Za-z0-9_-])sq0csp-[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g],
    (m) => !placeholderOf(m[0]) && varied(m[0].slice(7)),
  ),
  tokenRule(
    'firebase-fcm-server-key',
    'Firebase Cloud Messaging legacy server key (AAAA...:APA91b...)',
    /APA91b/,
    /(?<![A-Za-z0-9_-])AAAA[A-Za-z0-9_-]{7}:APA91b[A-Za-z0-9_-]{100,}/g,
  ),
  tokenRule(
    'newrelic-key',
    'New Relic user API key (NRAK-) or ingest key (NRII-)',
    /NR(?:AK|II)-/,
    [/(?<![A-Za-z0-9_-])NRAK-[A-Z0-9]{27}(?![A-Za-z0-9_-])/g, /(?<![A-Za-z0-9_-])NRII-[A-Za-z0-9_-]{32}(?![A-Za-z0-9_-])/g],
    (m) => !placeholderOf(m[0]) && varied(m[0].slice(5)),
  ),
  tokenRule(
    'cloudflare-token',
    'Cloudflare API token (cfut_, cfat_, cfk_ prefix)',
    /cf(?:ut|at|k)_/,
    /(?<![A-Za-z0-9_])cf(?:ut|at|k)_[A-Za-z0-9]{40,}(?![A-Za-z0-9_])/g,
    (m) => !placeholderOf(m[0]) && varied(m[0].slice(5)),
  ),
  tokenRule(
    'discord-bot-token',
    'Discord bot token (<base64 id>.<timestamp>.<hmac>)',
    /\.[A-Za-z0-9_-]{6}\./,
    /(?<![A-Za-z0-9_.-])[MNO][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,38}(?![A-Za-z0-9_.-])/g,
    (m) => !placeholderOf(m[0]) && mixedCase(m[0]) && /\d/.test(m[0]) && varied(m[0]),
  ),
  tokenRule(
    'other-provider-token',
    'Other provider token (Databricks, Grafana, Supabase, PlanetScale, Docker Hub, RubyGems, Terraform Cloud, age secret key)',
    /dapi|glsa_|sbp_|pscale_|dckr_pat_|rubygems_|atlasv1|AGE-SECRET-KEY/,
    [
      /(?<![A-Za-z0-9_])dapi[a-f0-9]{32}(?:-\d)?(?![A-Za-z0-9_])/g,
      /(?<![A-Za-z0-9_])glsa_[A-Za-z0-9]{32}_[a-f0-9]{8}(?![A-Za-z0-9_])/g,
      /(?<![A-Za-z0-9_])sbp_[a-f0-9]{40}(?![A-Za-z0-9_])/g,
      /(?<![A-Za-z0-9_])pscale_(?:tkn|pw|oauth)_[A-Za-z0-9_.-]{32,}/g,
      /(?<![A-Za-z0-9_])dckr_pat_[A-Za-z0-9_-]{27,}/g,
      /(?<![A-Za-z0-9_])rubygems_[a-f0-9]{48}(?![A-Za-z0-9_])/g,
      /(?<![A-Za-z0-9])[A-Za-z0-9]{14}\.atlasv1\.[A-Za-z0-9_-]{60,}/g,
      /(?<![A-Za-z0-9-])AGE-SECRET-KEY-1[QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L]{58}(?![A-Za-z0-9])/g,
    ],
    (m) => !placeholderOf(m[0]) && varied(m[0]),
  ),
];

// Lockfile fields that can hold a credential. The generic secret-name rules do not run on lockfiles (integrity hashes), so
// this rule looks only at URLs (userinfo token, credential-named query parameter) and at auth-like FIELD names.
const LOCKFILE_URL = /(?<![A-Za-z0-9+.-])[a-z][a-z0-9+.-]{1,30}:\/\/[^\s"'`<>\\]{1,2000}/gi;
const LOCKFILE_AUTH_FIELD =
  /(?<![A-Za-z0-9])(?:_authToken|_auth|_password|npmAuthToken|npmAuthIdent|authToken|auth_token|accessToken|access_token|client_secret|clientSecret|api_key|apiKey|secret_key|secretKey|private_key|privateKey|password|passwd|token|secret)(["']?)[ \t]*[:=][ \t]*(?:"([^"\n]{1,4096})"|'([^'\n]{1,4096})'|([^\s,;{}"']{1,4096}))/g;
// A dependency specifier or version, not a credential. The WHOLE value must have that shape ("^1.2.3", ">=1 <2", "1.x", "*",
// "npm:x@1", "workspace:*", "link:../x", "latest"): a first character that merely looks like one (a digit, x, v) exempts nothing.
const SPEC_VERSION = String.raw`[\^~<>=]{0,2}[ \t]?v?\d{1,8}(?:\.[\dxX*]{1,12}){0,3}(?:-(?:alpha|beta|rc|dev|next|canary|pre|preview|nightly|snapshot|experimental)(?:[.-]?\d{1,4}){0,4})?`;
const LOCKFILE_SPEC_VALUE = new RegExp(
  String.raw`^(?:${SPEC_VERSION}(?:(?:[ \t]*(?:\|\||-|,)[ \t]*|[ \t]+)${SPEC_VERSION}){0,4}|[\^~<>=]{0,2}[ \t]?[xX*]|(?:\.{1,2}|~)?(?:\/[A-Za-z0-9._@-]{1,64}){1,12}\/?|\.{1,2}|(?:npm|file|link|workspace|git|github|gitlab|bitbucket|patch|portal|catalog|resolution):[^\s]{0,256}|(?:latest|next|beta|alpha|canary|rc|true|false|null|none|undefined))$`,
);
// A bare "key" is not listed: cache-key, sort-key and the like are identifiers; only credential-qualified keys are.
const LOCKFILE_CREDENTIAL_PARAM = /(?:sig|signature|token|secret|(?:api|access|secret|private|auth|signing)[-_.]?key|password|passwd|pwd|auth|authorization|jwt|bearer|sas)$/i;

/** Does a URL in a lockfile carry a credential of its own: a token as the user name, or a credential-named query parameter? */
function lockfileUrlCarriesCredential(url) {
  const rest = url.replace(URL_PREFIX, '');
  const authorityEnd = rest.search(/[/?#]/);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  const at = authority.lastIndexOf('@');
  if (at > 0) {
    const user = authority.slice(0, authority.indexOf(':') === -1 || authority.indexOf(':') > at ? at : authority.indexOf(':'));
    // ssh://git@host, https://user@host and token-style names are ordinary; a long random user name is a token.
    if (user.length >= 16 && !isTemplateSegment(user) && !isWordIdentifier(user) && looksRandom(user, { minLength: 16, minEntropy: 3.2 })) return true;
  }
  if (authorityEnd === -1) return false;
  const afterAuthority = rest.slice(authorityEnd);
  const queryAt = afterAuthority.indexOf('?');
  if (queryAt === -1) return false;
  const hashAt = afterAuthority.indexOf('#', queryAt);
  const query = afterAuthority.slice(queryAt + 1, hashAt === -1 ? undefined : hashAt);
  for (const pair of query.split(/[&;]/)) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = safeDecode(pair.slice(0, eq));
    const value = safeDecode(pair.slice(eq + 1));
    if (LOCKFILE_CREDENTIAL_PARAM.test(name) && value.length >= 8 && !isTemplateSegment(value) && !isWordIdentifier(value)) return true;
  }
  return false;
}

const LOCKFILE_RULE = {
  id: 'lockfile-credential',
  description:
    'credential inside a lockfile: a token or password in a dependency URL (resolved, tarball, url, source, registry) or an auth field such as _authToken, _auth, _password',
  lockfile: true,
  appliesTo: (ctx) => ctx.lockfile,
  matchers: [
    // A YAML flow mapping or a JSON array can end right after the URL: {tarball: https://h/x?sig=V} is the URL without the brace.
    { pattern: LOCKFILE_URL, accept: (m) => lockfileUrlCarriesCredential(m[0].replace(/[)}\],;]+$/, '')) },
    {
      pattern: LOCKFILE_AUTH_FIELD,
      accept: (m, ctx) => {
        // The name must be a whole key: a word before it on the line makes it prose ("CSRF token: generation and ...").
        const before = m.input.slice(ctx.lineStart(m.index), m.index).trimEnd();
        if (/[A-Za-z0-9]$/.test(before)) return false;
        // Free-text package metadata (composer.lock, poetry.lock) is not an auth field.
        if (/^[ \t]*["']?(?:description|summary|homepage|title|readme|keywords|notes?)["']?[ \t]*[:=]/i.test(before)) return false;
        const value = (m[2] ?? m[3] ?? m[4]).trim();
        if (value.length < 4 || LOCKFILE_SPEC_VALUE.test(value) || URL_PREFIX.test(value)) return false; // a URL value is judged by the URL matcher
        return !isPlaceholder(value);
      },
    },
  ],
};

// The attribute that names an entry: <entry key="secret">V</entry>, <item name="password">V</item>.
const XML_NAME_ATTRIBUTE = /(?:^|[ \t\r\n])(?:name|key)[ \t]*=[ \t]*(?:"([^"]{1,200})"|'([^']{1,200})')/i;
// A file-system path (/path/to/private/key, ./certs/key.pem, ~/.ssh/id_rsa): a key FILE element holds this, not a key.
const PATH_VALUE = /^(?:\.{1,2}|~)?(?:\/[A-Za-z0-9._@-]{1,64}){2,12}\/?$/;
// Example values Maven's reference settings.xml documents; they are sample text, not credentials.
// (The passphrase hint is exact text: a sentence is not exempt by its punctuation, only this whole value is.)
const XML_EXAMPLE_VALUES = new Set(['proxypass', 'optional; leave empty if not used.']);

/** Is the text of this XML element (name, start-tag attributes, text) a secret? See the element matchers in RULES. */
function xmlElementIsSecret(qualifiedName, attributes, text, ctx) {
  const name = qualifiedName.slice(qualifiedName.lastIndexOf(':') + 1);
  let kind = nameKindFor(name, ctx);
  if (kind === null) {
    const attribute = XML_NAME_ATTRIBUTE.exec(attributes);
    if (attribute !== null) kind = nameKindFor(attribute[1] ?? attribute[2], ctx);
  }
  if (kind === null) return false;
  const value = text.trim();
  if (value === '') return false;
  // A Maven-encrypted password ({base64}) is not a plaintext credential: it is unreadable without the master key.
  if (/^\{[A-Za-z0-9+/=]{20,}\}$/.test(value)) return false;
  if (PATH_VALUE.test(value) || XML_EXAMPLE_VALUES.has(value.toLowerCase())) return false;
  // Text about the credential ("the password you chose during setup.") is exempt through the same documentation-cue rule
  // as every other format; punctuation alone never is, or a passphrase ending in "!" would slip through.
  return isSecretValue({ kind, value, quoted: true, separator: ':', mode: ctx.mode, minLength: ctx.minStrong, catalog: ctx.catalog });
}

/** A multi-line value that is an ansible-vault ciphertext ($ANSIBLE_VAULT;1.1;AES256 and its hex lines): encrypted, so not a credential. */
const isVaultBody = (values) => values.length > 0 && /^\$ANSIBLE_VAULT[;\s]/.test(values[0]);

const SECRET_ASSIGNMENT_MATCHER = {
  // group 2 = name, 3 = separator. The VALUE is deliberately not part of the match: it is read in accept()
  // (VALUE_AT) and only for a secret-like name. A rejected match therefore consumes nothing but `name =`, and
  // matching resumes right after it, so `cfg['a']={"K":"v"}`, `x=1;K='v'` and minified JSON are still examined.
  // Not a name: "${NAME:-x}" (an expansion, judged by its outer assignment) or "://NAME:x@" (a URL, judged by url-password).
  pattern: ASSIGNMENT_PATTERN,
  accept: (m, ctx) => {
    const kind = nameKindFor(m[2], ctx);
    if (!kind) return false;
    const input = m.input;
    let valueStart = m.index + m[0].length;
    if (ctx.mode !== 'code' && m[3] === ':') {
      // A YAML tag or anchor before the scalar (`!!str V`, `&anchor V`, `!vault V`) is not part of the value.
      YAML_NODE_PROPERTIES.lastIndex = valueStart;
      const properties = YAML_NODE_PROPERTIES.exec(input);
      if (properties) {
        // `!vault |` marks an ansible-vault ciphertext: encrypted, not a plaintext credential.
        if (/(?:^|[ \t])!vault[ \t]/.test(properties[0])) return false;
        valueStart += properties[0].length;
      }
    }
    // A literal over several lines (heredoc, triple quotes, a quote closed on a later line, a template literal) is judged
    // as a whole. One that does not end within the bounds is reported: it cannot be verified.
    const multiline = multilineValue(ctx, input, valueStart);
    if (multiline !== null) {
      m.spanEnd = multiline.end;
      if (multiline.exhausted) return exhaustedVerdict(m, ctx, multiline);
      if (isVaultBody(multiline.values)) return false;
      return multiline.values.some((text) =>
        isSecretValue({ kind, value: text, quoted: true, separator: m[3], mode: ctx.mode, minLength: ctx.minStrong, catalog: ctx.catalog }),
      );
    }
    // Assignments nested in one whitespace-free run (`a=b=c=...`) all share its tail. The first value gets the
    // full length; nested ones are judged on their first 64 characters, which keeps a hostile run linear.
    const nested = valueStart < (ctx.bareRunEnd ?? 0);
    const reader = nested ? NESTED_VALUE_AT : VALUE_AT;
    reader.lastIndex = valueStart;
    const value = reader.exec(input);
    if (!value) return false;
    const quotedValue = value[1] ?? value[2] ?? value[3];
    const quoted = quotedValue !== undefined;
    m.spanEnd = valueStart + value[0].length;
    // `NAME=\`cat file\`` in a shell script is a command substitution, not a string literal (in code it is a template literal).
    if (value[3] !== undefined && ctx.mode !== 'code' && isShellScriptPath(ctx.path)) return false;
    const check = (text, isQuoted) =>
      isSecretValue({ kind, value: text, quoted: isQuoted, separator: m[3], mode: ctx.mode, minLength: ctx.minStrong, catalog: ctx.catalog });
    if (quoted) return check(unescapeQuoted(quotedValue), true);
    const bare = value[4];
    if (!nested) ctx.bareRunEnd = valueStart + bare.length;
    let token = bare.replace(/^["'`]+/, '');
    if (ctx.mode === 'config' && bare.includes('${')) {
      // The value is the whole shell word, so ${A:-two words} and ${A}suffix stay in one piece.
      const wordEnd = bareShellWordEnd(input, valueStart);
      token = input.slice(valueStart, wordEnd);
      m.spanEnd = Math.max(m.spanEnd, wordEnd);
    }
    if (bare.startsWith('`') && ctx.mode !== 'code' && isShellScriptPath(ctx.path)) return false; // an unquoted command substitution
    if (ctx.mode !== 'config') return check(token, false);
    const extras = unquotedContinuations(ctx, input, m.index, valueStart + bare.length, bare);
    if (extras.some((extra) => isVaultBody([extra.value]))) return false; // `NAME: |` + an ansible-vault ciphertext
    // A backslash at the end of the line, an INI continuation line, a YAML scalar folded over indented lines.
    const continued = /^[|>][-+0-9]*$/.test(bare) ? null : continuedValue(ctx, input, m.index, valueStart);
    if (continued !== null) {
      m.spanEnd = continued.end;
      if (continued.exhausted) return exhaustedVerdict(m, ctx, continued);
      if (isVaultBody(continued.values)) return false;
      for (const text of continued.values) if (check(text, true)) return true;
    }
    // A value that continues after its first word (`password=Passwords do not match`) is the whole rest of the line:
    // the first word alone says nothing about it.
    const wholeLine = extras.find((extra) => extra.value.length > bare.length && extra.value.startsWith(bare));
    if (wholeLine) {
      m.spanEnd = wholeLine.end;
      return check(wholeLine.value, true);
    }
    if (check(token, false)) return true;
    for (const extra of extras) {
      if (check(extra.value, true)) {
        m.spanEnd = extra.end;
        return true;
      }
    }
    return false;
  },
};


// Definition forms with no operator, where the name follows a keyword or sigil and the value is a quoted literal after a blank:
// Elixir `@jwt_secret "v"`, Clojure `(def jwt-secret "v")` / `{:jwt-secret "v"}`, Lisp `(setq jwt-secret "v")` / `(defvar ...)`.
// Source code only (in prose these read as ordinary text); the value is judged like any other quoted literal in code.
const DEFINITION_ASSIGNMENT_MATCHER = {
  appliesTo: (ctx) => ctx.mode === 'code',
  hint: /[@(:]/,
  pattern:
    /(?<![A-Za-z0-9_$.\/-])(@|\((?:def|defonce|defvar|defparameter|defconstant|defcustom|setq|setf|define)(?![A-Za-z0-9_-])[ \t]{1,8}(?:\^[^\s()]{1,30}[ \t]{1,8}){0,2}|:)([A-Za-z_][A-Za-z0-9_.-]{0,255})()[ \t]{1,64}(?=["'\x60])/g,
  accept: (m, ctx) => SECRET_ASSIGNMENT_MATCHER.accept(m, ctx),
};

// ---------------------------------------------------------------------------
// HTTP credentials written out: `Authorization: Bearer <token>`, headers.set('Authorization', 'Basic <base64>'),
// `proxy_set_header Authorization "Bearer <token>"`, requests.get(url, auth=('user', 'password')), ...
// ---------------------------------------------------------------------------

// A token in a header must be at least this long to count: shorter text is a scheme keyword, a label or a test value.
const HTTP_CREDENTIAL_MIN_LENGTH = 12;
const HTTP_TOKEN_GATE = { minLength: HTTP_CREDENTIAL_MIN_LENGTH, minEntropy: 3.0 };
// The examples of RFC 7617, 6749, 6750 and 5849 (Aladdin / open sesame, the OAuth client, and the two sample bearer tokens): documentation, in any file.
const HTTP_SAMPLE_LOGINS = new Set(['aladdin:open sesame', 's6bhdrkqt3:gx1fbat3bv']);
const HTTP_SAMPLE_TOKENS = new Set(['mf_9.b5f-4.1jqm', 'h480djs93hd8']);
// A value that stands for a token (${token}, {token}, $(cat f), <token>, [token], f(x)) contains one of these; real tokens do not.
const HTTP_TOKEN_REFERENCE = /[{}()<>[\]$]/;

/** The password of a decoded `user:password` pair, or null when `value` is not the base64 of a printable pair. */
function basicPassword(value) {
  if (!/^[A-Za-z0-9+/_-]{4,4096}={0,2}$/.test(value)) return null;
  const decoded = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  if (!/^[\x20-\x7e]{3,4096}$/.test(decoded)) return null;
  if (HTTP_SAMPLE_LOGINS.has(decoded.toLowerCase())) return '';
  const colon = decoded.indexOf(':');
  return colon === -1 ? null : decoded.slice(colon + 1);
}

/**
 * Is the credential of an HTTP authorization header (`Bearer <token>`, `Basic <base64>`, `token <x>`, a bare token) a secret?
 * A reference or placeholder is not. Basic credentials are decoded and the password is judged like a URL password
 * (so `user:pass` and the RFC sample pass); everything else must look machine-generated. A JWT is the jwt-token rule's business.
 */
function httpCredentialIsSecret(scheme, raw) {
  const value = raw.replace(/[,;.]+$/, '');
  if (value.includes('${')) return expansionLiterals(value).some((literal) => looksRandom(stripQuotes(literal), HTTP_TOKEN_GATE));
  if (HTTP_TOKEN_REFERENCE.test(value) || isPlaceholder(value)) return false;
  if (/^eyJ[A-Za-z0-9_-]{10,}\.eyJ/.test(value) || HTTP_SAMPLE_TOKENS.has(value.toLowerCase())) return false;
  if (scheme !== undefined && scheme.toLowerCase() === 'basic') {
    const password = basicPassword(value);
    if (password !== null) return password !== '' && urlPasswordIsSecret(password);
  }
  return looksRandom(value, HTTP_TOKEN_GATE);
}

// What follows the header name (all groups are shared by the matchers below):
//   1 = opening quote of the value ('' when there is none), 2 = the scheme (Bearer, Basic, token, ApiKey, ...), 3 = the credential
// The credential stops at a blank, a quote or a backslash, so `Bearer <t>` inside "..." or a JSON string is read whole.
const HTTP_CREDENTIAL = String.raw`(["'\x60]?)(?:([A-Za-z][A-Za-z0-9_-]{0,30})[ \t]{1,8})?([^\s"'\x60\\]{${HTTP_CREDENTIAL_MIN_LENGTH},4096})`;
// [Proxy-]Authorization / X-Authorization
const HTTP_AUTH_NAME = String.raw`(?<![A-Za-z0-9_-])(?:[A-Za-z]{1,20}-)?authorization(?![A-Za-z0-9_-])`;
// after the name: `"Authorization": "..."`, `Authorization: ...`, `headers["Authorization"] = ...`, `'Authorization' => ...` | `.set('Authorization', ...)`
const HTTP_AUTH_SEPARATOR = String.raw`(?:["'\x60]?\]?[ \t]{0,8}(?:=>|[:=])|["'\x60][ \t]{0,8},)[ \t]{0,8}`;
// Directives of servers and proxies that set a request header: nginx, Apache mod_headers, HAProxy.
const HTTP_HEADER_DIRECTIVE = String.raw`(?<![A-Za-z0-9_-])(?:proxy_set_header|more_set_headers|add_header|RequestHeader[ \t]+(?:set|add|append|merge)|Header[ \t]+(?:always[ \t]+)?(?:set|add|append|merge)|http-(?:request|response)[ \t]+(?:set|add)-header)`;

// ---------------------------------------------------------------------------
// Whitespace-delimited service configuration: Redis, Mosquitto, HAProxy, msmtp, fetchmail, nginx / Apache header and variable
// directives. There is no `=` to anchor on, so every matcher is keyed on a directive or file name specific to the service.
// ---------------------------------------------------------------------------

// A directive's value: "double" (escapes), 'single' or one bare word. Groups dq / sq / bare.
const DIRECTIVE_VALUE = String.raw`(?:"(?<dq>(?:[^"\\\n]|\\.){0,4096})"|'(?<sq>[^'\n]{0,4096})'|(?<bare>[^\s"']{1,4096}))`;
// Documented sample values (redis.conf ships `# requirepass foobared`).
const DIRECTIVE_SAMPLES = new Set(['foobared', 'changeit']);

/** The text of a DIRECTIVE_VALUE match ({ text, quoted }). A trailing `;` ends an nginx directive; it is not part of the value. */
function directiveValue(groups) {
  if (groups.dq !== undefined) return { text: unescapeQuoted(groups.dq), quoted: true };
  if (groups.sq !== undefined) return { text: groups.sq, quoted: true };
  return { text: groups.bare.replace(/;+$/, ''), quoted: false };
}

// nginx variables ($http_x_api_key, ${var}), HAProxy sample fetches and log-format (%[req.hdr(x)]), Apache expressions (%{HTTP_X}e): references.
const DIRECTIVE_REFERENCE = /^(?:\$[A-Za-z_{(]|%[[{])/;

/** Is the literal value of a service directive a secret? Strong-name rules: any non-placeholder of 8+ characters. */
function directiveIsSecret(value) {
  if (DIRECTIVE_SAMPLES.has(value.text.toLowerCase()) || DIRECTIVE_REFERENCE.test(value.text)) return false;
  return isSecretValue({ kind: 'strong', value: value.text, quoted: value.quoted, separator: '=', mode: 'config' });
}

/** Directives are read in configuration files, and in fenced blocks of Markdown; anywhere else the text is prose or code. */
const directiveContextOk = (m, ctx) => ctx.mode === 'config' || (ctx.mode === 'prose' && ctx.fenceLang(m.index) !== undefined);

// Services whose configuration file is recognised by name (lower-case base name, template suffix removed).
const SERVICE_CONFIG_FILES = [
  ['redis', /^(?:redis|sentinel|valkey|keydb)[a-z0-9._-]{0,60}\.conf$/],
  ['mosquitto', /^mosquitto[a-z0-9._-]{0,60}\.conf$/],
  ['msmtp', /^\.?(?:msmtprc|mpoprc)$/],
  ['fetchmail', /^\.?fetchmailrc$/],
  ['tinyproxy', /^tinyproxy[a-z0-9._-]{0,60}\.conf$/],
];

/** Which service configuration a file is (see SERVICE_CONFIG_FILES), or null; also by directory (`.../mosquitto/*.conf`). */
function serviceConfigOf(filePath) {
  const normalized = filePath.split(path.sep).join('/').toLowerCase();
  const base = baseWithoutTemplateSuffix(path.posix.basename(normalized));
  for (const [service, pattern] of SERVICE_CONFIG_FILES) if (pattern.test(base)) return service;
  const dir = /(?:^|\/)(redis|mosquitto)\/[^/]{1,100}\.conf$/.exec(normalized);
  return dir === null ? null : dir[1];
}

/** Redis ACL rules: `>plaintext` adds a password, `#<sha256>` a password hash. Other rules (on, ~*, +@all, nopass) are not secrets. */
function aclRulesHoldSecret(rules) {
  const tokens = rules.trim().split(/[ \t]+/);
  // `user NAME` + rules: without an on/off/key/command rule the line is something else (an nginx `user` directive, prose).
  if (!tokens.some((token) => /^(?:on|off|reset|resetpass|nopass|allkeys|allcommands|allchannels|~.+|%[RW]{1,2}~.+|\+.+|-.+|&.+)$/i.test(token))) return false;
  return tokens.some((token) => {
    if (token.startsWith('>')) return directiveIsSecret({ text: token.slice(1), quoted: false });
    return /^#[0-9a-fA-F]{64}$/.test(token) && !isPlaceholder(token.slice(1));
  });
}

export const RULES = [
  {
    id: 'url-password',
    lockfile: true,
    description: 'URL (or curl -u) with an embedded non-placeholder password: database, broker, HTTP basic auth, ...',
    matchers: [
      {
        // No length caps on user and password: a long one must not make the match fail. Each attempt starts at a
        // "://" and cannot cross a "/", so the scan stays linear. Only the host (never judged) is capped.
        pattern: /(?<=[a-z0-9+.-]):\/\/([^\s:@/'"`]*):([^\s@/'"`]+)@([^\s/'"`?#]{0,256})/gi,
        accept: (m) => urlPasswordIsSecret(m[2]) && !isDocumentationHost(m[3]),
      },
      {
        // curl -u user:password https://...   (also --user, --proxy-user, -U, a flag cluster such as -sSu, and the attached
        // forms -uuser:password and --user=user:password). The argument is read as one shell word, so a quoted
        // "user:pass phrase" is judged whole (double, single and $'...' quotes, escaped spaces).
        pattern: /(?<![A-Za-z0-9_-])(?:(?:--user|--proxy-user)(?:=|[ \t]+)|-[A-Za-z]{0,8}[uU](?:=|[ \t]{0,32}))(?=\S)/g,
        // `-u root:root` is also docker's uid:gid, so the same line must mention an HTTP client or URL.
        accept: (m) => {
          if (!/curl|wget|https?:\/\//i.test(nearbyLineText(m))) return false;
          const argument = shellArgument(m.input, m.index + m[0].length);
          if (argument === null) return false;
          const colon = argument.text.indexOf(':');
          if (colon < 1) return false;
          m.spanEnd = m.index + m[0].length + argument.length;
          const password = argument.text.slice(colon + 1);
          return urlPasswordIsSecret(argument.quoted ? password : password.replace(/[,;)]+$/, ''));
        },
      },
      {
        // Other tools that take a password as a flag argument: wget, mysql, mongosh, redis-cli, httpie and xh, sshpass,
        // ldapsearch, curl --pass. The whole argument is judged, quoted or not.
        pattern: CLI_PASSWORD_COMMAND,
        accept: (m) => cliPasswordArguments(shellWords(m[0])).some((password) => urlPasswordIsSecret(password.replace(/[,;)]+$/, ''))),
      },
    ],
  },
  {
    id: 'private-key-block',
    lockfile: true,
    description: 'PEM private key block (header followed by key material)',
    matchers: [
      {
        pattern: new RegExp(
          String.raw`-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----` +
            PEM_SEPARATOR +
            String.raw`(?:(?:Proc-Type|DEK-Info|Version|Comment):[^\n]*` +
            PEM_SEPARATOR +
            String.raw`)*([A-Za-z0-9+/=]{20,}[^\n]*)`,
          'g',
        ),
        accept: (m) => !placeholderOf(m[1]),
      },
    ],
  },
  {
    id: 'aws-access-key-id',
    lockfile: true,
    description: 'AWS access key ID',
    matchers: [
      {
        pattern: /(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])/g,
        accept: (m) => !placeholderOf(m[0]),
      },
    ],
  },
  {
    id: 'google-api-key',
    lockfile: true,
    description: 'Google API key (also matches Firebase web API keys)',
    matchers: [
      {
        pattern: /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g,
        accept: (m) => !placeholderOf(m[0]),
      },
    ],
  },
  {
    id: 'github-token',
    lockfile: true,
    description: 'GitHub personal access, OAuth, app or fine-grained token',
    matchers: [
      {
        pattern:
          /(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})(?![A-Za-z0-9_])/g,
        accept: (m) => !placeholderOf(m[0]),
      },
    ],
  },
  {
    id: 'slack-token',
    lockfile: true,
    description: 'Slack API token (bot, user, legacy, app-level xapp-, configuration and refresh tokens)',
    matchers: [
      {
        // Bot/user/legacy/workspace/client tokens (xoxb xoxp xoxa xoxr xoxs xoxc xoxd), the rotating-token wrappers
        // (xoxe.xoxp-, xoxe.xoxb-) and app-level tokens (xapp-). A real token always has digits (team and app ids); the
        // lookahead is bounded, and the class after it cannot overlap the prefix, so a hostile run of "xoxb-xoxb-..." stays
        // linear. A repeated-character body (xoxb-000000000000-...-xxxxxxxx) is a placeholder.
        pattern: /(?<![A-Za-z0-9])(?:(?:xoxe\.)?xox[bparsc]|xoxd|xapp)-(?=[0-9A-Za-z%+/=-]{0,200}\d)[0-9A-Za-z%+/=-]{10,}/g,
        accept: (m) => !placeholderOf(m[0]) && varied(m[0]),
      },
      {
        // Documented shapes only, so prose slugs ("xoxo-love-and-kisses-2026") are not tokens: Enterprise Grid xoxo-<digits>-
        // <digits>-<digits>-<hex>, and configuration / refresh tokens xoxe-<digit>-<long base64url body>.
        pattern: /(?<![A-Za-z0-9])(?:xoxo-\d{6,}-\d{6,}(?:-\d{6,})?-[0-9a-f]{16,}|xoxe-\d-[A-Za-z0-9_-]{60,})(?![A-Za-z0-9])/g,
        // A refresh token body is mixed-case base64url with digits; a hyphenated lower-case slug is prose.
        accept: (m) => !placeholderOf(m[0]) && varied(m[0]) && (m[0].startsWith('xoxo-') || (mixedCase(m[0].slice(7)) && /\d/.test(m[0].slice(7)))),
      },
    ],
  },
  {
    id: 'stripe-live-key',
    lockfile: true,
    description: 'Stripe live secret or restricted key',
    matchers: [
      {
        pattern: /(?<![A-Za-z0-9_])[sr]k_live_[0-9A-Za-z]{16,}/g,
        accept: (m) => !placeholderOf(m[0]),
      },
    ],
  },
  {
    id: 'neon-api-key',
    lockfile: true,
    description: 'Neon API key (napi_ prefix)',
    matchers: [
      {
        pattern: /(?<![A-Za-z0-9_])napi_[A-Za-z0-9]{32,}(?![A-Za-z0-9_])/g,
        accept: (m) => !placeholderOf(m[0]),
      },
    ],
  },
  {
    id: 'neon-role-password',
    lockfile: true,
    description: 'Neon role password (npg_ prefix)',
    matchers: [
      {
        pattern: /(?<![A-Za-z0-9_])npg_[A-Za-z0-9]{10,}(?![A-Za-z0-9_])/g,
        accept: (m) => !placeholderOf(m[0]),
      },
    ],
  },
  {
    id: 'stack-auth-secret-key',
    lockfile: true,
    description: 'Stack Auth secret server key (ssk_ prefix)',
    matchers: [
      {
        pattern: /(?<![A-Za-z0-9_])ssk_[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])/g,
        accept: (m) => !placeholderOf(m[0]),
      },
    ],
  },
  {
    id: 'jwt-token',
    lockfile: true,
    description: 'JWT-shaped token with a long signature',
    matchers: [
      {
        pattern: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{20,})/g,
        // Header and payload are public; only the signature decides whether this is a real token.
        accept: (m) => !placeholderOf(m[1]),
      },
    ],
  },
  ...PROVIDER_RULES,
  LOCKFILE_RULE,
  SQL_RULE,
  {
    id: 'webhook-url',
    lockfile: true,
    description:
      'webhook URL whose path or query is a secret token (Slack, Discord, Microsoft Teams / Power Automate, Zapier, IFTTT, PagerDuty, Telegram bot): anyone holding the URL can post',
    hint: /hooks\.slack|discord|webhook\.office|outlook\.office|logic\.azure|zapier|ifttt|api\.telegram|pagerduty/i,
    matchers: [
      {
        // https://hooks.slack.com/services/T000/B000/<token>, /workflows/T/A/<id>/<token>, /triggers/E/<id>/<token>
        pattern: new RegExp(String.raw`hooks\.slack\.com${SLASH}(?:services|workflows|triggers)((?:${SLASH}[A-Za-z0-9_%-]{1,100}){1,6})`, 'gi'),
        accept: (m) => {
          const last = m[1].split(/\\?\//).pop();
          return last.length >= 16 && !isPlaceholder(last);
        },
      },
      {
        // https://discord.com/api/webhooks/<id>/<token>
        pattern: new RegExp(String.raw`discord(?:app)?\.com${SLASH}api(?:${SLASH}v\d{1,2})?${SLASH}webhooks${SLASH}\d{5,25}${SLASH}([A-Za-z0-9_-]{16,})`, 'gi'),
        accept: (m) => !placeholderOf(m[1]),
      },
      {
        // https://<tenant>.webhook.office.com/webhookb2/<guid>@<guid>/IncomingWebhook/<32 hex>/<guid>  (and outlook.office.com/webhook/...)
        pattern: new RegExp(
          String.raw`(?:outlook\.office(?:365)?\.com${SLASH}webhook|[a-z0-9.-]{1,80}\.webhook\.office\.com${SLASH}webhook[a-z0-9]{0,3})${SLASH}[^\s"'<>]{0,300}?IncomingWebhook${SLASH}([A-Za-z0-9]{20,})`,
          'gi',
        ),
        accept: (m) => !placeholderOf(m[1]),
      },
      {
        // Power Automate / Logic Apps HTTP trigger: https://prod-00.region.logic.azure.com/workflows/<id>/triggers/manual/paths/invoke?...&sig=<signature>
        pattern: new RegExp(
          String.raw`\.logic\.azure\.com(?::\d{1,5})?${SLASH}workflows${SLASH}[^\s"'<>]{0,300}?(?:[?&]|\\u0026|&amp;)sig=([A-Za-z0-9_%-]{16,})`,
          'gi',
        ),
        accept: (m) => !placeholderOf(m[1]),
      },
      {
        // https://hooks.zapier.com/hooks/catch/<id>/<code>
        pattern: new RegExp(String.raw`hooks\.zapier\.com${SLASH}hooks${SLASH}catch${SLASH}\d{3,}${SLASH}([A-Za-z0-9]{5,})`, 'gi'),
        accept: (m) => !placeholderOf(m[1]),
      },
      {
        // https://maker.ifttt.com/trigger/<event>/with/key/<key>
        pattern: new RegExp(String.raw`maker\.ifttt\.com${SLASH}trigger${SLASH}[A-Za-z0-9_-]{1,100}${SLASH}(?:json${SLASH})?with${SLASH}key${SLASH}([A-Za-z0-9_-]{16,})`, 'gi'),
        accept: (m) => !placeholderOf(m[1]),
      },
      {
        // https://events.pagerduty.com/integration/<32 character integration key>/enqueue
        pattern: new RegExp(String.raw`events\.pagerduty\.com${SLASH}integration${SLASH}([A-Za-z0-9]{20,})${SLASH}enqueue`, 'gi'),
        accept: (m) => !placeholderOf(m[1]),
      },
      {
        // https://api.telegram.org/bot<bot id>:<token>/sendMessage
        pattern: new RegExp(String.raw`api\.telegram\.org${SLASH}bot(\d{6,}:[A-Za-z0-9_-]{30,})`, 'gi'),
        accept: (m) => !placeholderOf(m[1]),
      },
    ],
  },
  {
    id: 'secret-assignment',
    description:
      'secret-like name (SECRET, PASSWORD, TOKEN, API_KEY, ...) set to a non-placeholder literal: any 8+ character value in env/config files, a random-looking quoted literal in code',
    hint: SECRET_HINT,
    matchers: [
      SECRET_ASSIGNMENT_MATCHER,
      DEFINITION_ASSIGNMENT_MATCHER,
      {
        // Pulumi.<stack>.yaml: `config:` keys are `<namespace>:<name>: value` (app:apiToken: V). The name is the part after the namespace; a
        // secret stored by `pulumi config set --secret` is a `secure:` ciphertext mapping and passes.
        appliesTo: (ctx) => ctx.mode === 'config' && /(?:^|\/)pulumi(?:\.[A-Za-z0-9_-]{1,64})?\.ya?ml$/i.test(ctx.path),
        pattern: /(?<![A-Za-z0-9_$.-])[A-Za-z0-9_-]{1,64}:([A-Za-z_][A-Za-z0-9_.-]{0,255})(:)[ \t]{0,64}(?=\S)/g,
        accept: (m, ctx) => {
          // SECRET_ASSIGNMENT_MATCHER reads the name from group 2 and the separator from group 3.
          const shifted = Object.assign([m[0], m[1], m[1], m[2]], { index: m.index, input: m.input });
          const found = SECRET_ASSIGNMENT_MATCHER.accept(shifted, ctx);
          if (shifted.spanEnd !== undefined) m.spanEnd = shifted.spanEnd;
          return found;
        },
      },
      {
        // The value starts on a later line: YAML `NAME:` + an indented scalar, INI / configparser `NAME =` + indented
        // continuation lines. A nested mapping (`NAME:` + `value: V`) is the name/value pair rule's business.
        // group 2 = name. The name line ends the match, so the cost per start is the name plus a comment.
        appliesTo: (ctx) => ctx.mode === 'config' && /\.(?:ya?ml|ini|cfg|conf)$/i.test(ctx.path),
        pattern: /(?<![A-Za-z0-9_$.-])(["']?)([A-Za-z_$][A-Za-z0-9_$.-]{0,1023})\1[ \t]{0,64}[:=][ \t]{0,64}(?:#[^\n]{0,4096})?\r?\n/g,
        accept: (m, ctx) => {
          const kind = nameKindFor(m[2], ctx);
          if (!kind) return false;
          if (budgetSpent(ctx)) return exhaustedVerdict(m, ctx, { budget: true });
          const input = m.input;
          const yaml = /\.ya?ml$/i.test(ctx.path);
          const lineStart = ctx.lineStart(m.index);
          const keyIndent = /^[ \t]*(?:-[ \t]+)?/.exec(input.slice(lineStart, m.index + 1))[0].length;
          const pieces = [];
          let at = m.index + m[0].length;
          let end = at;
          for (let n = 0; n < 20 && at < input.length; n += 1) {
            let next = input.indexOf('\n', at);
            if (next === -1) next = input.length;
            const line = input.slice(at, Math.min(next, at + 4096)).replace(/\r$/, '');
            if (line.trim() !== '' && !/^[ \t]*[#;]/.test(line)) {
              if (/^[ \t]*/.exec(line)[0].length <= keyIndent) break;
              // A nested mapping or a list (`pass:` / `- "text"` in a test fixture) is not a scalar value of this name.
              if (yaml && pieces.length === 0 && /^[ \t]*(?:[^\s#'"-][^:]*:(?:[ \t]|$)|-(?:[ \t]|$))/.test(line)) return false;
              pieces.push(line.trim());
              end = next;
            }
            at = next + 1;
          }
          if (pieces.length === 0 || isVaultBody(pieces)) return false;
          if (!spendMultiline(ctx, end - m.index)) return exhaustedVerdict(m, ctx, { budget: true });
          m.spanEnd = end;
          const judge = (text) => isSecretValue({ kind, value: stripQuotes(text), quoted: true, separator: m[0].includes('=') ? '=' : ':', mode: ctx.mode, minLength: ctx.minStrong, catalog: ctx.catalog });
          return pieces.some(judge) || (pieces.length > 1 && judge(pieces.join(' ')));
        },
      },
      {
        // Command-style assignments with no "=": fish `set -gx NAME value ...` (also csh `set NAME = value`, Windows `set "NAME=value"`),
        // csh `setenv NAME value`, Windows `setx NAME value`, `export NAME value`. See the block above shellTail.
        // group 1 = fish flags, 3 = name. The bounded flag list starts every flag with a blank and a "-", so it has one reading.
        hint: /\b(?:set|setenv|setx|export)\b/i,
        pattern: /(?<![A-Za-z0-9_$.\/-])set((?:[ \t]{1,64}-{1,2}[A-Za-z][A-Za-z-]{0,24}){0,8})[ \t]{1,64}(["']?)([A-Za-z_][A-Za-z0-9_.-]{0,255})\2(?=[ \t]|$)/gim,
        accept: (m, ctx) => {
          const kind = nameKindFor(m[3], ctx);
          if (!kind || !fishFlagsAssign(m[1]) || !commandContextOk(m, ctx, m[1] !== '')) return false;
          const words = shellTail(m.input, m.index + m[0].length);
          m.spanEnd = m.index + m[0].length;
          return shellWordsAreSecret(kind, words, ctx);
        },
      },
      {
        // Windows: set "NAME=value" (the quotes keep spaces and & out of the operator syntax)
        hint: /\bset[ \t]+"/i,
        pattern: /(?<![A-Za-z0-9_$.\/-])set[ \t]{1,64}"([A-Za-z_][A-Za-z0-9_.-]{0,255})=([^"\n]{0,4096})"/gi,
        accept: (m, ctx) => {
          const kind = nameKindFor(m[1], ctx);
          if (!kind || !commandContextOk(m, ctx, false)) return false;
          return shellWordsAreSecret(kind, [{ text: m[2], quoted: true, expr: false }], ctx);
        },
      },
      {
        // csh / tcsh: setenv NAME value
        hint: /\bsetenv\b/i,
        pattern: /(?<![A-Za-z0-9_$.\/-])setenv[ \t]{1,64}(["']?)([A-Za-z_][A-Za-z0-9_.-]{0,255})\1(?=[ \t]|$)/gim,
        accept: (m, ctx) => {
          const kind = nameKindFor(m[2], ctx);
          if (!kind || !commandContextOk(m, ctx, true)) return false;
          m.spanEnd = m.index + m[0].length;
          return shellWordsAreSecret(kind, shellTail(m.input, m.index + m[0].length), ctx);
        },
      },
      {
        // Windows: setx [/M] NAME value [/M]
        hint: /\bsetx\b/i,
        pattern: /(?<![A-Za-z0-9_$.\/-])setx[ \t]{1,64}(?:\/[A-Za-z][ \t]{1,64}){0,2}(["']?)([A-Za-z_][A-Za-z0-9_.-]{0,255})\1(?=[ \t]|$)/gim,
        accept: (m, ctx) => {
          const kind = nameKindFor(m[2], ctx);
          if (!kind || !commandContextOk(m, ctx, true)) return false;
          m.spanEnd = m.index + m[0].length;
          return shellWordsAreSecret(kind, shellTail(m.input, m.index + m[0].length), ctx);
        },
      },
      {
        // sh: export NAME value (no "="). A list of plain variable names (`export A B`) is not a value.
        hint: /\bexport\b/,
        pattern: /(?<![A-Za-z0-9_$.\/-])export((?:[ \t]{1,64}-[A-Za-z]{1,6}){0,3})[ \t]{1,64}(["']?)([A-Za-z_][A-Za-z0-9_]{0,255})\2(?=[ \t])/gm,
        accept: (m, ctx) => {
          const kind = nameKindFor(m[3], ctx);
          if (!kind || !commandContextOk(m, ctx, false)) return false;
          const words = shellTail(m.input, m.index + m[0].length).filter((w) => w.quoted || w.text !== '=');
          if (words.length === 0 || words.every((w) => !w.quoted && SHELL_VARIABLE_NAME.test(w.text))) return false;
          m.spanEnd = m.index + m[0].length;
          return shellWordsAreSecret(kind, words, ctx);
        },
      },
      {
        // PowerShell: $env:NAME = 'value', ${env:NAME} += "value"
        hint: /env:/i,
        pattern: /\$\{?env:([A-Za-z_][A-Za-z0-9_.-]{0,255})\}?[ \t]{0,64}\+?=[ \t]{0,64}(?=["'])/gi,
        accept: (m, ctx) => {
          const kind = nameKindFor(m[1], ctx);
          if (!kind || !commandContextOk(m, ctx, true)) return false;
          const literal = powershellString(m.input, m.index + m[0].length);
          if (literal !== null) m.spanEnd = literal.end;
          return powershellValueIsSecret(kind, literal, ctx);
        },
      },
      {
        // PowerShell / .NET: [Environment]::SetEnvironmentVariable('NAME', 'value'[, 'User'])
        hint: /SetEnvironmentVariable/i,
        pattern: /\[(?:System\.)?Environment\][ \t]{0,64}::[ \t]{0,64}SetEnvironmentVariable\([ \t]{0,64}(["'])([A-Za-z_][A-Za-z0-9_.-]{0,255})\1[ \t]{0,64},[ \t]{0,64}(?=["'])/gi,
        accept: (m, ctx) => {
          const kind = nameKindFor(m[2], ctx);
          if (!kind || !commandContextOk(m, ctx, true)) return false;
          const literal = powershellString(m.input, m.index + m[0].length);
          if (literal !== null) m.spanEnd = literal.end;
          return powershellValueIsSecret(kind, literal, ctx);
        },
      },
      {
        // PowerShell: Set-Item -Path Env:NAME -Value 'v', Set-Item Env:\NAME 'v', New-Item -Path Env:NAME -Value 'v'
        hint: /Env:/i,
        pattern: /(?<![A-Za-z0-9_$.-])(?:Set-Item|New-Item|Set-Content)(?=[ \t])[^\n]{0,300}?(?:[ \t]|["'])Env:\\?([A-Za-z_][A-Za-z0-9_.-]{0,255})(?![A-Za-z0-9_.-])/gi,
        accept: (m, ctx) => {
          const kind = nameKindFor(m[1], ctx);
          if (!kind || !commandContextOk(m, ctx, true)) return false;
          const words = shellTail(m.input, m.index);
          const at = words.findIndex((w) => !w.quoted && /^-value$/i.test(w.text));
          const rest = words.slice(1);
          const value = at !== -1 ? words[at + 1] : rest.find((w) => w.quoted || !/^-|^Env:/i.test(w.text) && w.text !== '=');
          m.spanEnd = m.index + m[0].length;
          return value !== undefined && shellWordsAreSecret(kind, [value], ctx);
        },
      },
      {
        // fish universal variables file (~/.config/fish/fish_variables): SETUVAR [--export] NAME:value
        hint: /SETUVAR/,
        pattern: /^SETUVAR((?:[ \t]{1,64}--?[A-Za-z-]{1,20}){0,4})[ \t]{1,64}([A-Za-z_][A-Za-z0-9_]{0,255}):([^\n]{1,4096})$/gm,
        accept: (m, ctx) => {
          const kind = nameKindFor(m[2], ctx);
          if (!kind) return false;
          const value = m[3].replace(/\\x1[de]/gi, ' ').replace(/\\(.)/g, '$1').replace(/\r$/, '').trim();
          return isSecretValue({ kind, value, quoted: true, separator: '=', mode: 'config', minLength: ctx.minStrong, catalog: ctx.catalog });
        },
      },
      {
        // Dockerfile "ENV NAME value" / "ARG NAME value" (space-separated; NAME=value is handled above)
        pattern: /^[ \t]*(?:ONBUILD[ \t]+)?(?:ENV|ARG)[ \t]+([A-Za-z_][A-Za-z0-9_]{0,1023})[ \t]+([^\n]{1,4096})$/gim,
        accept: (m, ctx) => {
          if (!/(?:^|\/)(?:[^/]*dockerfile[^/]*|containerfile[^/]*)$/i.test(ctx.path)) return false;
          const kind = secretNameKind(m[1]);
          if (!kind || m[2].startsWith('=')) return false;
          return isSecretValue({ kind, value: stripQuotes(m[2].replace(/\r$/, '')), quoted: true, separator: '=', mode: ctx.mode, catalog: ctx.catalog });
        },
      },
      {
        // XML element whose NAME is the secret-like word: Maven <server><password>V</password>, <apiKey>V</apiKey>,
        // <keystorePass>V</keystorePass>, <Secret>V</Secret>, a prefixed WS-Security <wsse:Password Type="PasswordText">V</...>,
        // or an entry named by an attribute: <entry key="secret">V</entry>, <env name="SECRET_KEY">V</env>. XML configuration
        // files only (an HTML page or SVG has <password> markup, not settings). The text is a bounded [^<>] run and the closing
        // tag must repeat the name, so each start costs at most the text length and the scan stays linear.
        // group 1 = qualified element name, 2 = start-tag attributes, 3 = text
        hint: /<\//,
        appliesTo: (ctx) => ctx.xml,
        pattern: /<((?:[A-Za-z_][A-Za-z0-9_.-]{0,50}:)?[A-Za-z_][A-Za-z0-9_.-]{0,100})((?:[ \t\r\n][^<>]{0,300})?)>([^<>]{1,4096})<\/\1[ \t\r\n]*>/g,
        accept: (m, ctx) => xmlElementIsSecret(m[1], m[2], m[3], ctx),
      },
      {
        // The same element with its text in a CDATA section: <password><![CDATA[V]]></password>. The section body is a run of
        // non-"]" characters and "]" not followed by "]>", so every character has one reading and the cost per start is bounded.
        hint: /<!\[CDATA\[/,
        appliesTo: (ctx) => ctx.xml,
        pattern: /<((?:[A-Za-z_][A-Za-z0-9_.-]{0,50}:)?[A-Za-z_][A-Za-z0-9_.-]{0,100})((?:[ \t\r\n][^<>]{0,300})?)>[ \t\r\n]{0,64}<!\[CDATA\[((?:[^\]]|\](?!\]>)){1,1024})\]\]>[ \t\r\n]{0,64}<\/\1[ \t\r\n]*>/g,
        accept: (m, ctx) => xmlElementIsSecret(m[1], m[2], m[3], ctx),
      },
    ],
  },
  {
    id: 'secret-name-value-pair',
    description:
      'name/value pair split across fields, in any order and with other fields in between (k8s "- name: X / value: Y", Vercel {"key":"X","value":"Y"}, {name: X, value: Y}, Terraform blocks, XML <add key= value=/>, CloudFormation ParameterKey/ParameterValue, create_var(name=X, value=Y), nested "X: {value: Y}") where the name is secret-like',
    hint: SECRET_HINT,
    matchers: [
      {
        appliesTo: (ctx) => ctx.mode !== 'code',
        // group 3 = variable name, 5/6 = quoted value, 7 = bare value
        pattern:
          /(?<![A-Za-z0-9_$.-])(["']?)(?:name|key)\1[ \t]*:[ \t]*(["']?)([A-Za-z_][A-Za-z0-9_.-]{0,1023})\2[ \t]*,?[ \t]*(?:\r?\n[ \t-]*)?["']?value["']?[ \t]*:[ \t]*(?:"((?:[^"\\\n]|\\.){0,4096})"|'((?:[^'\\\n]|\\.){0,4096})'|([^\s,}]{1,4096}))/gi,
        accept: (m, ctx) => {
          const kind = secretNameKind(m[3]);
          if (!kind) return false;
          const quotedValue = m[4] ?? m[5];
          const quoted = quotedValue !== undefined;
          return isSecretValue({
            kind,
            value: quoted ? unescapeQuoted(quotedValue) : m[6],
            quoted,
            separator: ':',
            mode: ctx.mode,
            catalog: ctx.catalog,
          });
        },
      },
      {
        // The same pair when the fields are not adjacent or not in that order: {"value":"Y","key":"X"},
        // {"key":"X","type":"encrypted","value":"Y"}, {name: X, value: Y}, `- value: Y` above `name: X`, Terraform
        // `name = "X"` / `value = "Y"` blocks, Netlify {"key":"X","values":[{"value":"Y"}]}. The value is searched for
        // in the enclosing bounded { ... } object and in the neighbouring lines of the YAML mapping.
        // group 1 = quote (may be a backslash-escaped one), 3 = variable name
        pattern:
          /(?<![A-Za-z0-9_$.-])(\\?["']?)(?:name|key|variable|variablename|env|envname|envvar|var|varname|secretname|parametername|parameterkey|optionname|propertyname|settingname|keyname)\1[ \t]*[:=][ \t]*(\\?["']?)([A-Za-z_][A-Za-z0-9_.-]{0,1023})\2(?![A-Za-z0-9_.-])/gi,
        accept: (m, ctx) => {
          // In source code the name must be a quoted literal ('JWT_SECRET'); a bare identifier (`key = TOKEN`) is code, not data.
          if (ctx.mode === 'code' && m[2] === '') return false;
          const kind = nameKindFor(m[3], ctx);
          return kind !== null && pairValueIsSecret(m, kind, ctx);
        },
      },
      {
        // XML element form: <property><name>X</name><value>Y</value></property>, <setting><key>X</key>...
        hint: /<\/(?:name|key|variable|env)/i,
        pattern: /<(name|key|variable|env|parametername|parameterkey)>[ \t\r\n]*([A-Za-z_][A-Za-z0-9_.-]{0,1023})[ \t\r\n]*<\/\1>/gi,
        accept: (m, ctx) => {
          const kind = nameKindFor(m[2], ctx);
          if (kind === null) return false;
          const window = xmlWindow(m.input, m.index);
          ctx.pairBudget = (ctx.pairBudget ?? PAIR_BUDGET_CHARS) - (window?.text.length ?? 0) - 64;
          if (ctx.pairBudget < 0) {
            ctx.pairExhausted = true;
            attributeToFile(m);
            return true;
          }
          const found = window === null ? null : windowHoldsSecretValue(window, kind, ctx, false, m.input);
          return found !== null && pairHit(m, window, found, ctx);
        },
      },
      {
        // The name is the KEY of a mapping whose child holds the value: `secrets:\n  NAME:\n    value: Y`, {"NAME": {"value": "Y"}},
        // `NAME: {value: Y}`. group 2 = quote, 3 = name; the child is the indented block below, or the object that follows.
        pattern:
          /(?<![A-Za-z0-9_$.-])(["']?)([A-Za-z_][A-Za-z0-9_.-]{0,1023})\1[ \t]*:[ \t]*(?=\{|(?:#[^\n]*)?\r?\n)/g,
        accept: (m, ctx) => {
          if (ctx.mode === 'code' && m[1] === '') return false;
          const kind = nameKindFor(m[2], ctx);
          if (kind === null) return false;
          const start = ctx.lineStart(m.index);
          const prefix = m.input.slice(start, m.index);
          const isBlock = m.input[m.index + m[0].length] !== '{';
          if (isBlock && (ctx.mode === 'code' || !/^[ \t]*(?:-[ \t]+)*$/.test(prefix))) return false;
          return childHoldsSecretValue(m, kind, ctx, prefix.length);
        },
      },
      {
        // Terraform / OpenTofu / Packer blocks whose secret-like LABEL is the variable's name: variable "api_token" { default = "V" },
        // output "api_token" { value = "V" }. The label is neither a name/key field nor an assignment, so the matchers above never pair it
        // with `default` / `value`. A `sensitive = true` or `type = string` alone carries no value and passes.
        hint: /(?:variable|output)[ \t]/,
        pattern: /(?<![A-Za-z0-9_$.-])(?:variable|output)[ \t]+(["'])([A-Za-z_][A-Za-z0-9_.-]{0,254})\1[ \t]*(?=\{)/g,
        appliesTo: (ctx) => ctx.mode !== 'code',
        accept: (m, ctx) => {
          const kind = nameKindFor(m[2], ctx);
          return kind !== null && childHoldsSecretValue(m, kind, ctx, 0);
        },
      },
      {
        // Delimited rows: `NAME,value` (CSV), `NAME<TAB>value` (TSV), `| NAME | value |` (Markdown or text tables).
        pattern:
          /^[ \t]*\|?[ \t]*(["'`]?)([A-Za-z_][A-Za-z0-9_.-]{0,1023})\1[ \t]*([,\t|;])[ \t]*(?:"([^"\n]{0,4096})"|`([^`\n]{0,4096})`|([^,\t|;\n"`]{1,4096}))/gm,
        accept: (m, ctx) => {
          const table = /\.(?:csv|tsv|psv|tab)$/i.test(ctx.path);
          const prose = ctx.mode === 'prose';
          if (!table && !(prose && m[3] === '|')) return false;
          const kind = secretNameKind(m[2]);
          if (kind === null) return false;
          const quotedValue = m[4] ?? m[5];
          const quoted = quotedValue !== undefined;
          return isSecretValue({
            kind,
            value: (quoted ? quotedValue : m[6]).trim(),
            quoted,
            separator: table ? '=' : ':',
            mode: table ? 'config' : 'prose',
            catalog: ctx.catalog,
          });
        },
      },
    ],
  },
  {
    id: 'secret-cli-command',
    description:
      'secret-like variable set on a command line with a literal value (gh secret set NAME --body V, netlify env:set NAME V, vercel env add NAME <<< V, aws ssm put-parameter --name NAME --value V, kubectl create secret --from-literal)',
    hint: /\b(?:gh|netlify|vercel|heroku|fly|flyctl|wrangler|railway|doppler|aws|firebase|az|kubectl|docker|pulumi)[ \t]/,
    matchers: [
      {
        pattern:
          /(?<![A-Za-z0-9_-])(?:gh[ \t]+(?:secret|variable)[ \t]+set|netlify[ \t]+env:set|vercel[ \t]+env[ \t]+(?:add|update)|heroku[ \t]+config:set|fly(?:ctl)?[ \t]+secrets[ \t]+set|wrangler[ \t]+secret[ \t]+put|railway[ \t]+variables[ \t]+set|doppler[ \t]+secrets[ \t]+set|aws[ \t]+ssm[ \t]+put-parameter|aws[ \t]+secretsmanager[ \t]+(?:create-secret|put-secret-value)|firebase[ \t]+functions:secrets:set|az[ \t]+keyvault[ \t]+secret[ \t]+set|kubectl[ \t]+create[ \t]+secret[ \t]+generic|docker[ \t]+secret[ \t]+create|pulumi[ \t]+config[ \t]+set(?![A-Za-z-])|aws[ \t]+configure[ \t]+set)[^\n]{0,600}/g,
        accept: (m, ctx) => {
          const tool = CLI_TOOLS.find(([re]) => re.test(m[0]));
          if (!tool) return false;
          // `echo V | vercel env add NAME`, `cat <<EOF | vercel ...`, `vercel ... <<EOF`: the value arrives on stdin.
          const stdin = stdinValues(m, ctx);
          const options = { positionalValue: tool[1].positionalValue ?? false, assignments: ctx.mode === 'code' };
          const words = shellWords(m[0].slice(tool[0].exec(m[0])[0].length));
          // `pulumi config set --secret NAME VALUE` names a secret by its flag, not by its name.
          const nameKind = (name) => secretNameKind(name) ?? (tool[1].secretFlag !== undefined && words.includes(tool[1].secretFlag) ? 'strong' : null);
          const judge = (piped) =>
            cliPairs(words, options, piped).some(([name, value]) => {
              const kind = nameKind(name);
              return kind !== null && isSecretValue({ kind, value: value.trim(), quoted: true, separator: '=', mode: 'config', catalog: false });
            });
          const found = (stdin.values.length === 0 ? [null] : stdin.values).some(judge);
          // A heredoc whose delimiter is not found within the bounds is not verified: fail closed for a secret-like name.
          const unverified = !found && stdin.unterminated && cliPairs(words, options, HEREDOC_UNVERIFIED).some(([name, value]) => value === HEREDOC_UNVERIFIED && nameKind(name) !== null);
          if (found || unverified) {
            // The heredoc body is part of the match: an allow marker on one of its lines counts, and so does a change to one of them.
            if (stdin.end > m.index + m[0].length) m.spanEnd = stdin.end;
            return true;
          }
          return false;
        },
      },
    ],
  },
  {
    id: 'credential-file',
    description:
      'secret in a native credential-file format: .netrc, .pgpass, .git-credentials, .npmrc/.yarnrc, .htpasswd, .curlrc, .vault-token, Kubernetes client-key-data and .dockerconfigjson',
    matchers: [
      {
        // .netrc / _netrc: `machine H login U password P`, `default login U password P`, `account A`; tokens may span lines.
        appliesTo: hasFormat('netrc'),
        pattern: /(?<![A-Za-z0-9_-])(?:password|passwd|account)[ \t\r\n]+(?:"((?:[^"\\\n]|\\.){0,1024})"|([^\s"]\S{0,1023}))/g,
        accept: (m, ctx) => {
          const value = unescapeQuoted(m[1] ?? m[2]);
          return !onCommentLine(m, ctx) && !isAnonymousFtpValue(value) && credentialValueIsSecret(value);
        },
      },
      {
        // .pgpass: hostname:port:database:username:password (a backslash escapes ":" and "\"). Comment lines start with #.
        appliesTo: hasFormat('pgpass'),
        pattern:
          /^(?![ \t]*#)[ \t]*(?:[^:\\\n]|\\.){0,255}:(?:[^:\\\n]|\\.){0,255}:(?:[^:\\\n]|\\.){0,255}:(?:[^:\\\n]|\\.){0,255}:([^\n]+)$/gm,
        accept: (m) => credentialValueIsSecret(unescapeQuoted(m[1])),
      },
      {
        // .git-credentials: https://user:password@host lines. url-password judges those on real hosts; this covers
        // documentation hosts (a stored credential is a credential wherever it points) and a token used as the user name.
        appliesTo: hasFormat('gitcred'),
        pattern: /^[ \t]*[a-z][a-z0-9+.-]*:\/\/([^\s:@/]{1,1024})(?::([^\s@/]{1,4096}))?@([^\s/?#]{0,256})/gim,
        accept: (m) => {
          if (m[2] === undefined) {
            const user = safeDecode(m[1]);
            return user.length >= 8 && !isPlaceholder(user) && !isWordIdentifier(user);
          }
          return isDocumentationHost(m[3]) && urlPasswordIsSecret(m[2]);
        },
      },
      {
        // .npmrc / .yarnrc in the space-separated form: "//registry.example/:_authToken" "value", npmAuthIdent "u:p"
        appliesTo: hasFormat('npmrc'),
        pattern:
          /(?<![A-Za-z0-9_-])(?:_authToken|_auth|_password|npmAuthToken|npmAuthIdent|npmPassword)["']?[ \t]+(?:"((?:[^"\\\n]|\\.){0,4096})"|'((?:[^'\\\n]|\\.){0,4096})'|([^\s"']\S{0,4096}))/g,
        accept: (m) => credentialValueIsSecret(unescapeQuoted(m[1] ?? m[2] ?? m[3])),
      },
      {
        // .htpasswd / .htdigest: user:hash. The hash is offline-crackable, so a committed one counts as a credential.
        appliesTo: hasFormat('htpasswd'),
        pattern: /^(?![ \t]*#)[ \t]*[^\s:#][^:\n]{0,255}:(?:[^:\n]{0,255}:)?([^\s:]{1,4096})[ \t]*\r?$/gm,
        // A hash is a credential; a placeholder body ($apr1$xxxxxxxx$xxxxxxxxxxxxxxxxxxxxxx, {SHA}REDACTED) is documentation.
        accept: (m) => {
          const hashBody = /^\$|^\{[A-Za-z0-9]+\}/.test(m[1]) ? m[1].slice(Math.max(m[1].lastIndexOf('$'), m[1].lastIndexOf('}')) + 1) : null;
          return hashBody !== null ? hashBody.length >= 4 && !isPlaceholder(hashBody) : credentialValueIsSecret(m[1]);
        },
      },
      {
        // .curlrc: user = "name:password"  (also -u / --user)
        appliesTo: hasFormat('curlrc'),
        pattern: /^[ \t]*(?:-u|--user|user)[ \t]*(?:=|[ \t])[ \t]*(?:"((?:[^"\\\n]|\\.){0,1024})"|'([^'\n]{0,1024})'|(\S{1,1024}))/gm,
        accept: (m) => {
          const userAndPassword = unescapeQuoted(m[1] ?? m[2] ?? m[3]);
          const colon = userAndPassword.indexOf(':');
          return colon !== -1 && credentialValueIsSecret(userAndPassword.slice(colon + 1));
        },
      },
      {
        // .vault-token: the whole file is the token
        appliesTo: hasFormat('vault'),
        pattern: /^[ \t]*([^\s#][^\n]{0,4095})$/gm,
        accept: (m) => m[1].trim().length >= MIN_STRONG_CONFIG_LENGTH && credentialValueIsSecret(m[1]),
      },
      {
        // Kubernetes kubeconfig and image-pull secrets, in any file name: client-key-data, .dockerconfigjson, .dockercfg
        appliesTo: (ctx) => ctx.mode !== 'code',
        hint: /client-key-data|\.dockerconfigjson|\.dockercfg/,
        pattern:
          /(?<![A-Za-z0-9_$.-])(["']?)(?:client-key-data|\.dockerconfigjson|\.dockercfg)\1[ \t]*:[ \t]*(?:"([^"\\\n]{0,65536})"|'([^'\\\n]{0,65536})'|([^\s"']\S{0,65536}))/g,
        accept: (m) => {
          const value = m[2] ?? m[3] ?? m[4];
          return value.length >= 20 && !isPlaceholder(value);
        },
      },
      // ---- Content matchers: the same credential files under any name (netrc.txt, notes.md, a script or CI step that
      // writes the file with echo/printf/heredoc). They need no path, and skip the path-specific format that already covers them.
      {
        // machine H login U password P / default login U password P / machine H password P (host with a dot), across lines
        // or with literal \n separators (printf "machine h\nlogin u\npassword p\n").
        hint: /machine|default/,
        pattern: new RegExp(
          String.raw`(?<![A-Za-z0-9_-])(?:machine${NETRC_SEP}([^\s"'\\]{1,255})|default)((?:${NETRC_SEP}(?:login|user|username|port|protocol)${NETRC_SEP}[^\s"'\\]{1,255}){0,4})` +
            String.raw`${NETRC_SEP}(?:password|passwd|account)${NETRC_SEP}(?:"((?:[^"\\\n]|\\.){0,1024})"|([^\s"'\\]{1,1024}))`,
          'g',
        ),
        accept: (m, ctx) => {
          if (ctx.formats.has('netrc')) return false;
          const hasLogin = /login|user/.test(m[2]);
          if (!hasLogin && !(m[1] ?? '').includes('.')) return false; // "machine learning password reset" is prose
          const value = unescapeQuoted(m[3] ?? m[4]);
          return !isAnonymousFtpValue(value) && credentialValueIsSecret(value);
        },
      },
      {
        // .pgpass line, anywhere: host:port:database:user:password with a numeric port, alone on its line or written by
        // echo/printf (`echo "db:5432:d:u:pw" > ~/.pgpass`). Anchored to the start of the line so it stays linear.
        pattern:
          /^[ \t]*(?:-[ \t]+)*(?:[\w-]+:[ \t]+)?(?:(?:echo|printf)(?:[ \t]+-[A-Za-z]+)*[ \t]+)?["']?([A-Za-z0-9_.*-]{1,255}):(?:\d{2,5}|\*):[A-Za-z0-9_.*-]{1,255}:([A-Za-z0-9_.@*-]{1,255}):([^\s:"'<>|;&]{4,1024})(?=["']?[ \t]*(?:>|\r?$))/gm,
        accept: (m, ctx) => !ctx.formats.has('pgpass') && /[A-Za-z*]/.test(m[1]) && /[A-Za-z]/.test(m[2]) && credentialValueIsSecret(m[3]),
      },
      {
        // Docker registry auth in any JSON/YAML/echo: {"auths": {"host": {"auth": "<base64 user:password>"}}}
        hint: /auths/,
        pattern:
          /(?<![A-Za-z0-9_$.-])(\\?["']?)(auth|identitytoken|registrytoken)\1[ \t]*:[ \t]*(?:\\?"([^"\\\n]{0,65536})\\?"|'([^'\\\n]{0,65536})'|([^\s"',}\\]{1,65536}))/gi,
        accept: (m, ctx) => {
          if (ctx.formats.has('docker') || !ctx.hasBefore('auths', m.index, 500)) return false; // registry entries sit right under "auths"
          return credentialValueIsSecret(m[3] ?? m[4] ?? m[5]);
        },
      },
    ],
  },
  {
    id: 'http-auth-credential',
    description:
      'HTTP credential written out: Authorization / Proxy-Authorization with a Bearer, Basic, token or ApiKey value (header text, curl -H, headers.set(...), object or YAML or JSON fields, nginx / Apache / HAProxy header directives), and Basic-auth calls with a literal password (auth=("user", "pw"), HTTPBasicAuth, Credentials.basic)',
    hint: /auth|basic|credential/i,
    matchers: [
      {
        // Authorization: Bearer <token>  |  "Authorization": "Basic <base64>"  |  .set('Authorization', 'token <token>')
        pattern: new RegExp(HTTP_AUTH_NAME + HTTP_AUTH_SEPARATOR + HTTP_CREDENTIAL, 'gi'),
        accept: (m, ctx) => {
          if ((m[2] ?? '').toLowerCase() === 'digest') return false; // judged by its own matcher
          // In source code a bare word after the name is an identifier (`Authorization: authHeader`), not a literal token.
          if (ctx.mode === 'code' && m[2] === undefined && m[1] === '') return false;
          return httpCredentialIsSecret(m[2], m[3]);
        },
      },
      {
        // proxy_set_header Authorization "Bearer <token>";  RequestHeader set Authorization "Basic <base64>"  http-request set-header Authorization ...
        pattern: new RegExp(HTTP_HEADER_DIRECTIVE + String.raw`[ \t]+["']?(?:[A-Za-z]{1,20}-)?authorization["']?[ \t]{1,8}` + HTTP_CREDENTIAL, 'gi'),
        accept: (m, ctx) => directiveContextOk(m, ctx) && (m[2] ?? '').toLowerCase() !== 'digest' && httpCredentialIsSecret(m[2], m[3]),
      },
      {
        // Authorization: Digest username="u", realm="r", nonce="n", uri="/", response="<hash>"  (the response is replayable within its nonce)
        pattern: new RegExp(HTTP_AUTH_NAME + HTTP_AUTH_SEPARATOR + String.raw`["'\x60]?digest[ \t][^\n]{0,600}?\bresponse=\\?["']?([A-Za-z0-9+/=_-]{16,256})`, 'gi'),
        accept: (m) => !isPlaceholder(m[1]) && looksRandom(m[1], { minLength: 16, minEntropy: 3.0 }),
      },
      {
        // requests: auth=("user", "pw"), HTTPBasicAuth('user', 'pw'); Java / Kotlin / C# / Go: Credentials.basic("u", "pw"), new UsernamePasswordCredentials("u", "pw"),
        // new Basic("u", "pw"), NetworkCredential, SetBasicAuth; supertest .auth('u', 'pw'). The second argument is a literal password.
        hint: /auth|basic|credential/i,
        pattern:
          /(?<![A-Za-z0-9_$])(?:auth[ \t]{0,8}=[ \t]{0,8}\(|\.auth\(|(?:HTTP(?:Basic|Digest|Proxy)Auth|BasicAuth|BasicCredentials|Credentials\.basic|PasswordAuthentication|UsernamePasswordCredentials|NetworkCredential|SetBasicAuth|Basic|basicAuth|basic_auth|withBasicAuth)[ \t]{0,4}\()[^,()\n]{1,200},[ \t]{0,8}(["'\x60])([^"'\x60\s]{1,4096})\1(?=[ \t]{0,8}[),])/g,
        accept: (m) => isSecretValue({ kind: 'strong', value: m[2], quoted: true, separator: '=', mode: 'config' }),
      },
    ],
  },
  {
    id: 'config-directive-secret',
    description:
      'password on a whitespace-delimited service directive: Redis requirepass / masterauth / sentinel auth-pass / ACL >password, Mosquitto, HAProxy userlist, msmtp, fetchmail, nginx / Apache header and variable directives, ssl_passphrase_command, OpenVPN inline credentials',
    hint: /secret|passw|pwd|pass|token|credential|key|auth|user[ \t]|header/i,
    matchers: [
      {
        // redis.conf: requirepass P, masterauth P, tls-key-file-pass P, tls-client-key-file-pass P; and the same as command-line options
        // (redis-server --requirepass P) or commands (CONFIG SET requirepass P). group 1 is set when the directive starts its line.
        pattern: new RegExp(
          String.raw`(?:^([ \t]*)|--|\bset[ \t]+)(?:requirepass|masterauth|tls-key-file-pass|tls-client-key-file-pass)(?:[ \t]+|=|["'][ \t]{0,4},[ \t]{0,4}["'])${DIRECTIVE_VALUE}`,
          'gim',
        ),
        accept: (m, ctx) => (m[1] === undefined || directiveContextOk(m, ctx)) && directiveIsSecret(directiveValue(m.groups)),
      },
      {
        // sentinel.conf: sentinel auth-pass <master> P, sentinel requirepass P
        pattern: new RegExp(String.raw`^[ \t]*sentinel[ \t]+(?:auth-pass[ \t]+\S{1,256}|requirepass)[ \t]+${DIRECTIVE_VALUE}`, 'gim'),
        accept: (m, ctx) => directiveContextOk(m, ctx) && directiveIsSecret(directiveValue(m.groups)),
      },
      {
        // ACL rules: `user default on >P ~* +@all`, `user app on #<sha256> ...`, ACL SETUSER app on >P
        pattern: /^[ \t]*(?:user|ACL[ \t]+SETUSER)[ \t]+\S{1,256}[ \t]([^\n]{1,2000})$/gim,
        accept: (m, ctx) => directiveContextOk(m, ctx) && aclRulesHoldSecret(m[1]),
      },
      {
        // Files of a service that reads `name value`: redis, mosquitto (password P, bridge_password P, remote_password P), msmtp (password P),
        // tinyproxy. The NAME must be secret-like (nameKindFor), so `passwordeval`, `password_file` and `requirepass`-free lines pass.
        pattern: new RegExp(String.raw`^[ \t]*(?<name>[A-Za-z][A-Za-z0-9_.-]{0,127})[ \t]+${DIRECTIVE_VALUE}`, 'gm'),
        appliesTo: (ctx) => ctx.mode === 'config' && serviceConfigOf(ctx.path) !== null && serviceConfigOf(ctx.path) !== 'fetchmail',
        accept: (m, ctx) => {
          if (/^(?:BasicAuth|basicauth)$/.test(m.groups.name)) return false;
          const kind = nameKindFor(m.groups.name, ctx);
          const value = directiveValue(m.groups);
          // Only names that end in a secret noun: a weak name (`password_file`, `X-Vault-Key`) usually holds a path or an id.
          return kind === 'strong' && directiveIsSecret(value);
        },
      },
      {
        // tinyproxy.conf: BasicAuth <user> <password>
        pattern: new RegExp(String.raw`^[ \t]*BasicAuth[ \t]+\S{1,256}[ \t]+${DIRECTIVE_VALUE}`, 'gim'),
        appliesTo: (ctx) => ctx.mode === 'config' && serviceConfigOf(ctx.path) === 'tinyproxy',
        accept: (m) => directiveIsSecret(directiveValue(m.groups)),
      },
      {
        // .fetchmailrc: poll host protocol pop3 user "alice" password "P"  (also `with password P`)
        pattern: new RegExp(String.raw`(?<![A-Za-z0-9_-])password[ \t]+${DIRECTIVE_VALUE}`, 'gi'),
        appliesTo: (ctx) => ctx.mode === 'config' && serviceConfigOf(ctx.path) === 'fetchmail',
        accept: (m) => directiveIsSecret(directiveValue(m.groups)),
      },
      {
        // HAProxy userlist: user NAME [groups G] password HASH | insecure-password P   (a crypt(3) hash after `password` is not plaintext)
        pattern: new RegExp(String.raw`^[ \t]*user[ \t]+\S{1,256}[ \t]+(?:groups[ \t]+\S{1,256}[ \t]+)?(?<kind>insecure-password|password)[ \t]+${DIRECTIVE_VALUE}`, 'gim'),
        appliesTo: (ctx) => ctx.mode === 'config',
        accept: (m, ctx) => {
          if (!ctx.hasBefore('userlist', m.index, 8000)) return false;
          const value = directiveValue(m.groups);
          if (m.groups.kind.toLowerCase() === 'password' && /^\$\d[a-z]?\$/.test(value.text)) return false;
          return directiveIsSecret(value);
        },
      },
      {
        // HAProxy: stats auth USER:PASSWORD
        pattern: /^[ \t]*stats[ \t]+auth[ \t]+[^\s:]{1,256}:(\S{1,4096})/gim,
        appliesTo: (ctx) => ctx.mode === 'config',
        accept: (m) => directiveIsSecret({ text: m[1], quoted: false }),
      },
      {
        // nginx, Apache and HAProxy directives that set a header, a FastCGI / uwsgi parameter or a variable to a literal under a secret-like NAME:
        // proxy_set_header X-Api-Key "V";  fastcgi_param DB_PASSWORD V;  set $api_token "V";  SetEnv DB_PASSWORD V;  RequestHeader set X-Api-Key V
        pattern: new RegExp(
          String.raw`(?<![A-Za-z0-9_-])(?:proxy_set_header|more_set_headers|add_header|fastcgi_param|uwsgi_param|scgi_param|SetEnv|RequestHeader[ \t]+(?:set|add|append|merge)|Header[ \t]+(?:always[ \t]+)?(?:set|add|append|merge)|http-(?:request|response)[ \t]+(?:set|add)-header|set)[ \t]+["']?(?<name>\$?[A-Za-z_][A-Za-z0-9_.-]{0,127})["']?[ \t]+${DIRECTIVE_VALUE}`,
          'gi',
        ),
        accept: (m, ctx) => {
          if (!directiveContextOk(m, ctx)) return false;
          // The bare `set NAME value` is nginx only with a `$variable` (fish and csh also have `set`).
          if (/^set[ \t]/i.test(m[0]) && !m.groups.name.startsWith('$')) return false;
          const kind = nameKindFor(m.groups.name, ctx);
          const value = directiveValue(m.groups);
          // Only names that end in a secret noun: a weak name (`password_file`, `X-Vault-Key`) usually holds a path or an id.
          return kind === 'strong' && directiveIsSecret(value);
        },
      },
      {
        // postgresql.conf: ssl_passphrase_command = 'echo P'  (the passphrase written into the command)
        pattern: /(?<![A-Za-z0-9_-])ssl_passphrase_command[ \t]*(?:=[ \t]*)?'([^'\n]{1,1024})'/g,
        appliesTo: (ctx) => ctx.mode === 'config',
        accept: (m) => {
          const echo = /(?:^|[ \t;|&])(?:echo|printf)[ \t]+(?:-[A-Za-z]+[ \t]+)*(?:"([^"\n]{1,512})"|''([^'\n]{1,512})''|([^\s"'|;&]{1,512}))/.exec(m[1]);
          return echo !== null && directiveIsSecret({ text: echo[1] ?? echo[2] ?? echo[3], quoted: false });
        },
      },
      {
        // Erlang application config (RabbitMQ advanced.config / rabbitmq.config, sys.config): {default_pass, <<"P">>}, {password, "P"}
        pattern: /\{[ \t\r\n]{0,16}(?<name>[a-z][A-Za-z0-9_@]{0,127})[ \t\r\n]{0,16},[ \t\r\n]{0,16}(?:<<[ \t]{0,4})?"(?<dq>(?:[^"\\\n]|\\.){0,4096})"/g,
        appliesTo: (ctx) => ctx.mode === 'config' && /\.config(?:\.src)?$|\.app\.src$/i.test(ctx.path),
        accept: (m, ctx) => nameKindFor(m.groups.name, ctx) === 'strong' && directiveIsSecret({ text: unescapeQuoted(m.groups.dq), quoted: true }),
      },
      {
        // OpenVPN inline credentials: <auth-user-pass> / user / password / </auth-user-pass>
        hint: /<auth-user-pass>/,
        pattern: /<auth-user-pass>[ \t]*\r?\n[^\n]{0,256}\n([^\n<]{1,1024})\n[ \t]*<\/auth-user-pass>/g,
        accept: (m) => directiveIsSecret({ text: m[1].trim(), quoted: false }),
      },
      {
        // echo 'user:P' | chpasswd, chpasswd <<< "user:P": the password of a user account set from a script (a Dockerfile RUN line)
        hint: /chpasswd/,
        pattern: /(?:(?:echo|printf)[ \t]+(?:-[A-Za-z]+[ \t]+)*["']?[A-Za-z_][A-Za-z0-9_.-]{0,63}:([^\s"'|;&]{1,1024})["']?[ \t]*\|[ \t]*(?:sudo[ \t]+)?chpasswd|chpasswd[ \t]*<<<[ \t]*["']?[A-Za-z_][A-Za-z0-9_.-]{0,63}:([^\s"'|;&]{1,1024}))/g,
        accept: (m) => {
          const password = m[1] ?? m[2];
          return !/^\$/.test(password) && directiveIsSecret({ text: password, quoted: false });
        },
      },
    ],
  },
  {
    id: 'hardcoded-signing-key',
    description: 'jwt.sign / jwt.verify called with a random-looking string literal as the key',
    appliesTo: (ctx) => ctx.mode === 'code',
    hint: /\b(?:sign|verify)\b/,
    matchers: [
      {
        pattern: /\b(?:jwt|jsonwebtoken|jws)\.(?:sign|verify)\(([^;]{0,300}?),[ \t]*(["'`])([^"'`\n]{8,4096})\2/g,
        accept: (m) => isSecondArgument(m[1]) && looksRandom(m[3], GATES.codeStrong),
      },
    ],
  },
  {
    id: 'hardcoded-secret-fallback',
    description:
      'process.env.<SECRET-like name> || "<literal>" in code, including env["X"], destructuring defaults and os.getenv("X", "<literal>") (a hardcoded default secret)',
    appliesTo: (ctx) => ctx.mode === 'code',
    hint: SECRET_HINT,
    matchers: [
      {
        // group 1 = .NAME, 3 = ["NAME"], 5 = literal
        pattern: new RegExp(
          String.raw`${ENV_ROOT}(?:\.([A-Za-z_$][A-Za-z0-9_$]{0,1023})|\[\s*(["'\x60])([^"'\x60\]\n]{1,1023})\2\s*\])\s*(?:\|\||\?\?)\s*` +
            String.raw`(["'\x60])([^"'\x60\n]{1,4096})\4`,
          'g',
        ),
        accept: (m) => isSecretLikeName(m[1] ?? m[3]) && !m[5].includes('${'),
      },
      {
        // destructuring defaults: const { NAME = "x" } = process.env, with a secret-like NAME
        pattern: new RegExp(String.raw`\{([^{}]{1,500})\}\s*=\s*${ENV_ROOT}\b`, 'g'),
        accept: (m) => {
          const entry = /(?<![A-Za-z0-9_$])([A-Za-z_$][A-Za-z0-9_$]{0,1023})\s*=\s*(["'`])([^"'`\n]{1,4096})\2/g;
          return [...m[1].matchAll(entry)].some((e) => isSecretLikeName(e[1]) && !e[3].includes('${'));
        },
      },
      {
        // Python defaults: os.getenv("NAME", "x") and os.environ.get("NAME", "x"), with a secret-like NAME
        pattern: /\b(?:os\.environ\.get|os\.getenv|environ\.get|getenv)\(\s*(["'])([A-Za-z0-9_]{1,1023})\1\s*,\s*(["'])([^"'\n]{1,4096})\3/g,
        accept: (m) => isSecretLikeName(m[2]),
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

const lineBreakAfter = (text, from) => {
  const at = text.indexOf('\n', from);
  return at === -1 ? text.length : at;
};

/** The fenced code blocks of a Markdown text: [{ start, end, lang }] where start..end is the body (a fence left open runs to the end). */
function findFences(text) {
  const blocks = [];
  let open = null;
  for (const line of text.matchAll(/^[ \t]{0,3}(`{3,20}|~{3,20})[ \t]{0,8}([^\s`]{0,40})/gm)) {
    if (open === null) open = { start: lineBreakAfter(text, line.index + line[0].length), char: line[1][0], size: line[1].length, lang: line[2].toLowerCase() };
    else if (line[1][0] === open.char && line[1].length >= open.size && line[2] === '') {
      blocks.push({ start: open.start, end: line.index, lang: open.lang });
      open = null;
    }
  }
  if (open !== null) blocks.push({ start: open.start, end: text.length, lang: open.lang });
  return blocks;
}

function buildNewlineIndex(text) {
  const positions = [];
  let i = -1;
  while ((i = text.indexOf('\n', i + 1)) !== -1) positions.push(i);
  return positions;
}

/** 1-based line number of the character at `index`. */
function lineAt(newlines, index) {
  let lo = 0;
  let hi = newlines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (newlines[mid] < index) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
}

/** True when the allow marker sits on the given 1-based line. Cached per line: one minified line can hold thousands of matches. */
function lineHasAllowMarker(text, newlines, line, cache) {
  let known = cache.get(line);
  if (known === undefined) {
    const start = line === 1 ? 0 : newlines[line - 2] + 1;
    const end = line - 1 < newlines.length ? newlines[line - 1] : text.length;
    known = text.slice(start, end).includes(ALLOW_MARKER);
    cache.set(line, known);
  }
  return known;
}

/**
 * Scan one file's text. Pure: no I/O.
 * @returns {{path: string, line: number, rule: string}[]} findings, never the matched text
 */
export function scanText(filePath, text) {
  return scanRanges(filePath, text).map(({ path: p, line, rule }) => ({ path: p, line, rule }));
}

/** Like scanText, but each finding also carries `lastLine`, the last line its match spans, and valueFirst..valueLast, the line(s) of a separate value field. */
function scanRanges(filePath, text) {
  const findings = [];
  const seen = new Set();
  const markerCache = new Map();
  const lockfile = isLockfile(filePath);
  if (lockfile) text = sanitizeLockfile(text); // ordinary integrity digests are not scanned
  const formats = credentialFormats(filePath);
  const strict = STRICT_CREDENTIAL_FORMATS.some((tag) => formats.has(tag));
  let newlines = null;
  const newlineIndex = () => (newlines ??= buildNewlineIndex(text));
  const occurrences = new Map();
  let fences = null;
  const ctx = {
    path: filePath.split(path.sep).join('/'),
    mode: fileMode(filePath),
    formats,
    strict,
    lockfile,
    xml: isXmlConfigPath(filePath),
    minStrong: strict ? CREDENTIAL_FILE_MIN_LENGTH : MIN_STRONG_CONFIG_LENGTH,
    runsToEndOfLine: valueRunsToEndOfLine(filePath),
    catalog: isMessageCatalogPath(filePath),
    // Start of the line holding `index` and the index of its line break (text.length when it has none): O(log n).
    lineStart(index) {
      const line = lineAt(newlineIndex(), index);
      return line === 1 ? 0 : newlineIndex()[line - 2] + 1;
    },
    // Is there an occurrence of `needle` within `distance` characters before `index`? Occurrences are listed once per file.
    hasBefore(needle, index, distance) {
      let list = occurrences.get(needle);
      if (list === undefined) {
        list = [];
        for (let at = text.indexOf(needle); at !== -1 && list.length < 200_000; at = text.indexOf(needle, at + needle.length)) list.push(at);
        occurrences.set(needle, list);
      }
      let lo = 0;
      let hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid] <= index) lo = mid + 1;
        else hi = mid;
      }
      if (lo === 0) return false;
      // A list that hit its cap cannot say what lies beyond it: fail closed.
      return index - list[lo - 1] <= distance || (list.length >= 200_000 && lo === list.length);
    },
    lineEnd(index) {
      const line = lineAt(newlineIndex(), index);
      return line - 1 < newlineIndex().length ? newlineIndex()[line - 1] : text.length;
    },
    // The language tag of the Markdown code fence that holds `index` ('' for a bare fence), or undefined outside every fence.
    fenceLang(index) {
      fences ??= findFences(text);
      let lo = 0;
      let hi = fences.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (fences[mid].end <= index) lo = mid + 1;
        else hi = mid;
      }
      return lo < fences.length && fences[lo].start <= index ? fences[lo].lang : undefined;
    },
  };
  for (const rule of RULES) {
    if (lockfile && !rule.lockfile) continue; // lockfiles: targeted rules only (see LOCKFILE_NAMES)
    if (rule.appliesTo && !rule.appliesTo(ctx)) continue;
    // The name hint is a speed-up for ordinary files; a credential file is always scanned in full.
    if (rule.hint && !strict && !rule.hint.test(text)) continue;
    for (const matcher of rule.matchers) {
      if (matcher.appliesTo && !matcher.appliesTo(ctx)) continue;
      if (matcher.hint && !matcher.hint.test(text)) continue;
      for (const match of text.matchAll(matcher.pattern)) {
        newlineIndex();
        const line = lineAt(newlines, match.index);
        const key = `${rule.id}:${line}`;
        if (seen.has(key)) continue; // already reported for this line: nothing to decide, and it keeps a hostile line cheap
        if (matcher.accept && !matcher.accept(match, ctx)) continue;
        if (isPathSample(ctx.path, text.slice(match.index, match.spanEnd ?? match.index + match[0].length))) continue;
        const lastLine = lineAt(newlines, match.index + Math.max((match.spanEnd ?? match.index + match[0].length) - match.index - 1, 0));
        // The lines the finding rests on (--history and --range blame a commit that added one of them): the match, plus the
        // separate value of a name/value pair (valueFirst..valueLast; the match itself when there is none).
        const valueFirst = match.attrStart === undefined ? line : lineAt(newlines, match.attrStart);
        const valueLast = match.attrEnd === undefined ? lastLine : lineAt(newlines, Math.max(match.attrEnd - 1, 0));
        // The marker may sit on any line the match spans (a match can run across lines), or on a line of the separate value
        // of a name/value pair, in either order. A marker on an unrelated line between the two does not count.
        let allowed = false;
        for (let l = line; l <= lastLine && !allowed; l += 1) allowed = lineHasAllowMarker(text, newlines, l, markerCache);
        if (!allowed && match.attrStart !== undefined && !match.attrCoarse) {
          for (let l = valueFirst; l <= valueLast && !allowed; l += 1) allowed = lineHasAllowMarker(text, newlines, l, markerCache);
        }
        if (allowed) continue;
        seen.add(key);
        findings.push({ path: filePath, line, lastLine, valueFirst, valueLast, rule: rule.id });
      }
    }
  }
  return findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, maxBuffer: 512 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args[0]} failed (is this a git repository?)`);
  }
  return result.stdout;
}

function findRepoRoot(cwd) {
  return git(['rev-parse', '--show-toplevel'], cwd).toString('utf8').trim();
}

function readHead(absolutePath) {
  const fd = openSync(absolutePath, 'r');
  try {
    const buffer = Buffer.alloc(SNIFF_BYTES);
    const bytes = readSync(fd, buffer, 0, SNIFF_BYTES, 0);
    return buffer.subarray(0, bytes);
  } finally {
    closeSync(fd);
  }
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

/** A path for messages and for the file-mode rules. Valid UTF-8 as is; otherwise every byte above 0x7e is shown as \xNN. */
function displayPath(raw) {
  try {
    return strictUtf8.decode(raw);
  } catch {
    return raw.toString('latin1').replace(/[\u007f-ÿ]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
  }
}

/**
 * Every tracked path from `git ls-files -s -z`, as raw bytes. The list is NUL-delimited and never decoded as a
 * whole: a file name may hold bytes that are not UTF-8 (allowed on Unix), and a lossy decode would name a file
 * that does not exist. Unmerged paths appear once per stage: they are listed once, with every distinct object and the
 * mode it has in its own stage (the stages of one path can differ: a gitlink in one, a regular file in another).
 * @returns {{raw: Buffer, objects: {mode: string, sha: string}[]}[]} every distinct (mode, object id) of the path
 */
function listTracked(root) {
  const out = git(['ls-files', '-s', '-z'], root);
  const entries = new Map();
  let start = 0;
  while (start < out.length) {
    let end = out.indexOf(0, start);
    if (end === -1) end = out.length;
    const record = out.subarray(start, end);
    start = end + 1;
    if (record.length === 0) continue;
    const tab = record.indexOf(9);
    const [mode, sha] = tab === -1 ? [] : record.subarray(0, tab).toString('latin1').split(' ');
    if (!mode || !sha) throw new Error('git ls-files printed a record this scanner cannot parse');
    const raw = Buffer.from(record.subarray(tab + 1));
    const key = raw.toString('latin1');
    const known = entries.get(key);
    if (!known) entries.set(key, { raw, objects: [{ mode, sha }] });
    else if (!known.objects.some((o) => o.mode === mode && o.sha === sha)) known.objects.push({ mode, sha });
  }
  return [...entries.values()];
}

/** The git object id of file content stored as a blob, in the repository's hash (sha1 or sha256, told apart by the id length). */
function blobId(bytes, referenceId) {
  const algorithm = referenceId.length === 64 ? 'sha256' : 'sha1';
  return createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/**
 * The git blob id of a file, hashed in 1 MB chunks so a file over the size limit is never held in memory. `size` is the size
 * lstat reported; a file that changed size while it was read gets an id that matches nothing (the caller then treats the
 * index versions as differing, which is the safe direction). Throws when the file cannot be read.
 */
function streamBlobId(absolute, size, referenceId) {
  const hash = createHash(referenceId.length === 64 ? 'sha256' : 'sha1').update(`blob ${size}\0`);
  const fd = openSync(absolute, 'r');
  try {
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    let total = 0;
    for (;;) {
      const n = readSync(fd, chunk, 0, chunk.length, null);
      if (n === 0) break;
      hash.update(chunk.subarray(0, n));
      total += n;
    }
    return total === size ? hash.digest('hex') : '';
  } finally {
    closeSync(fd);
  }
}

/**
 * The content of several blobs from the index, in two `git cat-file --batch*` calls in total: sizes first (so a blob
 * over the size limit is never read into memory), then the contents.
 * @returns {Map<string, {size: number, bytes: Buffer | null}>} bytes is null for a blob over MAX_LOCKFILE_BYTES (the callers apply the per-path limit); a blob git
 *   could not produce is missing from the map (the caller treats that as unreadable)
 */
function readIndexBlobs(root, shas) {
  const result = new Map();
  if (shas.length === 0) return result;
  const request = (mode, ids) => {
    const run = spawnSync('git', ['cat-file', mode], { cwd: root, input: `${ids.join('\n')}\n`, maxBuffer: 1024 * 1024 * 1024 });
    if (run.error || run.status !== 0) throw new Error(`git cat-file failed`);
    return run.stdout;
  };
  const sizes = new Map();
  for (const line of request('--batch-check', shas).toString('latin1').split('\n')) {
    const parts = line.split(' ');
    if (parts.length === 3 && parts[1] === 'blob' && /^\d+$/.test(parts[2])) sizes.set(parts[0], Number(parts[2]));
  }
  const readable = shas.filter((sha) => sizes.has(sha) && sizes.get(sha) <= MAX_LOCKFILE_BYTES);
  for (const sha of shas) {
    if (sizes.has(sha) && sizes.get(sha) > MAX_LOCKFILE_BYTES) result.set(sha, { size: sizes.get(sha), bytes: null });
  }
  if (readable.length === 0) return result;
  const stdout = request('--batch', readable);
  let cursor = 0;
  for (const sha of readable) {
    const headerEnd = stdout.indexOf(10, cursor);
    if (headerEnd === -1) break;
    const [id, type, size] = stdout.subarray(cursor, headerEnd).toString('latin1').split(' ');
    if (id !== sha || type !== 'blob' || !/^\d+$/.test(size ?? '')) break;
    const bodyStart = headerEnd + 1;
    const bodyEnd = bodyStart + Number(size);
    if (bodyEnd > stdout.length) break;
    result.set(sha, { size: Number(size), bytes: Buffer.from(stdout.subarray(bodyStart, bodyEnd)) });
    cursor = bodyEnd + 1;
  }
  return result;
}

/**
 * Scan every git-tracked file under `root`: the working-tree content (what CI checked out) AND the version staged in
 * the index whenever the two differ, so a secret cannot be staged and then swapped for a placeholder in the working
 * tree before the commit. The two are compared by git blob id (one hash of bytes already read); only files that
 * differ cost an extra read, batched into one `git cat-file --batch`. A CI checkout has none.
 *  - gitlinks (submodule commit pointers: no content here) and files with binary content are skipped on purpose,
 *    and counted in `skipped`; lockfiles are scanned with the lockfile rules (see isLockfile);
 *  - a symlink is scanned as its link target;
 *  - a file the index lists but the working tree no longer has (deleted, or skip-worktree) is scanned from the
 *    index blob instead, so nothing tracked goes unexamined (`fromIndex` names them);
 *  - an unmerged path is scanned with every stage's blob, and the working-tree file besides;
 *  - a file that exists but cannot be read (permissions, wrong type, I/O error) is NOT scanned and is listed in
 *    `unreadable`; a text file over the size limit (either version) is listed in `oversize`. The CLI fails on both.
 * A finding in a file that has a differing second version carries `source`: 'index' or 'working tree'.
 * @returns {{findings: object[], scanned: number, skipped: Record<string, number>, oversize: string[], unreadable: string[], fromIndex: string[], differing: string[]}}
 */
export function scanTree(root) {
  const findings = [];
  const skipped = {};
  const oversize = [];
  const unreadable = [];
  const fromIndex = [];
  const differing = [];
  let scanned = 0;
  const skip = (reason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };
  const rootBytes = Buffer.from(root);
  const pending = []; // index versions still to read: { file, sha, missing }
  for (const { raw, objects } of listTracked(root)) {
    const file = displayPath(raw);
    // Only a gitlink (a submodule commit pointer, no content here) is skipped, and only its own stage: every other
    // stage of an unmerged path is a file and is scanned, whatever mode the gitlink stage has.
    const files = objects.filter((o) => o.mode !== '160000');
    if (files.length < objects.length) skip('submodule');
    if (files.length === 0) continue;
    const sha = files[0].sha;
    const shas = [...new Set(files.map((o) => o.sha))];
    const hasLink = files.some((o) => o.mode === '120000');
    const hasFile = files.some((o) => o.mode !== '120000');
    const absolute = Buffer.concat([rootBytes, Buffer.from(path.sep), raw]);
    let bytes;
    let missing = false;
    try {
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        if (!hasLink) throw new Error('not a regular file');
        bytes = readlinkSync(absolute, 'buffer');
      } else {
        if (!stat.isFile() || !hasFile) throw new Error(hasFile ? 'not a regular file' : 'not a symlink');
        if (stat.size > sizeLimit(file)) {
          // Too large to read into memory here, but the staged version is still checked first: the working-tree copy
          // (a big binary, or an oversize text file) must not hide a differing index blob. The copy is hashed in chunks.
          const workingId = streamBlobId(absolute, stat.size, sha);
          const otherVersions = shas.filter((blob) => blob !== workingId);
          if (otherVersions.length > 0) {
            differing.push(file);
            for (const blob of otherVersions) pending.push({ file, sha: blob, missing: false });
          }
          if (isBinaryContent(readHead(absolute))) skip('binary');
          else oversize.push(file);
          continue;
        }
        bytes = readFileSync(absolute);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        unreadable.push(file);
        // The working-tree entry cannot be read, but the staged versions still can: they are scanned too.
        for (const blob of shas) pending.push({ file, sha: blob, missing: false });
        continue;
      }
      missing = true;
    }
    if (missing) {
      fromIndex.push(file);
      for (const blob of shas) pending.push({ file, sha: blob, missing: true });
      continue;
    }
    // The index blob that differs from the working-tree bytes (all of them for an unmerged path) is scanned too.
    const workingId = blobId(bytes, sha);
    const otherVersions = shas.filter((blob) => blob !== workingId);
    if (otherVersions.length > 0) {
      differing.push(file);
      for (const blob of otherVersions) pending.push({ file, sha: blob, missing: false });
    }
    const text = decodeText(bytes);
    if (text === null) {
      skip('binary');
      continue;
    }
    scanned += 1;
    for (const finding of scanText(file, text)) {
      findings.push(otherVersions.length > 0 ? { ...finding, source: 'working tree' } : finding);
    }
  }

  if (pending.length > 0) {
    let blobs = new Map();
    try {
      blobs = readIndexBlobs(root, [...new Set(pending.map((p) => p.sha))]);
    } catch {
      // every pending version stays unreadable below
    }
    const reported = new Set();
    for (const { file, sha, missing } of pending) {
      const blob = blobs.get(sha);
      if (blob === undefined) {
        if (!reported.has(`${file}\0u`)) unreadable.push(file);
        reported.add(`${file}\0u`);
        continue;
      }
      if (blob.bytes === null || blob.size > sizeLimit(file)) {
        if (!reported.has(`${file}\0o`) && !oversize.includes(file)) oversize.push(file);
        reported.add(`${file}\0o`);
        continue;
      }
      const text = decodeText(blob.bytes);
      if (text === null) {
        skip(missing ? 'binary' : 'binary (staged version)');
        continue;
      }
      if (missing) scanned += 1;
      for (const finding of scanText(file, text)) findings.push({ ...finding, source: 'index' });
    }
  }
  return { findings, scanned, skipped, oversize, unreadable, fromIndex, differing };
}

/** Decode a path git printed C-style quoted ("b/we\"ird/a.env", octal escapes for control bytes). */
function unquoteGitPath(quoted) {
  const escapes = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '\\': 92, '"': 34 };
  const bytes = [];
  const body = quoted.slice(1);
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '"') break;
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'));
    } else if (/[0-7]/.test(body[i + 1] ?? '')) {
      const octal = /^[0-7]{1,3}/.exec(body.slice(i + 1))[0];
      bytes.push(parseInt(octal, 8) & 0xff);
      i += octal.length;
    } else {
      bytes.push(escapes[body[i + 1]] ?? body[i + 1].charCodeAt(0));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

const printable = (p) => String(p).replace(/[\u0000-\u001f\u007f]/g, '?');

/** First line of git's stderr, cleaned. In the failure modes seen so far it names refs and objects, never file content. */
function summarizeStderr(stderr) {
  const first = stderr.trim().split('\n')[0] ?? '';
  return first === '' ? '' : `: ${printable(first).slice(0, 200)}`;
}

// Unchanged context kept around each change, so a split "name: X / value: Y" pair whose name line did not change can
// still be recognised. Context lines are never reported by themselves. It is derived from the constants the pair matcher
// (and the other multi-line rules: PEM headers, netrc tokens, mapping keys) look back and forward with, so the two cannot
// drift apart. The YAML window and the multi-line literal reader count LINES; the brace and XML windows count CHARACTERS.
// A character window is kept as characters: context lines are retained until their text (each line plus its newline, as
// the scanned text holds it) covers the window, however short or blank the lines are. No line length is assumed anywhere.
const HISTORY_CONTEXT_LINES = Math.max(
  PAIR_YAML_LINES,
  MULTILINE_MAX_LINES + 1, // a heredoc / triple-quoted body and its closing line
);
const HISTORY_CONTEXT_CHARS = Math.max(PAIR_BACK_CHARS, PAIR_FORWARD_CHARS, PAIR_XML_CHARS);
// The unified context git is asked for. Every line is at least its own newline, so a window of N characters never spans
// more than N lines: asking git for that many lines (it stops at the file's ends) always supplies enough to fill the window.
export const HISTORY_CONTEXT = Math.max(HISTORY_CONTEXT_LINES, HISTORY_CONTEXT_CHARS);
// A lockfile is scanned with single-line rules only (no name/value pairing), so a bump that touches a big lockfile in
// many places must not drag hundreds of unchanged lines around every change into the text that is size-checked and scanned.
const HISTORY_LOCKFILE_CONTEXT = { lines: 2, chars: 0 };
const HISTORY_TEXT_CONTEXT = { lines: HISTORY_CONTEXT_LINES, chars: HISTORY_CONTEXT_CHARS };

/**
 * The first SNIFF_BYTES bytes of `path` as it is in `commit` (`git cat-file blob <commit>:<path>`), or null when git
 * cannot produce them. The read is bounded: spawnSync stops the child at SNIFF_BYTES, so a huge blob is never held.
 */
function blobHead(root, commit, filePath) {
  const run = spawnSync('git', ['cat-file', 'blob', `${commit}:${filePath}`], {
    cwd: root,
    maxBuffer: SNIFF_BYTES,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const complete = run.status === 0 && !run.error;
  const cut = run.error?.code === 'ENOBUFS' && run.stdout && run.stdout.length > 0; // longer than SNIFF_BYTES: the head is what was wanted
  return complete || cut ? Buffer.from(run.stdout).subarray(0, SNIFF_BYTES) : null;
}

/** True only when the tree scan would also skip this version as binary: the same isBinaryContent test on the same first 8 KB. */
const versionIsVerifiedBinary = (root, commit, filePath) => {
  const head = blobHead(root, commit, filePath);
  return head !== null && isBinaryContent(head);
};

/** The path a `diff --git a/P b/P` (or `diff --cc P`) header names, or null when it cannot be told exactly (quoted, renamed). */
function diffHeaderPath(header) {
  const combined = /^diff --(?:cc|combined) (.+)$/.exec(header);
  if (combined) return combined[1].startsWith('"') ? unquoteGitPath(combined[1]) : combined[1];
  const rest = header.slice('diff --git '.length);
  const half = (rest.length - 5) / 2;
  if (!Number.isInteger(half) || half < 1 || rest.startsWith('"')) return null;
  const left = rest.slice(2, 2 + half);
  return rest.startsWith('a/') && rest.slice(2 + half, 5 + half) === ' b/' && rest.slice(5 + half) === left ? left : null;
}

// Longest git output line that is held whole. A longer line is fed to the parser cut at this length and the rest is
// dropped: no line that long can be a header, and an added line that long is over every size limit (it is reported
// as oversize or, if the version is a verified binary, skipped), so nothing that is scanned as text is lost.
const MAX_HELD_LINE_CHARS = MAX_LOCKFILE_BYTES + 2;

/**
 * Scan every commit reachable from any ref, reporting only matches that touch a line the commit ADDED.
 * Unchanged context lines are scanned together with the added ones (so multi-line rules can see the
 * name next to a new value) but a match made only of context lines belongs to an earlier commit.
 * Merge commits are shown as combined diffs (--cc), so only lines that the merge itself introduced
 * (conflict resolutions) are scanned; everything else was added by a parent and is reported there.
 * @returns {Promise<{hits: {commit: string, path: string, rule: string, count: number}[], commits: number, oversize: number, oversizeLimits: Map<number, number>, unscanned: number, skipped: Record<string, number>}>}
 * `unscanned` counts every file version whose added lines were not examined (oversize, or content git would not show).
 * `skipped` counts the file versions left out on purpose, as the tree scan does: a verified binary (see isBinaryContent, checked
 * on the version's own first 8 KB, so a binary asset over the size limit does not count as oversize) is `binary`.
 * `revisions` selects the commits (default every ref; range mode passes `<head> --not <base>`, so the walk and the diffs
 * cost what the range holds, not what the repository holds); `maxCount` limits the walk (range mode with an unknown base).
 */
async function scanHistory(root, { revisions = ['--all'], maxCount = null } = {}) {
  const child = spawn(
    'git',
    [
      '-c', 'core.quotepath=false',
      'log', ...(maxCount === null ? [] : [`--max-count=${maxCount}`]), '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--text',
      '-p', '--cc', `-U${HISTORY_CONTEXT}`, '--format=commit %H',
      ...revisions, '--',
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    if (stderr.length < 4096) stderr += chunk.toString('utf8');
  });
  const exited = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });

  const hits = new Map();
  let commits = 0;
  let oversize = 0;
  const oversizeLimits = new Map(); // size limit in bytes -> file versions over it (the limit differs per path)
  let unscanned = 0; // file versions whose added lines were NOT examined, for any reason (oversize included)
  const skipped = {}; // file versions left out on purpose, by reason: the same accounting as the tree scan ('binary')
  let commit = null;
  let file = null;
  let headerPath = null; // the path named by the current `diff` header, for versions git prints as one "Binary files" line
  let inHunk = false;
  let parents = 1;
  let lines = []; // added lines and the context around them (see contextFor) of the current file; gaps are a blank line
  let addedLines = new Set(); // 1-based indexes into `lines` of the lines this commit added
  let addedAny = false; // this version had an added line, even one that overflowed the size limit before it could be indexed
  let textChars = 0; // characters held in `lines`
  let overflow = false; // the retained text passed the file's size limit: stop collecting, report it as oversize
  let recent = []; // context lines seen since the last kept line: the newest ones that cover contextFor(file) (lines AND characters)
  let recentChars = 0; // characters (lines plus newlines) in `recent`
  let dropped = false; // context lines were left out since the last kept line
  let afterLines = 0; // context lines still to keep after the last added line ...
  let afterChars = 0; // ... and characters still to cover; a line is kept while either is left
  const contextFor = (path) => (isLockfile(path) ? HISTORY_LOCKFILE_CONTEXT : HISTORY_TEXT_CONTEXT);
  // Drop the oldest held context line while the rest still covers the window (enough lines AND enough characters), or
  // while what is held could not fit the file's size limit anyway (bounded memory, whatever the line lengths).
  const trimRecent = () => {
    const window = contextFor(file ?? '');
    const limit = file === null ? Infinity : sizeLimit(file);
    while (
      recent.length > 0 &&
      ((recent.length > window.lines && recentChars - (recent[0].length + 1) >= window.chars) || recentChars > limit)
    ) {
      recentChars -= recent.shift().length + 1;
      dropped = true;
    }
  };
  const keep = (line) => {
    textChars += line.length + 1;
    if (file !== null && textChars > sizeLimit(file)) overflow = true;
    if (!overflow) lines.push(line);
  };

  const flush = () => {
    if (commit && !file && addedAny) {
      unscanned += 1; // added lines under a header this parser could not attribute to a path
    } else if (commit && file && addedAny) {
      let text = lines.join('\n');
      // UTF-16 files (and binary blobs) show up with NUL bytes; drop them so ASCII content stays scannable.
      const hadNul = text.includes('\u0000');
      if (hadNul) text = text.replace(/[\u0000�]/g, '');
      const tooLarge = overflow || text.length > sizeLimit(file);
      if ((tooLarge || hadNul) && versionIsVerifiedBinary(root, commit, file)) {
        // A verified binary (the tree scan's own test, on the version's own first 8 KB) is skipped whatever its size: a
        // large image must not be judged by the text size limit. Anything else, a NUL-prefixed text file included, goes on.
        skipped.binary = (skipped.binary ?? 0) + 1;
      } else if (tooLarge) {
        oversize += 1;
        unscanned += 1;
        oversizeLimits.set(sizeLimit(file), (oversizeLimits.get(sizeLimit(file)) ?? 0) + 1);
      } else {
        for (const finding of scanRanges(file, text)) {
          let touchesAddedLine = false;
          for (let l = finding.line; l <= finding.lastLine && !touchesAddedLine; l += 1) touchesAddedLine = addedLines.has(l);
          for (let l = finding.valueFirst; l <= finding.valueLast && !touchesAddedLine; l += 1) touchesAddedLine = addedLines.has(l);
          if (!touchesAddedLine) continue;
          const key = `${commit}\t${file}\t${finding.rule}`;
          const entry = hits.get(key) ?? { commit, path: file, rule: finding.rule, count: 0 };
          entry.count += 1;
          hits.set(key, entry);
        }
      }
    }
    lines = [];
    addedLines = new Set();
    addedAny = false;
    textChars = 0;
    overflow = false;
    recent = [];
    recentChars = 0;
    dropped = false;
    afterLines = 0;
    afterChars = 0;
  };

  const onLine = (line) => {
    if (/^commit [0-9a-f]{40,64}$/.test(line)) {
      flush();
      commit = line.slice(7);
      commits += 1;
      file = null;
      headerPath = null;
      inHunk = false;
    } else if (/^diff --(?:git|cc|combined) /.test(line)) {
      flush();
      file = null;
      headerPath = diffHeaderPath(line);
      inHunk = false;
      parents = 1;
    } else if (!inHunk && line.startsWith('Binary files ')) {
      // git refused to show this version's content (for example above core.bigFileThreshold). Only a verified binary is
      // left out (counted, as the tree scan counts it); anything else, or a path this parser cannot name, is unscanned.
      if (headerPath !== null && versionIsVerifiedBinary(root, commit, headerPath)) skipped.binary = (skipped.binary ?? 0) + 1;
      else unscanned += 1;
    } else if (line.startsWith('@@')) {
      inHunk = true;
      parents = Math.max(1, line.match(/^@+/)[0].length - 1); // "@@@" hunks belong to 2-parent merges
      if (lines.length > 0) keep(''); // keep lines from different hunks from looking adjacent
      recent = [];
      recentChars = 0;
      dropped = false;
      afterLines = 0;
      afterChars = 0;
    } else if (!inHunk) {
      if (line.startsWith('+++ ')) {
        const raw = line.slice(4);
        const target = raw.startsWith('"') ? unquoteGitPath(raw) : raw.replace(/\t.*$/, '');
        file = target === '/dev/null' ? null : target.replace(/^b\//, '');
      }
    } else if (line.length >= parents && !line.startsWith('\\')) {
      const marks = line.slice(0, parents);
      if (marks.includes('-')) return; // gone from the result
      const content = line.slice(parents);
      if (marks === '+'.repeat(parents)) {
        // An added line: the context before it (up to the window), then the line itself, then the window after it.
        if (dropped && lines.length > 0) keep('');
        for (const held of recent) keep(held);
        recent = [];
        recentChars = 0;
        dropped = false;
        keep(content);
        addedAny = true; // an added line that is over the limit on its own still makes this version unscanned
        if (!overflow) addedLines.add(lines.length);
        ({ lines: afterLines, chars: afterChars } = contextFor(file ?? ''));
      } else if (afterLines > 0 || afterChars > 0) {
        keep(content);
        afterLines -= 1;
        afterChars -= content.length + 1;
      } else {
        recent.push(content);
        recentChars += content.length + 1;
        trimRecent();
      }
    }
  };

  // Split on "\n" only. readline would also split on a lone CR and lose the continuation.
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let discarding = false; // inside the rest of a line that was cut at MAX_HELD_LINE_CHARS
  for await (const chunk of child.stdout) {
    pending += decoder.write(chunk);
    let start = 0;
    let newline;
    if (discarding) {
      newline = pending.indexOf('\n');
      if (newline === -1) {
        pending = '';
        continue;
      }
      start = newline + 1;
      discarding = false;
    }
    while ((newline = pending.indexOf('\n', start)) !== -1) {
      onLine(pending.slice(start, newline));
      start = newline + 1;
    }
    pending = pending.slice(start);
    if (pending.length > MAX_HELD_LINE_CHARS) {
      // One line longer than any size limit (a binary blob with few newline bytes): parse its head once and drop the
      // rest of it, so memory stays bounded whatever the blob size. See MAX_HELD_LINE_CHARS.
      onLine(pending.slice(0, MAX_HELD_LINE_CHARS));
      pending = '';
      discarding = true;
    }
  }
  pending += decoder.end();
  if (pending !== '') onLine(pending);
  flush();

  const code = await exited;
  if (code !== 0) throw new Error(`git log failed with exit code ${code}${summarizeStderr(stderr)}`);
  return { hits: [...hits.values()], commits, oversize, oversizeLimits, unscanned, skipped };
}

// ---------------------------------------------------------------------------
// Reporting (path, line, rule, commit and counts only)
// ---------------------------------------------------------------------------

const describeRule = (id) => RULES.find((rule) => rule.id === id)?.description ?? id;

/** Format tree-scan findings. The output cannot contain matched text: findings never hold it. */
export function formatReport(findings) {
  const lines = [
    `check-secrets: ${findings.length} potential secret${findings.length === 1 ? '' : 's'} found (values are never printed)`,
    '',
  ];
  for (const f of findings) lines.push(`  ${printable(f.path)}:${f.line}  ${f.rule}${f.source ? `  (${f.source})` : ''}`);
  const rules = [...new Set(findings.map((f) => f.rule))];
  lines.push('', 'Rules triggered:');
  for (const id of rules) lines.push(`  ${id}: ${describeRule(id)}`);
  lines.push(
    '',
    'If this is a real credential: remove it, rotate it (see SECURITY_NOTICE.md), do not just delete the line.',
    `If it is a false positive: use an obvious placeholder, or add "${ALLOW_MARKER}" in a comment on that line.`,
  );
  return lines.join('\n');
}

const MB = 1024 * 1024;
/** The size limit applied to a limit value, and the constant that sets it (a lockfile has its own). */
const limitName = (bytes) => (bytes === MAX_LOCKFILE_BYTES ? 'MAX_LOCKFILE_BYTES' : 'MAX_FILE_BYTES');

/** Format the text files that were too large to scan. Each path is reported against the limit that was applied to IT. */
export function formatOversizeReport(paths) {
  const limits = [...new Set(paths.map((p) => sizeLimit(p)))].sort((a, b) => a - b);
  const names = limits.map(limitName);
  const single = limits.length === 1 ? `${limits[0] / MB} MB` : 'their size limit';
  return [
    `check-secrets: ${paths.length} tracked text file${paths.length === 1 ? '' : 's'} over ${single} NOT scanned:`,
    ...paths.map((p) => `  ${printable(p)}  (over ${sizeLimit(p) / MB} MB, ${limitName(sizeLimit(p))})`),
    `A file this size cannot be checked for secrets. Split it, move it out of git, or review it by hand and raise ${names.join(' / ')}.`,
  ].join('\n');
}

/** `oversizeLimits`: Map of size limit in bytes to the number of file versions over it. */
const describeUnscanned = (unscanned, oversize, oversizeLimits = new Map()) => {
  const entries = [...oversizeLimits].sort((a, b) => a[0] - b[0]);
  const detail = entries.length === 0
    ? `${oversize} over the ${MAX_FILE_BYTES / MB} MB limit`
    : entries.map(([bytes, n]) => `${n} over the ${bytes / MB} MB ${bytes === MAX_LOCKFILE_BYTES ? 'lockfile ' : ''}limit`).join(', ');
  const names = entries.map(([bytes]) => limitName(bytes));
  return (
    `${unscanned} file version${unscanned === 1 ? '' : 's'} NOT scanned` +
    (oversize > 0 ? ` (${detail})` : '') +
    ', so this audit is incomplete.' +
    (oversize > 0 ? ` The size limit${names.length === 1 ? ' is' : 's are'} ${(names.length === 0 ? ['MAX_FILE_BYTES'] : names).join(' and ')}.` : '')
  );
};

/** Format the tracked files that could not be read. */
export function formatUnreadableReport(paths) {
  return [
    `check-secrets: ${paths.length} tracked file${paths.length === 1 ? '' : 's'} could NOT be read, so ${paths.length === 1 ? 'it was' : 'they were'} NOT scanned:`,
    ...paths.map((p) => `  ${printable(p)}`),
    'An unreadable file is never treated as clean. Fix its permissions or type (or remove it from git), then run again.',
  ].join('\n');
}

/** Format history-scan hits: commit, path, rule and counts only. */
export function formatHistoryReport(hits, { commits = 0, shallow = false, oversize = 0, unscanned = oversize, label = '--history', oversizeLimits = undefined } = {}) {
  const lines = [];
  if (shallow) {
    lines.push(
      'warning: this is a shallow clone, so only part of the history was scanned.',
      '         Run "git fetch --unshallow" (or scan a full clone) for a complete answer.',
      '',
    );
  }
  if (unscanned > 0) lines.push(`warning: ${describeUnscanned(unscanned, oversize, oversizeLimits)}`, '');
  const distinctCommits = new Set(hits.map((h) => h.commit)).size;
  lines.push(
    `check-secrets ${label}: ${hits.length} hit${hits.length === 1 ? '' : 's'} in ${distinctCommits} of ${commits} commit${commits === 1 ? '' : 's'} (values are never printed)`,
    '',
  );
  for (const h of hits) {
    lines.push(`  ${h.commit.slice(0, 7)}  ${printable(h.path)}  ${h.rule}  x${h.count}`);
  }
  lines.push(
    '',
    'Hits in history cannot be undone by deleting a line. Rotate the credential first; scrubbing history is optional.',
  );
  return lines.join('\n');
}

const describeSkipped = (skipped) => {
  const entries = Object.entries(skipped);
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  return { total, detail: entries.length === 0 ? '' : `: ${entries.map(([reason, n]) => `${n} ${reason}`).join(', ')}` };
};

/** " (2 skipped: 2 binary)" for the history and range summaries, or nothing when no version was left out on purpose. */
const skippedNote = (skipped) => {
  const { total, detail } = describeSkipped(skipped);
  return total === 0 ? '' : ` (${total} skipped${detail})`;
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: node scripts/check-secrets.mjs [--history | --range <base>..<head>]

  (no flags)  scan all git-tracked text files; exit 1 on any finding
  --history   scan added lines of every commit on every ref (owner-run, not for CI)
  --range     scan added lines of the commits reachable from <head> but not from <base> (what CI runs on a pull
              request or push: catches a secret committed and removed again inside the range). Needs full history:
              a shallow clone or a commit that is not present exits 2. An all-zero <base> (a new branch) scans the
              <head> commit only.
  --help      show this message

The report lists file path, line number and rule name only. Matched text is never printed.
`;

/** Parse the command line: at most one of --history and --range <base>..<head> (or --range=<base>..<head>). */
function parseArguments(argv) {
  let history = false;
  let range = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--history') history = true;
    else if (arg === '--range' || arg.startsWith('--range=')) {
      const value = arg === '--range' ? argv[(i += 1)] : arg.slice('--range='.length);
      if (range !== null) return { error: '--range given twice' };
      if (value === undefined) return { error: '--range needs a <base>..<head> value' };
      range = value;
    } else return { error: 'unknown argument' };
  }
  if (history && range !== null) return { error: '--history and --range cannot be combined' };
  return { history, range, error: null };
}

const ZERO_ID = /^0{40}(?:0{24})?$/;

/** Resolve a revision to a full commit id, or null. The value is never an option: it is passed after --end-of-options. */
function resolveCommit(root, revision) {
  const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', '--end-of-options', `${revision}^{commit}`], { cwd: root });
  if (result.error || result.status !== 0) return null;
  const id = result.stdout.toString('utf8').trim();
  return /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(id) ? id : null;
}

/**
 * --range <base>..<head>: scan the added lines of the commits reachable from head and not from base (`git log head --not base`,
 * so base need not be an ancestor: a pull request is judged by what it adds, wherever its base has moved to). Same reader
 * as --history (added-line logic, split-pair context, lockfile rules, --cc for merges) and the same fail-closed semantics:
 * hits exit 1; an unresolvable revision, a shallow clone or an unscanned file version exit 2; a range without commits is clean.
 * The output holds commit short ids, paths, rule names and counts, never matched text.
 */
async function runRange(spec, { cwd, stdout, stderr }) {
  const parts = /^([^\s.][^\s]*?)\.\.([^\s.][^\s]*)$/.exec(spec);
  if (!parts || parts[1].startsWith('-') || parts[1].endsWith('.') || parts[2].startsWith('-') || parts[1].includes('..') || parts[2].includes('..')) {
    stderr.write('check-secrets --range: expected <base>..<head> (two dots; a three-dot range is not accepted)\n');
    return 2;
  }
  const [, baseRevision, headRevision] = parts;
  const root = findRepoRoot(cwd);
  if (git(['rev-parse', '--is-shallow-repository'], root).toString('utf8').trim() === 'true') {
    stderr.write(
      'check-secrets --range: INCOMPLETE, not a clean result. This is a shallow clone, so the commits in the range cannot be told apart from the\n' +
        'truncated history. Fetch full history (actions/checkout fetch-depth: 0, or "git fetch --unshallow") and run again.\n',
    );
    return 2;
  }
  const head = resolveCommit(root, headRevision);
  if (head === null) {
    stderr.write(`check-secrets --range: INCOMPLETE. The head commit ${printable(headRevision).slice(0, 80)} is not in this repository (not fetched?), so nothing was scanned.\n`);
    return 2;
  }
  const newRef = ZERO_ID.test(baseRevision);
  let base = null;
  if (!newRef) {
    base = resolveCommit(root, baseRevision);
    if (base === null) {
      stderr.write(
        `check-secrets --range: INCOMPLETE. The base commit ${printable(baseRevision).slice(0, 80)} is not in this repository. After a force-push the old tip is gone, and a shallow or partial fetch may not\n` +
          'have it. Nothing was scanned, and this is not a clean result. Fetch the missing commits or check the pushed commits by hand.\n',
      );
      return 2;
    }
  }
  const { hits, commits, oversize, oversizeLimits, unscanned, skipped } = await scanHistory(
    root,
    newRef ? { revisions: [head], maxCount: 1 } : { revisions: [head, '--not', base] },
  );
  const scope = newRef ? 'the new branch\'s tip commit only (the base is all zeros, so no earlier commit is known)' : `${commits} commit${commits === 1 ? '' : 's'} in ${baseRevision.slice(0, 12)}..${headRevision.slice(0, 12)}`;
  if (hits.length > 0) {
    stderr.write(`${formatHistoryReport(hits, { commits, oversize, oversizeLimits, unscanned, label: '--range' })}\n`);
    return 1;
  }
  if (unscanned > 0) {
    stderr.write(`check-secrets --range: INCOMPLETE, not a clean result (${commits} commits read, nothing found in them).\n  ${describeUnscanned(unscanned, oversize, oversizeLimits)}\n`);
    return 2;
  }
  stdout.write(commits === 0 ? `check-secrets --range: no commits in ${baseRevision.slice(0, 12)}..${headRevision.slice(0, 12)}, nothing to scan\n` : `check-secrets --range: no hits in ${scope}${skippedNote(skipped)}\n`);
  return 0;
}

/**
 * @param {string[]} argv arguments after the script name
 * @returns {Promise<number>} process exit code
 */
export async function main(
  argv = process.argv.slice(2),
  { cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {},
) {
  if (argv.includes('--help') || argv.includes('-h')) {
    stdout.write(USAGE);
    return 0;
  }
  const parsed = parseArguments(argv);
  if (parsed.error) {
    stderr.write(`check-secrets: ${parsed.error}\n\n${USAGE}`);
    return 2;
  }

  try {
    if (parsed.range !== null) return await runRange(parsed.range, { cwd, stdout, stderr });
    if (parsed.history) {
      // Works in bare clones (git clone --mirror) too, which have no work tree.
      let root = cwd;
      try {
        root = findRepoRoot(cwd);
      } catch {
        git(['rev-parse', '--git-dir'], cwd);
      }
      const shallow = git(['rev-parse', '--is-shallow-repository'], root).toString('utf8').trim() === 'true';
      const { hits, commits, oversize, oversizeLimits, unscanned, skipped } = await scanHistory(root);
      if (hits.length > 0) {
        stderr.write(`${formatHistoryReport(hits, { commits, shallow, oversize, oversizeLimits, unscanned })}\n`);
        return 1;
      }
      // An audit that did not look at everything is never reported as clean.
      const gaps = [];
      if (unscanned > 0) gaps.push(describeUnscanned(unscanned, oversize, oversizeLimits));
      if (shallow) gaps.push('this is a shallow clone, so only part of the history was available. Run "git fetch --unshallow" or scan a full clone.');
      if (gaps.length > 0) {
        stderr.write(`check-secrets --history: INCOMPLETE, not a clean result (${commits} commits read, nothing found in them).\n${gaps.map((g) => `  ${g}`).join('\n')}\n`);
        return 2;
      }
      stdout.write(`check-secrets --history: no hits in ${commits} commits${skippedNote(skipped)}\n`);
      return 0;
    }

    const { findings, scanned, skipped, oversize, unreadable, fromIndex, differing } = scanTree(findRepoRoot(cwd));
    let failed = false;
    if (findings.length > 0) {
      stderr.write(`${formatReport(findings)}\n`);
      failed = true;
    }
    if (oversize.length > 0) {
      stderr.write(`${formatOversizeReport(oversize)}\n`);
      failed = true;
    }
    if (unreadable.length > 0) {
      stderr.write(`${formatUnreadableReport(unreadable)}\n`);
      failed = true;
    }
    if (failed) return 1;
    const { total, detail } = describeSkipped(skipped);
    const indexNote = fromIndex.length > 0 ? `, ${fromIndex.length} missing from the working tree and scanned from the index` : '';
    const differNote = differing.length > 0 ? `, ${differing.length} with a staged version that differs from the working tree (both scanned)` : '';
    stdout.write(`check-secrets: OK (${scanned} files scanned, ${total} skipped${detail}${indexNote}${differNote})\n`);
    return 0;
  } catch (error) {
    stderr.write(`check-secrets: ${error.message}\n`);
    return 2;
  }
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false; // imported (or run from stdin): the caller drives main()
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    // Never fall back to "not the entry point": that would exit 0 without scanning anything.
    return path.resolve(entry) === self;
  }
}

if (isDirectRun()) {
  main().then((code) => {
    process.exitCode = code;
  });
}
