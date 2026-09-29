#!/usr/bin/env node
/**
 * check-secrets.mjs - dependency-free secret scanner for git-tracked files.
 *
 * Usage (from anywhere inside the repository):
 *   node scripts/check-secrets.mjs             scan every git-tracked text file (this is what CI runs)
 *   node scripts/check-secrets.mjs --history   scan the ADDED lines of every commit on every ref
 *   node scripts/check-secrets.mjs --help
 *
 * Exit codes: 0 = clean, 1 = potential secret found (or a tracked file that could not be scanned:
 * text over the size limit, unreadable), 2 = usage or git error, or a --history audit that did
 * not look at everything (version over the size limit, shallow clone).
 *
 * Fail closed: the only content skipped on purpose is lockfiles (exact names), gitlinks (submodule
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
 * match works); it stays visible in review.
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
 *   - Name and value fields in one JSON/YAML/HCL/XML object or call are matched in either order (secret-name-value-pair),
 *     and secrets passed on a command line (gh secret set, vercel env add, aws ssm put-parameter, ...) are their own rule.
 *
 * The index blob AND the working-tree file are both scanned whenever they differ (compared by git blob id).
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

// Lockfiles are full of integrity hashes that look like high-entropy secrets. Exact names
// only: other *.lock files and everything else is scanned.
const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'composer.lock',
  'gemfile.lock',
  'cargo.lock',
  'poetry.lock',
  'go.sum',
]);

/** True for lockfiles. Nothing else is skipped by name or extension: content decides. */
export function shouldSkipPath(filePath) {
  const base = path.posix.basename(filePath.split(path.sep).join('/')).toLowerCase();
  return LOCKFILE_NAMES.has(base);
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
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
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

/** @returns {'strong' | 'weak' | null} how secret-like an identifier is (see the file header) */
export function secretNameKind(name) {
  const words = nameWords(name);
  while (words.length > 1 && /^\d+$/.test(words[words.length - 1])) words.pop();
  if (words.length === 0) return null;
  const bare = words.map((w) => w.replace(/\d+$/, ''));
  const last = bare[bare.length - 1];
  const merged = bare.join('');
  if (STRONG_LAST_WORDS.has(last) || STRONG_MERGED_SUFFIX.test(merged)) return 'strong';
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
const INTERPOLATION = /\$\{|\{\{|^\$\(|^`/;
const WHOLE_REFERENCE =
  /^(?:\$[A-Z_][A-Z0-9_]*|\$[a-z][a-z0-9]*_[a-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%)$/;
const CODE_REFERENCE = /process\.env|import\.meta\.env|os\.environ|\bgetenv|\bENV\[/;
// Encrypted or hashed forms are not plaintext credentials.
const NON_SECRET_FORMS = /^(?:ENC\[|\$ANSIBLE_VAULT|\$2[abxy]?\$\d{2}\$|\$argon2|\$pbkdf2|\$scrypt|\$apr1\$|\{SHA\})/;
// AWS documentation keys end in EXAMPLE / EXAMPLEKEY.
const EXAMPLE_SUFFIX = /EXAMPLE(?:KEY)?$/;
// "Bearer eyJhbGciOi..." A trailing ellipsis means the author cut the value off, so it cannot be a working credential.
const TRUNCATED = /(?:\.{3,}|…)$/;

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
  if (NON_SECRET_FORMS.test(value) || TRUNCATED.test(value) || isMostlyMarkers(value)) return true;
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

const MESSAGE_CATALOG_DIRS = /(?:^|\/)(?:i18n|l10n|locales?|_locales|lang|langs|languages?|messages?|translations?|intl|strings)(?:\/|$)/;
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
  '.json5', '.sh', '.bash', '.zsh', '.fish', '.tf', '.tfvars', '.hcl', '.example', '.sample', '.template',
  '.dist', '.cnf', '.tfstate', '.kubeconfig',
]);
const CONFIG_BASENAMES = new Set([
  '.npmrc', '.yarnrc', '.netrc', '.pgpass', '.envrc', 'makefile', 'gnumakefile', 'procfile', 'credentials', 'config',
]);

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
  if (base === '.vault-token' || base === 'vault-token') tags.add('vault');
  return tags;
}

// Formats in which every `name = value` is a credential setting: the value-length limit drops from 8 to 4 and
// auth-style names (auth, npmAuthIdent, client-key-data) count as secret names.
const STRICT_CREDENTIAL_FORMATS = ['npmrc', 'pypirc', 'awscreds', 'docker', 'kube', 'mycnf', 's3cfg', 'terraformrc', 'wgetrc', 'curlrc'];
const CREDENTIAL_FILE_MIN_LENGTH = 4;
const CREDENTIAL_FILE_NAMES = new Set(['auth', 'authident', 'npmauthident', 'clientkeydata', 'clientkey', 'authorization', 'basicauth']);

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
    CONFIG_BASENAMES.has(base) ||
    CONFIG_EXTENSIONS.has(ext) ||
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
const SECRET_HINT = /secret|passw|pwd|pass|token|credential|salt|pepper|key/i;
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
    String.raw`"((?:[^"\\\n]|\\.){0,4096})"|'((?:[^'\\\n]|\\.){0,4096})'|\x60((?:[^\x60\\\n]|\\.){0,4096})\x60|(\S{1,${bareMax}})`,
    'y',
  );
const NESTED_VALUE_CHARS = 64;
const VALUE_AT = valueAt(4096);
const NESTED_VALUE_AT = valueAt(NESTED_VALUE_CHARS);

/** Undo backslash escapes inside a quoted value (\" \\ \'), so an escaped quote cannot hide the rest of the string. */
const unescapeQuoted = (text) => text.replace(/\\(.)/g, '$1');

/**
 * A password taken from a URL or `curl -u`. A password with no ${...} is judged as a whole. One with an expansion
 * is judged like a secret-like assignment: a reference alone (${DB_PASSWORD}) passes, but a literal default
 * (${DB_PASSWORD:-hunter2}) or literal text next to a reference (${A}suffix) is a candidate password.
 */
function urlPasswordIsSecret(password) {
  if (!password.includes('${')) return !isPlaceholder(password);
  if (expansionLiterals(password).some((literal) => !isPlaceholder(stripQuotes(literal)))) return true;
  const glued = stripQuotes(withoutExpansions(password));
  return glued !== '' && !isPlaceholder(glued);
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
  return { text: input.slice(open, end), cost: end - open };
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
  return { text: input.slice(open, end), cost: index - from + (end - index) };
}

/**
 * The lines of the YAML mapping (a list item, or a plain block) that the name line belongs to: the item's own first line
 * and its sibling keys, in either direction, up to PAIR_YAML_LINES lines each way. An item ends at the next `- ` at
 * or left of it, a dedent, or a document marker. Returns null when the key is not at the start of its line.
 * Every search for a line break is bounded to PAIR_LINE_CHARS, so a huge single line costs a constant amount.
 */
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
    if (newline === -1) return { text: chunk.replace(/\r$/, ''), next: input.length + 1 };
    return { text: chunk.slice(0, newline).replace(/\r$/, ''), next: start + newline + 1 };
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
    for (let n = 0; n < PAIR_YAML_LINES && cursor > 0; n += 1) {
      const previousStart = startOfLine(cursor - 1);
      if (previousStart === -1) break;
      const line = lineFrom(previousStart);
      cursor = previousStart;
      if (line.text.trim() === '' || isMarker(line.text)) break;
      if (isDash(line.text) && /^[ \t]*-[ \t]+/.exec(line.text)[0].length === keyCol) {
        above.push(line.text);
        break;
      }
      if (indentOf(line.text) < keyCol || (isDash(line.text) && indentOf(line.text) <= keyCol)) break;
      above.push(line.text);
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
    below.push(line.text);
  }
  return [...above.reverse(), own.text, ...below].join('\n');
}

// The entry tags of XML/properties-style configuration: <add key= value=/>, <setting name=><value/></setting>,
// <property><name/><value/></property>, <entry key=>V</entry>.
const XML_ENTRY_TAG = /<(?:add|setting|property|entry|item|param|parameter|variable|var|env|envvar|option|appsetting|pair|element|secret)(?![A-Za-z0-9_-])/gi;

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
  const forward = input.slice(index, Math.min(input.length, index + PAIR_XML_CHARS));
  let end = forward.length;
  const selfClose = forward.indexOf('/>');
  if (selfClose !== -1) end = Math.min(end, selfClose + 2);
  const closing = /<\/(?:add|setting|property|entry|item|param|parameter|variable|var|env|envvar|option|appsetting|pair|element|secret)\s*>/i.exec(forward);
  if (closing) end = Math.min(end, closing.index + closing[0].length);
  XML_ENTRY_TAG.lastIndex = 0;
  const next = XML_ENTRY_TAG.exec(forward);
  if (next && next.index > 0) end = Math.min(end, next.index);
  XML_ENTRY_TAG.lastIndex = 0;
  return input.slice(start, index + end);
}

