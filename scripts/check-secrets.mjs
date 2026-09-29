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
 *
 * --history is for the repository owner to run locally. CI does NOT run it: the known
 * leak from issue #22 lives in history forever and would fail every build. A shallow
 * clone only has part of the history, so an incomplete audit (shallow, or any version not
 * scanned) exits 2 and never prints "no hits".
 */

import { spawn, spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
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

// Words that make a multi-word quoted value a sentence ("Invalid or expired token", "Passwords do not match")
// and not a passphrase. Message catalogs (en.json, messages.yml) use keys such as password/token/apiKey a lot.
const PROSE_WORDS = new Set([
  'is', 'are', 'was', 'be', 'been', 'not', 'no', 'do', 'does', 'did', 'the', 'a', 'an', 'or', 'and', 'of', 'to',
  'for', 'in', 'on', 'at', 'by', 'as', 'if', 'it', 'its', 'this', 'that', 'these', 'those', 'your', 'you', 'my',
  'please', 'must', 'should', 'cannot', 'can', 'will', 'has', 'have', 'least', 'most', 'than', 'below', 'above',
  'enter', 'choose', 'select', 'type', 'invalid', 'expired', 'missing', 'required', 'incorrect', 'match',
  'matches', 'characters', 'forgot', 'reset', 'confirm', 'wrong', 'empty', 'too', 'short', 'long', 'weak',
]);

/**
 * A value with whitespace in it (a quoted passphrase, or the rest of a YAML/ini line). It is a finding when a
 * word in it is random-looking, or, for a strong name, when it is not a sentence and is long enough.
 */
function isPhraseSecret({ kind, text }) {
  const words = text
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z0-9]+|[.,;:!?)]+$/g, ''))
    .filter(Boolean);
  if (words.some((w) => looksRandom(w, GATES.configWeak))) return true;
  if (words.some((w) => PROSE_WORDS.has(w.toLowerCase()))) return false;
  return kind === 'strong' && text.length >= MIN_STRONG_CONFIG_LENGTH;
}

const stripQuotes = (text) => text.trim().replace(/^["'`]+|["'`]+$/g, '');

/**
 * Decide whether a value assigned to a secret-like name is a finding.
 * @param {{kind: 'strong'|'weak', value: string, quoted: boolean, separator: string, mode: string}} input
 */
function isSecretValue({ kind, value, quoted, separator, mode }) {
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
      isSecretValue({ kind, value: stripQuotes(literal), quoted: true, separator: '=', mode });
    if (expansionLiterals(text).some(operand)) return true;
    const glued = stripQuotes(withoutExpansions(text));
    return glued !== '' && looksRandom(glued, GATES.configWeak);
  }
  if (text === '' || URL_PREFIX.test(text) || isPlaceholder(text)) return false;
  if (/\s/.test(text)) {
    // Only a quoted value (or a whole-line value) may contain spaces; in code a spaced string is text.
    return quoted && mode !== 'code' && isPhraseSecret({ kind, text });
  }
  if (mode === 'code') return looksRandom(text, kind === 'strong' ? GATES.codeStrong : GATES.codeWeak);
  // Prose such as "Token: something" is common, so an unquoted `name: word` needs a random-looking word.
  const proseColon = mode === 'prose' && !quoted && separator !== '=';
  if (kind === 'strong' && !proseColon) return text.length >= MIN_STRONG_CONFIG_LENGTH;
  return looksRandom(text, GATES.configWeak);
}

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
function valueRunsToEndOfLine(filePath) {
  const base = path.posix.basename(filePath).toLowerCase();
  return REST_OF_LINE_EXTENSIONS.has(path.posix.extname(base)) || base === '.env' || base.startsWith('.env.') || base.endsWith('.env');
}

/**
 * Extra candidate values for an unquoted `name: value` / `name = value`, where the first whitespace-free token
 * (the regex capture) is not the whole value. Returns [{ value, end }] with `end` the index the value reaches.
 *  - the rest of the line, comment removed (a plain scalar or ini value with spaces)
 *  - the indented lines of a YAML block scalar (`|`, `>`, `|-`, `>-`, ...)
 */
function unquotedContinuations(input, matchIndex, tokenEnd, token, filePath) {
  let lineEnd = input.indexOf('\n', tokenEnd);
  if (lineEnd === -1) lineEnd = input.length;
  const results = [];
  if (/^[|>][-+0-9]*$/.test(token)) {
    const lineStart = input.lastIndexOf('\n', matchIndex - 1) + 1;
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
  if (!valueRunsToEndOfLine(filePath) || /^[!&*'"`{[]/.test(token) || token.endsWith(',')) return results;
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
  '.dist',
]);
const CONFIG_BASENAMES = new Set([
  '.npmrc', '.yarnrc', '.netrc', '.pgpass', '.envrc', 'makefile', 'gnumakefile', 'procfile', 'credentials', 'config',
]);

/**
 * 'prose'  Markdown and text: docs paste real values into code fences.
 * 'config' env files, YAML, JSON, INI, shell, Terraform, Makefile, ...: bare KEY=value lines.
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
    CONFIG_EXTENSIONS.has(ext)
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

/** Any secret-like environment variable name, strong or weak. */
const isSecretLikeName = (name) => secretNameKind(name) !== null;

/**
 * Each rule: id, description, matchers[{ pattern (global regex), accept(match, ctx) }],
 * optional appliesTo(ctx) and hint (a cheap regex the file must match before the rule runs).
 * ctx is { path, mode }. accept() returns false for placeholders and other non-secrets.
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
          /(?<![A-Za-z0-9_$.-])(?<!\$\{|:\/\/)(["'`]?)([A-Za-z_$][A-Za-z0-9_$.-]{0,1023})\1(?:(?<=["'`])[ \t]*\])?(?:[ \t]*:[ \t]*[A-Za-z_][A-Za-z0-9_<>[\]|.]{0,40})?[ \t]*(:=|=>|\?=|\+=|=|:(?!:))[ \t]*(?=\S)/g,
        accept: (m, ctx) => {
          const kind = secretNameKind(m[2]);
          if (!kind) return false;
          const input = m.input;
          const valueStart = m.index + m[0].length;
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
            isSecretValue({ kind, value: text, quoted: isQuoted, separator: m[3], mode: ctx.mode });
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
          if (check(token, false)) return true;
          if (ctx.mode !== 'config') return false;
          for (const extra of unquotedContinuations(input, m.index, valueStart + bare.length, bare, ctx.path)) {
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
          return isSecretValue({ kind, value: stripQuotes(m[2].replace(/\r$/, '')), quoted: true, separator: '=', mode: ctx.mode });
        },
      },
    ],
  },
  {
    id: 'secret-name-value-pair',
    description:
      'name/value pair split across keys (k8s "- name: X / value: Y", Vercel {"key":"X","value":"Y"}) where the name is secret-like',
    appliesTo: (ctx) => ctx.mode !== 'code',
    hint: SECRET_HINT,
    matchers: [
      {
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
          });
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
  const ctx = { path: filePath.split(path.sep).join('/'), mode: fileMode(filePath) };
  let newlines = null;
  for (const rule of RULES) {
    if (rule.appliesTo && !rule.appliesTo(ctx)) continue;
    if (rule.hint && !rule.hint.test(text)) continue;
    for (const matcher of rule.matchers) {
      for (const match of text.matchAll(matcher.pattern)) {
        newlines ??= buildNewlineIndex(text);
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
 * that does not exist. Unmerged paths appear once per stage and are listed once.
 * @returns {{raw: Buffer, mode: string, sha: string}[]}
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
    if (!entries.has(key)) entries.set(key, { raw, mode, sha });
  }
  return [...entries.values()];
}

/**
 * Scan every git-tracked file under `root`, working-tree content (what CI checked out).
 *  - lockfiles (exact names), gitlinks (submodule commit pointers: no content here) and files with binary
 *    content are skipped on purpose, and counted in `skipped`;
 *  - a symlink is scanned as its link target;
 *  - a file the index lists but the working tree no longer has (deleted, or skip-worktree) is scanned from the
 *    index blob instead, so nothing tracked goes unexamined (`fromIndex` names them; a CI checkout has none);
 *  - a file that exists but cannot be read (permissions, wrong type, I/O error) is NOT scanned and is listed in
 *    `unreadable`; a text file over the size limit is listed in `oversize`. The CLI fails on both.
 * @returns {{findings: object[], scanned: number, skipped: Record<string, number>, oversize: string[], unreadable: string[], fromIndex: string[]}}
 */
export function scanTree(root) {
  const findings = [];
  const skipped = {};
  const oversize = [];
  const unreadable = [];
  const fromIndex = [];
  let scanned = 0;
  const skip = (reason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };
  const rootBytes = Buffer.from(root);
  for (const { raw, mode, sha } of listTracked(root)) {
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
      try {
        bytes = git(['cat-file', 'blob', sha], root);
        fromIndex.push(file);
      } catch {
        unreadable.push(file);
        continue;
      }
      if (bytes.length > MAX_FILE_BYTES) {
        if (isBinaryContent(bytes)) skip('binary');
        else oversize.push(file);
        continue;
      }
    }
    const text = decodeText(bytes);
    if (text === null) {
      skip('binary');
      continue;
    }
    scanned += 1;
    findings.push(...scanText(file, text));
  }
  return { findings, scanned, skipped, oversize, unreadable, fromIndex };
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
  for (const f of findings) lines.push(`  ${printable(f.path)}:${f.line}  ${f.rule}`);
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

    const { findings, scanned, skipped, oversize, unreadable, fromIndex } = scanTree(findRepoRoot(cwd));
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
    stdout.write(`check-secrets: OK (${scanned} files scanned, ${total} skipped${detail}${indexNote})\n`);
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