// The value-carrying field of a name/value object. `valueFrom`, `values` and other longer names do not match. A YAML tag
// or anchor before the scalar (`!!str V`, `&a V`) is skipped.
const PAIR_VALUE_FIELD =
  /(?<![A-Za-z0-9_$.-])(["']?)(?:value|val|secret|secretvalue|stringvalue|plaintext|content|data|default|defaultvalue|parametervalue)\1[ \t]*[:=][ \t]*(?:(?:![^\s,}\]]{0,60}|&[A-Za-z0-9_-]{1,60})[ \t]+){0,3}(?:"((?:[^"\\\n]|\\.){0,4096})"|'((?:[^'\\\n]|\\.){0,4096})'|([^\s,}\]"']{1,4096}))/gi;
// The same field as an XML element: <value>V</value>
const PAIR_XML_VALUE = /<(?:value|val|secret|content|data|default|string)(?:[ \t][^<>]{0,80})?>[ \t\r\n]*([^<>]{1,4096}?)[ \t\r\n]*<\//gi;

/** Is any value field (either order) in the window text a non-placeholder secret? */
function windowHoldsSecretValue(text, kind, ctx, escaped) {
  const unescaped = escaped ? text.replace(/\\(["'])/g, '$1') : text;
  for (const field of unescaped.matchAll(PAIR_VALUE_FIELD)) {
    const quotedValue = field[2] ?? field[3];
    const quoted = quotedValue !== undefined;
    if (
      isSecretValue({
        kind,
        value: quoted ? unescapeQuoted(quotedValue) : field[4],
        quoted,
        separator: ':',
        mode: ctx.mode,
        minLength: ctx.minStrong,
        catalog: ctx.catalog,
      })
    ) {
      return true;
    }
  }
  if (unescaped.includes('</')) {
    for (const field of unescaped.matchAll(PAIR_XML_VALUE)) {
      if (isSecretValue({ kind, value: field[1], quoted: true, separator: ':', mode: ctx.mode, minLength: ctx.minStrong, catalog: ctx.catalog })) return true;
    }
  }
  return false;
}

/**
 * Judge a name/value object whose secret-like name field is at `m`: is any value field in the same bounded JSON/HCL/YAML/
 * XML object or call (either order, other fields in between) a non-placeholder secret? Reads are budgeted per file;
 * running out of budget reports the file once (hostile input must not be silently skipped).
 */
function pairValueIsSecret(m, kind, ctx) {
  if (ctx.pairExhausted) return false; // already reported for this file, and nothing more is read
  ctx.pairBudget ??= PAIR_BUDGET_CHARS;
  const windows = [];
  const brace = braceWindow(m.input, m.index);
  ctx.pairBudget -= brace.cost;
  if (brace.text !== null) windows.push(brace.text);
  const aware = stringAwareWindow(m.input, m.index);
  ctx.pairBudget -= aware.cost;
  if (aware.text !== null && aware.text !== brace.text) windows.push(aware.text);
  const yaml = yamlBlockWindow(m.input, m.index);
  if (yaml !== null) {
    ctx.pairBudget -= yaml.length;
    windows.push(yaml);
  }
  const xml = xmlWindow(m.input, m.index);
  if (xml !== null) {
    ctx.pairBudget -= xml.length;
    windows.push(xml);
  }
  if (ctx.pairBudget < 0) {
    // Out of budget: the file is too dense with secret-like names to verify. Report it (once: one finding fails the run).
    ctx.pairExhausted = true;
    return true;
  }
  const escaped = m[1].startsWith('\\'); // a JSON document stored as a string: {\"key\":\"X\",\"value\":\"Y\"}
  return windows.some((window) => windowHoldsSecretValue(window, kind, ctx, escaped));
}

/** Value fields inside the child block or object that belongs to a name: `NAME:` followed by indented lines, or `NAME: {`. */
function childHoldsSecretValue(m, kind, ctx, keyIndent) {
  if (ctx.pairExhausted) return false;
  ctx.pairBudget ??= PAIR_BUDGET_CHARS;
  const input = m.input;
  const after = m.index + m[0].length;
  let text;
  if (input[after] === '{') {
    const forward = input.slice(after + 1, Math.min(input.length, after + 1 + PAIR_FORWARD_CHARS));
    const state = { braces: [], parens: [] };
    const hit = scanBrackets(forward, after + 1, state, '}');
    text = forward.slice(0, hit === -1 ? forward.length : hit);
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
      if (indent === childIndent) lines.push(line);
    }
    text = lines.join('\n');
  }
  ctx.pairBudget -= text.length + 64;
  if (ctx.pairBudget < 0) {
    ctx.pairExhausted = true;
    return true;
  }
  return windowHoldsSecretValue(text, kind, ctx, false);
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
  const push = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote !== null) {
      if (ch === '\\' && quote === '"' && i + 1 < line.length) {
        word += line[i + 1];
        i += 1;
      } else if (ch === quote) quote = null;
      else word += ch;
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

const hasFormat = (tag) => (ctx) => ctx.formats.has(tag);

/** Any secret-like environment variable name, strong or weak. */
const isSecretLikeName = (name) => secretNameKind(name) !== null;

/**
 * Each rule: id, description, matchers[{ pattern (global regex), accept(match, ctx), optional appliesTo(ctx) and hint }],
 * optional appliesTo(ctx) and hint (a cheap regex the file must match before the rule runs).
 * ctx is { path, mode, formats, strict, minStrong }. accept() returns false for placeholders and other non-secrets.
 * Every quantifier that can meet attacker-shaped text is bounded, so scan time stays linear.
 */
export const RULES = [
  {
    id: 'url-password',
    description: 'URL (or curl -u) with an embedded non-placeholder password: database, broker, HTTP basic auth, ...',
    matchers: [
      {
        // No length caps on user and password: a long one must not make the match fail. Each attempt starts at a
        // "://" and cannot cross a "/", so the scan stays linear. Only the host (never judged) is capped.
        pattern: /(?<=[a-z0-9+.-]):\/\/([^\s:@/'"`]*):([^\s@/'"`]+)@([^\s/'"`?#]{0,256})/gi,
        accept: (m) => urlPasswordIsSecret(m[2]) && !isDocumentationHost(m[3]),
      },
      {
        // curl -u user:password https://...   (also --user)
        pattern: /(?<![A-Za-z0-9_-])(?:-u|--user)(?:[ \t]+|=)["']?([^\s:"'`]+):([^\s"'`]+)/g,
        // `-u root:root` is also docker's uid:gid, so the same line must mention an HTTP client or URL.
        accept: (m) =>
          /curl|wget|https?:\/\//i.test(nearbyLineText(m)) && urlPasswordIsSecret(m[2].replace(/[,;)]+$/, '')),
      },
    ],
  },
  {
    id: 'private-key-block',
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
        accept: (m) => !isPlaceholder(m[1]),
      },
    ],
  },
  {
    id: 'aws-access-key-id',
    description: 'AWS access key ID',
    matchers: [
      {
        pattern: /(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])/g,
        accept: (m) => !isPlaceholder(m[0]),
      },
    ],
  },
  {
    id: 'google-api-key',
    description: 'Google API key (also matches Firebase web API keys)',
    matchers: [
      {
        pattern: /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g,
        accept: (m) => !isPlaceholder(m[0]),
      },
    ],
  },
  {
    id: 'github-token',
    description: 'GitHub personal access, OAuth, app or fine-grained token',
    matchers: [
      {
        pattern:
          /(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})(?![A-Za-z0-9_])/g,
        accept: (m) => !isPlaceholder(m[0]),
      },
    ],
  },
  {
    id: 'slack-token',
    description: 'Slack API token',
    matchers: [
      {
        pattern: /(?<![A-Za-z0-9])xox[baprs]-[0-9A-Za-z-]{10,}/g,
        accept: (m) => !isPlaceholder(m[0]),
      },
    ],
  },
  {
    id: 'stripe-live-key',
    description: 'Stripe live secret or restricted key',
    matchers: [
      {
        pattern: /(?<![A-Za-z0-9_])[sr]k_live_[0-9A-Za-z]{16,}/g,
        accept: (m) => !isPlaceholder(m[0]),
      },
    ],
  },
  {
    id: 'neon-api-key',
    description: 'Neon API key (napi_ prefix)',
    matchers: [
      {
        pattern: /(?<![A-Za-z0-9_])napi_[A-Za-z0-9]{32,}(?![A-Za-z0-9_])/g,
        accept: (m) => !isPlaceholder(m[0]),
      },
    ],
  },
  {
    id: 'neon-role-password',
    description: 'Neon role password (npg_ prefix)',
    matchers: [
      {
        pattern: /(?<![A-Za-z0-9_])npg_[A-Za-z0-9]{10,}(?![A-Za-z0-9_])/g,
        accept: (m) => !isPlaceholder(m[0]),
      },
    ],
  },
  {
    id: 'stack-auth-secret-key',
    description: 'Stack Auth secret server key (ssk_ prefix)',
    matchers: [
      {
        pattern: /(?<![A-Za-z0-9_])ssk_[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])/g,
        accept: (m) => !isPlaceholder(m[0]),
      },
    ],
  },
  {
    id: 'jwt-token',
    description: 'JWT-shaped token with a long signature',
    matchers: [
      {
        pattern: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{20,})/g,
        // Header and payload are public; only the signature decides whether this is a real token.
        accept: (m) => !isPlaceholder(m[1]),
      },
    ],
  },
  {
    id: 'sql-password-literal',
    description: "SQL statement that sets a role or user password to a literal (ALTER ROLE ... PASSWORD '...')",
    matchers: [
      {
        pattern:
          /\b(?:(?:(?:alter|create)[ \t]+(?:user|role)\b[^;'\n]{0,160}?\b|with[ \t]+(?:encrypted[ \t]+)?|login[ \t]+)?password|identified[ \t]+by)[ \t]*=?[ \t]*'((?:[^'\n]|''){1,4096})'/gi,
        accept: (m, ctx) => {
          // A bare `password '...'` is only SQL in a .sql file; elsewhere it is prose.
          if (/^password/i.test(m[0]) && !ctx.path.toLowerCase().endsWith('.sql')) return false;
          return !isPlaceholder(m[1].replace(/''/g, "'"));
        },
      },
    ],
  },
  {
    id: 'webhook-url',
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
        accept: (m) => !isPlaceholder(m[1]),
      },
      {
        // https://<tenant>.webhook.office.com/webhookb2/<guid>@<guid>/IncomingWebhook/<32 hex>/<guid>  (and outlook.office.com/webhook/...)
        pattern: new RegExp(
          String.raw`(?:outlook\.office(?:365)?\.com${SLASH}webhook|[a-z0-9.-]{1,80}\.webhook\.office\.com${SLASH}webhook[a-z0-9]{0,3})${SLASH}[^\s"'<>]{0,300}?IncomingWebhook${SLASH}([A-Za-z0-9]{20,})`,
          'gi',
        ),
        accept: (m) => !isPlaceholder(m[1]),
      },
      {
        // Power Automate / Logic Apps HTTP trigger: https://prod-00.region.logic.azure.com/workflows/<id>/triggers/manual/paths/invoke?...&sig=<signature>
        pattern: new RegExp(
          String.raw`\.logic\.azure\.com(?::\d{1,5})?${SLASH}workflows${SLASH}[^\s"'<>]{0,300}?(?:[?&]|\\u0026|&amp;)sig=([A-Za-z0-9_%-]{16,})`,
          'gi',
        ),
        accept: (m) => !isPlaceholder(m[1]),
      },
      {
        // https://hooks.zapier.com/hooks/catch/<id>/<code>
        pattern: new RegExp(String.raw`hooks\.zapier\.com${SLASH}hooks${SLASH}catch${SLASH}\d{3,}${SLASH}([A-Za-z0-9]{5,})`, 'gi'),
        accept: (m) => !isPlaceholder(m[1]),
      },
      {
        // https://maker.ifttt.com/trigger/<event>/with/key/<key>
        pattern: new RegExp(String.raw`maker\.ifttt\.com${SLASH}trigger${SLASH}[A-Za-z0-9_-]{1,100}${SLASH}(?:json${SLASH})?with${SLASH}key${SLASH}([A-Za-z0-9_-]{16,})`, 'gi'),
        accept: (m) => !isPlaceholder(m[1]),
      },
      {
        // https://events.pagerduty.com/integration/<32 character integration key>/enqueue
        pattern: new RegExp(String.raw`events\.pagerduty\.com${SLASH}integration${SLASH}([A-Za-z0-9]{20,})${SLASH}enqueue`, 'gi'),
        accept: (m) => !isPlaceholder(m[1]),
      },
      {
        // https://api.telegram.org/bot<bot id>:<token>/sendMessage
        pattern: new RegExp(String.raw`api\.telegram\.org${SLASH}bot(\d{6,}:[A-Za-z0-9_-]{30,})`, 'gi'),
        accept: (m) => !isPlaceholder(m[1]),
      },
    ],
  },
  {
    id: 'secret-assignment',
    description:
      'secret-like name (SECRET, PASSWORD, TOKEN, API_KEY, ...) set to a non-placeholder literal: any 8+ character value in env/config files, a random-looking quoted literal in code',
    hint: SECRET_HINT,
    matchers: [
      {
        // group 2 = name, 3 = separator. The VALUE is deliberately not part of the match: it is read in accept()
        // (VALUE_AT) and only for a secret-like name. A rejected match therefore consumes nothing but `name =`, and
        // matching resumes right after it, so `cfg['a']={"K":"v"}`, `x=1;K='v'` and minified JSON are still examined.
        // Not a name: "${NAME:-x}" (an expansion, judged by its outer assignment) or "://NAME:x@" (a URL, judged by url-password).
        pattern:
          /(?<![A-Za-z0-9_$.-])(?<!\$\{|:\/\/)(["'`]?)([A-Za-z_$][A-Za-z0-9_$.-]{0,1023})\1(?:(?<=["'`])[ \t]*\])?(?:[ \t]*:[ \t]*[A-Za-z_][A-Za-z0-9_<>[\]|.]{0,40}(?!:\/\/))?[ \t]*(:=|=>|\?=|\+=|=|:(?!:))[ \t]*(?=\S)/g,
        accept: (m, ctx) => {
          const kind = nameKindFor(m[2], ctx);
          if (!kind) return false;
          const input = m.input;
          let valueStart = m.index + m[0].length;
          if (ctx.mode !== 'code' && m[3] === ':') {
            // A YAML tag or anchor before the scalar (`!!str V`, `&anchor V`, `!vault V`) is not part of the value.
            YAML_NODE_PROPERTIES.lastIndex = valueStart;
            const properties = YAML_NODE_PROPERTIES.exec(input);
            if (properties) valueStart += properties[0].length;
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
          if (ctx.mode !== 'config') return check(token, false);
          const extras = unquotedContinuations(ctx, input, m.index, valueStart + bare.length, bare);
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
      },
      {
        // Dockerfile "ENV NAME value" / "ARG NAME value" (space-separated; NAME=value is handled above)
        pattern: /^[ \t]*(?:ENV|ARG)[ \t]+([A-Za-z_][A-Za-z0-9_]{0,1023})[ \t]+([^\n]{1,4096})$/gim,
        accept: (m, ctx) => {
          if (!/(?:^|\/)(?:[^/]*dockerfile[^/]*|containerfile[^/]*)$/i.test(ctx.path)) return false;
          const kind = secretNameKind(m[1]);
          if (!kind || m[2].startsWith('=')) return false;
          return isSecretValue({ kind, value: stripQuotes(m[2].replace(/\r$/, '')), quoted: true, separator: '=', mode: ctx.mode, catalog: ctx.catalog });
        },
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
          ctx.pairBudget = (ctx.pairBudget ?? PAIR_BUDGET_CHARS) - (window?.length ?? 0) - 64;
          if (ctx.pairBudget < 0) {
            ctx.pairExhausted = true;
            return true;
          }
          return window !== null && windowHoldsSecretValue(window, kind, ctx, false);
        },
      },
      {
        // The name is the KEY of a mapping whose child holds the value: `secrets:\n  NAME:\n    value: Y`, {"NAME": {"value": "Y"}},
        // `NAME: {value: Y}`. group 2 = quote, 3 = name; the child is the indented block below, or the object that follows.
        pattern:
          /(?<![A-Za-z0-9_$.-])(["']?)([A-Za-z_][A-Za-z0-9_.-]{0,1023})\1[ \t]*:[ \t]*(?=\{|[ \t]*(?:#[^\n]*)?\r?\n)/g,
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
    hint: /\b(?:gh|netlify|vercel|heroku|fly|flyctl|wrangler|railway|doppler|aws|firebase|az|kubectl|docker)[ \t]/,
    matchers: [
      {
        pattern:
          /(?<![A-Za-z0-9_-])(?:gh[ \t]+(?:secret|variable)[ \t]+set|netlify[ \t]+env:set|vercel[ \t]+env[ \t]+(?:add|update)|heroku[ \t]+config:set|fly(?:ctl)?[ \t]+secrets[ \t]+set|wrangler[ \t]+secret[ \t]+put|railway[ \t]+variables[ \t]+set|doppler[ \t]+secrets[ \t]+set|aws[ \t]+ssm[ \t]+put-parameter|aws[ \t]+secretsmanager[ \t]+(?:create-secret|put-secret-value)|firebase[ \t]+functions:secrets:set|az[ \t]+keyvault[ \t]+secret[ \t]+set|kubectl[ \t]+create[ \t]+secret[ \t]+generic|docker[ \t]+secret[ \t]+create)[^\n]{0,600}/g,
        accept: (m, ctx) => {
          const tool = CLI_TOOLS.find(([re]) => re.test(m[0]));
          if (!tool) return false;
          // `echo V | vercel env add NAME`: the value comes from the text before the command on the same line.
          const before = m.input.slice(Math.max(ctx.lineStart(m.index), m.index - 400), m.index);
          const piped = /(?:^|[;&][ \t]*)(?:echo|printf)(?:[ \t]+-[A-Za-z]+)*[ \t]+(?:%s[ \t]+)?(?:"([^"\n]*)"|'([^'\n]*)'|([^\s"'|]+))[ \t]*\|[ \t]*$/.exec(before);
          const pipedValue = piped ? (piped[1] ?? piped[2] ?? piped[3]) : null;
          const options = { positionalValue: tool[1].positionalValue ?? false, assignments: ctx.mode === 'code' };
          return cliPairs(shellWords(m[0].slice(tool[0].exec(m[0])[0].length)), options, pipedValue).some(([name, value]) => {
            const kind = secretNameKind(name);
            return kind !== null && isSecretValue({ kind, value: value.trim(), quoted: true, separator: '=', mode: 'config', catalog: false });
          });
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

/** Like scanText, but each finding also carries `lastLine`, the last line its match spans. */
function scanRanges(filePath, text) {
  const findings = [];
  const seen = new Set();
  const markerCache = new Map();
  const formats = credentialFormats(filePath);
  const strict = STRICT_CREDENTIAL_FORMATS.some((tag) => formats.has(tag));
  let newlines = null;
  const newlineIndex = () => (newlines ??= buildNewlineIndex(text));
  const occurrences = new Map();
  const ctx = {
    path: filePath.split(path.sep).join('/'),
    mode: fileMode(filePath),
    formats,
    strict,
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
  };
  for (const rule of RULES) {
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
        // The marker may sit on any line the match spans (a match can run across lines).
        const lastLine = lineAt(newlines, match.index + Math.max((match.spanEnd ?? match.index + match[0].length) - match.index - 1, 0));
        let allowed = false;
        for (let l = line; l <= lastLine && !allowed; l += 1) allowed = lineHasAllowMarker(text, newlines, l, markerCache);
        if (allowed) continue;
        seen.add(key);
        findings.push({ path: filePath, line, lastLine, rule: rule.id });
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
 * that does not exist. Unmerged paths appear once per stage: they are listed once, with every distinct blob.
 * @returns {{raw: Buffer, mode: string, sha: string, shas: string[]}[]} `sha` is the first blob, `shas` all distinct ones
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
    if (!known) entries.set(key, { raw, mode, sha, shas: [sha] });
    else if (!known.shas.includes(sha)) known.shas.push(sha);
  }
  return [...entries.values()];
}

/** The git object id of file content stored as a blob, in the repository's hash (sha1 or sha256, told apart by the id length). */
function blobId(bytes, referenceId) {
  const algorithm = referenceId.length === 64 ? 'sha256' : 'sha1';
  return createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/**
 * The content of several blobs from the index, in two `git cat-file --batch*` calls in total: sizes first (so a blob
 * over the size limit is never read into memory), then the contents.
 * @returns {Map<string, {size: number, bytes: Buffer | null}>} bytes is null for a blob over MAX_FILE_BYTES; a blob git
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
  const readable = shas.filter((sha) => sizes.has(sha) && sizes.get(sha) <= MAX_FILE_BYTES);
  for (const sha of shas) {
    if (sizes.has(sha) && sizes.get(sha) > MAX_FILE_BYTES) result.set(sha, { size: sizes.get(sha), bytes: null });
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
 *  - lockfiles (exact names), gitlinks (submodule commit pointers: no content here) and files with binary
 *    content are skipped on purpose, and counted in `skipped`;
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
  for (const { raw, mode, sha, shas } of listTracked(root)) {
    const file = displayPath(raw);
    if (shouldSkipPath(file)) {
      skip('lockfile');
      continue;
    }
    if (mode === '160000') {
      skip('submodule');
      continue;
    }
    const absolute = Buffer.concat([rootBytes, Buffer.from(path.sep), raw]);
    let bytes;
    let missing = false;
    try {
      const stat = lstatSync(absolute);
      if (mode === '120000') {
        if (!stat.isSymbolicLink()) throw new Error('not a symlink');
        bytes = readlinkSync(absolute, 'buffer');
      } else {
        if (!stat.isFile()) throw new Error('not a regular file');
        if (stat.size > MAX_FILE_BYTES) {
          if (isBinaryContent(readHead(absolute))) skip('binary');
          else oversize.push(file);
          continue;
        }
        bytes = readFileSync(absolute);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        unreadable.push(file);
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
      if (blob.bytes === null || blob.size > MAX_FILE_BYTES) {
        if (!reported.has(`${file}\0o`)) oversize.push(file);
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

// Lines of unchanged context kept around each change, so a split "name: X / value: Y" pair whose
// name line did not change can still be recognised. Context lines are never reported by themselves.
const HISTORY_CONTEXT = 2;

/**
 * Scan every commit reachable from any ref, reporting only matches that touch a line the commit ADDED.
 * Unchanged context lines are scanned together with the added ones (so multi-line rules can see the
 * name next to a new value) but a match made only of context lines belongs to an earlier commit.
 * Merge commits are shown as combined diffs (--cc), so only lines that the merge itself introduced
 * (conflict resolutions) are scanned; everything else was added by a parent and is reported there.
 * @returns {Promise<{hits: {commit: string, path: string, rule: string, count: number}[], commits: number, oversize: number, unscanned: number}>}
 * `unscanned` counts every file version whose added lines were not examined (oversize, or content git would not show).
 */
async function scanHistory(root) {
  const child = spawn(
    'git',
    [
      '-c', 'core.quotepath=false',
      'log', '--all', '--no-color', '--no-ext-diff', '--no-renames', '--text',
      '-p', '--cc', `-U${HISTORY_CONTEXT}`, '--format=commit %H',
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
  let unscanned = 0; // file versions whose added lines were NOT examined, for any reason (oversize included)
  let commit = null;
  let file = null;
  let inHunk = false;
  let parents = 1;
  let lines = []; // added and context lines of the current file, hunks separated by a blank line
  let addedLines = new Set(); // 1-based indexes into `lines` of the lines this commit added

  const flush = () => {
    if (commit && !file && addedLines.size > 0) {
      unscanned += 1; // added lines under a header this parser could not attribute to a path
    } else if (commit && file && addedLines.size > 0 && !shouldSkipPath(file)) {
      let text = lines.join('\n');
      // UTF-16 files (and binary blobs) show up with NUL bytes; drop them so ASCII content stays scannable.
      if (text.includes('\u0000')) text = text.replace(/[\u0000�]/g, '');
      if (text.length > MAX_FILE_BYTES) {
        oversize += 1;
        unscanned += 1;
      } else {
        for (const finding of scanRanges(file, text)) {
          let touchesAddedLine = false;
          for (let l = finding.line; l <= finding.lastLine && !touchesAddedLine; l += 1) touchesAddedLine = addedLines.has(l);
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
  };

  const onLine = (line) => {
    if (/^commit [0-9a-f]{40,64}$/.test(line)) {
      flush();
      commit = line.slice(7);
      commits += 1;
      file = null;
      inHunk = false;
    } else if (/^diff --(?:git|cc|combined) /.test(line)) {
      flush();
      file = null;
      inHunk = false;
      parents = 1;
    } else if (!inHunk && line.startsWith('Binary files ')) {
      unscanned += 1; // git refused to show this version's content (for example above core.bigFileThreshold)
    } else if (line.startsWith('@@')) {
      inHunk = true;
      parents = Math.max(1, line.match(/^@+/)[0].length - 1); // "@@@" hunks belong to 2-parent merges
      if (lines.length > 0) lines.push(''); // keep lines from different hunks from looking adjacent
    } else if (!inHunk) {
      if (line.startsWith('+++ ')) {
        const raw = line.slice(4);
        const target = raw.startsWith('"') ? unquoteGitPath(raw) : raw.replace(/\t.*$/, '');
        file = target === '/dev/null' ? null : target.replace(/^b\//, '');
      }
    } else if (line.length >= parents && !line.startsWith('\\')) {
      const marks = line.slice(0, parents);
      if (marks.includes('-')) return; // gone from the result
      lines.push(line.slice(parents));
      if (marks === '+'.repeat(parents)) addedLines.add(lines.length);
    }
  };

  // Split on "\n" only. readline would also split on a lone CR and lose the continuation.
  const decoder = new StringDecoder('utf8');
  let pending = '';
  for await (const chunk of child.stdout) {
    pending += decoder.write(chunk);
    let start = 0;
    let newline;
    while ((newline = pending.indexOf('\n', start)) !== -1) {
      onLine(pending.slice(start, newline));
      start = newline + 1;
    }
    pending = pending.slice(start);
  }
  pending += decoder.end();
  if (pending !== '') onLine(pending);
  flush();

  const code = await exited;
  if (code !== 0) throw new Error(`git log failed with exit code ${code}${summarizeStderr(stderr)}`);
  return { hits: [...hits.values()], commits, oversize, unscanned };
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

/** Format the text files that were too large to scan. */
export function formatOversizeReport(paths) {
  return [
    `check-secrets: ${paths.length} tracked text file${paths.length === 1 ? '' : 's'} over ${MAX_FILE_BYTES / (1024 * 1024)} MB NOT scanned:`,
    ...paths.map((p) => `  ${printable(p)}`),
    'A file this size cannot be checked for secrets. Split it, move it out of git, or review it by hand and raise MAX_FILE_BYTES.',
  ].join('\n');
}

const describeUnscanned = (unscanned, oversize) =>
  `${unscanned} file version${unscanned === 1 ? '' : 's'} NOT scanned` +
  (oversize > 0 ? ` (${oversize} over the ${MAX_FILE_BYTES / (1024 * 1024)} MB limit)` : '') +
  ', so this audit is incomplete.';

/** Format the tracked files that could not be read. */
export function formatUnreadableReport(paths) {
  return [
    `check-secrets: ${paths.length} tracked file${paths.length === 1 ? '' : 's'} could NOT be read, so ${paths.length === 1 ? 'it was' : 'they were'} NOT scanned:`,
    ...paths.map((p) => `  ${printable(p)}`),
    'An unreadable file is never treated as clean. Fix its permissions or type (or remove it from git), then run again.',
  ].join('\n');
}

/** Format history-scan hits: commit, path, rule and counts only. */
export function formatHistoryReport(hits, { commits = 0, shallow = false, oversize = 0, unscanned = oversize } = {}) {
  const lines = [];
  if (shallow) {
    lines.push(
      'warning: this is a shallow clone, so only part of the history was scanned.',
      '         Run "git fetch --unshallow" (or scan a full clone) for a complete answer.',
      '',
    );
  }
  if (unscanned > 0) lines.push(`warning: ${describeUnscanned(unscanned, oversize)}`, '');
  const distinctCommits = new Set(hits.map((h) => h.commit)).size;
  lines.push(
    `check-secrets --history: ${hits.length} hit${hits.length === 1 ? '' : 's'} in ${distinctCommits} of ${commits} commit${commits === 1 ? '' : 's'} (values are never printed)`,
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

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: node scripts/check-secrets.mjs [--history]

  (no flags)  scan all git-tracked text files; exit 1 on any finding
  --history   scan added lines of every commit on every ref (owner-run, not for CI)
  --help      show this message

The report lists file path, line number and rule name only. Matched text is never printed.
`;

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
  const unknown = argv.filter((arg) => arg !== '--history');
  if (unknown.length > 0) {
    stderr.write(`check-secrets: unknown argument\n\n${USAGE}`);
    return 2;
  }

  try {
    if (argv.includes('--history')) {
      // Works in bare clones (git clone --mirror) too, which have no work tree.
      let root = cwd;
      try {
        root = findRepoRoot(cwd);
      } catch {
        git(['rev-parse', '--git-dir'], cwd);
      }
      const shallow = git(['rev-parse', '--is-shallow-repository'], root).toString('utf8').trim() === 'true';
      const { hits, commits, oversize, unscanned } = await scanHistory(root);
      if (hits.length > 0) {
        stderr.write(`${formatHistoryReport(hits, { commits, shallow, oversize, unscanned })}\n`);
        return 1;
      }
      // An audit that did not look at everything is never reported as clean.
      const gaps = [];
      if (unscanned > 0) gaps.push(describeUnscanned(unscanned, oversize));
      if (shallow) gaps.push('this is a shallow clone, so only part of the history was available. Run "git fetch --unshallow" or scan a full clone.');
      if (gaps.length > 0) {
        stderr.write(`check-secrets --history: INCOMPLETE, not a clean result (${commits} commits read, nothing found in them).\n${gaps.map((g) => `  ${g}`).join('\n')}\n`);
        return 2;
      }
      stdout.write(`check-secrets --history: no hits in ${commits} commits\n`);
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
