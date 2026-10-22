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
 * not look at everything (version over the size limit, shallow clone, a commit that is not present, a new branch with more
 * commits than NEW_BRANCH_MAX_COMMITS).
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
 *   - Public verification material is not a secret: a name ending in public/pub + key (PUBLIC_KEY, jwtPublicKey) is not secret-like,
 *     and a complete PEM PUBLIC KEY / RSA PUBLIC KEY / CERTIFICATE / CERTIFICATE REQUEST / X509 CRL block or PGP PUBLIC KEY BLOCK (a
 *     chain too) whose body is one whole DER object (or PGP public-key packet) is blanked before the name-based rules read the file, so
 *     it is not judged under any name (blankPublicPemBlocks). The shape rules still read it: a PRIVATE KEY block (in any line-break
 *     encoding, on one line, base64-encoded, a PuTTY body, a bare DER key) or a provider token under a public name is a finding, and
 *     so is any text around a public block.
 *   - A URL value is judged only under a strong name, and only for credential-looking parts (signed-URL parameters,
 *     webhook path tokens, a token as the user name). Webhook URLs are also a rule of their own (webhook-url).
 *   - A file-system path value (/etc/ssl/private/key.pem, ~/.ssh/id_rsa, ../certs/x.key, C:\keys\x.pfx, certs/server.pem) names the
 *     file that holds the secret, so it passes in env, config, XML and Markdown files under a weak or strong name alike, unless a piece
 *     of it looks machine-generated (/tmp/<random>, a base64 string that starts with "/"): see isFileSystemPath.
 *   - Native credential files (.netrc, .pgpass, .git-credentials, .npmrc, .pypirc, .aws/credentials, docker config,
 *     kubeconfig, .htpasswd, .my.cnf, .s3cfg, Terraform, .curlrc, .vault-token) have path-specific matchers
 *     (rule credential-file) and a 4-character value minimum; netrc, pgpass and docker auth are also recognised by
 *     content in any file (notes, scripts that write them).
 *   - Shell syntaxes with no "=" are read too: fish `set -gx NAME value ...`, csh `setenv NAME value`, Windows `setx` and
 *     `set "NAME=value"`, `export NAME value`, PowerShell `$env:NAME = 'v'` / SetEnvironmentVariable / Set-Item Env:NAME, fish_variables
 *     SETUVAR lines, in shell scripts, config files, heredocs written into them and fenced Markdown blocks.
 *   - Literals over several lines are judged like a quoted value: TOML/Python triple quotes, HCL/Ruby/Perl/PHP heredocs, PowerShell
 *     here-strings, template literals, quotes closed on a later line, backslash / INI continuation lines, YAML scalars on the next line.
 *     They are read up to 200 non-blank lines / 32 KB of non-blank text (4 MB raw); a literal that does not end within that is reported (fail closed).
 *     Each continuation line is read once per file (backslash continuations are cached), so the cost stays linear in the file.
 *   - String literals with a prefix, hashes or another delimiter are read wherever a literal value is (callStringLiteral): Rust r#"..."#,
 *     C# @"..." / $@"...", C++ R"(...)", Swift #"..."#, Python r'...', and by file type Lua [[...]], OCaml {|...|}, Perl q(), Ruby %q().
 *     Rust raw strings (r"...", r#"..."#, any hash count) and backtick literals that run over lines, in an assignment or a setter call
 *     (std::env::set_var, os.Setenv), are judged like a heredoc under the same bounds; one that does not end within them is reported.
 *   - Account passwords set from a script (chpasswd, passwd --stdin, smbpasswd -s, usermod -p, openssl passwd, mkpasswd, ldappasswd,
 *     net user, dscl -passwd) are read as whole shell words.
 *   - Passwords inside semicolon-delimited connection strings (connection-string-password: ADO.NET, ODBC, OLE DB, SQL Server JDBC
 *     `Password=` / `Pwd=` / `Pass=`) are read in string literals in code (also concatenated from pieces), JSON and XML attribute values,
 *     dotenv / YAML / INI values, documents and comments, next to another connection-string key, and judged like a URL password.
 *   - Credentials that are not `name = value`: HTTP `Authorization` values with a scheme (http-auth-credential; Basic is decoded and
 *     judged by its password), Terraform `variable "api_token" { default = ... }` labels, and whitespace-delimited service directives
 *     keyed on their own names (config-directive-secret: Redis requirepass / ACL, HAProxy userlist, Mosquitto, nginx / Apache header
 *     and SetEnv directives, ...). Only literals count; references, placeholders and paths pass.
 *   - Name and value fields in one JSON/YAML/HCL/XML object or call are matched in either order (secret-name-value-pair),
 *     and secrets passed on a command line (gh secret set, vercel env add, aws ssm put-parameter, ...) are their own rule.
 *   - A literal default for a secret-like environment variable (hardcoded-secret-fallback) is read in each language's standard getter/default
 *     form: JavaScript `||` / `??` and destructuring, Python os.getenv(N, v) / `or`, C# `??`, Kotlin `?:`, Java getOrDefault / Optional.orElse /
 *     ternaries, Ruby ENV.fetch / `||`, PHP `?:` / `??`, Rust unwrap_or, Go `if v == "" { v = ... }` after os.Getenv, ... (see ENV_GETTER).
 *     Any non-empty constant counts, a guessable one too; an empty or interpolated string, or a default that is not a literal, passes.
 *
 * The index blob AND the working-tree file are both scanned whenever they differ (compared by git blob id).
 * --history and --range skip a file version that is verified binary (the same test as above, on the version's own first 8 KB) and
 * count it as skipped, so a large image never fails a run as "oversize"; a text version over the size limit still exits 2.
 *
 * --history is for the repository owner to run locally. CI does NOT run it: the known
 * leak from issue #22 lives in history forever and would fail every build. A shallow
 * clone only has part of the history, so an incomplete audit (shallow, or any version not
 * scanned) exits 2 and never prints "no hits".
 *
 * The scanner's own test files (app/src/lib/__tests__/checkSecrets*.test.js, exact paths, see isScannerFixture) are the one
 * exemption of --history and --range: their added lines are not scanned, and every such version is counted as skipped
 * ("scanner-fixture") and named in one note line, never as a hit and never as INCOMPLETE. Those files hold secret-shaped fixtures
 * on purpose, and a rule added in a later commit can match a fixture line an earlier commit of the same pull request added and
 * then rewrote; history cannot be edited to fix that. They are reviewed by hand, like the scanner and the workflow file
 * (SECURITY_NOTICE.md), and the tree scan still scans them in full, so a secret-shaped literal at the tip is reported there.
 *
 * --range with an all-zero <base> (a push that creates a branch, or deletes and recreates it) has nothing to subtract, and the tip
 * commit alone would miss a value that one pushed commit added and a later one removed. It scans the commits reachable from <head>
 * and from no branch under refs/remotes/origin/ (a branch that points at <head> itself is the pushed one and does not count), or
 * every commit reachable from <head> when there is no other branch. More than NEW_BRANCH_MAX_COMMITS of them exits 2 (incomplete).
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

// Lockfiles are full of integrity hashes that look like high-entropy secrets, so the generic entropy and secret-name
// rules do not run on them. They are NOT skipped: a dependency URL can carry a credential (https://user:<password>@registry/...),
// and a lockfile can hold an auth field. Only rules flagged `lockfile: true` (URL passwords, private keys, provider-shaped
// tokens, webhook URLs) and the targeted `lockfile-credential` rule run on them, after ordinary digests are blanked
// (sanitizeLockfile: only where the format puts an integrity value, never in an auth field). Exact names only: other *.lock
// files are scanned with every rule.
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

// The scanner's own test files, by exact path: app/src/lib/__tests__/checkSecrets.test.js and the review-round files beside it
// (checkSecrets.r17a.test.js, ...). Nothing else under __tests__ and no other *.test.js is matched. The history modes (--history,
// --range) do not scan the added lines of these files and count each such version as skipped by design (SCANNER_FIXTURE_REASON):
// they hold secret-shaped fixtures on purpose, a rule added later in a pull request can match a fixture line an earlier commit
// of the same pull request added and then rewrote, and that history cannot be edited. The files are reviewed by hand instead,
// as SECURITY_NOTICE.md already asks for the scanner and the workflow file. The tree scan is NOT affected: it scans these files
// in full, so a secret-shaped literal that survives at the tip (one without an allow marker) still fails the build.
const SCANNER_FIXTURE_FILE = /^app\/src\/lib\/__tests__\/checkSecrets[^/]*\.test\.js$/;
const SCANNER_FIXTURE_REASON = 'scanner-fixture';

/**
 * True for the scanner's own Vitest files (app/src/lib/__tests__/checkSecrets*.test.js, repository-relative, exact directory).
 * `gitPath` is a path as git prints it: always "/"-separated, whatever the platform. It is matched as it is, never converted from
 * the OS separator: in a git path a backslash is a literal character of the name, so a root-level file literally named
 * `app\src\lib\__tests__\checkSecrets.test.js` is NOT the fixture, on Windows either.
 */
export function isScannerFixture(gitPath) {
  return SCANNER_FIXTURE_FILE.test(gitPath);
}

// A lockfile is machine-generated and can be far larger than a source file; it gets a higher (still fail-closed) limit.
const MAX_LOCKFILE_BYTES = 16 * 1024 * 1024;
const sizeLimit = (filePath) => (isLockfile(filePath) ? MAX_LOCKFILE_BYTES : MAX_FILE_BYTES);

// Ordinary digests, blanked (same length, so line numbers stay) before the lockfile rules run. Every quantifier is a
// fixed count or a bounded class run, so this is linear. Only digests of the exact size of their algorithm are blanked:
// a longer or shorter string after "sha512-" is not an integrity value and stays visible to the token rules (hence the
// lookahead: without it the first 86 characters of a longer value were blanked and only its tail was left to judge).
const LOCKFILE_DIGEST = new RegExp(
  [
    String.raw`sha512-[A-Za-z0-9+/]{86}={0,2}(?![A-Za-z0-9+/=])`,
    String.raw`sha384-[A-Za-z0-9+/]{64}={0,2}(?![A-Za-z0-9+/=])`,
    String.raw`sha256-[A-Za-z0-9+/]{43}={0,2}(?![A-Za-z0-9+/=])`,
    String.raw`sha1-[A-Za-z0-9+/]{27}={0,2}(?![A-Za-z0-9+/=])`,
    String.raw`\bh1:[A-Za-z0-9+/]{43}=(?![A-Za-z0-9+/=])`, // go.sum
    String.raw`(?<![A-Za-z0-9])(?:sha(?:1|224|256|384|512)|md5)[:=][0-9a-fA-F]{32,128}(?![0-9A-Za-z])`, // poetry, Pipfile.lock, Gemfile CHECKSUMS
  ].join('|'),
  'g',
);
// A hex digest is blanked only after a checksum-like key (Cargo `checksum = "..."`, composer `"shasum": "..."`, yarn berry
// `checksum: 10c0/...`) or after "#" (a git commit in a URL fragment). The key must start a token: at the start of the text or
// after a blank, a quote, `{`, `[`, `(`, `,`, `;`, `?`, `&` or `#`. Without that, any URL user name that ENDS in one of the words
// (`https://subhash:<hex>@`, `https://cicommit:<hex>@`, `//hash:<hex>@`) read as a key and its hex password was blanked. The
// compound keys a lockfile really writes (composer `content-hash`, pnpm `packageExtensionsChecksum` / `pnpmfileChecksum`) are
// named; `#commit=` (yarn berry) counts as a token start. A bare "#" counts only as a URL fragment (see hexFragmentOk).
const LOCKFILE_HEX_DIGEST =
  /((?<![^\s"'{[(,;?&#])(?:content[-_]?hash|packageExtensionsChecksum|pnpmfileChecksum|checksum|shasum|hash|integrity|digest|reference|commit|revision|rev|sha256|sha1|sha512)["']?[ \t]*[:=][ \t]*["']?(?:[0-9a-z]{1,8}\/)?|#)([0-9a-fA-F]{32,128})(?![0-9A-Za-z])/gi;
/** A "#" before a hex run is a URL fragment only when it follows URL text: not at the start, not after a blank, a quote, `=`, `:` or "#". */
const hexFragmentOk = (text, at) => at >= 1 && !/[\s"'=:#]/.test(text[at - 1]);
// ...except `sha256:<hex>` / `sha1=<hex>` with nothing between the algorithm and the hex: that is one digest-shaped VALUE, not
// a key and its value. LOCKFILE_DIGEST has already blanked it where it is an integrity value; anywhere else (the value of an
// auth field, a `?token=` URL parameter) it stays visible.
const DIGEST_VALUE_LEAD = /^sha(?:1|256|512)[:=]$/i;

// The SHAPE of a digest proves nothing on its own: a registry token can be written as "sha512-<base64>", and blanking that
// shape wherever it appeared hid `"_authToken": "sha512-..."` (and `?token=sha256-...` in a URL) from lockfile-credential.
// So a digest is blanked only where the lockfile format puts an integrity value, judged from the text just before it:
//   - after an integrity / checksum key: npm and bun `"integrity": "`, yarn v1 `integrity `, pnpm `{integrity: `, poetry
//     `hash = "`, `"shasum": "`, Pipfile.lock `"hashes": ["`. An auth-named field (_authToken, _auth, _password, npmAuthToken,
//     token, password, ...) is never one of these keys, so its value always reaches lockfile-credential;
//   - as the fragment of a resolved URL (`.tgz#sha512-...`), not after a bare "#" that starts a value or a comment;
//   - as a whole quoted array element (bun.lock `["a@1.0.0", "", {}, "sha512-..."]`, the Pipfile.lock and old poetry hash
//     lists, one per line): a credential field is `name: value`, never a bare element;
//   - at the end of a go.sum line (`module v1.2.3[/go.mod] h1:...`) or a Gemfile.lock CHECKSUMS line (`  rake (13.0.6) sha256=...`);
//   - after a digest blanked for one of these reasons and a space or comma: one value listing several (`"sha1-... sha512-..."`,
//     `sha256=...,sha512=...`).
// Every look back is bounded (a fixed window before the digest, never back to the start of a long line), so the cost per
// digest is fixed and the pass stays linear. A digest the look back cannot place stays visible: at worst a finding to allow,
// never a miss.
const INTEGRITY_KEY_LOOKBACK = 48; // longer than the longest lead INTEGRITY_KEY_LEAD can match (37 characters)
// The key must start a token (after a blank, a quote, `{`, `[`, `(` or `,`, or at the start of the look back): a URL user name
// such as `ci-hash`, `x_digest` or `//hash` in `https://ci-hash:sha512-...@host` is not an integrity key. pnpm's camelCase
// top-level checksums are named.
const INTEGRITY_KEY_LEAD =
  /(?<![^\s"'{[(,])(?:integrity|checksums?|shasum|hash(?:es)?|digest|sha(?:1|256|384|512)|packageExtensionsChecksum|pnpmfileChecksum)["']?(?:[ \t]{0,8}[:=][ \t]{0,8}|[ \t]{1,8})(?:\[[ \t]{0,8})?["']?$/i;
// Inside a URL authority (after `//` and before the host's `@`), nothing is an integrity key: `https://hash:<digest>@host`.
const URL_AUTHORITY_TAIL = /\/\/[^/\s"'@]{0,256}$/;
const ARRAY_ELEMENT_LOOKBACK = 256; // the line break and indentation between `[` or `,` and a list element on the next line
const LINE_LOOKBACK = 512; // a go.sum module path and version, a Gemfile gem name and version
const GO_SUM_LINE_LEAD = /^\S{1,400}[ \t]+v\d\S{0,100}[ \t]+$/;
const GEMFILE_CHECKSUM_LINE_LEAD = /^[ \t]*[^\s()]{1,200}[ \t]+\([^()\n]{1,100}\)[ \t]+$/;
const DIGEST_LIST_SEPARATOR = /^[ \t]{0,4},?[ \t]{0,4}$/;

/** Is the digest at text[start, end) in an integrity position (see above), other than the second of a list? */
function isIntegrityPosition(text, start, end) {
  const lead = text.slice(Math.max(0, start - INTEGRITY_KEY_LOOKBACK), start);
  if (INTEGRITY_KEY_LEAD.test(lead) && !URL_AUTHORITY_TAIL.test(text.slice(Math.max(0, start - 260), start))) return true;
  const before = text[start - 1];
  if (before === '#') return start >= 2 && !/[\s"'=:#]/.test(text[start - 2]);
  if ((before === '"' || before === "'") && text[end] === before) {
    const lead = text.slice(Math.max(0, start - 1 - ARRAY_ELEMENT_LOOKBACK), start - 1).trimEnd();
    if (lead.endsWith('[') || lead.endsWith(',')) return true;
  }
  const window = text.slice(Math.max(0, start - LINE_LOOKBACK), start);
  const lineBreak = window.lastIndexOf('\n');
  if (lineBreak === -1 && start > LINE_LOOKBACK) return false; // the line starts before the look back: no go.sum / Gemfile line is that long
  const linePrefix = window.slice(lineBreak + 1);
  return GO_SUM_LINE_LEAD.test(linePrefix) || GEMFILE_CHECKSUM_LINE_LEAD.test(linePrefix);
}

/**
 * The lockfile text with ordinary integrity digests blanked: only a digest in an integrity position, never the value of an
 * auth field (see isIntegrityPosition). Offsets and line breaks are unchanged.
 */
export function sanitizeLockfile(text) {
  let listEnd = -1; // the end of the last digest blanked, for a value that lists several
  const out = text.replace(LOCKFILE_DIGEST, (m, start) => {
    const end = start + m.length;
    const listed = listEnd !== -1 && start > listEnd && start - listEnd <= 9 && DIGEST_LIST_SEPARATOR.test(text.slice(listEnd, start));
    if (!listed && !isIntegrityPosition(text, start, end)) return m;
    listEnd = end;
    return ' '.repeat(m.length);
  });
  return out.replace(LOCKFILE_HEX_DIGEST, (m, lead, hex, at, whole) => {
    if (DIGEST_VALUE_LEAD.test(lead)) return m;
    if (lead === '#' ? !hexFragmentOk(whole, at) : URL_AUTHORITY_TAIL.test(whole.slice(Math.max(0, at - 260), at))) return m;
    return lead + ' '.repeat(hex.length);
  });
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
// <public qualifier> + "key" names verification material, not a secret (see secretNameKind).
const PUBLIC_KEY_QUALIFIERS = new Set(['public', 'pub']);

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
  // PUBLIC_KEY, jwtPublicKey, ssh_pub_key: the public half of a key pair is committed on purpose (a JWT verification key, a deploy
  // key's .pub line) and its body is as random-looking as a secret. Exempt only a name that ENDS in public/pub + key, and only after
  // the strong checks above, so public_key_password, pubkey_secret and public_secret_key stay strong; a name that also calls the key
  // secret or private (secret_public_key, clientSecretPublicKey, private_public_key) contradicts itself and stays weak. Other words
  // say what the key verifies (ID_TOKEN_PUBLIC_KEY, PASSWORD_ENCRYPTION_PUBLIC_KEY) and do not. A PRIVATE KEY block or a provider-
  // shaped token held by such a name is still found by its own rule, which never looks at the name. "verification_key" and
  // "verify_key" are NOT exempt: an HMAC (HS256) verification key is the shared secret itself (a PEM public key under any name is
  // exempt by value: blankPublicPemBlocks). Single-word names (pubkey, publickey) and certificate names (cert, ca_cert,
  // certificate) never were secret-like.
  if (last === 'key' && PUBLIC_KEY_QUALIFIERS.has(bare[bare.length - 2]) && !/secret|private/.test(bare.slice(0, -2).join(''))) return null;
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
const WHOLE_REFERENCE = new RegExp(
  '^(?:' +
    [
      String.raw`\$[A-Z_][A-Z0-9_]*`, // $NAME
      String.raw`\$[a-z][a-z0-9]*_[a-z0-9_]*`, // $db_password
      // $password, $dbPassword, $DbPassword: one word, or a few capitalised words, and at most two digits. `$` followed by a longer
      // or mixed run (letters and digits together, or a long run of capitals inside) reads as a password that starts with `$`.
      String.raw`\$[A-Za-z][a-z]{0,40}(?:[A-Z][a-z]{1,20}){0,4}[0-9]{0,2}`,
      String.raw`\$[0-9]{1,2}`, // $1 (a positional parameter)
      String.raw`\$[Ee][Nn][Vv]:[A-Za-z_][A-Za-z0-9_]{0,63}`, // PowerShell $env:NAME
      String.raw`\$ENV\{[A-Za-z_][A-Za-z0-9_]{0,63}\}`, // Perl $ENV{NAME}
      String.raw`\$_(?:ENV|SERVER)\[["']?[A-Za-z_][A-Za-z0-9_]{0,63}["']?\]`, // PHP $_ENV['NAME']
      String.raw`%\([A-Za-z_][A-Za-z0-9_.:-]{0,64}\)[sdifr]`, // Python / configparser %(name)s
      String.raw`%[A-Za-z_][A-Za-z0-9_]*%`, // cmd %NAME%
      String.raw`%%[A-Za-z_][A-Za-z0-9_.-]*%%`, // Ant / Maven build tokens
      String.raw`@[A-Za-z_][A-Za-z0-9_.-]*@`, // autoconf / Maven filtering @name@
      String.raw`<%[=-]?[^%\n]{1,200}%>`, // ERB / EJS <%= ENV['X'] %>
      String.raw`[@?]\+?(?:[a-z]+:)?[a-z]+\/[A-Za-z0-9_.]+`, // Android @string/name, ?attr/name
    ].join('|') +
    ')$',
);
// (%%NAME%% and @NAME@ are build-time substitution tokens (Ant, Maven filtering, autoconf); @string/name and ?attr/name are Android resource references.)
const CODE_REFERENCE = /process\.env|import\.meta\.env|os\.environ|\bgetenv|\bENV\[|\bENV\.(?:fetch|dig)\b|\bDeno\.env\b|GetEnvironmentVariable|\bgetProperty\(/;
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

// A setting under a secret-like name often names the FILE that holds the secret (private_key: /etc/ssl/private/key.pem, signing_key:
// ~/.ssh/id_rsa, client_secret: C:\secrets\client.json). That value is an address, like a URL with nothing credential-like in it.
//   - Anchors: an absolute POSIX path, ~/, ./ or ../ (also .\ and ..\), a home or other directory variable ($HOME/, %USERPROFILE%\), a
//     Windows drive (C:\ or C:/), a UNC share (\\host\share) or a path from the drive root (\keys\server.pfx; also what is left of an
//     unquoted `name: C:\keys\...` once ASSIGNMENT_PATTERN has read `: C` as a type annotation). An anchored path needs two segments
//     or a key-file extension: "/" + one word reads as a password.
//   - Without an anchor only a relative path or a bare file name that ends in a key, certificate or credential-document extension counts
//     (certs/server.pem, prod.p12, sa.json): base64 has "/" in its alphabet, so "abc/def" alone says nothing.
//   - A segment is a run of [A-Za-z0-9._@-]; in an anchored path single blanks may join runs ("Program Files", "Application Support").
//     So `+`, `=`, quotes, and `%`, `$` or `:` anywhere but in the anchor make the value something else (base64 padding, a URL,
//     user:password@host, a reference), and it is judged as before.
// Fail closed: a piece of a segment (split at - _ . @ and blanks) that looks machine-generated makes the whole value a token, not a
// path: /tmp/<random>, /run/secrets/<40 hex>, a base64 string that happens to start with "/", a random name + ".pem". The gate is lower
// than for whole values (8 characters) because a token split at its "/" characters is shorter in each piece.
const KEY_FILE_EXTENSION = /\.(?:pem|key|crt|cer|der|csr|p7b|p8|p12|pfx|jks|jceks|keystore|truststore|pub|asc|gpg|ppk|json|txt)$/i;
// The variable is an ALL-CAPS name, as in WHOLE_REFERENCE: `$` + mixed letters and digits reads as a password that starts with `$`.
// `~user/` is another user's home directory.
const POSIX_PATH_ANCHOR = /^(?:~(?:[a-z_][a-z0-9_-]{0,31})?|\.{1,2}|\$[A-Z_][A-Z0-9_]{0,63})?\//;
const WINDOWS_PATH_ANCHOR = /^(?:[A-Za-z]:[\\/]|%[A-Za-z_][A-Za-z0-9_]{0,63}%[\\/]|\\\\(?=[^\\/])|\.{1,2}\\|\\(?=[^\\/]))/;
// Letters of any script (/home/josé/...), digits and . _ @ -.
const PATH_SEGMENT = /^[\p{L}\p{N}._@-]{1,255}$/u;
// The blank is outside the run's class, so every character has one reading (linear). An anchored segment may also hold
// parentheses and "~" (C:\Program Files (x86)\, the 8.3 name C:\PROGRA~1\).
const SPACED_PATH_SEGMENT = /^[\p{L}\p{N}._@()~-]{1,255}(?: [\p{L}\p{N}._@()~-]{1,255}){0,15}$/u;
// A whole Windows segment that is a variable (C:\Users\%USERNAME%\.ssh) or, right after \\host\, an administrative share (c$).
const WINDOWS_VARIABLE_SEGMENT = /^%[A-Za-z_][A-Za-z0-9_]{0,63}%$/;
const ADMIN_SHARE_SEGMENT = /^[A-Za-z]\$$/;
const MAX_PATH_SEGMENTS = 64;
// A piece of 8 or more characters with this much variety is machine-generated. 2.7 rather than 3.0: an 8- or 9-character piece
// of a random token reaches 3.0 only with every character distinct, so `/A7fK9mQ7/xL8vN4xR/...` (one repeat per piece) passed.
const PATH_PIECE_GATE = { minLength: 8, minEntropy: 2.7 };
// Key files whose conventional NAME carries an id: an SSH key with a suffix (id_ed25519_<host or id>, id_rsa-deploy.pub) and an
// App Store Connect / APNs key (AuthKey_<10-character key id>.p8). The id is public; the name is judged by its shape, not its pieces.
// Only in a path with a directory: a bare `id_rsa_<random>` is judged like any value.
const NAMED_KEY_FILE = /^(?:id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?(?:[-_.][A-Za-z0-9]{1,24}){0,3}|AuthKey_[A-Z0-9]{10}\.p8)$/;

// A backslash escape that a double-quoted JSON / YAML / TOML / shell string turns into another character (read in pairs, so `\\n` is a
// doubled backslash and then "n"). `\\` and `\/` are left out: they are how a quoted Windows or JSON path writes its separators.
const STRING_ESCAPE = /\\(?:[uUxtnrbfave0N_LP"' ]|$)/;
/** Does the raw text of a double-quoted string hold an escape sequence other than `\\` and `\/`? */
function hasStringEscape(raw) {
  if (!raw.includes('\\')) return false;
  return STRING_ESCAPE.test(raw.replace(/\\[\\/]/g, ''));
}

/** Is `value` unmistakably a file-system path whose pieces are all ordinary names (see above)? */
export function isFileSystemPath(value) {
  if (value.length > 4096) return false;
  const windows = WINDOWS_PATH_ANCHOR.exec(value);
  const posix = windows === null ? POSIX_PATH_ANCHOR.exec(value) : null;
  const anchor = windows ?? posix;
  // A POSIX path separates with "/" only (a backslash in it is not a path character); a Windows or a relative one with either. A
  // doubled separator (C:\\keys\\x.pfx, as a single-quoted YAML or TOML literal keeps it) and a trailing one (a directory) are fine.
  const segments = value
    .slice(anchor === null ? 0 : anchor[0].length)
    .split(posix === null ? /[\\/]+/ : /\/+/)
    .filter((segment) => segment !== '');
  if (segments.length === 0 || segments.length > MAX_PATH_SEGMENTS) return false;
  const last = segments[segments.length - 1];
  const keyFileName = NAMED_KEY_FILE.test(last);
  const named = KEY_FILE_EXTENSION.test(last) || keyFileName;
  if (!named && (anchor === null || segments.length < 2)) return false;
  const segmentShape = anchor === null ? PATH_SEGMENT : SPACED_PATH_SEGMENT;
  const unc = windows !== null && windows[0] === '\\\\';
  return segments.every((segment, i) => {
    if (i === segments.length - 1 && keyFileName && (anchor !== null || segments.length >= 2)) return true;
    if (windows !== null && WINDOWS_VARIABLE_SEGMENT.test(segment)) return true;
    if (unc && i === 1 && ADMIN_SHARE_SEGMENT.test(segment)) return true;
    return segmentShape.test(segment) && segment.split(/[-_.@ ()~]+/).every((piece) => !looksRandom(piece, PATH_PIECE_GATE));
  });
}

/**
 * Decide whether a value assigned to a secret-like name is a finding.
 * @param {{kind: 'strong'|'weak', value: string, quoted: boolean, separator: string, mode: string, minLength?: number}} input
 * `minLength` is the shortest value a strong name may hold (8; credential files such as .npmrc use 4).
 */
function isSecretValue({ kind, value, quoted, separator, mode, minLength = MIN_STRONG_CONFIG_LENGTH, catalog = false, allowPath = true }) {
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
      isSecretValue({ kind, value: stripQuotes(literal), quoted: true, separator: '=', mode, minLength, catalog, allowPath });
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
  // A file-system path names the file that holds the secret; it is not the secret (isFileSystemPath). This comes before the env,
  // config and Markdown gates below, under a weak or a strong name alike, and before the blank test ("C:\Program Files\..."). Source
  // code keeps its randomness-only gate: a quoted literal there is reported only when it looks random as a whole. A position that
  // can only hold the password itself (requirepass, a basic-auth argument, chpasswd input: `allowPath: false`) never holds a path.
  if (allowPath && mode !== 'code' && isFileSystemPath(text)) return false;
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
// .udl: an OLE DB data link file, `[oledb]` and then one initialization (connection) string per line.
const REST_OF_LINE_EXTENSIONS = new Set(['.yml', '.yaml', '.ini', '.cfg', '.conf', '.config', '.properties', '.toml', '.env', '.udl']);
const REST_OF_LINE_FORMATS = ['npmrc', 'pypirc', 'awscreds', 'mycnf', 's3cfg', 'wgetrc', 'terraformrc'];
function valueRunsToEndOfLine(filePath) {
  const base = path.posix.basename(filePath).toLowerCase();
  if (REST_OF_LINE_EXTENSIONS.has(path.posix.extname(base)) || isPropertiesPath(filePath) || base === '.env' || base.startsWith('.env.') || base.endsWith('.env')) return true;
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
// Program source: a base name that starts with "env." is configuration (env.production, env.example) unless it ends in one of these
// (env.go, Env.cs, env.rs, env.ts are the code that READS the environment, and their defaults are judged as code).
const SOURCE_CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.go', '.rs', '.cs', '.java', '.kt', '.kts', '.scala', '.groovy',
  '.py', '.rb', '.php', '.swift', '.dart', '.ex', '.exs', '.lua', '.pl', '.pm', '.c', '.h', '.cc', '.cpp', '.hpp', '.m', '.vb',
  '.fs', '.ps1', '.psm1',
]);
const CONFIG_EXTENSIONS = new Set([
  '.env', '.ini', '.cfg', '.conf', '.config', '.properties', '.toml', '.yml', '.yaml', '.json', '.jsonc',
  '.json5', '.sh', '.bash', '.zsh', '.fish', '.ksh', '.csh', '.tcsh', '.bat', '.cmd', '.tf', '.tfvars', '.hcl', '.example',
  '.sample', '.template', '.dist', '.cnf', '.tfstate', '.kubeconfig', '.acl', '.udl',
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
  // SSIS package configurations and packages, SSRS data sources and reports: XML whose element text holds connection strings.
  '.dtsconfig', '.dtsx', '.rds', '.rsds', '.rdl',
]);
// systemd units (and Podman Quadlet units, which share their syntax) are INI-like settings: `Environment=NAME=value` sets a
// variable of the service, so they are configuration, not source code. A drop-in (`app.service.d/override.conf`) is `.conf` already.
const SYSTEMD_UNIT_EXTENSIONS = new Set([
  '.service', '.socket', '.timer', '.target', '.mount', '.automount', '.path', '.slice', '.swap', '.scope', '.container', '.pod',
  '.volume', '.kube', '.network', '.netdev', '.nspawn',
]);
/** Is this a systemd (or Quadlet) unit file, or a `.conf` drop-in in a `*.d/` directory? */
const isSystemdUnitPath = (filePath) => {
  const normalized = filePath.toLowerCase();
  return SYSTEMD_UNIT_EXTENSIONS.has(path.posix.extname(normalized)) || /\.d\/[^/]{1,255}\.conf$/.test(normalized);
};
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
  return XML_CONFIG_EXTENSIONS.has(ext.toLowerCase()) || ext === '.config' || /^\.[a-z]*proj$/.test(ext);
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
/**
 * Is this a Java properties file: `app.properties`, or one with an environment or backup suffix (`app.properties.local`,
 * `application.properties.prod`, `db.properties.bak`)? Its lines are `key value`, `key=value` or `key:value`.
 */
export function isPropertiesPath(filePath) {
  const base = path.posix.basename(filePath.split(path.sep).join('/')).toLowerCase();
  const at = base.lastIndexOf('.properties');
  if (at === -1) return false;
  const rest = base.slice(at + '.properties'.length);
  return rest === '' || (rest.length <= 33 && rest[0] === '.' && /^[a-z0-9_-]+$/.test(rest.slice(1)));
}

export function fileMode(filePath) {
  const base = path.posix.basename(filePath.split(path.sep).join('/')).toLowerCase();
  const ext = path.posix.extname(base);
  if (PROSE_EXTENSIONS.has(ext)) return 'prose';
  if (
    base === '.env' ||
    base.startsWith('.env.') ||
    base.includes('.env.') ||
    base.endsWith('.env') ||
    (base.startsWith('env.') && !SOURCE_CODE_EXTENSIONS.has(ext)) ||
    base.startsWith('docker-compose') ||
    base.startsWith('dockerfile') ||
    DOVECOT_CONFIG.test(base) ||
    CONFIG_BASENAMES.has(base) ||
    CONFIG_EXTENSIONS.has(ext) ||
    XML_CONFIG_EXTENSIONS.has(ext) ||
    isXmlConfigPath(filePath) ||
    CONFIG_EXTENSIONS.has(path.posix.extname(baseWithoutTemplateSuffix(base))) ||
    isPropertiesPath(filePath) ||
    SYSTEMD_UNIT_EXTENSIONS.has(ext) ||
    credentialFormats(filePath).size > 0
  ) {
    return 'config';
  }
  return 'code';
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

// One line break inside a PEM block, as the formats write it: real (\n, \r\n), a JSON / YAML escape (\n, \r\n; doubled when the JSON
// is itself escaped: \\n), a \u000a escape, an XML character reference (&#10; &#xA;, after an optional &#13; / &#xD;), or a backslash
// line continuation (.properties, shell: `\` at the end of the line). The alternatives start with different text, so each position has
// one reading.
const PEM_LINE_BREAK = String.raw`(?:\\{1,2}r|\r|\\u000[dD]|&#(?:13|[xX]0{0,2}[dD]);)?(?:\\{1,2}n|\n|\\u000[aA]|&#(?:10|[xX]0{0,2}[aA]);)|\\\r?\n`;
// One or more line breaks. Unambiguous on purpose (each repetition consumes a line break), to avoid regex backtracking blow-ups.
const PEM_SEPARATOR = String.raw`(?:[ \t]*(?:${PEM_LINE_BREAK}))+[ \t]*`;
// Between the lines of a PRIVATE key block: those line breaks, or blanks alone (a block pasted onto one line, "-----BEGIN ... KEY-----
// MII... -----END ... KEY-----", as a dotenv value or a YAML string holds it).
const PRIVATE_PEM_SEPARATOR = String.raw`(?:${PEM_SEPARATOR}|[ \t]+)`;
// A PEM private key written as base64 (a Kubernetes Secret's tls.key, a CI variable): "-----BEGIN " encodes to LS0tLS1CRUdJTi.
const BASE64_PEM_PRIVATE = /(?<![A-Za-z0-9+/])LS0tLS1CRUdJTi[A-Za-z0-9+/]{30,}={0,2}/g;
/** Does a base64 run starting with LS0tLS1CRUdJTi decode to a PRIVATE KEY header? Only its first 80 characters are decoded. */
const base64PemIsPrivate = (b64) => /^-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----/.test(Buffer.from(b64.slice(0, 80), 'base64').toString('latin1'));
// The bare DER body of a private key, base64 (no PEM armor): PKCS#8 RSA, PKCS#1 RSA, PKCS#8 and SEC1 EC, PKCS#8 Ed25519 / X25519.
// Each prefix is the fixed ASN.1 header of that key type (version 0 or 1, then the algorithm OID or the first INTEGER).
const DER_PRIVATE_KEY = new RegExp(
  String.raw`(?<![A-Za-z0-9+/])(?:` +
    [
      String.raw`MII[A-Za-z0-9+/]{3}IBADANBgkqhkiG9w0BAQEFAAS[A-Za-z0-9+/]{200,}`, // PKCS#8 rsaEncryption
      String.raw`MII[A-Za-z0-9+/]{3}IBAAKC[A-Za-z0-9+/]{3}A[A-Za-z0-9+/]{200,}`, // PKCS#1 RSAPrivateKey
      String.raw`M[IH][A-Za-z0-9+/]{2}AgEAMB[AM]GByqGSM49AgEG[A-Za-z0-9+/]{40,}`, // PKCS#8 id-ecPublicKey
      String.raw`M(?:HcCAQEEI|IGkAgEBBDA|IHcAgEBBEI)[A-Za-z0-9+/]{40,}`, // SEC1 ECPrivateKey (P-256, P-384, P-521)
      String.raw`MC4CAQAwBQYDK2V[wu]BCIEI[A-Za-z0-9+/]{43}`, // PKCS#8 Ed25519 / X25519
    ].join('|') +
    ')',
  'g',
);
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

/** `signWith(Keys.hmacShaKeyFor(` ... : does the text before the literal stay inside the call (never closes more than it opens)? */
function opensWithinCall(prefix) {
  let depth = 0;
  for (const ch of prefix) {
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    if (depth < 0) return false;
  }
  return true;
}

/**
 * A literal handed to a signing or HMAC call as its key. The key is never prose, so a passphrase (several words) is judged like a
 * quoted value under a strong name (documentation about the key and placeholders pass); one word must look random.
 */
function signingKeyIsSecret(raw) {
  const text = raw.trim();
  if (text === '' || text.includes('${') || isPlaceholder(text.length > 512 ? text.slice(0, 256) + text.slice(-256) : text)) return false;
  if (/\s/.test(text)) return isPhraseSecret({ kind: 'strong', text });
  return looksRandom(text, GATES.codeStrong);
}

// The calls whose options object carries a signing key under `secret` / `secretOrKey`: express-session, cookie-session, express-jwt,
// koa-jwt, passport-jwt. The object must open right after the call's parenthesis: session({ secret: "..." }).
const SIGNING_OPTIONS_CALL = /(?:^|[^A-Za-z0-9_$])(?:new[ \t]{1,8})?(?:session|expressSession|cookieSession|expressjwt|expressJwt|jwt|koaJwt|JwtStrategy)\([ \t\r\n]{0,64}$/;

/** Is the `secret:` key at `index` inside an options object passed straight to one of SIGNING_OPTIONS_CALL? Looks back at most 600 characters. */
function inSigningOptions(input, index) {
  const before = input.slice(Math.max(0, index - 600), index);
  let depth = 0;
  let brace = before.length - 1;
  for (; brace >= 0; brace -= 1) {
    if (before[brace] === '}') depth += 1;
    else if (before[brace] === '{') {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  return brace >= 0 && SIGNING_OPTIONS_CALL.test(before.slice(Math.max(0, brace - 100), brace));
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

const QUOTED_ARGUMENT_MAX = 4096;
/**
 * The quoted string that starts at `start` (text[start] is a quote) and is the last argument of a call: its body without the quotes
 * (`raw`, escapes still in place) and the index after the closing quote (`end`), or null when it is not one complete string on one line
 * followed by `)` or `,`. A triple quote (three double or three single quotes) ends at the first run of three; the others end at the first quote that is not escaped.
 * One pass over at most QUOTED_ARGUMENT_MAX body characters.
 */
function quotedArgument(text, start) {
  const quote = text[start];
  const triple = (quote === '"' || quote === "'") && text[start + 1] === quote && text[start + 2] === quote;
  const bodyStart = start + (triple ? 3 : 1);
  const limit = Math.min(text.length, bodyStart + QUOTED_ARGUMENT_MAX + 3);
  let i = bodyStart;
  for (; i < limit; i += 1) {
    const c = text[i];
    if (c === '\n') return null;
    if (c === '\\') {
      if (text[i + 1] === undefined || text[i + 1] === '\n') return null;
      i += 1;
    } else if (c === quote && (!triple || (text[i + 1] === quote && text[i + 2] === quote))) {
      break;
    }
  }
  if (i >= limit || i - bodyStart > QUOTED_ARGUMENT_MAX) return null;
  const end = i + (triple ? 3 : 1);
  let after = end;
  while (after < text.length && after - end < 8 && (text[after] === ' ' || text[after] === '\t')) after += 1;
  if (text[after] !== ')' && text[after] !== ',') return null;
  return { raw: text.slice(bodyStart, i), end };
}

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
  /(?<![A-Za-z0-9_.-])(?:curl|wget2?|mysql(?:dump|admin|pump|import|show|check|slap)?|mariadb(?:-dump|-admin)?|mongo(?:sh|dump|restore|export|import|stat|top)?|redis6?-cli|valkey-cli|sshpass|smbclient|xhs?|https?|ldap(?:search|modify|add|delete|passwd|compare|whoami)|mosquitto_(?:pub|sub|rr|passwd)|htpasswd|user(?:mod|add)|mkpasswd|dscl|(?:openssl(?=[ \t]+passwd)|net(?=[ \t]+use(?:r)?[ \t]))|rabbitmq(?:ctl|admin)|sqlcmd|keytool|gpg2?|(?:docker|podman|az|vault)(?=[ \t]+login))(?=[ \t])[^\n]{0,600}/g;

// crypt(3) hashes: $1$ (MD5), $2a$ / $2y$ (bcrypt), $5$ / $6$ (SHA-2), $y$ (yescrypt), $apr1$ (Apache): a value that starts with `$`
// and is not a shell variable. A hash committed with its account is a credential like any other literal password.
const CRYPT_HASH = /^\$(?:1|2[abxy]?|5|6|7|y|gy|apr1|md5|sha1|sha256|sha512|pbkdf2[-a-z0-9]{0,16}|argon2[a-z0-9]{0,4})\$[A-Za-z0-9./$,=+-]{8,1024}$/;

/** A password given on a command line: text, or a crypt hash; not a variable reference ($PW, ${PW}, %PW%). */
const shellPasswordIsLiteral = (value) => CRYPT_HASH.test(value) || !SHELL_REFERENCE.test(value);

const OPENSSL_PASSWD_ARGUMENT_FLAGS = new Set(['-salt', '-in', '-rand', '-writerand', '-engine', '-random', '-provider', '-propquery']);
const MKPASSWD_ARGUMENT_FLAGS = new Set(['-m', '--method', '-S', '--salt', '-R', '--rounds', '-P', '--password-fd']);

/** The words that are neither options nor the argument of an option that takes one (`flagsWithArgument`). */
function optionOperands(words, flagsWithArgument) {
  const operands = [];
  for (let i = 0; i < words.length; i += 1) {
    if (words[i].startsWith('-') && words[i] !== '-') {
      if (flagsWithArgument.has(words[i])) i += 1;
    } else operands.push(words[i]);
  }
  return operands;
}

/** The password arguments of one command line for the tools in CLI_PASSWORD_COMMAND (`words` are its shell words, tool first). */
function cliPasswordArguments(allWords) {
  // A quote that never closes on the line belongs to the code around the command (`'wget --password', ...`): the word it
  // swallowed is not an argument.
  const words = allWords.open ? allWords.slice(0, -1) : allWords;
  if (words.length === 0) return [];
  const tool = words[0].replace(/[0-9]+$/, '');
  const found = [];
  const next = (i) => (i + 1 < words.length && !words[i + 1].startsWith('-') ? words[i + 1] : null);
  // A password given as a shell variable ($PW, %PW%) is a reference, not a literal. A crypt(3) hash ($6$salt$...) is a literal.
  const literal = (value) => {
    if (value !== null && value !== undefined && shellPasswordIsLiteral(value)) found.push(value);
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
      else if (tool === 'ldappasswd' && (word === '-s' || word === '-a')) literal(next(i)); // the new and the old password
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
    } else if (tool === 'usermod' || tool === 'useradd') {
      // usermod -p PASSWORD (a crypt(3) hash, or the plain text by mistake), --password PASSWORD
      if (word === '-p' || flag === '--password') literal(value());
    } else if (tool === 'openssl') {
      // openssl passwd: the password is the first operand that is not an option or an option's argument (-salt and -in take one)
      if (words[1] === 'passwd' && i === 2) {
        const operands = optionOperands(words.slice(2), OPENSSL_PASSWD_ARGUMENT_FLAGS);
        literal(operands[0]);
      }
    } else if (tool === 'mkpasswd') {
      // mkpasswd: the password is the first operand that is not an option or an option's argument (the second operand is the salt)
      if (i === 1) literal(optionOperands(words.slice(1), MKPASSWD_ARGUMENT_FLAGS)[0]);
    } else if (tool === 'net') {
      // net user NAME PASSWORD [/add ...], net use \\host\share PASSWORD [/user:NAME]: a bare `*` prompts
      if ((words[1] === 'user' || words[1] === 'use') && i === 2) {
        const operands = words.slice(2).filter((w) => !w.startsWith('/') && w !== '*');
        if (operands.length >= 2) literal(operands[1]);
      }
    } else if (tool === 'dscl') {
      // dscl . -passwd /Users/NAME [OLD] NEW
      if (word === '-passwd') for (const operand of words.slice(i + 2)) literal(operand);
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
// An element name may carry a namespace prefix (`<ns:add>`); the prefix ends in a colon, which no name character is, so each tag has one reading.
const XML_ENTRY_TAG = /<(?:[A-Za-z_][A-Za-z0-9_.-]{0,32}:)?(?:add|setting|property|entry|item|param|parameter|variable|var|env|envvar|option|appsetting|pair|element|secret)(?![A-Za-z0-9_-])/gi;

const XML_ENTRY_CLOSE = /<\/(?:[A-Za-z_][A-Za-z0-9_.-]{0,32}:)?(?:add|setting|property|entry|item|param|parameter|variable|var|env|envvar|option|appsetting|pair|element|secret)[ \t\r\n]*>/gi;
const XML_ENTRY_CLOSE_ONCE = /<\/(?:[A-Za-z_][A-Za-z0-9_.-]{0,32}:)?(?:add|setting|property|entry|item|param|parameter|variable|var|env|envvar|option|appsetting|pair|element|secret)[ \t\r\n]*>/i;
/**
 * The XML entry around `index`: from the nearest opening entry tag before it (or the tag that holds it) to the end of that
 * entry (`/>`, or its closing tag, or the start of the next entry), at most PAIR_XML_CHARS. Null when `index` is not in XML.
 */
function xmlWindow(input, index) {
  const from = Math.max(0, index - PAIR_XML_CHARS);
  const back = input.slice(from, index);
  // `index` at a `<` is an element that starts the document or follows only text: its own entry starts there.
  if (!back.includes('<') && input[index] !== '<') return null;
  let start = -1;
  for (const tag of back.matchAll(XML_ENTRY_TAG)) start = from + tag.index;
  if (start === -1) start = back.includes('<') ? from + back.lastIndexOf('<') : index;
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
  /(?<![A-Za-z0-9_$.-])(["']?)(?:value|val|secret|secretvalue|stringvalue|plaintext|content|data|default|defaultvalue|example|parametervalue)\1[ \t]*[:=][ \t]*(?:(?:![^\s,}\]]{0,60}|&[A-Za-z0-9_-]{1,60})[ \t]+){0,3}(?:"((?:[^"\\\n]|\\.){0,4096})"|'((?:[^'\\\n]|\\.){0,4096})'|([^\s,}\]"']{1,4096}))/gi;
// The same field as an XML element: <value>V</value>
const PAIR_XML_VALUE = /<(?:[A-Za-z_][A-Za-z0-9_.-]{0,32}:)?(?:value|val|secret|content|data|default|example|string)(?:[ \t][^<>]{0,80})?>([^<>]{1,4096})<\//gi; // the body is trimmed in code: whitespace quantifiers around it would backtrack

// Where a value begins (the same field names as PAIR_VALUE_FIELD, whatever follows): read again from the input when it runs over
// several lines (a YAML block scalar, a quote closed on a later line, a folded scalar, a heredoc).
const PAIR_VALUE_START =
  /(?<![A-Za-z0-9_$.-])(["']?)(?:value|val|secret|secretvalue|stringvalue|plaintext|content|data|default|defaultvalue|example|parametervalue)\1[ \t]*[:=][ \t]*(?:(?:![^\s,}\]]{0,60}|&[A-Za-z0-9_-]{1,60})[ \t]+){0,3}(?=\S)/gi;
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
  // Blank lines do not count against the bounds (see MULTILINE_MAX_LINES); the raw read is capped and charged.
  for (let n = 0; !closed && n < MULTILINE_MAX_LINES && chars <= MULTILINE_MAX_CHARS && at - afterHeader <= MULTILINE_RAW_MAX_CHARS; ) {
    if (at >= input.length) {
      closed = true;
      break;
    }
    const next = input.indexOf('\n', at);
    const stop = next === -1 ? input.length : next;
    const raw = input.slice(at, Math.min(stop, at + 4096)).replace(/\r$/, '');
    const trimmedLength = raw.trim().length;
    chars += trimmedLength;
    if (trimmedLength > 0) n += 1;
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
  if (!closed) {
    spendMultiline(ctx, Math.max(0, at - afterHeader - MULTILINE_MAX_CHARS));
    return exhaustedLiteral(ctx, input, afterHeader);
  }
  if (!spendMultiline(ctx, end - afterHeader + 1)) return exhaustedLiteral(ctx, input, afterHeader);
  return { values: bodyValues(lines.join('\n')), end, exhausted: false };
}

/** The lines of a JSON string value whose line breaks are written as \n escapes, as candidate values (each line, and all joined). */
function escapedLineValues(raw) {
  if (!/\\[nr]/.test(raw)) return [];
  const lines = raw.split(/\\r\\n|\\n|\\r/).map((line) => unescapeQuoted(line).trim()).filter((line) => line !== '');
  return lines.length > 1 ? [...lines, lines.join(' ')] : [];
}

// The `kind` of a name that stands for an HTTP authorization header: its value is `<scheme> <credential>` (httpCredentialIsSecret), not a plain secret.
const AUTHORIZATION_KIND = 'authorization';
const isAuthorizationName = (name) => /^(?:[A-Za-z]{1,20}-)?authorization$/i.test(name);

/** Is the value of an Authorization header (`Bearer <token>`, `Basic <base64>`, or a bare token) a hardcoded credential? References and placeholders are not. */
function authorizationValueIsSecret(raw) {
  const value = raw.trim();
  const scheme = /^([A-Za-z][A-Za-z0-9_-]{0,30})[ \t]{1,8}(\S{12,4096})$/.exec(value);
  if (scheme !== null) return scheme[1].toLowerCase() !== 'digest' && httpCredentialIsSecret(scheme[1], scheme[2]);
  return /^\S{12,4096}$/.test(value) && httpCredentialIsSecret(undefined, value);
}

/**
 * The unquoted value of a value field. An authorization value is `<scheme> <credential>`, so a plain YAML scalar reads on past its
 * first blank to the end of the line (or the next `,` / `}` / `#`); every other kind judges the first word.
 */
function bareValue(kind, text, field) {
  if (kind !== AUTHORIZATION_KIND) return field[4];
  const from = field.index + field[0].length;
  let end = from;
  while (end < text.length && end - from < 256 && !',}]#"\'\n'.includes(text[end])) end += 1;
  return field[4] + text.slice(from, end).trimEnd();
}

/** The judge for the value fields paired with a name of this `kind`: (value, quoted) => is it a secret. */
function valueJudge(kind, ctx) {
  if (kind === AUTHORIZATION_KIND) return (value) => authorizationValueIsSecret(value);
  return (value, quoted) => isSecretValue({ kind, value, quoted, separator: ':', mode: ctx.mode, minLength: ctx.minStrong, catalog: ctx.catalog });
}

/**
 * Value fields of the window whose value is not on the field's line: a block scalar (`value: |`, `>-`, `|2`, after a tag such as
 * `!Sub`), a quote closed on a later line, a heredoc or triple-quoted string, a scalar folded over indented lines. The value is
 * read from the input (the window only says where it starts) and judged like a quoted value. Returns a hit ({ abs }), an
 * unverifiable read ({ exhausted }) or null.
 */
function multilineFieldSecret(window, kind, ctx, input, read) {
  const judgeValue = valueJudge(kind, ctx);
  for (const start of window.text.matchAll(PAIR_VALUE_START)) {
    const keyAt = inputOffset(window, start.index);
    const valueAt = inputOffset(window, start.index + start[0].length);
    if (read.has(valueAt)) continue;
    read.add(valueAt);
    // A window is far wider than a pair, so the next names of a dense file see this same value again: a value judged not to be a
    // secret for this kind of name is not read a second time (the verdict of a read that ran out of a bound is never kept).
    const judgedKey = `${kind}@${valueAt}`;
    const judgedBefore = (ctx.judgedValueStarts ??= new Set());
    if (judgedBefore.has(judgedKey)) continue;
    const keyColumn = keyAt - ctx.lineStart(keyAt);
    BLOCK_SCALAR_HEADER.lastIndex = valueAt;
    const header = BLOCK_SCALAR_HEADER.exec(input);
    const body =
      header !== null
        ? blockScalarValue(ctx, input, valueAt + header[0].length, keyColumn)
        : (multilineValue(ctx, input, valueAt) ?? continuedValue(ctx, input, keyAt, valueAt));
    if (body === null) continue;
    if (body.exhausted) return { exhausted: true, budget: body.budget === true };
    if (body.values.some((value) => judgeValue(value, true))) return { abs: { start: valueAt, end: body.end } };
    judgedBefore.add(judgedKey);
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
  const judge = valueJudge(kind, ctx);
  for (const field of unescaped.matchAll(PAIR_VALUE_FIELD)) {
    const quotedValue = field[2] ?? field[3];
    const quoted = quotedValue !== undefined;
    if (quoted ? judge(unescapeQuoted(quotedValue), true) || escapedLineValues(quotedValue).some((line) => judge(line, true)) : judge(bareValue(kind, unescaped, field), false)) {
      return at(field);
    }
    if (!quoted) {
      // `value = sensitive("v")`, `default = pulumi.secret("v")`: the literal argument of a wrapper call is the value.
      const callAt = field.index + field[0].length - field[4].length;
      const literalAt = unwrapLiteralCall(unescaped, callAt);
      const literal = literalAt === callAt ? null : quotedArgument(unescaped, literalAt);
      if (literal !== null && judge(unescapeQuoted(literal.raw), true)) return escaped ? at(field) : { index: field.index, length: literal.end - field.index };
    }
  }
  if (unescaped.includes('</')) {
    for (const field of unescaped.matchAll(PAIR_XML_VALUE)) {
      const body = field[1].trim();
      if (body !== '' && (judge(body, true) || bodyValues(body).some((line) => judge(line, true)))) return at(field);
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

/**
 * The XML element form of a pair: the name element `m` (<name>X</name>, <key>X</key>) and its value in the same entry
 * (<value>Y</value>, a plist <string>Y</string>, value="Y"). Reads are budgeted per file like the other window searches.
 */
function xmlPairIsSecret(m, kind, ctx) {
  const window = xmlWindow(m.input, m.index);
  ctx.pairBudget = (ctx.pairBudget ?? PAIR_BUDGET_CHARS) - (window?.text.length ?? 0) - 64;
  if (ctx.pairBudget < 0) {
    ctx.pairExhausted = true;
    attributeToFile(m);
    return true;
  }
  const found = window === null ? null : windowHoldsSecretValue(window, kind, ctx, false, m.input);
  return found !== null && pairHit(m, window, found, ctx);
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
      if (ch === '\\' && ansi && i + 1 < line.length) {
        word += line[i + 1];
        i += 1;
      } else if (ch === '\\' && quote === '"' && i + 1 < line.length) {
        // inside "...", a backslash escapes only $ ` " \ and a line break; before any other character it stays (echo -e "a\nb")
        if ('$`"\\\n'.includes(line[i + 1])) {
          word += line[i + 1];
          i += 1;
        } else word += ch;
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
  let content = 0;
  // Blank lines do not count against the bounds (see MULTILINE_MAX_LINES); the whole raw read is charged below.
  for (let n = 0; n < MULTILINE_MAX_LINES && at <= input.length && content <= MULTILINE_MAX_CHARS && at - from <= MULTILINE_RAW_MAX_CHARS; ) {
    const lineEnd = input.indexOf('\n', at);
    const stop = lineEnd === -1 ? input.length : lineEnd;
    const line = input.slice(at, Math.min(stop, at + 4096)).replace(/\r$/, '');
    end = stop;
    const trimmed = line.trim();
    if (trimmed === word) {
      closed = true;
      break;
    }
    lines.push(line);
    if (trimmed !== '') n += 1;
    content += trimmed.length;
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

/** A chpasswd account name (the part before the colon); a trailing $ is a machine account. */
const CHPASSWD_USER = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}\$?$/;

/**
 * The passwords a `chpasswd` / `passwd` / `smbpasswd` command at `m` receives on its standard input (a pipe from echo or printf, a
 * here-string, a heredoc), judged like any other literal password: references and placeholders pass, a crypt hash (`chpasswd -e`)
 * is a literal. A heredoc whose end cannot be found within the bounds cannot be verified and is reported.
 */
function accountPasswordFromStdin(m, ctx) {
  const words = shellWords(m[0]);
  const tool = words[0];
  // The command must be a word on its own: in code such as 'chpasswd', 'chpasswd <<< ' + x the shell reading glues the
  // quoted pieces into one word that is no command at all.
  if (tool !== 'chpasswd' && tool !== 'passwd' && tool !== 'smbpasswd') return false;
  const stdin = stdinValues(m, ctx);
  const inputs = [...stdin.values];
  const hereString = words.indexOf('<<<');
  const hereWord = hereString !== -1 ? words[hereString + 1] : undefined;
  if (hereWord !== undefined) inputs.push(hereWord);
  if (stdin.end > m.index + m[0].length) m.spanEnd = stdin.end;
  if (stdin.unterminated) return true;
  if (tool === 'smbpasswd' && !words.some((w) => /^-[A-Za-z]*s/.test(w) && !w.startsWith('--'))) return false; // without -s it prompts
  const passwords = [];
  for (const input of inputs) {
    if (tool === 'chpasswd') {
      // user:password, one account per line; printf 'user:%s\n' P passes the password alone (stdinValues drops the
      // format). Where a colon is present, the part before it must be an account name, and a here-string word is the
      // literal input, so it needs that shape: shell-word reading of code (a JS string such as 'chpasswd <<< ' + x)
      // yields text that is neither.
      const colon = input.indexOf(':');
      if (colon > 0 ? !CHPASSWD_USER.test(input.slice(0, colon)) : input === hereWord) continue;
      passwords.push(colon > 0 ? input.slice(colon + 1) : input);
    } else {
      // the password, typed twice: two lines, or one text with the line break written as \n
      passwords.push(...input.split(/\\n|\r?\n/));
    }
  }
  return passwords.some((password) => {
    const text = password.trim();
    return text !== '' && shellPasswordIsLiteral(text) && directiveIsSecret({ text, quoted: /\s/.test(text) });
  });
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

/**
 * A PowerShell here-string (@' ... '@ or @" ... "@) at `start` as the value of an environment variable, read by the shared multi-line
 * reader: each body line and the joined body are candidates. One that does not close within the bounds is reported (fail closed).
 */
function powershellHereStringIsSecret(m, kind, ctx, start) {
  const read = multilineValue(ctx, m.input, start);
  if (read === null) return false;
  m.spanEnd = read.end;
  if (read.exhausted) return exhaustedVerdict(m, ctx, read);
  return read.values.some((text) => powershellValueIsSecret(kind, { text }, ctx));
}

// Function-call forms that set an environment variable or a system property to a literal:
//   C# / .NET  Environment.SetEnvironmentVariable("NAME", "v"[, EnvironmentVariableTarget.Machine])   Win32  SetEnvironmentVariableW(L"NAME", L"v")
//   Go         os.Setenv("NAME", "v")           Python  os.putenv("NAME", "v"), os.environ.setdefault("NAME", "v")
//   Java       System.setProperty("name", "v"), props.setProperty("name", "v"), System.getenv().put("NAME", "v"), pb.environment().put(...)
//   Ruby       ENV.store("NAME", "v")           Deno  Deno.env.set("NAME", "v")           Rust  std::env::set_var("NAME", "v")
//   C / PHP / Swift / Lua  setenv("NAME", "v", 1), putenv("NAME=v"), _putenv_s("NAME", "v"), g_setenv(...), apache_setenv(...)
//   Elixir System.put_env("NAME", "v")          Erlang  os:putenv("NAME", "v")
// (`ENV["NAME"] = "v"`, `os.environ["NAME"] = "v"`, `process.env.NAME = "v"`, `$_ENV['NAME'] = 'v'` and `$env:NAME = 'v'` are assignments.)
// Every alternative is a fixed call name, so a match starts at a name and reads a bounded argument list.
const ENV_SETTER_CALLEE = [
  String.raw`(?:System\.)?Environment\.SetEnvironmentVariable`,
  String.raw`(?:os|syscall)\.Setenv`,
  String.raw`os\.(?:putenv|environ\.setdefault)`,
  String.raw`System\.(?:setProperty|getProperties\(\)\.setProperty|getenv\(\)\.put|put_env)`,
  String.raw`[A-Za-z_$][A-Za-z0-9_$]{0,64}\.setProperty`,
  String.raw`(?:environment|getenv)\(\)\.put`,
  String.raw`ENV\.store`,
  String.raw`Deno\.env\.set`,
  String.raw`(?:std::)?env::set_var`,
  String.raw`os:putenv`,
  String.raw`(?:g_|_)?(?:setenv|putenv)(?:_s)?`,
  String.raw`SetEnvironmentVariable[AW]?`,
  String.raw`apache_setenv`,
].join('|');
// The callee and its opening parenthesis; the arguments (a name literal, then `, value` or `=value` inside the same string for putenv)
// are read by envSetterArguments with callStringLiteral, so every literal form of a language (Rust r#"..."#, C# @"...", C++ R"(...)") counts.
const ENV_SETTER_CALL = new RegExp(String.raw`(?<![A-Za-z0-9_$])(?:${ENV_SETTER_CALLEE})\(\s{0,64}(?=\S)`, 'g');
/** The index after the blanks and line breaks (at most 256 characters: rustfmt puts each argument on its own line) from `at`. */
function skipArgumentSpace(input, at) {
  const stop = Math.min(input.length, at + 256);
  while (at < stop && (input[at] === ' ' || input[at] === '\t' || input[at] === '\r' || input[at] === '\n')) at += 1;
  return at;
}
const ENV_VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,255}$/;

/**
 * The arguments of an environment setter call whose `(` and blanks end at `start`: { name, literal, valueStart } for `("NAME", "value")`
 * or `("NAME=value")`, or null when they are not literals (a variable, a call, a name that is not a variable name). The value may run
 * over lines (Rust r#"..."#, a Go backtick literal) or be exhausted; the caller judges it through callLiteralTexts.
 */
function envSetterArguments(input, start, filePath, ctx = null) {
  const nameLiteral = callStringLiteral(input, start, filePath);
  if (nameLiteral === null) return null;
  let at = skipArgumentSpace(input, nameLiteral.end);
  if (input[at] === ',' && ENV_VARIABLE_NAME.test(nameLiteral.text)) {
    at = skipArgumentSpace(input, at + 1);
    return { name: nameLiteral.text, literal: callStringLiteral(input, at, filePath, ctx), valueStart: at };
  }
  const equals = nameLiteral.text.indexOf('=');
  if (equals > 0 && ENV_VARIABLE_NAME.test(nameLiteral.text.slice(0, equals))) {
    // putenv("NAME=value"): the value runs to the closing quote of the same string
    const text = nameLiteral.text.slice(equals + 1);
    return { name: nameLiteral.text.slice(0, equals), literal: { text, end: nameLiteral.end, interpolated: nameLiteral.interpolated }, valueStart: start };
  }
  return null;
}

const LITERAL_HASH_MAX = 16; // Rust r#"..."#, Swift #"..."#: at most this many hashes
const LITERAL_MAX_CHARS = 4098;
// Languages whose triple-quoted strings run over lines (Python, Kotlin, Java text blocks, C# raw literals, Scala, Swift, Groovy, Julia,
// Dart, Elixir, TOML). Elsewhere three quotes are an empty string and a quote.
const SPANNING_TRIPLE_QUOTES = /\.(?:py|pyw|pyi|kt|kts|java|cs|scala|sc|swift|groovy|gradle|gvy|jl|dart|ex|exs|toml)$/i;
const CLOSING_DELIMITER = { '(': ')', '[': ']', '{': '}', '<': '>' };

/**
 * The body of a delimited literal whose opening delimiter is at `open`: { text, end } or null. A bracket delimiter nests; any other
 * delimiter closes at its next occurrence; a backslash escapes the next character. Without `ctx`: one line, at most LITERAL_MAX_CHARS.
 * With `ctx` (Perl q{...} / qq / qw and Ruby %q(...) / %Q / %w may run over lines): up to the multi-line bounds (200 non-blank lines,
 * 32 KB of non-blank text, MULTILINE_RAW_MAX_CHARS in all); one that does not close within them comes back { exhausted: true }.
 */
function delimitedBody(input, open, ctx = null) {
  const opener = input[open];
  const closer = CLOSING_DELIMITER[opener] ?? opener;
  let depth = 0;
  let text = '';
  const spans = ctx !== null;
  const capped = spans && budgetSpent(ctx); // the file's multi-line budget is gone: a literal that leaves its line is exhausted
  let j = open + 1;
  const exhausted = () => {
    spendMultiline(ctx, Math.max(0, j - open - MULTILINE_MAX_CHARS)); // blank text read past the content bound (see closingQuote)
    return { text: '', end: Math.min(input.length, open + 1 + MULTILINE_MAX_CHARS), interpolated: false, exhausted: true };
  };
  let lines = 0;
  let content = 0;
  let lineHasContent = false;
  const limit = spans ? MULTILINE_RAW_MAX_CHARS : LITERAL_MAX_CHARS;
  for (; j < input.length && j - open < limit; j += 1) {
    const ch = input[j];
    if (ch === '\n') {
      if (!spans) return null;
      if (capped || (lineHasContent && (lines += 1) > MULTILINE_MAX_LINES)) return exhausted();
      lineHasContent = false;
    } else if (ch !== ' ' && ch !== '\t' && ch !== '\r') {
      lineHasContent = true;
      if ((content += 1) > MULTILINE_MAX_CHARS) return spans ? exhausted() : null;
    }
    if (ch === '\\' && j + 1 < input.length) {
      text += input[j + 1];
      j += 1;
    } else if (ch === closer && depth === 0) {
      return { text, end: j + 1, interpolated: false };
    } else {
      if (closer !== opener) {
        if (ch === opener) depth += 1;
        else if (ch === closer) depth -= 1;
      }
      text += ch;
    }
  }
  return spans ? exhausted() : null;
}

/** A word-list literal (Perl qw(), Ruby %w[]) is a list of values: its words are candidates as well as the whole text. */
function wordList(literal, words) {
  return literal !== null && words ? { ...literal, words: true } : literal;
}

/**
 * Index of `needle` in `input` at or after `from`, looking at most `max` characters ahead (-1 when it is not there). The search is
 * bounded, so a file of unclosed openers costs a constant per opener, not a scan to the end of the file.
 */
function indexWithin(input, needle, from, max) {
  const found = input.slice(from, from + max + needle.length).indexOf(needle);
  return found === -1 ? -1 : from + found;
}

/** The number of line breaks in input[from, to). */
function lineCount(input, from, to) {
  let n = 0;
  for (let at = input.indexOf('\n', from); at !== -1 && at < to; at = input.indexOf('\n', at + 1)) n += 1;
  return n;
}

/** The body from `from` to the next `closer` (a literal that may run over lines: Lua [[...]], OCaml {|...|}, C++ R"(...)"), or null. */
function bodyUntil(input, from, closer) {
  const close = indexWithin(input, closer, from, MULTILINE_MAX_CHARS);
  if (close === -1) return null;
  return { text: input.slice(from, close).replace(/^\r?\n/, ''), end: close + closer.length, interpolated: false };
}

/**
 * The literals that do not start with a quote, by language (the file's extension decides, since `q(x)` or `[[x]]` are ordinary code elsewhere):
 * Lua [[...]] / [==[...]==], OCaml {|...|} / {id|...|id}, Perl q(...) qq{...} qw/.../, Ruby and Crystal %q(...) %Q[...] %w<...> %(...),
 * Elixir ~s(...) ~S"...", Groovy slashy /.../ and dollar-slashy $/.../$.
 */
function quoteLikeLiteral(input, start, filePath, ctx = null) {
  const c = input[start];
  if (c === '[' && /\.lua$/i.test(filePath)) {
    let level = 0;
    while (level <= LITERAL_HASH_MAX && input[start + 1 + level] === '=') level += 1;
    if (level > LITERAL_HASH_MAX || input[start + 1 + level] !== '[') return null;
    return bodyUntil(input, start + 2 + level, `]${'='.repeat(level)}]`);
  }
  if (c === '{' && /\.(?:ml|mli|re|rei)$/i.test(filePath)) {
    let end = start + 1;
    while (end - start <= 17 && /[a-z_]/.test(input[end] ?? '')) end += 1;
    if (input[end] !== '|') return null;
    return bodyUntil(input, end + 1, `|${input.slice(start + 1, end)}}`);
  }
  if (c === 'q' && /\.(?:pl|pm|t|cgi|psgi)$/i.test(filePath)) {
    let open = start + 1;
    const words = input[open] === 'w';
    if (input[open] === 'q' || words) open += 1;
    return '([{<|!/^~\'"'.includes(input[open] ?? '\n') ? wordList(delimitedBody(input, open, ctx), words) : null;
  }
  if (c === '%' && /\.(?:rb|rake|gemspec|podspec|cr|erb)$/i.test(filePath)) {
    const open = 'qQwWiI'.includes(input[start + 1] ?? '\n') ? start + 2 : start + 1;
    return '([{<|!/^'.includes(input[open] ?? '\n') ? wordList(delimitedBody(input, open, ctx), 'wWiI'.includes(input[start + 1] ?? '\n')) : null;
  }
  if (c === '~' && /\.(?:ex|exs|eex|heex)$/i.test(filePath)) {
    return /[A-Za-z]/.test(input[start + 1] ?? '') && '([{<|/"\''.includes(input[start + 2] ?? '\n') ? delimitedBody(input, start + 2) : null;
  }
  if ((c === '/' || (c === '$' && input[start + 1] === '/')) && /\.(?:groovy|gradle|gvy|gy)$/i.test(filePath)) {
    const dollar = c === '$';
    const open = dollar ? start + 1 : start;
    const close = indexWithin(input, dollar ? '/$' : '/', open + 1, LITERAL_MAX_CHARS);
    if (dollar && ctx !== null && (close === -1 || input.slice(open, close).includes('\n'))) {
      // A dollar-slashy string may run over lines: read like the other spanning literals, exhausted past the bounds.
      const exhausted = { text: '', end: Math.min(input.length, open + 1 + MULTILINE_MAX_CHARS), interpolated: true, exhausted: true };
      if (budgetSpent(ctx)) return exhausted;
      const far = indexWithin(input, '/$', open + 1, MULTILINE_MAX_CHARS);
      if (far === -1 || lineCount(input, open + 1, far) > MULTILINE_MAX_LINES) return exhausted;
      return { text: input.slice(open + 1, far).replace(/^\r?\n/, ''), end: far + 2, interpolated: true };
    }
    if (close === -1 || input.slice(open, close).includes('\n')) return null;
    return { text: input.slice(open + 1, close), end: close + (dollar ? 2 : 1), interpolated: true };
  }
  return null;
}

/**
 * The string literal at `start` in call or assignment syntax. Forms read, with their prefixes:
 *   "..." '...' and backtick strings, with the prefixes C# @ $ $@, C / C++ L u U u8, Python / Rust r b br rb f fr u, Scala s raw
 *   r#"..."# r##"..."##   Rust raw strings, and Swift #"..."# / ##"..."## (up to LITERAL_HASH_MAX hashes; no escapes)
 *   R"delim(...)delim"    C++ raw strings, and r"(...)" in R files
 *   triple-quoted strings on one line
 *   the quote-less forms of quoteLikeLiteral (Lua, OCaml, Perl, Ruby, Elixir, Groovy), chosen by `filePath`.
 * Backslash escapes the next character unless the string is verbatim (@"..." doubles its quote) or raw (backtick, r"...", hashed).
 * Raw forms whose grammar lets them run over lines (Rust r"..." / br"..." in a .rs file, r#"..."# with any number of hashes, backtick
 * literals) are read over lines when `ctx` is given: the body comes back whole (the caller judges it like a heredoc, see
 * callLiteralTexts), and one that does not end within the multi-line bounds (or once the file's budget is gone) comes back as
 * { exhausted: true } so the caller reports it instead of reading the following lines as code. Without `ctx` they are one line.
 * Returns { text, end, interpolated } or null (not a literal, not closed within the bounds).
 */
function callStringLiteral(input, start, filePath = '', ctx = null) {
  let i = start;
  let prefix = input.startsWith('u8', i) ? 'u8' : '';
  i += prefix.length;
  const rust = /\.rs$/i.test(filePath);
  for (let n = 0; n < 2 && (/[@$LuUrRbBfF]/.test(input[i] ?? '') || (rust && n === 0 && input[i] === 'c')); n += 1) {
    prefix += input[i];
    i += 1;
  }
  if (prefix === '' && (input.startsWith('raw"', i) || input.startsWith('s"', i))) {
    prefix = input[i] === 'r' ? 'raw' : 's';
    i += prefix.length;
  }
  if (prefix === '' && input.startsWith('String.raw`', i)) i += 10; // JavaScript tagged template (raw)
  else if (prefix === '' && input[i] === ':' && input[i + 1] === '"' && /\.(?:rb|rake|cr)$/i.test(filePath)) i += 1; // Ruby symbol :"..."
  let hashes = 0;
  while (hashes <= LITERAL_HASH_MAX && input[i + hashes] === '#') hashes += 1;
  const quote = input[i + hashes];
  if (hashes > LITERAL_HASH_MAX || (hashes > 0 && quote !== '"') || (quote !== '"' && quote !== "'" && quote !== '`')) {
    return hashes === 0 ? quoteLikeLiteral(input, start, filePath, ctx) : null;
  }
  i += hashes;
  const verbatim = prefix.includes('@');
  const raw = quote === '`' || /r/i.test(prefix) || hashes > 0;
  const interpolated = /[$fFs]/.test(prefix);
  if (quote === '"' && hashes === 0 && /[rR]/.test(prefix)) {
    // C++ R"delim(...)delim", and r"(...)" / r"[...]" / r"{...}" / r"-(...)-" in R files
    const cpp = prefix.includes('R');
    let open = i + 1;
    while (open - i <= 17 && (cpp ? !/[()\\\s]/.test(input[open] ?? '(') : input[open] === '-')) open += 1;
    const bracket = input[open];
    if (cpp ? bracket === '(' : /\.r$/i.test(filePath) && (bracket === '(' || bracket === '[' || bracket === '{')) {
      const closer = (cpp ? ')' : CLOSING_DELIMITER[bracket]) + input.slice(i + 1, open) + '"';
      return bodyUntil(input, open + 1, closer);
    }
  }
  if (quote !== '`' && hashes === 0 && input[i + 1] === quote && input[i + 2] === quote) {
    const close = indexWithin(input, quote.repeat(3), i + 3, LITERAL_MAX_CHARS);
    if (ctx !== null && SPANNING_TRIPLE_QUOTES.test(filePath) && (close === -1 || input.slice(i + 3, close).includes('\n'))) {
      // Triple quotes run over lines in every language that has them (Python, Kotlin and Java text blocks, C# raw literals, Scala,
      // Swift): read within the multi-line bounds, exhausted past them. C#, Kotlin and Scala raw strings have no escapes.
      const exhausted = { text: '', end: Math.min(input.length, i + 3 + MULTILINE_MAX_CHARS), interpolated, exhausted: true };
      if (budgetSpent(ctx)) return exhausted;
      const escapes = !raw && !/\.(?:cs|kt|kts|scala)$/i.test(filePath);
      const far = closingQuote(input, i + 3, quote, { escapes, tripled: true, ctx });
      if (far === -1) return exhausted;
      const body = input.slice(i + 3, far).replace(/^\r?\n/, '');
      return { text: escapes ? unescapeMultiline(body) : body, end: far + 3, interpolated };
    }
    if (close === -1 || input.slice(i + 3, close).includes('\n')) return null;
    return { text: input.slice(i + 3, close), end: close + 3, interpolated };
  }
  const closer = '#'.repeat(hashes);
  if (raw && !verbatim) {
    // no escapes: the literal ends at the first closing quote (followed by its hashes); two native searches, no per-character work
    let closing = indexWithin(input, quote + closer, i + 1, LITERAL_MAX_CHARS);
    // Rust raw strings and backtick literals may span lines (Python r"..." and Swift #"..."# may not: a line break there is a syntax
    // error, so a newline in one of those is the next line of code, not the value). A spanning form that does not close on its line
    // is looked for within the multi-line window, only after the short one failed, so an ordinary one-line literal never pays for
    // the wide search; one that is still not closed, or that exceeds the line bound, is exhausted (reported by the caller, fail
    // closed). Once the file's multi-line budget is gone nothing more is read: a file of unterminated openers costs one window per
    // opener until then and a constant after.
    const spansLines = ctx !== null && (hashes > 0 || quote === '`' || (/^[bc]?r$/.test(prefix) && rust));
    if (spansLines && (closing === -1 || input.slice(i + 1, closing).includes('\n'))) {
      const exhausted = { text: '', end: Math.min(input.length, i + 1 + MULTILINE_MAX_CHARS), interpolated, exhausted: true };
      if (budgetSpent(ctx)) return exhausted;
      if (closing === -1) closing = indexWithin(input, quote + closer, i + 1, MULTILINE_MAX_CHARS);
      if (closing === -1) return exhausted;
      const text = input.slice(i + 1, closing);
      let lines = 0;
      for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) {
        lines += 1;
        if (lines > MULTILINE_MAX_LINES) return exhausted;
      }
      return { text: text.replace(/^\r?\n/, ''), end: closing + 1 + hashes, interpolated };
    }
    if (closing === -1) return null;
    const text = input.slice(i + 1, closing);
    return text.includes('\n') ? null : { text, end: closing + 1 + hashes, interpolated };
  }
  // One pass to the closing quote without building anything, so a line of unclosed openers costs a scan each, not an allocation each.
  // A Rust string ("...", b"...", c"...") and a C# verbatim string (@"...", $@"...") may run over lines: with `ctx`, one that does not
  // close on its line is read within the multi-line bounds (closingQuote) and comes back whole, or exhausted past them.
  const spansPlain = ctx !== null && quote === '"' && hashes === 0 && (verbatim || (rust && /^[bc]?$/.test(prefix)));
  const limit = Math.min(input.length, i + LITERAL_MAX_CHARS);
  let j = i + 1;
  for (; j < limit; j += 1) {
    const ch = input[j];
    if (ch === '\n') {
      if (!spansPlain) return null;
      const exhausted = { text: '', end: Math.min(input.length, i + 1 + MULTILINE_MAX_CHARS), interpolated, exhausted: true };
      if (budgetSpent(ctx)) return exhausted;
      const far = closingQuote(input, i + 1, quote, { escapes: !verbatim, pair: verbatim, ctx });
      if (far === -1) return exhausted;
      const body = input.slice(i + 1, far);
      return { text: verbatim ? body.split(quote + quote).join(quote) : unescapeMultiline(body), end: far + 1, interpolated };
    }
    if (ch === quote) {
      if (hashes > 0) {
        if (input.startsWith(closer, j + 1)) break;
      } else if (verbatim && input[j + 1] === quote) j += 1;
      else break;
    } else if (ch === '\\' && !raw && !verbatim && j + 1 < input.length) j += 1;
  }
  if (j >= limit) return null;
  const body = input.slice(i + 1, j);
  const end = j + 1 + hashes;
  return { text: verbatim ? body.split(quote + quote).join(quote) : body.replace(/\\([\s\S])/g, '$1'), end, interpolated };
}

// Python string prefixes, case-insensitive: r b u f, and the pairs rb br fr rf (lower-cased here).
const PYTHON_STRING_PREFIXES = new Set(['r', 'b', 'u', 'f', 'rb', 'br', 'fr', 'rf']);

/** Length of a Python string prefix (r, b, rb, f, u, ...) at `start` that a quote follows directly, or 0. Reads at most three characters. */
function stringPrefixLength(input, start) {
  for (let length = 1; length <= 2; length += 1) {
    const next = input[start + length];
    if (next === '"' || next === "'") return PYTHON_STRING_PREFIXES.has(input.slice(start, start + length).toLowerCase()) ? length : 0;
  }
  return 0;
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

// The bounds count CONTENT: lines that are not blank and characters that are not blanks. A certificate chain that the name-based
// rules see blanked (blankPublicPemBlocks) is spaces and line breaks, so a real-size CA bundle (8 certificates of ~1.6 KB are over
// 200 lines) does not run a literal out of its bounds. The raw distance a single read may cover is capped at MULTILINE_RAW_MAX_CHARS,
// and blank text read past the content bounds is charged to the file's multi-line budget, so a hostile run of blanks stays linear.
const MULTILINE_MAX_LINES = 200;
const MULTILINE_MAX_CHARS = 32_768;
const MULTILINE_RAW_MAX_CHARS = 4 * 1024 * 1024;
const MULTILINE_BUDGET_CHARS = 24_000_000; // per file: characters the multi-line readers may look at before the file is reported
const TRIPLE_QUOTE = /[rRbBfFuU]{0,2}#{0,16}("""|''')/y;
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
 * The texts a literal read by callStringLiteral (at `from`) is judged on, or the verdict when it cannot be verified. A one-line
 * literal is its text. One that runs over lines (a Rust raw string, a backtick literal, a Lua / OCaml / C++ raw body) is judged like
 * a heredoc: each line and the joined lines, charged to the file's multi-line budget. A word list (Perl qw, Ruby %w) adds its words.
 * A literal that did not end within the bounds, or whose body the budget no longer covers, is reported (fail closed), once the
 * budget is gone once per file, exactly as the other multi-line readers do.
 * @returns {{texts: string[]} | {verdict: boolean}}
 */
function callLiteralTexts(m, ctx, literal, from) {
  const multiline = literal.text.includes('\n');
  if (literal.exhausted === true || (multiline && !spendMultiline(ctx, literal.text.length))) {
    return { verdict: exhaustedVerdict(m, ctx, exhaustedLiteral(ctx, m.input, from)) };
  }
  const texts = multiline ? bodyValues(literal.text) : [literal.text];
  if (literal.words === true) texts.push(...literal.text.split(/\s+/).filter((word) => word !== ''));
  return { texts };
}

/**
 * Index of the closing `quote` of a string body that starts at `from`, or -1 when it does not close within the bounds.
 * `escapes`: a backslash makes the next character part of the string (so an escaped quote does not close it).
 * `pair`: a doubled quote is one quote of the content (YAML 'it''s'). `tripled`: the closing delimiter is three quotes.
 * `stop`: do not look at or beyond this index.
 */
function closingQuote(input, from, quote, { escapes, pair = false, tripled = false, stop = input.length, ctx = null }) {
  const limit = Math.min(stop, from + MULTILINE_RAW_MAX_CHARS);
  let lines = 0;
  let content = 0;
  let lineHasContent = false;
  const giveUp = (at) => {
    if (ctx !== null) spendMultiline(ctx, Math.max(0, at - from - MULTILINE_MAX_CHARS)); // blank text read past the content bound
    return -1;
  };
  for (let i = from; i < limit; i += 1) {
    const ch = input[i];
    if (ch === '\n') {
      if (lineHasContent && (lines += 1) > MULTILINE_MAX_LINES) return giveUp(i);
      lineHasContent = false;
    } else if (ch === ' ' || ch === '\t' || ch === '\r') continue;
    else if ((content += 1) > MULTILINE_MAX_CHARS) return giveUp(i);
    else {
      lineHasContent = true;
      if (ch === '\\' && escapes) i += 1;
      else if (ch === quote) {
        if (tripled) {
          if (input[i + 1] === quote && input[i + 2] === quote) return i;
        } else if (pair && input[i + 1] === quote) i += 1;
        else return i;
      }
    }
  }
  return giveUp(limit);
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
    const close = closingQuote(input, bodyStart, quote[0], { escapes: !literalToml, tripled: true, ctx });
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
      let content = 0;
      // Blank lines do not count against the bounds (see MULTILINE_MAX_LINES); the raw read is capped and charged.
      for (let n = 0; n < MULTILINE_MAX_LINES && at <= input.length && at - lineEnd <= MULTILINE_RAW_MAX_CHARS; ) {
        let next = input.indexOf('\n', at);
        if (next === -1) next = input.length;
        const line = input.slice(at, next).replace(/\r$/, '');
        const head = indented ? line.trimStart() : line;
        if (head.startsWith(tag) && /^[ \t;,)]*$/.test(head.slice(tag.length))) {
          if (!spendMultiline(ctx, next - lineEnd)) return exhaustedLiteral(ctx, input, lineEnd);
          return { values: bodyValues(body.join('\n')), end: next, exhausted: false };
        }
        body.push(line);
        const trimmed = line.trim().length;
        if (trimmed > 0) n += 1;
        content += trimmed;
        if (next >= input.length || content > MULTILINE_MAX_CHARS) break;
        at = next + 1;
      }
      spendMultiline(ctx, Math.max(0, at - lineEnd - MULTILINE_MAX_CHARS));
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
    const close = closingQuote(input, valueStart + 1, '`', { escapes: true, ctx });
    if (close === -1) return exhaustedLiteral(ctx, input, valueStart);
    const body = input.slice(valueStart + 1, close);
    if (!body.includes('\n')) return null;
    if (!spendMultiline(ctx, body.length)) return exhaustedLiteral(ctx, input, valueStart);
    return { values: bodyValues(body.replace(/\\\r?\n[ \t]*/g, '')).filter((line) => !line.includes('${')), end: close, exhausted: false };
  }
  // A quote that is not closed on its line: shell NAME='a<newline>b', dotenv and YAML flow scalars over several lines.
  if ((first === '"' || first === "'") && ctx.mode === 'config') {
    const lineEnd = ctx.lineEnd(valueStart);
    const sameLine = closingQuote(input, valueStart + 1, first, { escapes: first === '"', pair: first === "'", stop: lineEnd, ctx });
    if (sameLine !== -1) return null;
    if (budgetSpent(ctx)) return exhaustedLiteral(ctx, input, valueStart);
    const close = closingQuote(input, valueStart + 1, first, { escapes: first === '"', pair: first === "'", ctx });
    if (close === -1 || !spendMultiline(ctx, close - valueStart)) return exhaustedLiteral(ctx, input, valueStart);
    const body = input.slice(valueStart + 1, close);
    return { values: bodyValues(first === '"' ? unescapeMultiline(body) : body.replace(/''/g, "'")), end: close, exhausted: false };
  }
  return null;
}

/** Does the text end in an odd run of backslashes (a line continuation)? A linear scan from the end; no regular expression. */
function endsInBackslash(text) {
  let run = 0;
  for (let i = text.length - 1; i >= 0 && text[i] === '\\'; i -= 1) run += 1;
  return run % 2 === 1;
}

/** Judge `text` through `judge`, remembering the verdict of a long text (the pieces of a continued value are judged once per name kind). */
function judgeOnce(ctx, tag, text, judge) {
  if (text.length < 128) return judge();
  const memo = (ctx.judgedTexts ??= new Map());
  let byText = memo.get(tag);
  if (byText === undefined) memo.set(tag, (byText = new Map()));
  let verdict = byText.get(text);
  if (verdict === undefined) {
    verdict = judge();
    if (byText.size < 4096) byText.set(text, verdict);
  }
  return verdict;
}

/**
 * One line of a backslash-continued value, read once per file: `piece` is its text without the continuation backslash and its
 * leading blanks, `next` where its line ends, `more` whether it continues on the next line. Every match that reads a
 * continuation walks these records instead of slicing and testing the lines again, so a file of many continued lines
 * costs one read per line, not one per (match, line).
 */
function continuationLine(ctx, input, at) {
  const lines = (ctx.continuationLines ??= new Map());
  let line = lines.get(at);
  if (line === undefined) {
    let next = input.indexOf('\n', at);
    if (next === -1) next = input.length;
    const text = input.slice(at, Math.min(next, at + 4096)).replace(/\r$/, '');
    const more = endsInBackslash(text);
    const piece = (more ? text.slice(0, -1) : text).trimStart();
    line = { next, more, piece, trimmed: piece.trim() };
    lines.set(at, line);
  }
  return line;
}

/**
 * The lines that continue an unquoted value of a configuration file after its first line:
 *  - a trailing backslash (properties files, shell scripts): the next line follows without a break;
 *  - an INI value (configparser) or a YAML plain scalar folded over indented lines: the following lines indented deeper than the key.
 * A name that sits inside a continuation already read for an earlier name (`a=x \` / `b=y`) is part of that value: its own
 * pieces are judged, and the whole logical line once more (as read at the first name), but the tail is not joined again, so the
 * reading stays linear however many names a continued value holds.
 * @returns {{values: string[], end: number, exhausted: boolean} | null}
 */
function continuedValue(ctx, input, matchIndex, valueStart) {
  const lineEnd = ctx.lineEnd(valueStart);
  const first = input.slice(valueStart, Math.min(lineEnd, valueStart + 4096)).replace(/\r$/, '');
  const pieces = [];
  let end = lineEnd;
  if (endsInBackslash(first)) {
    if (budgetSpent(ctx)) return exhaustedLiteral(ctx, input, valueStart);
    const chain = [];
    let at = lineEnd + 1;
    let closed = false;
    for (let n = 0; n < MULTILINE_MAX_LINES && at <= input.length; n += 1) {
      const line = continuationLine(ctx, input, at);
      chain.push(line);
      end = line.next;
      if (!line.more || line.next >= input.length) {
        closed = true;
        break;
      }
      at = line.next + 1;
    }
    if (!closed) return exhaustedLiteral(ctx, input, valueStart);
    if (!spendMultiline(ctx, end - valueStart)) return exhaustedLiteral(ctx, input, valueStart);
    const head = (ctx.continuedHeads ??= new Map()).get(ctx.lineStart(valueStart));
    const own = first.slice(0, -1);
    const trimmed = [own.trim(), ...chain.map((line) => line.trimmed)].filter((piece) => piece !== '');
    if (head !== undefined) return { values: [head.joined, ...trimmed], end, exhausted: false };
    const joined = [own, ...chain.map((line) => line.piece)].join('');
    for (let i = 0, line = lineEnd + 1; i < chain.length; line = chain[i].next + 1, i += 1) ctx.continuedHeads.set(line, { joined });
    return { values: [joined, ...trimmed], end, exhausted: false };
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
const ASSIGN_TYPE_COLON = String.raw`:[ \t]*(?:&(?:'[A-Za-z_]{1,16}[ \t]{1,4}|mut[ \t]{1,4})?|\*(?:const[ \t]{1,4}|mut[ \t]{1,4})?|\[\d{0,4}\](?:const[ \t]{1,4})?)?\[?[A-Za-z_][A-Za-z0-9_<>[\]|.?!&*]{0,40}(?!:\/\/)`;
const ASSIGN_TYPE_WORD = String.raw`[ \t]{1,4}(?:As[ \t]{1,4})?(?:\*|\[\d{0,4}\])?(?:string|String|str|byte|bytes|char|text|any|auto|dynamic|object|Object)(?![A-Za-z0-9_])`;
const ASSIGN_MARKER = String.raw`(?:\*|[?!](?=[ \t]*:)|\[[A-Za-z0-9_]{0,20}\]|[ \t]*<(?:const|close)>)`;
// Every assignment operator that carries a value: = := ::= ?= += -= .= *= **= |= &= ^= %= ||= &&= ??= => and the arrows <- <<- -> (R, Scala) and the
// infix `to` (Kotlin `"NAME" to "value"`). An arrow or `to` counts only in front of a quote, so `a->b`, `x<-1` and prose stay out.
const ASSIGN_OPERATOR = String.raw`(\|\|=|&&=|\?\?=|\*\*=|:{1,3}=|\?=|[-+.*|&^%]=|=>|<{1,2}-(?=[ \t]*(?:[rR](?=")|["'\x60]))|->(?=[ \t]*["'\x60])|(?<=["'\x60][ \t]{1,8})to(?=[ \t]{1,8}["'\x60])|=|:(?!:))`;
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

// ---------------------------------------------------------------------------
// Passwords inside semicolon-delimited connection strings
// ---------------------------------------------------------------------------

// ADO.NET, ODBC, OLE DB and SQL Server JDBC connection strings are `key=value;key=value` lists, not URLs, so url-password never sees
// them. In source code the generic assignment reader takes the `Password=<pw>;` inside `"Server=db;User Id=sa;Password=<pw>;"` for an
// unquoted code expression and skips it, so the same literal in C#, JavaScript, Python or Java went unreported. This rule reads the
// password field itself wherever such a list is a literal: a string literal in code, a JSON string (appsettings.json
// "ConnectionStrings"), an XML attribute (web.config <add connectionString="..."/>) or element text, a .env / YAML / INI value, or a
// bare line of a document. The value is judged like a URL password (urlPasswordIsSecret: anything that is not a placeholder or a
// reference, with no length or entropy test), because a connection string carries the password whole, as a URL does. Azure
// `AccountKey=` / `SharedAccessKey=` fields are azure-storage-key's business (it knows their base64 shape).
//
// A field is a password key that opens a field: after `;`, a quote, `=` (a .env value that starts with it), `>`, at the start of a line, or
// after blanks that follow `:`, a comment marker or (in prose) anything (see CONN_BLANK_OPENER).
// The keys are case-insensitive and may have blanks around `=`, as the drivers parse them: Password, Pwd, Pass, Passwd, a qualified
// SSL / TLS / proxy / certificate / key-store password, and OLE DB's `Jet OLEDB:Database Password`.
// A field may also open after a blank (`conn: Password=...`, a `// Password=...` comment, prose) or `>` (XML element text): the
// literal must still hold a connection-string key (CONN_STRING_CONTEXT), so a lone `pass=x` is not read. Npgsql's PSW and the SQL
// Server JDBC key-store keys (keyStoreSecret, clientKeyPassword) are password keys too.
// What may stand before the blanks in front of a field that opens after a blank (see the matcher).
const CONN_BLANK_OPENER = /(?:[;"'\x60=>:]|\/\/|#|--|\/\*|^\*|<!--|^REM)$/i;
const CONN_PASSWORD_FIELD =
  /(?<=[;"'\x60=> \t]|^)[ \t]{0,64}(?:jet[ \t]{1,8}oledb:(?:new[ \t]{1,8})?database[ \t]{1,8}password|key[ \t]?store[ \t]?secret|client[ \t]?key[ \t]?password|(?:(?:ssl|tls|proxy|certificate|cert|keystore|truststore)[ \t_]?)?password|passwd|pwd|psw|pass)[ \t]{0,64}=(?!=)[ \t]{0,64}/gim;
// The other keys of a connection string. A password field counts only in a literal that also holds one of them (or a jdbc: URL), so
// a lone `pass=x` in a query string, a list of test results or prose is not read as a connection string.
const CONN_STRING_KEY = String.raw`(?:server|data[ \t]?source|host(?:[ \t]?name)?|address|addr|network[ \t]?address|database(?:[ \t]?name)?|initial[ \t]?catalog|user[ \t]?id|uid|user(?:[ \t]?name)?|driver|provider|dsn|dbq|port|integrated[ \t]?security|trusted[_ \t]?connection|encrypt|trust[ \t]?server[ \t]?certificate|persist[ \t]?security[ \t]?info|ssl[ \t]?mode|service[ \t]?name|application[ \t]?name|(?:connect(?:ion)?[ \t]?)?timeout|pooling|multiple[ \t]?active[ \t]?result[ \t]?sets)`;
const CONN_STRING_CONTEXT = new RegExp(String.raw`(?:^|[;"'\x60=])[ \t]{0,64}${CONN_STRING_KEY}[ \t]{0,64}=|\bjdbc:[a-z0-9]{1,32}:`, 'i');
// What may sit between two pieces of a connection string concatenated in code: blanks, line breaks and a concatenation operator
// (`+`, `&`, `.`, `..`, `||`, Visual Basic's `& _`); nothing at all between adjacent literals (C, Python).
const CONN_GLUE = new Set([' ', '\t', '\r', '\n', '+', '&', '.', '|', '_']);
// Code and shell scripts read a bare (unquoted) field only after a comment marker: a connection string pasted into a comment is
// text, while `;user=<u>;pass=<p>` outside a string is code (minified JavaScript assigns variables that way; in shell, `;` ends a
// command, and a literal assigned there is secret-assignment's business).
const CONN_COMMENT = /(?:^|[ \t;])(?:\/\/|\/\*|#|--|<!--)|^[ \t]*(?:\*|REM[ \t])/i;
// C# $"..." / $@"..." / @$"...", Python f"..." / rf"..." / fr"...: the {...} inside are code, not text.
const CONN_INTERPOLATED_PREFIX = /(?:^|[^A-Za-z0-9_])(?:\$@?|@\$|[fF][rR]?|[rR][fF])$/;
// Filled in at run time: a printf / String.Format / MessageFormat slot or a `?` bind marker (`Password=%s`, `Pwd={0}`). printf slots
// may be positional (%1$s), take a length modifier (%ls, %hs, %lld, %zu, %I64d) and a `*` width or precision (%.*s, %-*s); Ruby
// names them (%{pw}, %<pw>s); Python's {0!s} / {0!r:>8} and .NET's {0,-8:X} are positional slots.
const CONN_PARAMETER =
  /^(?:\?|%(?:\d{1,2}\$)?[-+ #0-9.*]{0,8}(?:hh|h|ll|l|z|j|t|L|q|I64|I32|I)?[sdiuxXofFeEgGcCvqrSp@]|%\{[A-Za-z_][A-Za-z0-9_]{0,63}\}|%<[A-Za-z_][A-Za-z0-9_]{0,63}>[sdifgx]|\{\d{0,3}(?:![rsa])?(?:[,:][^{}]{0,32})?\})$/;
// A {name} slot is a template when something fills it: a format call (Python str.format, Rust format!, .NET String.Format), a
// .Replace("{pw}", ...) on the literal, a structured-logging call (Serilog / Microsoft.Extensions.Logging message templates name
// their holes {Name} or {@Name}), or a value named as a template.
const CONN_FORMAT_CALL =
  /\bformat(?:_map)?\b|\.[Rr]eplace(?:All)?\(|\b(?:[Ll]og|_?[Ll]ogger|[A-Za-z_]{0,20}[Ll]ogger)\s{0,4}\.\s{0,4}(?:Verbose|Debug|Information|Info|Warning|Warn|Error|Fatal|Critical|Trace|Log[A-Za-z]{0,20})\s{0,4}\(|template/;
// A reference that some tool replaces before the value is used: Jinja / Helm / Mustache / cookiecutter {{ ... }}, Jinja {% ... %}, ERB /
// EJS <%= ... %>, cmd delayed expansion !NAME!, tokenizer @@NAME@@ / __NAME__ / #{NAME}#, MSBuild $(NAME).
const CONN_REFERENCE = /^(?:\{\{[^{}]{1,256}\}\}|\{%[^%]{1,256}%\}|<%=?[^%]{1,256}%>|![A-Za-z_][A-Za-z0-9_.]{0,63}!|@@[A-Za-z_][A-Za-z0-9_.]{0,63}@@|__[A-Za-z][A-Za-z0-9_]{0,63}__|#\{[A-Za-z_][A-Za-z0-9_.]{0,63}\}#?|\$\([A-Za-z_][A-Za-z0-9_.]{0,63}\))$/;
// How far a value is read. A longer one is judged on what was read (fail closed); the bound keeps each field's cost constant, so a
// hostile line of `;pwd=` fields stays linear.
const CONN_VALUE_LIMIT = 256;
// The `;` that ends an XML character reference (`&lt;`, `&#59;`) is part of the value, not the end of the field.
const XML_ENTITY_BEFORE = /&(?:lt|gt|amp|quot|apos|#[0-9]{1,6}|#x[0-9a-f]{1,5})$/i;
const XML_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decodeXmlEntities = (text) =>
  text.replace(/&(lt|gt|amp|quot|apos|#[0-9]{1,6}|#x[0-9a-f]{1,5});/gi, (whole, name) => {
    const lower = name.toLowerCase();
    if (lower in XML_ENTITIES) return XML_ENTITIES[lower];
    const code = lower[1] === 'x' ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });

/**
 * The literal that holds the password key at `keyAt`: { quote, openAt, start, close, interpolated, bareOk, context }. The line is read
 * from its start with a simple quote state (", ' or `; inside one, a backslash escapes the next character). `quote` is null for a
 * field outside every quote: the bare line is then the literal, and `bareOk` says whether a bare field is read there at all.
 * start..close is the literal's text; close is its closing quote or the end of the line. The quote state, the line's bare literal and
 * the current quoted literal are kept on ctx between the matches of one scan (matchAll visits them in order), so each line is read
 * once and each literal measured once however many fields it holds.
 */
// Source files whose literals run over lines with no quote on the inner lines: Java / C# / Kotlin / Python / Scala / Swift triple
// quotes (text blocks, raw literals) and Go / JavaScript / TypeScript backtick literals.
const CONN_TRIPLE_SOURCE = /\.(?:java|cs|kt|kts|py|pyw|scala|swift|groovy|dart)$/i;
const CONN_BACKTICK_SOURCE = /\.(?:go|js|mjs|cjs|jsx|ts|mts|cts|tsx)$/i;

/**
 * Is the line that starts at `lineStart` inside a literal that runs over lines (triple quotes or a backtick literal opened on an
 * earlier line)? A forward scan kept on ctx and advanced only (the matches of one scan come in order), so the whole file is read once.
 * It toggles on triple quotes and on unescaped backticks; ordinary quotes are not tracked, so a backtick inside "..." can mislead it, and the
 * only effect is which bare lines are read (each still needs a password field and a connection-string key).
 */
function connInsideMultiline(input, lineStart, ctx) {
  const triple = CONN_TRIPLE_SOURCE.test(ctx.path);
  const tick = CONN_BACKTICK_SOURCE.test(ctx.path);
  if (!triple && !tick) return false;
  let state = ctx.connMulti;
  if (state === undefined || state.at > lineStart) state = ctx.connMulti = { at: 0, inTriple: false, inTick: false };
  let { at, inTriple, inTick } = state;
  for (; at < lineStart; at += 1) {
    const ch = input[at];
    if (inTick) {
      if (ch === '\\') at += 1;
      else if (ch === '`') inTick = false;
    } else if (inTriple) {
      if (ch === '"' && input[at + 1] === '"' && input[at + 2] === '"') {
        inTriple = false;
        at += 2;
      }
    } else if (tick && ch === '`') inTick = true;
    else if (triple && ch === '"' && input[at + 1] === '"' && input[at + 2] === '"') {
      inTriple = true;
      at += 2;
    }
  }
  Object.assign(state, { at, inTriple, inTick });
  return inTriple || inTick;
}

function connLiteralAt(input, keyAt, ctx) {
  const lineStart = ctx.lineStart(keyAt);
  let state = ctx.connState;
  if (state === undefined || state.lineStart !== lineStart || state.at > keyAt) {
    state = { lineStart, at: lineStart, quote: null, openAt: -1, bare: null, quoted: null };
  }
  let { at, quote, openAt } = state;
  for (; at < keyAt; at += 1) {
    const ch = input[at];
    if (quote !== null) {
      if (ch === '\\') at += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === '\x60') {
      quote = ch;
      openAt = at;
    }
  }
  Object.assign(state, { at, quote, openAt });
  ctx.connState = state;
  const lineEnd = ctx.lineEnd(keyAt);
  if (quote === null) {
    if (state.bare === null) {
      // A line of a document, or an unquoted value of a dotenv / YAML / INI / properties / XML file, is a literal as it stands.
      // Code (and shell, where `;` separates commands) is read bare only in a comment.
      const asIs = ctx.mode === 'prose' || ctx.runsToEndOfLine || ctx.xml;
      const commentAt = asIs ? -1 : input.slice(lineStart, Math.min(lineEnd, lineStart + 4096)).search(CONN_COMMENT);
      state.bare = { quote: null, openAt: -1, start: lineStart, close: lineEnd, interpolated: false, asIs, commentAt, context: undefined };
    }
    const bare = state.bare;
    bare.bareOk = bare.asIs || (bare.commentAt !== -1 && lineStart + bare.commentAt < keyAt);
    // A line inside a text block, a C# / Kotlin raw literal or a Go / JavaScript backtick literal is the literal's own text.
    if (!bare.bareOk && ctx.mode === 'code') {
      bare.inLiteral ??= connInsideMultiline(input, lineStart, ctx);
      bare.bareOk = bare.inLiteral;
    }
    return bare;
  }
  if (state.quoted === null || state.quoted.openAt !== openAt) {
    let close = lineEnd;
    for (let i = keyAt; i < lineEnd; i += 1) {
      if (input[i] === '\\') i += 1;
      else if (input[i] === quote) {
        close = i;
        break;
      }
    }
    const interpolated = CONN_INTERPOLATED_PREFIX.test(input.slice(Math.max(lineStart, openAt - 4), openAt));
    state.quoted = { quote, openAt, start: openAt + 1, close, interpolated, bareOk: true, context: undefined };
  }
  return state.quoted;
}

// How many literals before this one a concatenation (or a Join call) is followed back, and how far each may be.
const CONN_CHAIN_PIECES = 8;
const CONN_PIECE_CHARS = 256;
// A Join call around the literals: C# string.Join(";", ...), Python ";".join([...]), JavaScript [...].join(";"). Its pieces are
// separated by commas and the call puts the `;` between them.
const CONN_JOIN_BEFORE = /\b[Jj]oin\s{0,8}\(\s{0,8}(?:\[|$)|\b[Jj]oin\s{0,8}\(\s{0,8}["'][;,]["']\s{0,8},/;
const CONN_JOIN_AFTER = /^[^\n]{0,400}?[\])]\s{0,8}\.\s{0,8}[Jj]oin\s{0,8}\(\s{0,8}["'];["']/;

/**
 * The quoted pieces that come before the literal opened at `openAt`, nearest first (at most CONN_CHAIN_PIECES): each glued to the next
 * by CONN_GLUE (or, in a Join call, by a comma). Each piece is read back to its opening quote within CONN_PIECE_CHARS on one line.
 */
function connPiecesBefore(input, openAt, joined) {
  const pieces = [];
  let i = openAt - 1;
  for (let n = 0; n < CONN_CHAIN_PIECES; n += 1) {
    const stop = Math.max(0, i - 64);
    while (i >= stop && (CONN_GLUE.has(input[i]) || (joined && (input[i] === ',' || input[i] === '[' || input[i] === '(')))) i -= 1;
    const quote = input[i];
    if (i < stop || (quote !== '"' && quote !== "'" && quote !== '\x60')) break;
    let j = i - 1;
    const back = Math.max(0, i - CONN_PIECE_CHARS);
    while (j >= back && input[j] !== quote && input[j] !== '\n') j -= 1;
    if (j < back || input[j] !== quote) break;
    pieces.push(input.slice(j + 1, i));
    i = j - 1;
  }
  return pieces;
}

/**
 * Does the literal continue a connection string from the pieces before it? "Server=db;User Id=sa;" + "App=x;" + "Password=<pw>;" in
 * code (any of the CONN_GLUE operators, or adjacent literals; up to CONN_CHAIN_PIECES pieces back), `"...User Id=sa" + ";Password=..."`
 * (the `;` opens the password literal), the elements of a Join call, or a YAML folded / multi-line scalar line after a line that ends
 * in a field. Some piece must hold a connection-string key, and the password field must start a field of the joined text.
 */
function connContinues(input, literal, ctx, keyAt) {
  let end;
  if (literal.quote !== null) {
    const lineStart = ctx.lineStart(literal.openAt);
    const joined =
      CONN_JOIN_BEFORE.test(input.slice(Math.max(lineStart, literal.openAt - 400), literal.openAt)) ||
      CONN_JOIN_AFTER.test(input.slice(literal.openAt, literal.openAt + 600));
    const pieces = connPiecesBefore(input, literal.openAt, joined);
    if (pieces.length === 0) return false;
    const lead = input.slice(literal.start, keyAt);
    const text = joined ? pieces.reverse().join(';') : pieces.reverse().join('');
    const boundary = joined ? lead.trim() === '' : /;[ \t]*$/.test(text + lead);
    return boundary && CONN_STRING_CONTEXT.test(text.startsWith(';') ? text : `;${text}`);
  } else {
    if (literal.start === 0) return false;
    end = literal.start - 1; // the line break that ends the line before
    if (end > 0 && input[end - 1] === '\r') end -= 1;
  }
  const before = input.slice(Math.max(ctx.lineStart(end), end - 256), end);
  return /;[ \t]*$/.test(before) && CONN_STRING_CONTEXT.test(before);
}

/**
 * The value of the field whose `=` ends at `valueStart`, read as the drivers read it: a value in {braces} (ODBC; `}}` is a `}`) or in
 * the quote the literal does not use (ADO.NET `Password='a;b'`; a doubled quote is the quote) is read whole, `;` included; any other
 * value runs to the next `;`, the end of the literal or, in XML element text, the next `<`. A bare configuration line can end in a
 * ` #` comment. Returns { value, braced, end }.
 */
function connFieldValue(input, valueStart, literal, xmlText) {
  const limit = Math.min(literal.close, valueStart + CONN_VALUE_LIMIT);
  const first = input[valueStart];
  // The end of what any value form may read: the line, and CONN_VALUE_LIMIT characters (searched within that bound only, so a long
  // line of fields costs a constant per field).
  const window = input.slice(valueStart, valueStart + CONN_VALUE_LIMIT);
  const lineBreak = window.indexOf('\n');
  const lineLimit = valueStart + (lineBreak === -1 ? window.length : lineBreak);
  // A value quoted with the literal's OWN quote doubled: Visual Basic and C# verbatim "...Password=""p;w"";", PowerShell and SQL
  // '...Password=''p;w'';'. The literal's scan ended at the first of those quotes; the value runs to the next doubled quote.
  if (literal.quote !== null && first === literal.quote && input[valueStart + 1] === literal.quote) {
    const pair = literal.quote + literal.quote;
    const close = input.indexOf(pair, valueStart + 2);
    if (close !== -1 && close < lineLimit) return { value: input.slice(valueStart + 2, close), braced: false, end: close + 2 };
  }
  // A template reference ({{ .Values.db.pw }}, {{password}}) is not an ODBC braced value.
  if (first === '{' && input[valueStart + 1] === '{' && !literal.interpolated) {
    const close = input.indexOf('}}', valueStart + 2);
    if (close !== -1 && close < Math.max(limit, lineLimit)) return { value: input.slice(valueStart, close + 2), braced: false, end: close + 2 };
  }
  // The other quote closing a code piece, not opening a value: ARM `concat('...;Password=', parameters('pw'), ...)`, `"Password='" + pw`.
  if ((first === '"' || first === "'") && first !== literal.quote && /^[ \t]*(?:[,+&)]|$)/.test(input.slice(valueStart + 1, Math.min(literal.close, valueStart + 16)))) {
    return { value: '', braced: false, end: valueStart, code: true };
  }
  // The value in a literal of its own: "...Password=" + "<pw>" + ";", Python ("...PWD=" "<pw>").
  if (literal.quote !== null && valueStart === literal.close) {
    let i = valueStart + 1;
    const stop = Math.min(input.length, i + 64);
    while (i < stop && CONN_GLUE.has(input[i])) i += 1;
    const quote = input[i];
    if (quote === '"' || quote === "'" || quote === '\x60') {
      let j = i + 1;
      const end = Math.min(input.length, j + CONN_VALUE_LIMIT);
      for (; j < end && input[j] !== quote && input[j] !== '\n'; j += 1) if (input[j] === '\\') j += 1;
      if (input[j] === quote) return { value: input.slice(i + 1, j).split(';')[0].trim(), braced: false, end: j + 1 };
    }
  }
  if (first === '{' && !literal.interpolated) {
    let i = valueStart + 1;
    for (; i < limit; i += 1) {
      if (input[i] === '}') {
        if (input[i + 1] === '}') i += 1;
        else break;
      }
    }
    return { value: input.slice(valueStart + 1, Math.min(i, limit)).replace(/\}\}/g, '}'), braced: true, end: Math.min(i + 1, literal.close) };
  }
  if ((first === '"' || first === "'") && first !== literal.quote) {
    for (let i = valueStart + 1; i < limit; i += 1) {
      if (input[i] !== first) continue;
      if (input[i + 1] === first) i += 1;
      else return { value: input.slice(valueStart + 1, i).split(first + first).join(first), braced: false, end: i + 1 };
    }
  }
  let i = valueStart;
  for (; i < limit; i += 1) {
    const ch = input[i];
    if (ch === ';' && !XML_ENTITY_BEFORE.test(input.slice(Math.max(valueStart, i - 8), i))) break;
    if (ch === '<' && xmlText) break;
  }
  let value = input.slice(valueStart, i);
  if (literal.quote === null) value = value.replace(/[ \t]+#.*$/, '');
  return { value: value.trim(), braced: false, end: i };
}

/** Is a connection-string password a literal credential? Interpolation and format slots are code; the rest is a URL password. */
function connPasswordIsSecret(field, literal, around) {
  if (field.code === true) return false;
  let text = field.value.includes('&') ? decodeXmlEntities(field.value) : field.value;
  if (!literal.interpolated && CONN_REFERENCE.test(text.trim())) return false; // in C# $"..." / Python f"...", {{ is a literal brace
  // Interpolation that is code in any string: PHP `{$pw}`, Swift `\(pw)`; in an interpolated literal, every {...}. Literal text left
  // next to it is still judged, as `${NAME}suffix` is in a URL. In an interpolated literal `{{` and `}}` are literal braces (C# $"...",
  // Python f"..."): `PWD={{<pw>}}` is the ODBC braced value <pw>, so they are kept aside while the holes are removed.
  text = text.replace(/\{\$[^{}\n]{0,256}\}|\\\([^()\n]{0,256}\)/g, '');
  let braced = field.braced;
  if (literal.interpolated) {
    text = text.replace(/\{\{/g, '\u0001').replace(/\}\}/g, '\u0002').replace(/\{[^{}\n]{0,256}\}/g, '').replace(/\u0001/g, '{').replace(/\u0002/g, '}');
    const odbc = /^\{([^{}]*)\}$/.exec(text.trim());
    if (odbc !== null) {
      text = odbc[1];
      braced = true;
    }
  }
  text = text.trim();
  if (text === '' || CONN_PARAMETER.test(braced ? `{${text}}` : text)) return false;
  if (braced && /^@?[A-Za-z_][A-Za-z0-9_.]{0,63}(?:![rsa])?(?::[^{}]{0,32})?$/.test(text) && CONN_FORMAT_CALL.test(around)) return false;
  return urlPasswordIsSecret(text);
}

const CONNECTION_STRING_RULE = {
  id: 'connection-string-password',
  description:
    'Password / Pwd / Pass field set to a literal inside a semicolon-delimited connection string (ADO.NET, ODBC, OLE DB, SQL Server JDBC), in source code or config',
  hint: /pass|pwd|psw|secret/i,
  matchers: [
    {
      pattern: CONN_PASSWORD_FIELD,
      accept: (m, ctx) => {
        const input = m.input;
        const keyAt = m.index + m[0].search(/\S/);
        // A field after a blank opens one only after `:` (YAML / properties `conn: Password=...`), `>`, a comment marker, or in prose:
        // `user=mail password=x` is a space-separated list (dovecot, libpq), not a connection string.
        if (ctx.mode !== 'prose' && /[ \t]$/.test(input.slice(Math.max(0, keyAt - 1), keyAt))) {
          const before = input.slice(Math.max(ctx.lineStart(keyAt), keyAt - 80), keyAt).trimEnd();
          if (before !== '' && !CONN_BLANK_OPENER.test(before)) return false;
        }
        const literal = connLiteralAt(input, keyAt, ctx);
        if (!literal.bareOk) return false;
        literal.context ??= CONN_STRING_CONTEXT.test(input.slice(literal.start, literal.close)) || connContinues(input, literal, ctx, keyAt);
        if (!literal.context) return false;
        const valueStart = m.index + m[0].length;
        const field = connFieldValue(input, valueStart, literal, literal.quote === null && ctx.xml);
        m.spanEnd = Math.max(field.end, valueStart);
        // The line around the match, plus what follows the literal (a `.format(` chained on the next line).
        return connPasswordIsSecret(field, literal, nearbyLineText(m) + input.slice(literal.close, literal.close + 80));
      },
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
    hint: /AccountKey|SharedAccessKey|PrimaryKey|SecondaryKey|sig=|AccessKey|Secret/i,
    matchers: [
      {
        // Azure SignalR / Web PubSub `Endpoint=...;AccessKey=<base64>` and App Configuration `Endpoint=...;Id=...;Secret=<base64>`
        // (the generic names count only after an Endpoint= field of the same connection string).
        pattern: /;[ \t]*(?:AccessKey|Secret)[ \t]*=[ \t]*([A-Za-z0-9+/]{40,}={0,2})(?![A-Za-z0-9+/=])/gi,
        accept: (m) => /Endpoint[ \t]*=[ \t]*https?:\/\//i.test(m.input.slice(Math.max(0, m.index - 300), m.index)) && !placeholderOf(m[1]) && /\d/.test(m[1]) && mixedCase(m[1]),
      },
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
    'Other provider token or prefixed private key (Databricks, Grafana, Supabase, PlanetScale, Docker Hub, RubyGems, Terraform Cloud, ' +
      'Postman PMAK-, age secret key, BIP32 extended private key xprv / tprv / yprv / zprv, Nostr nsec1)',
    /dapi|glsa_|sbp_|pscale_|dckr_pat_|rubygems_|atlasv1|AGE-SECRET-KEY|PMAK-|prv|nsec1/,
    [
      /(?<![A-Za-z0-9_])dapi[a-f0-9]{32}(?:-\d)?(?![A-Za-z0-9_])/g,
      /(?<![A-Za-z0-9_])glsa_[A-Za-z0-9]{32}_[a-f0-9]{8}(?![A-Za-z0-9_])/g,
      /(?<![A-Za-z0-9_])sbp_[a-f0-9]{40}(?![A-Za-z0-9_])/g,
      /(?<![A-Za-z0-9_])pscale_(?:tkn|pw|oauth)_[A-Za-z0-9_.-]{32,}/g,
      /(?<![A-Za-z0-9_])dckr_pat_[A-Za-z0-9_-]{27,}/g,
      /(?<![A-Za-z0-9_])rubygems_[a-f0-9]{48}(?![A-Za-z0-9_])/g,
      /(?<![A-Za-z0-9])[A-Za-z0-9]{14}\.atlasv1\.[A-Za-z0-9_-]{60,}/g,
      /(?<![A-Za-z0-9-])AGE-SECRET-KEY-1[QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L]{58}(?![A-Za-z0-9])/g,
      /(?<![A-Za-z0-9_-])PMAK-[a-f0-9]{24}-[a-f0-9]{34}(?![A-Za-z0-9_-])/g,
      // Base58Check of a 78-byte BIP32 extended PRIVATE key (the public form says pub: xpub, tpub, ...).
      /(?<![A-Za-z0-9])[xtyzuvYZUV]prv[1-9A-HJ-NP-Za-km-z]{107,108}(?![A-Za-z0-9])/g,
      /(?<![A-Za-z0-9])nsec1[02-9ac-hj-np-z]{58}(?![A-Za-z0-9])/g,
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
    // <header name="Authorization">Bearer T</header>, <Authorization>Bearer T</Authorization>: the text is a scheme and a credential.
    if (kind === null && (isAuthorizationName(name) || (attribute !== null && isAuthorizationName((attribute[1] ?? attribute[2]).trim())))) {
      return authorizationValueIsSecret(text);
    }
  }
  if (kind === null) return false;
  const value = text.trim();
  if (value === '') return false;
  // A Maven-encrypted password ({base64}) is not a plaintext credential: it is unreadable without the master key.
  if (/^\{[A-Za-z0-9+/=]{20,}\}$/.test(value)) return false;
  // A file-system path (/path/to/private/key, ./certs/key.pem, ~/.ssh/id_rsa): a key FILE element holds this, not a key. The same
  // test as every configuration value (isFileSystemPath), so a path with a random-looking piece is judged as a value here too.
  if (isFileSystemPath(value) || XML_EXAMPLE_VALUES.has(value.toLowerCase())) return false;
  // Text about the credential ("the password you chose during setup.") is exempt through the same documentation-cue rule
  // as every other format; punctuation alone never is, or a passphrase ending in "!" would slip through.
  return isSecretValue({ kind, value, quoted: true, separator: ':', mode: ctx.mode, minLength: ctx.minStrong, catalog: ctx.catalog });
}

/** A multi-line value that is an ansible-vault ciphertext ($ANSIBLE_VAULT;1.1;AES256 and its hex lines): encrypted, so not a credential. */
const isVaultBody = (values) => values.length > 0 && /^\$ANSIBLE_VAULT[;\s]/.test(values[0]);

// Calls that mark or convert a value without hiding it: the literal they are given is still in the file. Terraform sensitive() /
// nonsensitive() / tostring() / trimspace() / chomp(), Pulumi pulumi.secret() / Output.secret(), CDK SecretValue.unsafePlainText() /
// plainText(), Pydantic / Starlette SecretStr() / SecretBytes() / Secret(). One call name per alternative, then `(`.
const LITERAL_WRAPPER_CALL =
  /(?:(?:pulumi\.(?:Output\.)?|Output\.)secret|(?:cdk\.)?SecretValue\.(?:unsafePlainText|plainText)|nonsensitive|sensitive|tostring|trimspace|chomp|(?:pydantic\.)?Secret(?:Str|Bytes)?)\([ \t]{0,64}/y;
const LITERAL_WRAPPER_DEPTH = 4;

// systemd settings whose value is a list of assignments, a credential, a file or only names. A `NAME=` inside one of them is not an
// assignment of its own: Environment= and SetCredential= are judged by SYSTEMD_SETTING_MATCHER, the rest hold no literal.
const SYSTEMD_SETTING_KEY =
  /[ \t]{0,64}(?:Environment|EnvironmentFile|PassEnvironment|UnsetEnvironment|SetCredential|SetCredentialEncrypted|LoadCredential|LoadCredentialEncrypted|ImportCredential)[ \t]{0,64}=/y;
/** Is the match `m` inside the value of one of those settings, in a systemd unit? */
function isSystemdSettingLine(m, ctx) {
  if (!isSystemdUnitPath(ctx.path)) return false;
  SYSTEMD_SETTING_KEY.lastIndex = ctx.lineStart(m.index);
  return SYSTEMD_SETTING_KEY.exec(m.input) !== null && SYSTEMD_SETTING_KEY.lastIndex <= m.index;
}

/**
 * Where the literal inside wrapper calls that start at `start` begins (`sensitive(trimspace("v"))` -> the quote of "v"), or `start`
 * itself when there is no wrapper or its argument is not a quoted literal (`sensitive(var.x)` stays an expression). At most
 * LITERAL_WRAPPER_DEPTH calls, each matched once: linear.
 */
function unwrapLiteralCall(input, start) {
  let at = start;
  for (let n = 0; n < LITERAL_WRAPPER_DEPTH; n += 1) {
    LITERAL_WRAPPER_CALL.lastIndex = at;
    const call = LITERAL_WRAPPER_CALL.exec(input);
    if (call === null) break;
    at += call[0].length;
  }
  return at !== start && /["'\x60]/.test(input[at] ?? '') ? at : start;
}

// In source code, a formatter (rustfmt, prettier, ktlint) puts a long value on the line after the operator: `const JWT_SECRET: &str =`
// and then the literal, indented. The same assignment with one line break (and indentation) between the operator and the value; the
// value is read exactly as SECRET_ASSIGNMENT_MATCHER reads it (in code only a quoted literal can be a finding).
const ASSIGNMENT_VALUE_LOOKAHEAD = String.raw`[ \t]*(?=\S)`;
if (!ASSIGNMENT_PATTERN.source.endsWith(ASSIGNMENT_VALUE_LOOKAHEAD)) throw new Error('ASSIGNMENT_PATTERN must end in its value look-ahead');
const WRAPPED_ASSIGNMENT_PATTERN = new RegExp(
  ASSIGNMENT_PATTERN.source.slice(0, -ASSIGNMENT_VALUE_LOOKAHEAD.length) + String.raw`[ \t]*\r?\n[ \t]*(?=\S)`,
  'g',
);

const SECRET_ASSIGNMENT_MATCHER = {
  // group 2 = name, 3 = separator. The VALUE is deliberately not part of the match: it is read in accept()
  // (VALUE_AT) and only for a secret-like name. A rejected match therefore consumes nothing but `name =`, and
  // matching resumes right after it, so `cfg['a']={"K":"v"}`, `x=1;K='v'` and minified JSON are still examined.
  // Not a name: "${NAME:-x}" (an expansion, judged by its outer assignment) or "://NAME:x@" (a URL, judged by url-password).
  pattern: ASSIGNMENT_PATTERN,
  accept: (m, ctx) => {
    const kind = nameKindFor(m[2], ctx);
    if (!kind) return false;
    if (isSystemdSettingLine(m, ctx)) return false; // Environment= / SetCredential= are SYSTEMD_SETTING_MATCHER's; the others name files
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
    valueStart = unwrapLiteralCall(input, valueStart); // sensitive("v"), pulumi.secret("v"), SecretStr("v"): the literal is the value
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
    // A literal that does not start with a plain quote: Rust r#"..."#, C# @"...", C++ R"(...)", Swift #"..."#, Python r'...', Lua [[...]],
    // Perl q(...), Ruby %q(...), OCaml {|...|}. A literal over several lines is judged like a heredoc, and one that does not end within
    // the bounds is reported (callLiteralTexts).
    if (ctx.mode === 'code' && (!'"\'`'.includes(input[valueStart] ?? '') || (input[valueStart] === '"' && /\.rs$/i.test(ctx.path)))) {
      const literal = callStringLiteral(input, valueStart, ctx.path, ctx);
      if (literal !== null) {
        m.spanEnd = literal.end;
        const read = callLiteralTexts(m, ctx, literal, valueStart);
        if (read.verdict !== undefined) return read.verdict;
        if (literal.interpolated && /[{}$]/.test(literal.text)) return false; // built from other values
        return read.texts.some((text) =>
          isSecretValue({ kind, value: text, quoted: true, separator: m[3], mode: ctx.mode, minLength: ctx.minStrong, catalog: ctx.catalog }),
        );
      }
    }
    // Outside source code a Python string prefix (r"..", b'..', rb"..", f"..", u"..") in a snippet or a fenced block is not the value:
    // the quoted body after it is (otherwise the bare word `r"big` would be judged instead of the whole passphrase).
    const prefixLength = ctx.mode === 'code' ? 0 : stringPrefixLength(input, valueStart);
    if (prefixLength > 0) {
      const prefix = input.slice(valueStart, valueStart + prefixLength);
      const formatted = /[fF]/.test(prefix);
      valueStart += prefixLength;
      const prefixed = multilineValue(ctx, input, valueStart);
      if (prefixed !== null) {
        m.spanEnd = prefixed.end;
        if (prefixed.exhausted) return exhaustedVerdict(m, ctx, prefixed);
        return prefixed.values.some(
          (text) =>
            !(formatted && /[{}]/.test(text)) &&
            isSecretValue({ kind, value: text, quoted: true, separator: m[3], mode: ctx.mode, minLength: ctx.minStrong, catalog: ctx.catalog }),
        );
      }
      VALUE_AT.lastIndex = valueStart;
      const body = VALUE_AT.exec(input);
      const text = body?.[1] ?? body?.[2];
      if (text !== undefined) {
        m.spanEnd = valueStart + body[0].length;
        if (formatted && /[{}]/.test(text)) return false; // an f-string is built from other values
        const literal = /[rR]/.test(prefix) ? text : unescapeQuoted(text);
        return isSecretValue({ kind, value: literal, quoted: true, separator: m[3], mode: ctx.mode, minLength: ctx.minStrong, catalog: ctx.catalog });
      }
      valueStart -= prefixLength; // not a closed string on this line: read the word as it stands
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
    if (quoted) {
      // A backslash is no escape in a single-quoted YAML or TOML string ('C:\keys\server.pfx'), so the path is judged as written too:
      // unescaped it would read "C:keysserver.pfx", which is not a path, and the strong-name gate would report it. A double-quoted
      // (or backtick) value is judged as written only when it holds no escape sequence but a doubled backslash or `\/`: a JSON, YAML
      // or TOML `"\u00dcn\u00efcode-pass"` or `"\tCorrectHorse\tBattery"` is a password with escapes, not a path from the drive root.
      if (ctx.mode !== 'code' && (value[2] !== undefined || !hasStringEscape(quotedValue)) && isFileSystemPath(quotedValue)) return false;
      return check(unescapeQuoted(quotedValue), true);
    }
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
      for (const text of continued.values) if (judgeOnce(ctx, `${kind}|${m[3]}`, text, () => check(text, true))) return true;
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
const WRAPPED_ASSIGNMENT_MATCHER = {
  appliesTo: (ctx) => ctx.mode === 'code',
  pattern: WRAPPED_ASSIGNMENT_PATTERN,
  accept: (m, ctx) => SECRET_ASSIGNMENT_MATCHER.accept(m, ctx),
};

const DEFINITION_ASSIGNMENT_MATCHER = {
  appliesTo: (ctx) => ctx.mode === 'code',
  hint: /[@(:]/,
  pattern:
    /(?<![A-Za-z0-9_$.\/-])(@|\((?:def|defonce|defvar|defparameter|defconstant|defcustom|setq|setf|define)(?![A-Za-z0-9_-])[ \t]{1,8}(?:\^[^\s()]{1,30}[ \t]{1,8}){0,2}|:)([A-Za-z_][A-Za-z0-9_.-]{0,255})()[ \t]{1,64}(?=["'\x60~])/g,
  accept: (m, ctx) => SECRET_ASSIGNMENT_MATCHER.accept(m, ctx),
};

// Java properties: `key value` is a line too. The key ends at the first unescaped blank, `=` or `:`, and the value is the rest of the
// line (with `\` continuations); `key=value` and `key:value` are read by the assignment matchers above. The key is a run of
// characters that are not blanks, `=`, `:` or a backslash, or a backslash and the character it escapes, so each character has one reading.
// A `#` or `!` first character is a comment.
const PROPERTIES_BLANK_MATCHER = {
  appliesTo: (ctx) => ctx.properties,
  pattern: /^[ \t\f]{0,64}((?:[^\s=:#!\\]|\\[^\n]){1}(?:[^\s=:\\]|\\[^\n]){0,1023})[ \t\f]{1,64}(?=[^\s=:])/gm,
  accept: (m, ctx) => {
    const kind = nameKindFor(m[1].replace(/\\(.)/g, '$1'), ctx);
    if (!kind) return false;
    const input = m.input;
    const valueStart = m.index + m[0].length;
    const lineEnd = ctx.lineEnd(valueStart);
    const first = input.slice(valueStart, Math.min(lineEnd, valueStart + 4096)).replace(/\r$/, '');
    m.spanEnd = Math.min(lineEnd, valueStart + first.length);
    const check = (text, quoted) => isSecretValue({ kind, value: text, quoted, separator: ' ', mode: ctx.mode, minLength: ctx.minStrong, catalog: ctx.catalog });
    const continued = continuedValue(ctx, input, m.index, valueStart);
    if (continued !== null) {
      m.spanEnd = continued.end;
      if (continued.exhausted) return exhaustedVerdict(m, ctx, continued);
      return continued.values.some((text) => judgeOnce(ctx, `${kind}| `, text, () => check(text, true)));
    }
    const token = first.trimEnd();
    if (/\s/.test(token)) return check(token, true) || check(token.split(/\s/, 1)[0], false);
    return check(token, false);
  },
};

// ---------------------------------------------------------------------------
// Definitions with no `name = value` shape: systemd Environment= / SetCredential=, C #define, Makefile define ... endef,
// CMake set(), Gradle buildConfigField / resValue. Each reads its value with a small linear reader and judges it with isSecretValue.
// ---------------------------------------------------------------------------

/**
 * A literal string defined as a constant (#define, CMake set, Gradle field): text with blanks is judged like a configuration value
 * (a passphrase counts), a single word like a quoted literal in code (it must look random).
 */
// Text that names the credential it is about ("Invalid token", "Missing API key") is a message in source code, not a passphrase.
const MESSAGE_ABOUT_CREDENTIAL = /(?:^|[^A-Za-z])(?:password|passphrase|passwd|token|secret|key|credentials?|login|auth|api)(?![A-Za-z])/i;

function definitionValueIsSecret(kind, text, ctx) {
  const mode = /\s/.test(text.trim()) ? 'config' : 'code';
  if (mode === 'config' && MESSAGE_ABOUT_CREDENTIAL.test(text)) return false;
  return isSecretValue({ kind, value: text, quoted: true, separator: '=', mode, minLength: ctx.minStrong, catalog: ctx.catalog });
}

const SYSTEMD_MAX_LINES = 20;
const SYSTEMD_LINE_CHARS = 4096;
/** The value of a systemd setting that starts at `from`: the rest of the line, joined with the next ones while a line ends in `\`. */
function systemdSettingValue(input, from) {
  let text = '';
  let at = from;
  let end = from;
  for (let n = 0; n < SYSTEMD_MAX_LINES; n += 1) {
    let lineEnd = input.indexOf('\n', at);
    if (lineEnd === -1) lineEnd = input.length;
    end = Math.min(lineEnd, at + SYSTEMD_LINE_CHARS);
    const line = input.slice(at, end).replace(/\r$/, '');
    if (!line.endsWith('\\') || lineEnd === input.length) return { text: text + line, end };
    text += `${line.slice(0, -1)} `;
    at = lineEnd + 1;
  }
  return { text, end };
}

/** The words of a systemd value: blank-separated, "double" or 'single' quoted parts (with backslash escapes) joined into their word. One pass. */
function systemdWords(text) {
  const words = [];
  let word = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === ' ' || c === '\t') {
      if (word !== null) words.push(word);
      word = null;
      continue;
    }
    word ??= { text: '', quoted: false };
    if (c === '"' || c === "'") {
      word.quoted = true;
      for (i += 1; i < text.length && text[i] !== c; i += 1) {
        if (text[i] === '\\' && i + 1 < text.length) i += 1;
        word.text += text[i];
      }
    } else if (c === '\\' && i + 1 < text.length) {
      i += 1;
      word.text += text[i];
    } else {
      word.text += c;
    }
  }
  if (word !== null) words.push(word);
  return words;
}

// A systemd specifier (%d the credentials directory, %h the home directory, ...) or a $VARIABLE: a reference, not a literal.
const SYSTEMD_REFERENCE = /^(?:%[A-Za-z]|\$)/;
const systemdValueIsSecret = (kind, value, ctx) =>
  !SYSTEMD_REFERENCE.test(value) &&
  isSecretValue({ kind, value, quoted: true, separator: '=', mode: 'config', minLength: ctx.minStrong, catalog: ctx.catalog });

/** Does a systemd `Environment=` value (`A=1 "NAME=two words" 'B=x'`) set a secret-like name to a literal? */
function systemdEnvironmentIsSecret(text, ctx) {
  const words = systemdWords(text);
  for (let i = 0; i < words.length; i += 1) {
    const eq = words[i].text.indexOf('=');
    const name = eq > 0 ? words[i].text.slice(0, eq) : '';
    const kind = /^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(name) ? nameKindFor(name, ctx) : null;
    if (!kind) continue;
    let value = words[i].text.slice(eq + 1);
    // `Environment=NAME=correct horse battery` meant one value: unquoted words that are not assignments belong to it.
    for (let j = i + 1; !words[i].quoted && j < words.length && !words[j].quoted && !words[j].text.includes('='); j += 1) value += ` ${words[j].text}`;
    if (systemdValueIsSecret(kind, value, ctx)) return true;
  }
  return false;
}

// systemd / Quadlet units: `Environment=` (one or more NAME=value words) and `SetCredential=ID:value` hold literals.
// EnvironmentFile= and LoadCredential= name files, PassEnvironment= only names: none of them is matched.
const SYSTEMD_SETTING_MATCHER = {
  appliesTo: (ctx) => isSystemdUnitPath(ctx.path),
  pattern: /^[ \t]{0,64}(Environment|SetCredential)[ \t]{0,64}=[ \t]{0,64}/gm,
  accept: (m, ctx) => {
    const value = systemdSettingValue(m.input, m.index + m[0].length);
    m.spanEnd = Math.max(value.end, m.index + m[0].length);
    if (m[1] === 'Environment') return systemdEnvironmentIsSecret(value.text, ctx);
    const colon = value.text.indexOf(':');
    if (colon <= 0) return false;
    const kind = nameKindFor(value.text.slice(0, colon), ctx) ?? 'weak'; // a credential of any name: random-looking text counts
    return systemdValueIsSecret(kind, value.text.slice(colon + 1).trim(), ctx);
  },
};

/** The double-quoted literal at `at` (after an optional `(` and an L / u8 / u / U / @ prefix): its unescaped text and end, or null. */
function definitionLiteral(input, at) {
  let i = at;
  if (input[i] === '(') i += 1;
  while (i < input.length && i - at < 70 && (input[i] === ' ' || input[i] === '\t')) i += 1;
  const prefix = /^(?:u8|[LuU@])"/.exec(input.slice(i, i + 3));
  if (prefix !== null) i += prefix[0].length - 1;
  if (input[i] !== '"') return null;
  VALUE_AT.lastIndex = i;
  const value = VALUE_AT.exec(input);
  if (value === null || value[1] === undefined) return null;
  return { text: unescapeQuoted(value[1]), end: i + value[0].length };
}

// C / C++ / Objective-C: `#define NAME "literal"` (`#  define`, a `\` continuation before the value, L"..." / u8"..." / @"...").
// A function-like macro (`NAME(x)`) or a value that is an expression does not match.
const C_DEFINE_MATCHER = {
  appliesTo: (ctx) => ctx.mode !== 'prose',
  hint: /#[ \t]{0,64}define/,
  pattern: /^[ \t]{0,64}#[ \t]{0,64}define[ \t]{1,64}([A-Za-z_][A-Za-z0-9_]{0,255})(?:[ \t]|\\\r?\n){1,64}(?=\(?[ \t]{0,64}(?:u8|[LuU@])?")/gm,
  accept: (m, ctx) => {
    const kind = nameKindFor(m[1], ctx);
    if (!kind) return false;
    const literal = definitionLiteral(m.input, m.index + m[0].length);
    if (literal === null) return false;
    m.spanEnd = literal.end;
    return definitionValueIsSecret(kind, literal.text, ctx);
  },
};

const isMakefilePath = (filePath) => /(?:^|\/)(?:gnu)?makefile$|\.(?:mk|mak)$/i.test(filePath);
const MAKE_DEFINE_LINE = /^[ \t]{0,64}(?:override[ \t]{1,8})?(?:export[ \t]{1,8})?define[ \t]/;
const MAKE_DEFINE_BODY_LINES = 200;
const MAKE_DEFINE_BODY_CHARS = 32_768;

// Makefile `define NAME` ... `endef`: a one-line body is the value (a longer body is a recipe or a template). The body is read up to
// `endef` or the next `define` line, so the reads of two definitions never overlap.
const MAKE_DEFINE_MATCHER = {
  appliesTo: (ctx) => isMakefilePath(ctx.path),
  hint: /define/,
  pattern: /^[ \t]{0,64}(?:override[ \t]{1,8})?(?:export[ \t]{1,8})?define[ \t]{1,64}([A-Za-z_][A-Za-z0-9_.-]{0,255})[ \t]{0,64}(?:[:+?!]{0,2}=[ \t]{0,64})?\r?\n/gm,
  accept: (m, ctx) => {
    const kind = nameKindFor(m[1], ctx);
    if (!kind) return false;
    const input = m.input;
    const body = [];
    let at = m.index + m[0].length;
    for (let n = 0; n < MAKE_DEFINE_BODY_LINES && at < input.length && at - m.index < MAKE_DEFINE_BODY_CHARS; n += 1) {
      let lineEnd = input.indexOf('\n', at);
      if (lineEnd === -1) lineEnd = input.length;
      const line = input.slice(at, Math.min(lineEnd, at + SYSTEMD_LINE_CHARS)).replace(/\r$/, '');
      if (/^[ \t]{0,64}endef(?![A-Za-z0-9_.-])/.test(line)) {
        const lines = body.filter((text) => text.trim() !== '');
        // A recipe line (tab first) or one built from variables ($(...), ${...}, $@) is not a literal.
        if (lines.length !== 1 || lines[0].startsWith('\t') || lines[0].includes('$')) return false;
        m.spanEnd = lineEnd;
        return definitionValueIsSecret(kind, lines[0].trim(), ctx);
      }
      if (MAKE_DEFINE_LINE.test(line)) return false;
      body.push(line);
      at = lineEnd + 1;
    }
    return false;
  },
};

const isCmakePath = (filePath) => /(?:^|\/)cmakelists\.txt$|\.cmake$/i.test(filePath);
// CMake `set(NAME value)` and `set(ENV{NAME} value)`: the first argument after the name. A value built from ${...}, $ENV{...},
// $CACHE{...} or a generator expression $<...> is a reference.
const CMAKE_SET_MATCHER = {
  appliesTo: (ctx) => isCmakePath(ctx.path),
  hint: /set/i,
  pattern: /(?<![A-Za-z0-9_])set[ \t]{0,64}\([ \t\r\n]{0,64}(?:ENV\{([A-Za-z_][A-Za-z0-9_]{0,255})\}|([A-Za-z_][A-Za-z0-9_.-]{0,255}))[ \t\r\n]{1,64}/gi,
  accept: (m, ctx) => {
    const kind = nameKindFor(m[1] ?? m[2], ctx);
    if (!kind) return false;
    const input = m.input;
    const at = m.index + m[0].length;
    let text;
    if (input[at] === '"') {
      const literal = definitionLiteral(input, at);
      if (literal === null) return false;
      text = literal.text;
      m.spanEnd = literal.end;
    } else {
      const bare = /[^\s()"#]{1,4096}/y;
      bare.lastIndex = at;
      const word = bare.exec(input);
      if (word === null) return false;
      text = word[0];
      m.spanEnd = at + text.length;
    }
    return !text.includes('$') && definitionValueIsSecret(kind, text, ctx);
  },
};

// Gradle (Groovy or Kotlin DSL): buildConfigField "String", "NAME", "\"literal\"" puts a Java expression into BuildConfig (only a string
// literal is a value), resValue "string", "name", "literal" puts the text itself into the app's resources.
const GRADLE_FIELD_MATCHER = {
  appliesTo: (ctx) => /\.gradle(?:\.kts)?$/i.test(ctx.path),
  hint: /buildConfigField|resValue/,
  pattern:
    /(?<![A-Za-z0-9_$.])(buildConfigField|resValue)[ \t]{0,64}(?:\([ \t]{0,64})?["']([A-Za-z_.]{1,64})["'][ \t]{0,64},[ \t\r\n]{0,64}["']([A-Za-z_][A-Za-z0-9_.]{0,255})["'][ \t]{0,64},[ \t\r\n]{0,64}(?=")/g,
  accept: (m, ctx) => {
    const kind = nameKindFor(m[3], ctx);
    if (!kind || m[2].toLowerCase() !== 'string') return false;
    const literal = definitionLiteral(m.input, m.index + m[0].length);
    if (literal === null) return false;
    m.spanEnd = literal.end;
    let text = literal.text;
    if (m[1] === 'buildConfigField') {
      if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"') || text.slice(1, -1).includes('"')) return false; // an expression
      text = text.slice(1, -1);
    }
    return !text.includes('$') && definitionValueIsSecret(kind, text, ctx);
  },
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

/**
 * Is the literal value of a service directive a secret? Strong-name rules: any non-placeholder of 8+ characters. Most directives
 * (requirepass, masterauth, BasicAuth, stats auth, an ACL >password, chpasswd input) hold the password itself, never the name of a
 * file, so a path-shaped value is judged like any other (`requirepass /srv/Summer2024/Prod`). The matchers that read a
 * directive by a secret-like NAME pass `allowPath: true`, as an assignment would.
 */
function directiveIsSecret(value, { allowPath = false } = {}) {
  if (DIRECTIVE_SAMPLES.has(value.text.toLowerCase()) || DIRECTIVE_REFERENCE.test(value.text)) return false;
  return isSecretValue({ kind: 'strong', value: value.text, quoted: value.quoted, separator: '=', mode: 'config', allowPath });
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

// ---------------------------------------------------------------------------
// Private JSON Web Keys (RFC 7517/7518/8037): an object with a `kty` member whose private members hold key material. One linear
// pass per file finds every such member; the rule's matcher then reports on the line of the private member. Two readers:
//  - a brace reader for JSON, JSON escaped inside a string (\"kty\"), JS / Python object literals (quoted or bare keys) and YAML flow maps;
//  - a line reader for YAML block mappings (`kty: EC` ... `d: ...`, also as `- ` list items), which also covers pretty-printed JSON.
// ---------------------------------------------------------------------------

const JWK_PRIVATE_MEMBERS = new Map([
  ['EC', new Set(['d'])],
  ['OKP', new Set(['d'])],
  ['RSA', new Set(['d', 'p', 'q', 'dp', 'dq', 'qi'])],
  ['oct', new Set(['k'])],
]);
const JWK_WATCHED = new Set(['kty', 'd', 'p', 'q', 'dp', 'dq', 'qi', 'k']);
const JWK_WINDOW_CHARS = 16 * 1024; // an object (or YAML mapping) longer than this is not read as a key (an 8192-bit RSA JWK is ~6.5 KB)
const JWK_MAX_DEPTH = 64;
const JWK_MAX_MEMBERS = 32; // watched members kept per object
// A member name: optionally quoted (', ", or a quote escaped one to three times), the same quote closing it, then a colon.
const JWK_KEY = /(\\{0,3}["']?)([A-Za-z_$][A-Za-z0-9_$]{0,31})\1[ \t]*:[ \t\r\n]{0,64}/y;
// A quoted value made only of base64 / base64url characters; anything else (`<private-key>`, `${D}`, `...`) is not key material.
const JWK_QUOTED_VALUE = /(\\{0,3}["'`])([A-Za-z0-9_+/=-]{0,8192})\1/y;
const JWK_BARE_VALUE = /[A-Za-z0-9_+/=-]{1,8192}/y;
const JWK_IDENTIFIER_CHAR = /[A-Za-z0-9_$]/;

/** Is a private member's literal key material: base64url of 16+ characters that looks random and is not a placeholder? */
function jwkValueIsKeyMaterial(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === '=') end -= 1; // base64 padding, trimmed by hand: /=+$/ backtracks on long runs
  const body = value.slice(0, end);
  if (body.length < 16 || !/^[A-Za-z0-9_+/-]+$/.test(body)) return false;
  return !placeholderOf(body) && looksRandom(body, { minLength: 16, minEntropy: 3.0 });
}

/** Record the private members of a closed object or mapping that has a known `kty` (index of the name -> end of the value). */
function jwkCollect(object, found) {
  if (object.kty === null) return;
  const names = JWK_PRIVATE_MEMBERS.get(object.kty);
  if (names === undefined) return;
  for (const member of object.members) {
    if (names.has(member.name) && jwkValueIsKeyMaterial(member.value)) found.set(member.at, member.end);
  }
}

function jwkAddMember(object, name, value, at, end) {
  if (name === 'kty') object.kty = value;
  else if (object.members.length < JWK_MAX_MEMBERS) object.members.push({ name, value, at, end });
}

/** Brace reader: one left-to-right pass with a stack of open objects. Each position is tried once; a value is read once. */
function jwkBraceMembers(text, found) {
  const stack = [];
  let overflow = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '{') {
      if (stack.length >= JWK_MAX_DEPTH) overflow += 1;
      else stack.push({ start: i, kty: null, members: [] });
      i += 1;
      continue;
    }
    if (c === '}') {
      if (overflow > 0) overflow -= 1;
      else if (stack.length > 0) {
        const object = stack.pop();
        if (i - object.start <= JWK_WINDOW_CHARS) jwkCollect(object, found);
      }
      i += 1;
      continue;
    }
    if (stack.length === 0 || (i > 0 && JWK_IDENTIFIER_CHAR.test(text[i - 1]))) {
      i += 1;
      continue;
    }
    JWK_KEY.lastIndex = i;
    const key = JWK_KEY.exec(text);
    if (key === null) {
      i += 1;
      continue;
    }
    const at = i + key[1].length;
    i = JWK_KEY.lastIndex;
    if (!JWK_WATCHED.has(key[2])) continue;
    JWK_QUOTED_VALUE.lastIndex = i;
    let value = JWK_QUOTED_VALUE.exec(text);
    let literal = value === null ? null : value[2];
    if (value === null) {
      JWK_BARE_VALUE.lastIndex = i;
      value = JWK_BARE_VALUE.exec(text);
      // A bare value is a YAML flow scalar or a JS identifier: a name like privateKeyMaterial is not key material (looksRandom decides).
      literal = value === null ? null : value[0];
    }
    if (value === null) continue;
    const end = i + value[0].length;
    i = end;
    jwkAddMember(stack[stack.length - 1], key[2], literal, at, end);
  }
  for (const object of stack) if (text.length - object.start <= JWK_WINDOW_CHARS) jwkCollect(object, found); // unclosed at the end: read anyway
}

// One YAML (or pretty-printed JSON) line: indentation, list dashes, an optionally quoted key, the rest of the line.
const JWK_YAML_LINE = /^([ \t]*)((?:-[ \t]+)*)(["']?)([A-Za-z_$][A-Za-z0-9_$]{0,31})\3[ \t]*:(?:[ \t]([^\r\n]*))?\r?$/;

/** The scalar of a YAML line's value: quotes, a trailing comma (JSON) and a trailing comment removed. */
function jwkYamlScalar(raw) {
  const line = raw ?? '';
  const comment = line.search(/[ \t]#/); // a comment starts at '#' after a blank; fixed-length search, no backtracking
  const text = (comment === -1 ? line : line.slice(0, comment)).trim().replace(/,$/, '').trim();
  const quoted = /^(["'])([^"']*)\1$/.exec(text);
  return quoted === null ? text : quoted[2];
}

/** Line reader for block mappings: a stack of mappings keyed by the column of their keys. */
function jwkYamlMembers(text, found) {
  const stack = [];
  const close = (minColumn) => {
    while (stack.length > 0 && stack[stack.length - 1].column >= minColumn) jwkCollect(stack.pop(), found);
  };
  let offset = 0;
  while (offset <= text.length) {
    let lineEnd = text.indexOf('\n', offset);
    if (lineEnd === -1) lineEnd = text.length;
    const line = text.slice(offset, lineEnd);
    const m = JWK_YAML_LINE.exec(line);
    if (m === null) {
      const content = /\S/.exec(line);
      if (content !== null && line[content.index] !== '#') close(content.index);
    } else {
      const column = m[1].length + m[2].length;
      close(m[2] === '' ? column + 1 : column);
      let top = stack[stack.length - 1];
      if (top === undefined || top.column !== column || offset - top.start > JWK_WINDOW_CHARS) {
        if (top !== undefined && top.column === column) jwkCollect(stack.pop(), found);
        top = { column, start: offset, kty: null, members: [] };
        stack.push(top);
      }
      if (JWK_WATCHED.has(m[4])) {
        const at = offset + column + m[3].length;
        jwkAddMember(top, m[4], jwkYamlScalar(m[5]), at, lineEnd);
      }
    }
    offset = lineEnd + 1;
  }
  close(0);
}

/** Every private JWK member in `text`: index of its name -> end of its value. Computed once per scanned text. */
function privateJwkMembers(ctx, text) {
  if (ctx.jwkText !== text) {
    const found = new Map();
    jwkBraceMembers(text, found);
    jwkYamlMembers(text, found);
    ctx.jwkText = text;
    ctx.jwkFound = found;
  }
  return ctx.jwkFound;
}

// ---------------------------------------------------------------------------
// Environment fallbacks outside JavaScript (rule hardcoded-secret-fallback). Every language reads an environment variable by a literal
// name and has standard ways to supply a default when it is unset. A literal default under a secret-like name N is the same hardcoded
// secret as JavaScript's `process.env.N || "v"`: it is the key in use whenever the variable is missing. The forms read, by shape:
//   operator  C# Environment.GetEnvironmentVariable("N") ?? "v"          Kotlin / Groovy System.getenv("N") ?: "v"
//             PHP getenv("N") ?: "v", $_ENV["N"] ?? "v", $_SERVER[...]    Ruby ENV["N"] || "v"   Perl $ENV{N} // "v"   Elixir System.get_env("N") || "v"
//             Python os.getenv("N") or "v", os.environ.get("N") or "v"    Lua os.getenv("N") or "v"   Deno.env.get("N") ?? "v"
//             Swift ProcessInfo.processInfo.environment["N"] ?? "v"       Dart Platform.environment["N"] ?? "v"
//   argument  Java / Kotlin System.getenv().getOrDefault("N", "v")        Ruby ENV.fetch("N", "v"), ENV.fetch("N") { "v" }
//             Scala sys.env.getOrElse("N", "v"), Properties.envOrElse    Elixir System.get_env("N", "v")   Dart String.fromEnvironment("N", defaultValue: "v")
//             PHP (Laravel) env("N", "v"), Env::get("N", "v")            getenv / getEnv / get_env / GetEnvOrDefault("N", "v") helpers, Python default="v"
//   method    Java Optional.ofNullable(System.getenv("N")).orElse("v")   Scala sys.env.get("N").getOrElse("v")
//             Rust std::env::var("N").unwrap_or("v".into()), .unwrap_or_else(|_| "v".to_string()), option_env!("N").unwrap_or("v")
//   helper    Java Objects.requireNonNullElse(System.getenv("N"), "v"), Objects.toString(...), StringUtils.defaultIfBlank(...), MoreObjects.firstNonNull(...)
//   ternary   System.getenv("N") != null ? System.getenv("N") : "v"      string.IsNullOrEmpty(GetEnvironmentVariable("N")) ? "v" : GetEnvironmentVariable("N")
//             getenv("N") == null ? "v" : x                              C# GetEnvironmentVariable("N") is { } v ? v : "v"
//             Either the other branch is a getter too, or the condition tests the getter for null / empty and so names the default
//             branch; `getenv("N") ? "configured" : "missing"` and `getenv("N") != null ? "set" : "unset"` are messages, not defaults.
//   Go        v := os.Getenv("N") (or v, ok := os.LookupEnv("N")), then within ENV_GO_DEFAULT_LINES lines `if v == "" { v = "v" }` (also
//             "" == v, len(v) == 0, !ok). Go has no default operator, so its idiom assigns the default to the variable on a later line.
// The default is judged like the JavaScript branch above under a strong name: any non-empty constant counts, because a guessable
// "hunter2" default signs tokens as well as a random one does. A placeholder ("your-secret-here", "changeme", "<jwt-secret>") and a
// display text in parentheses or brackets ("(not set)") pass, and under a weak name the default must look random (envDefaultValueIsSecret).
// An empty string, an interpolated string ("${x}", "#{x}", Kotlin / PHP "$x", C# $"{x}", Swift "\(x)") and anything that is not a string
// literal (a variable, a call, `throw`, `nil`) pass. A literal that is the operand of a comparison or membership test after `or` / `||`
// (`getenv("K") or "k" in settings`) is no default, and a ternary whose both branches are literals is a message, not a default. Every pattern below is a fixed callee or operator followed
// by bounded runs, so a match costs a constant amount of work past its start.
// A default kept in a local variable and applied on a later line is read only in Go's form; `v = getenv("N")` then `v ?? "v"` is not.
// ---------------------------------------------------------------------------

// One getter that reads a variable by a literal name: group `getter` is the callee, `q` the name's quote, `name` the name. A bare name is
// accepted only for Perl's $ENV{N} (envGetterNameOk). An identifier may follow the name as a second argument (C#
// EnvironmentVariableTarget.User, Ruby ENV.fetch("N", nil), PHP getenv("N", true)); a quoted second argument is the argument form below.
const ENV_GETTER =
  String.raw`(?<getter>(?<![A-Za-z0-9_$])(?:(?:System\.)?Environment\.GetEnvironmentVariable|getenv(?:\(\)(?:\.get)?)?|environ(?:\.get)?|ENV(?:\.fetch)?|` +
  String.raw`System\.get_env|(?:std::)?env::var(?:_os)?|dotenvy?::var|option_env!|sys\.env(?:\.get)?|Deno\.env\.get|ProcessInfo\.processInfo\.environment|Platform\.environment)|` +
  // A named first argument: C# GetEnvironmentVariable(variable: "N"), Python os.getenv(key="N").
  String.raw`\$_(?:ENV|SERVER)|\$ENV)[ \t]{0,16}[([{]\s{0,64}(?:(?:variable|key|name)[ \t]{0,4}[:=][ \t]{0,4})?(?<q>["'\x60]?)(?<name>[A-Za-z_][A-Za-z0-9_.-]{0,255})\k<q>` +
  String.raw`\s{0,64}(?:,\s{0,64}[A-Za-z_][A-Za-z0-9_.:]{0,80}\s{0,64})?[)\]}]`;
// A file that holds none of these words has no getter: the operator, method and ternary matchers are skipped for it.
const ENV_GETTER_HINT = /getenv|GetEnvironmentVariable|environ|ENV|_SERVER|get_env|env::var|dotenv|option_env!|sys\.env|Deno\.env/;
// Where a getter is not the start of an expression (a ternary branch, a helper's argument), it may name its class or module first
// (System.getenv, os.getenv): up to three qualifiers.
const GETTER_QUALIFIERS = String.raw`(?:[A-Za-z_][A-Za-z0-9_]{0,63}\.){0,3}`;

// Getter, then a default operator: ?? (C#, PHP, Swift, Dart, TypeScript), ?: (Kotlin, Groovy, PHP, GNU C), || (Ruby, Elixir, Perl), `or`
// (Python, Lua, Ruby), and Perl's defined-or // (only after $ENV{...}: everywhere else // starts a comment). `??=` and `||=` are not
// read here (the literal must follow the operator): they assign the variable, which secret-assignment judges.
// What may stand between a getter and its default operator: the parenthesis of `(getter) ?? "v"`, up to three member calls or
// properties, plain or null-conditional (C# `?.Trim()`, Kotlin `?.trim()`, `?.takeIf { it.isNotBlank() }`, Ruby `.presence`), and one
// comment (`getter // fallback` + line break, `/* ... */`). Every run is bounded and the alternatives start differently (linear).
const ENV_GETTER_TAIL =
  String.raw`(?:[ \t]{0,16}\)){0,2}(?:\s{0,16}\??\.\s{0,16}[A-Za-z_][A-Za-z0-9_]{0,63}(?:\((?:[^()\n]|\([^()\n]{0,64}\)){0,128}\)|[ \t]{0,4}\{[^{}\n]{0,120}\})?){0,3}` +
  String.raw`(?:[ \t]{0,16}(?:\/\/[^\n]{0,200}\n|\/\*[^*\n]{0,200}\*\/))?`;
const ENV_DEFAULT_OPERATOR = new RegExp(
  String.raw`${ENV_GETTER}${ENV_GETTER_TAIL}\s{0,64}(?<op>\?\?|\?:|\|\||\/\/|(?<![A-Za-z0-9_$])or(?![A-Za-z0-9_$]))\s{0,64}(?=\S)`,
  'g',
);

// Calls that take the name and then the default (or a block that returns it). os.getenv / os.environ.get repeat the Python matcher above
// on purpose, so its `default=` keyword is read as well; a finding is reported once per line.
const ENV_DEFAULT_ARGUMENT_CALLEE = [
  String.raw`(?:System\.)?getenv\(\)\.(?:getOrDefault|getOrElse)`, // Java / Kotlin map defaults
  String.raw`ENV\.fetch`, // Ruby
  String.raw`sys\.env\.getOrElse`, // Scala
  String.raw`(?:scala\.util\.)?Properties\.envOrElse`, // Scala
  String.raw`System\.get_env`, // Elixir
  String.raw`String\.fromEnvironment`, // Dart (defaultValue:)
  String.raw`(?:os\.)?environ\.get`, // Python
  String.raw`env\.str`, // django-environ env.str("N", default="v")
  String.raw`[Gg]et_?[Ee]nv(?:_?[Oo]r(?:_?[Dd]efault|_?[Ee]lse)?|_?[Ww]ith_?[Dd]efault)?`, // os.getenv, and getEnv / get_env / GetEnvOrDefault helpers
  // Laravel env("N", "v") and envOr helpers. Never a method: cmd.env("N", "v") sets a child process's variable, it does not read one.
  String.raw`(?<![.:]|->)env(?:_?[Oo]r(?:_?[Dd]efault)?)?`,
  String.raw`Env::get`, // Laravel
].join('|');
const ENV_DEFAULT_ARGUMENT = new RegExp(
  String.raw`(?<![A-Za-z0-9_$])(?<callee>${ENV_DEFAULT_ARGUMENT_CALLEE})\(\s{0,64}(?:(?:key|name|variable)[ \t]{0,4}[:=][ \t]{0,4})?(?<q>["'\x60])(?<name>[A-Za-z_][A-Za-z0-9_.-]{0,255})\k<q>\s{0,64}` +
    // `, "v"` (with Python's default= or Dart's defaultValue:), or a block after the call: Ruby ENV.fetch("N") { "v" } / { |k| "v" },
    // Kotlin getOrElse("N") { "v" }. The block form is accepted for those two callees only (an `if (getenv("N")) {` body is no default).
    // Ruby's block may also be `do ... end`, its body on the next line.
    String.raw`(?:,\s{0,64}(?:default(?:Value)?[ \t]{0,4}[:=][ \t]{0,4})?|(?<block>\)[ \t]{0,16}(?:\{[ \t]{0,16}|do(?![A-Za-z0-9_])\s{0,64})(?:\|[^|\n]{0,64}\|\s{0,16})?))(?=\S)`,
  'g',
);

// Getter, an optional `)` (Java's Optional.ofNullable(getter)), up to three adapters (.ok(), .map(String::trim), .filter(s -> !s.isBlank())),
// the default method, and what may stand between its parenthesis and the literal: a closure head (Rust |_|, Java () ->), a block brace,
// String::from( or String.valueOf(. An adapter's argument may hold one level of parentheses; both alternatives are disjoint, so no backtracking.
// Also Kotlin `.orEmpty().ifBlank { "v" }` / `?.ifEmpty { "v" }`, Rust `map_or("v", f)` / `map_or_else(|_| "v", f)` / `format!("v")`,
// and Java `Optional...or(() -> Optional.of("v"))`.
const ENV_DEFAULT_METHOD = new RegExp(
  ENV_GETTER +
    String.raw`(?:[ \t]{0,16}\))?(?:\s{0,16}\??\.\s{0,16}(?:ok|as_deref|as_ref|map|filter|flatMap|trim|trimEnd|trimStart|orEmpty|takeIf|takeUnless)` +
    String.raw`(?:\((?:[^()\n]|\([^()\n]{0,64}\)){0,128}\)|[ \t]{0,4}\{[^{}\n]{0,120}\})){0,3}` +
    String.raw`\s{0,16}\??\.\s{0,16}(?:(?:unwrap_or(?:_else)?|orElse(?:Get)?|getOrElse|map_or(?:_else)?|or)\(\s{0,16}(?:(?:move[ \t]+)?\|[^|\n]{0,64}\|\s{0,16}|\(\s{0,16}\)\s{0,16}->\s{0,16})?` +
    String.raw`(?:\{\s{0,16})?|(?:ifBlank|ifEmpty)[ \t]{0,4}\{\s{0,16})(?:(?:String|OsString)::from\(\s{0,16}|String\.valueOf\(\s{0,16}|format!\(\s{0,16}|Optional\.of\(\s{0,16})?(?=\S)`,
  'g',
);

// Java helpers that return their second argument when the first is null or blank, called with the getter first: Objects.requireNonNullElse
// and Objects.toString (JDK), StringUtils.defaultIfBlank / defaultIfEmpty / defaultString (Apache Commons), MoreObjects.firstNonNull (Guava).
const ENV_DEFAULT_WRAPPER = new RegExp(
  String.raw`(?<![A-Za-z0-9_$])(?:Objects\.(?:requireNonNullElse(?:Get)?|toString)|(?:StringUtils\.)?default(?:IfBlank|IfEmpty|String)|(?:MoreObjects\.)?firstNonNull)` +
    String.raw`\(\s{0,64}${GETTER_QUALIFIERS}${ENV_GETTER}\s{0,64},\s{0,64}(?:\(\s{0,16}\)\s{0,16}->\s{0,16})?(?=\S)`,
  'g',
);

// Ternaries whose one branch is a getter and whose other branch is a literal. The `?` is not part of ??, ?. or ?: .
const TERNARY_QUESTION = String.raw`(?<![?])\?(?![?.:])`;
// `? getter : "v"` (the getter may be followed by up to three zero-argument calls such as .trim()).
const ENV_DEFAULT_TERNARY_ELSE = new RegExp(
  String.raw`${TERNARY_QUESTION}\s{0,64}${GETTER_QUALIFIERS}${ENV_GETTER}(?:\s{0,16}\.\s{0,16}[A-Za-z_][A-Za-z0-9_]{0,63}\(\s{0,16}\)){0,3}\s{0,64}:(?!:)\s{0,64}(?=\S)`,
  'g',
);
// `? "v" : getter`: the literal is read after the `?`, then ENV_TERNARY_ELSE_GETTER must follow it.
const ENV_DEFAULT_TERNARY_THEN = new RegExp(String.raw`${TERNARY_QUESTION}\s{0,64}(?=\S)`, 'g');
const ENV_TERNARY_ELSE_GETTER = new RegExp(String.raw`\s{0,64}:(?!:)\s{0,64}${GETTER_QUALIFIERS}${ENV_GETTER}`, 'y');
// A condition that tests the getter itself for null or empty says which branch is the default, whatever the other branch is:
// `getter == null ? "v" : x` (then-branch, group `missing`) and `getter != null ? x : "v"`, C# `getter is { } v ? v : "v"` (else-branch).
// Not preceded by `!` (also across blanks and opening parentheses: `!(getter == null)`), which would invert the test.
const ENV_DEFAULT_TERNARY_TEST = new RegExp(
  String.raw`(?<![!A-Za-z0-9_$.])(?<!![ \t(]{1,8})${GETTER_QUALIFIERS}${ENV_GETTER}\s{0,16}(?:(?<missing>===?\s{0,16}(?:null|nil|None|""|'')|is[ \t]+null)|` +
    String.raw`!==?\s{0,16}(?:null|nil|None|""|'')|is[ \t]+not[ \t]+null|is[ \t]+(?:\{\s{0,16}\}|string|String)[ \t]+[A-Za-z_][A-Za-z0-9_]{0,63})` +
    String.raw`\s{0,16}\)?\s{0,64}${TERNARY_QUESTION}\s{0,64}(?=\S)`,
  'g',
);
// The then-branch of a present-test ternary, skipped to reach the else-branch: an expression with no quote, `?`, `:` or `;` (a getter
// there is the ENV_DEFAULT_TERNARY_ELSE form).
const TERNARY_THEN_BRANCH = /[^?:;\n"'\x60]{1,200}:(?!:)\s{0,64}(?=\S)/y;

// Go: `v := os.Getenv("N")`, `var v = ...`, `v = ...`, `cfg.Secret = ...` or `v, ok := os.LookupEnv("N")`. The default must be assigned
// within this many lines (and characters) after the read, inside an `if` that tests the variable for empty.
// The read may be wrapped in one call (`strings.TrimSpace(os.Getenv("N"))`): group `wrap`, whose `)` (group `close`) must follow.
const ENV_GO_READ =
  /(?<![A-Za-z0-9_.])(?<v>[A-Za-z_][A-Za-z0-9_]{0,63}(?:\.[A-Za-z_][A-Za-z0-9_]{0,63}){0,3})(?:[ \t]*,[ \t]*(?<ok>[A-Za-z_][A-Za-z0-9_]{0,63}))?(?:[ \t]+string)?[ \t]*:?=[ \t]*(?<wrap>[A-Za-z_][A-Za-z0-9_]{0,31}\.[A-Za-z_][A-Za-z0-9_]{0,63}\([ \t]*)?os\.(?:Getenv|LookupEnv)\([ \t]*(?<q>["\x60])(?<name>[A-Za-z_][A-Za-z0-9_.-]{0,255})\k<q>[ \t]*\)(?<close>[ \t]*\))?/g;
// Go: `cmp.Or(os.Getenv("N"), "v")` (the standard library's first-non-zero helper).
const GO_CMP_OR = /(?<![A-Za-z0-9_.])cmp\.Or\([ \t]*os\.Getenv\([ \t]*(?<q>["\x60])(?<name>[A-Za-z_][A-Za-z0-9_.-]{0,255})\k<q>[ \t]*\)[ \t]*,\s{0,64}(?=\S)/g;
// Go's helper idiom: `if v := os.Getenv("N"); v != "" { return v }` (or `if v, ok := os.LookupEnv("N"); ok { ... }`), then the
// default returned after the block (or from its `else` block).
const GO_IF_INIT_RETURN =
  /(?<![A-Za-z0-9_])if[ \t]+[A-Za-z_][A-Za-z0-9_]{0,63}(?:[ \t]*,[ \t]*[A-Za-z_][A-Za-z0-9_]{0,63})?[ \t]*:=[ \t]*os\.(?:Getenv|LookupEnv)\([ \t]*(?<q>["\x60])(?<name>[A-Za-z_][A-Za-z0-9_.-]{0,255})\k<q>[ \t]*\)[ \t]*;[^{}\n]{1,160}\{[^{}]{0,400}\}\s{0,64}(?:else[ \t]*\{\s{0,64})?return[ \t]+(?=\S)/g;
// Rust: `match env::var("N") { Ok(v) => v, Err(_) => "v".to_string() }` (also `.ok()` and `None =>`).
const RUST_ENV_MATCH = new RegExp(
  String.raw`(?<![A-Za-z0-9_])match[ \t]+${ENV_GETTER}(?:\s{0,16}\.\s{0,16}(?:ok|as_deref)\(\))?\s{0,16}\{[^{}]{0,300}?(?<![A-Za-z0-9_])(?:Err|None)(?:\([^()\n]{0,40}\))?\s{0,16}=>\s{0,16}` +
    String.raw`(?:\{\s{0,16})?(?:(?:String|OsString)::from\(\s{0,16}|format!\(\s{0,16})?(?=\S)`,
  'g',
);
// Python: `getter if <test> else "v"` (os.environ["N"] if "N" in os.environ else "v").
const PY_ENV_CONDITIONAL = new RegExp(String.raw`(?<![A-Za-z0-9_.])${GETTER_QUALIFIERS}${ENV_GETTER}[ \t]+if[ \t]+[^\n]{1,200}?[ \t]else[ \t]+(?=\S)`, 'g');
// Ruby without parentheses: `ENV.fetch "N", "v"`.
const RUBY_FETCH_BARE = /(?<![A-Za-z0-9_$])ENV\.fetch[ \t]+(?<q>["'])(?<name>[A-Za-z_][A-Za-z0-9_.-]{0,255})\k<q>[ \t]*,[ \t]*(?=\S)/g;
// PowerShell 7: `$env:N ?? 'v'` and `if ($env:N) { $env:N } else { 'v' }`.
const PS_ENV_DEFAULT = /(?<![A-Za-z0-9_])\$env:(?<name>[A-Za-z_][A-Za-z0-9_]{0,255})[ \t]*\?\?[ \t]*(?=\S)/gi;
const PS_ENV_IF_ELSE =
  /(?<![A-Za-z0-9_])if[ \t]*\([ \t]*\$env:(?<name>[A-Za-z_][A-Za-z0-9_]{0,255})[ \t]*\)[ \t]*\{[ \t]*\$env:\k<name>[ \t]*\}\s{0,64}else[ \t]*\{\s{0,64}(?=\S)/gi;
// Java: an environment map held in a variable (`Map<String, String> env = System.getenv();` ... `env.getOrDefault("N", "v")`).
const JAVA_ENV_MAP_VARIABLE = /(?<![A-Za-z0-9_$.])([A-Za-z_$][A-Za-z0-9_$]{0,63})[ \t]*=[ \t]*System\.getenv\(\)[ \t]*;/g;
const JAVA_ENV_MAP_GET =
  /(?<![A-Za-z0-9_$.])(?<v>[A-Za-z_$][A-Za-z0-9_$]{0,63})\.(?:getOrDefault|getOrElse)\(\s{0,64}(?<q>["'])(?<name>[A-Za-z_][A-Za-z0-9_.-]{0,255})\k<q>\s{0,64},\s{0,64}(?=\S)/g;
/** The variables of this file that hold System.getenv() (computed once per file). */
function javaEnvMapVariables(ctx, input) {
  if (ctx.javaEnvMaps === undefined) {
    ctx.javaEnvMaps = new Set();
    if (input.includes('System.getenv()')) for (const m of input.matchAll(JAVA_ENV_MAP_VARIABLE)) ctx.javaEnvMaps.add(m[1]);
  }
  return ctx.javaEnvMaps;
}
const ENV_GO_DEFAULT_LINES = 8;
const ENV_GO_DEFAULT_CHARS = 1200;

// Strings that interpolate a bare $name: Kotlin, Groovy, PHP and Perl in double quotes, Dart in either quote.
const DOLLAR_NAME_INTERPOLATION = /\.(?:kts?|groovy|gradle|gvy|php|phtml|pl|pm|dart)$/i;

/**
 * The string literal at `at` as an environment default: the literal ({ text, end }) when it is a non-empty constant, or null when it is
 * empty, interpolated (built from other values), or not a string literal at all (a variable, a call, `throw`, `nil`).
 */
function fallbackConstant(input, at, filePath, ctx = null) {
  // With ctx a literal may run over lines (Rust r#"..."#, a backtick, C# @"...", Perl q{...}) or be exhausted: see judgeEnvDefault.
  const literal = callStringLiteral(input, at, filePath, ctx);
  if (literal === null) return null;
  if (literal.exhausted === true) return literal;
  if (literal.text.trim() === '') return null;
  if (literal.interpolated && /[{}$]/.test(literal.text)) return null; // C# $"{x}", Scala s"$x", Python f"{x}"
  const source = input.slice(at, literal.end);
  if (INTERPOLATION.test(literal.text) || source.includes('{$')) return null; // ${x}, #{x}, {{x}}, PHP {$x}
  const quote = /["'\x60]/.exec(source)?.[0];
  if (DOLLAR_NAME_INTERPOLATION.test(filePath) && /\$[A-Za-z_]/.test(source) && (quote === '"' || /\.dart$/i.test(filePath))) return null;
  if (/\.swift$/i.test(filePath) && source.includes('\\(')) return null; // Swift "\(x)" (the escape is gone from literal.text)
  return literal;
}

/** Is the getter's name a quoted secret-like name (a bare one only in Perl's $ENV{N})? */
const envGetterNameOk = (groups) => (groups.q !== '' || groups.getter?.startsWith('$ENV') === true) && isSecretLikeName(groups.name);

// A literal after a default OPERATOR that is itself an operand of a tighter one is no default: Python `getenv("K") or "k" in settings`
// (`or` binds more loosely than `in`), `... or "--insecure" in sys.argv`, `x == "v"`.
const NOT_A_DEFAULT_AFTER = /[ \t]*(?:(?:not[ \t]+)?in(?![A-Za-z0-9_])|is(?![A-Za-z0-9_])|==|!=|<|>|%(?!=))/y;

/**
 * Is a constant default for the variable `name` a secret? A placeholder ("your-secret-here", "<jwt-secret>", "REDACTED", "changeme")
 * and a parenthesised or bracketed display text ("(not set)", "[unset]") are not, exactly as the scanner's remediation text suggests.
 * Under a weak name (AUTH_PASSWORD_BROKER, a *_TABLE) the default must look random, as a weak name's value in code must; under a
 * strong name any other constant counts, as in the JavaScript branch (a guessable default signs tokens as well as a random one).
 */
function envDefaultValueIsSecret(name, text) {
  const value = text.trim();
  if (isPlaceholder(value) || /^\(.*\)$|^\[.*\]$/.test(value)) return false;
  return secretNameKind(name) === 'strong' || looksRandom(value, GATES.codeWeak);
}

/**
 * A getter match whose default literal starts at `at`: a secret-like name and a constant default that is a secret (see
 * envDefaultValueIsSecret). `operator`: the literal follows a default operator, so it must not be the operand of a comparison or a
 * membership test. The span runs to the literal's end.
 */
function envDefaultIsSecret(m, ctx, at, { operator = false } = {}) {
  if (!envGetterNameOk(m.groups)) return false;
  const literal = fallbackConstant(m.input, at, ctx.path, ctx);
  if (literal === null) return false;
  if (operator && literal.exhausted !== true) {
    NOT_A_DEFAULT_AFTER.lastIndex = literal.end;
    if (NOT_A_DEFAULT_AFTER.test(m.input)) return false;
  }
  return judgeEnvDefault(m, ctx, m.groups.name, literal, at);
}

/**
 * The verdict on a default literal read by fallbackConstant at `at`: one over lines is judged like a heredoc (each line and all of them,
 * charged to the file's multi-line budget), one that did not end within the bounds is reported (fail closed), exactly as callLiteralTexts
 * does for the other readers. The span runs to the literal's end.
 */
function judgeEnvDefault(m, ctx, name, literal, at) {
  m.spanEnd = literal.end;
  const read = callLiteralTexts(m, ctx, literal, at);
  if (read.verdict !== undefined) return read.verdict;
  return read.texts.some((text) => envDefaultValueIsSecret(name, text));
}

/** `? "v" : getter`: the then-branch literal of a ternary whose else-branch reads a secret-like variable. */
function ternaryThenIsSecret(m, ctx) {
  const literal = fallbackConstant(m.input, m.index + m[0].length, ctx.path, ctx);
  if (literal === null) return false;
  ENV_TERNARY_ELSE_GETTER.lastIndex = literal.end;
  const getter = ENV_TERNARY_ELSE_GETTER.exec(m.input);
  if (getter === null || literal.exhausted === true || !envGetterNameOk(getter.groups) || !envDefaultValueIsSecret(getter.groups.name, literal.text)) return false;
  m.spanEnd = getter.index + getter[0].length;
  return true;
}

/** `getter == null ? "v" : x` or `getter != null ? x : "v"`: the branch the condition's own test names as the default. */
// The else-branch of a missing-test ternary: when it is a string literal too, both branches are messages (`getter == null ? "missing" :
// "configured"`), as in the `!=` form, where a literal then-branch never reaches the else-branch reader.
const TERNARY_ELSE_LITERAL = /\s{0,64}:(?!:)\s{0,64}[@$]?["'\x60]/y;

/** `getter == null ? "v" : x` or `getter != null ? x : "v"`: the branch the condition's own test names as the default. */
function ternaryTestIsSecret(m, ctx) {
  let at = m.index + m[0].length;
  if (m.groups.missing === undefined) {
    TERNARY_THEN_BRANCH.lastIndex = at;
    const then = TERNARY_THEN_BRANCH.exec(m.input);
    if (then === null) return false;
    at = then.index + then[0].length;
  } else {
    const literal = fallbackConstant(m.input, at, ctx.path, ctx);
    if (literal === null) return false;
    TERNARY_ELSE_LITERAL.lastIndex = literal.exhausted === true ? m.input.length : literal.end;
    if (TERNARY_ELSE_LITERAL.test(m.input)) return false;
  }
  return envDefaultIsSecret(m, ctx, at);
}

// Go: an `if` that tests one variable for empty (`v == ""`, `"" == v`, `len(v) == 0`, `len(v) < 1`) or an ok flag (`!ok`), then its
// block up to the first brace (read ahead, not consumed). One compiled pattern for every file: the tested and the assigned names are
// captured and compared with the read's variable as strings, so no pattern is ever built from file text (no escaping, no per-name cost).
const GO_IDENT_CHAIN = String.raw`[A-Za-z_][A-Za-z0-9_]{0,63}(?:\.[A-Za-z_][A-Za-z0-9_]{0,63}){0,3}`;
const GO_EMPTY_TEST = new RegExp(
  String.raw`(?<![A-Za-z0-9_])if[ \t]+(?:(?<a>${GO_IDENT_CHAIN})[ \t]*==[ \t]*(?:""|\x60\x60)|(?:""|\x60\x60)[ \t]*==[ \t]*(?<b>${GO_IDENT_CHAIN})(?![A-Za-z0-9_.])|` +
    String.raw`len\((?<c>${GO_IDENT_CHAIN})\)[ \t]*(?:==[ \t]*0|<[ \t]*1)|!(?<ok>[A-Za-z_][A-Za-z0-9_]{0,63})(?![A-Za-z0-9_]))[^{}\n]{0,160}\{(?=(?<body>[^{}]{0,480}))`,
  'g',
);
// An assignment in that block: `name = ` (not `==`, not `:=`, not a field of something else).
const GO_ASSIGNMENT = new RegExp(String.raw`(?<![A-Za-z0-9_.])(?<t>${GO_IDENT_CHAIN})[ \t]*=(?!=)[ \t]*(?=\S)`, 'g');
// How far into the block the assignment may start.
const GO_BLOCK_CHARS = 400;

/**
 * Go: after `v := os.Getenv("N")`, an `if` within ENV_GO_DEFAULT_LINES lines that tests v for empty and assigns v a constant in its
 * block (`if v == "" { v = "x" }`). The window, the test and the block are all bounded; the block is read up to its first brace.
 */
function goEnvDefaultIsSecret(m, ctx) {
  if (!isSecretLikeName(m.groups.name) || (m.groups.wrap !== undefined && m.groups.close === undefined)) return false;
  const from = m.index + m[0].length;
  let end = Math.min(m.input.length, from + ENV_GO_DEFAULT_CHARS);
  let lines = 0;
  for (let at = m.input.indexOf('\n', from); at !== -1 && at < end; at = m.input.indexOf('\n', at + 1)) {
    lines += 1;
    if (lines > ENV_GO_DEFAULT_LINES) end = at;
  }
  const window = m.input.slice(from, end);
  if (!window.includes('if')) return false;
  const { v, ok } = m.groups;
  GO_EMPTY_TEST.lastIndex = 0;
  for (let test = GO_EMPTY_TEST.exec(window); test !== null; test = GO_EMPTY_TEST.exec(window)) {
    const tested = test.groups.a ?? test.groups.b ?? test.groups.c;
    if (tested === undefined ? ok === undefined || test.groups.ok !== ok : tested !== v) continue;
    const blockAt = test.index + test[0].length;
    const body = test.groups.body;
    GO_ASSIGNMENT.lastIndex = 0;
    for (let assign = GO_ASSIGNMENT.exec(body); assign !== null && assign.index <= GO_BLOCK_CHARS; assign = GO_ASSIGNMENT.exec(body)) {
      if (assign.groups.t !== v) continue;
      const at = from + blockAt + assign.index + assign[0].length;
      const literal = fallbackConstant(m.input, at, ctx.path, ctx);
      if (literal === null) return false;
      return judgeEnvDefault(m, ctx, m.groups.name, literal, at);
    }
  }
  return false;
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
    description:
      'Private key material: a PEM private key block (line breaks real, escaped, as XML references or continuations, or blanks on one line), ' +
      'the private lines of a PuTTY .ppk file, a base64-encoded PEM private key, or a bare base64 DER private key (PKCS#8, PKCS#1, SEC1)',
    matchers: [
      {
        pattern: new RegExp(
          String.raw`-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----` +
            PRIVATE_PEM_SEPARATOR +
            String.raw`(?:(?:Proc-Type|DEK-Info|Version|Comment):[^\n]*` +
            PEM_SEPARATOR +
            String.raw`)*([A-Za-z0-9+/=]{20,}[^\n]*)`,
          'g',
        ),
        accept: (m) => !placeholderOf(m[1]),
      },
      {
        // PuTTY .ppk: "PuTTY-User-Key-File-2: ssh-rsa" ... "Private-Lines: N" and the private key lines after it.
        hint: /Private-Lines/,
        pattern: new RegExp(String.raw`Private-Lines:[ \t]*\d{1,4}` + PEM_SEPARATOR + String.raw`([A-Za-z0-9+/=]{20,}[^\n]*)`, 'g'),
        accept: (m) => !placeholderOf(m[1]),
      },
      { hint: /LS0tLS1CRUdJTi/, pattern: BASE64_PEM_PRIVATE, accept: (m) => base64PemIsPrivate(m[0]) },
      { pattern: DER_PRIVATE_KEY, accept: (m) => !placeholderOf(m[0]) && varied(m[0].slice(-40)) },
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
  CONNECTION_STRING_RULE,
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
      WRAPPED_ASSIGNMENT_MATCHER,
      DEFINITION_ASSIGNMENT_MATCHER,
      PROPERTIES_BLANK_MATCHER,
      SYSTEMD_SETTING_MATCHER,
      C_DEFINE_MATCHER,
      MAKE_DEFINE_MATCHER,
      CMAKE_SET_MATCHER,
      GRADLE_FIELD_MATCHER,
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
        pattern: /\$\{?env:([A-Za-z_][A-Za-z0-9_.-]{0,255})\}?[ \t]{0,64}\+?=[ \t]{0,64}(?=["'@])/gi,
        accept: (m, ctx) => {
          const kind = nameKindFor(m[1], ctx);
          if (!kind || !commandContextOk(m, ctx, true)) return false;
          if (m.input[m.index + m[0].length] === '@') return powershellHereStringIsSecret(m, kind, ctx, m.index + m[0].length);
          const literal = powershellString(m.input, m.index + m[0].length);
          if (literal !== null) m.spanEnd = literal.end;
          return powershellValueIsSecret(kind, literal, ctx);
        },
      },
      {
        // PowerShell / .NET: [Environment]::SetEnvironmentVariable('NAME', 'value'[, 'User'])
        hint: /SetEnvironmentVariable/i,
        pattern: /\[(?:System\.)?Environment\][ \t]{0,64}::[ \t]{0,64}SetEnvironmentVariable\([ \t]{0,64}(["'])([A-Za-z_][A-Za-z0-9_.-]{0,255})\1[ \t]{0,64},[ \t]{0,64}(?=["'@])/gi,
        accept: (m, ctx) => {
          const kind = nameKindFor(m[2], ctx);
          if (!kind || !commandContextOk(m, ctx, true)) return false;
          if (m.input[m.index + m[0].length] === '@') return powershellHereStringIsSecret(m, kind, ctx, m.index + m[0].length);
          const literal = powershellString(m.input, m.index + m[0].length);
          if (literal !== null) m.spanEnd = literal.end;
          return powershellValueIsSecret(kind, literal, ctx);
        },
      },
      {
        // Function-call setters (see ENV_SETTER_CALLEE): the second argument is a literal, or the name is followed by `=` in one string.
        pattern: ENV_SETTER_CALL,
        accept: (m, ctx) => {
          if (ctx.mode === 'prose' && ctx.fenceLang(m.index) === undefined) return false;
          const call = envSetterArguments(m.input, m.index + m[0].length, ctx.path, ctx);
          if (call === null) return false;
          const kind = nameKindFor(call.name, ctx);
          if (!kind) return false;
          const literal = call.literal;
          if (literal === null) return false;
          m.spanEnd = literal.end;
          const read = callLiteralTexts(m, ctx, literal, call.valueStart); // a value over lines is judged like a heredoc; an unterminated one is reported
          if (read.verdict !== undefined) return read.verdict;
          if (literal.interpolated && /[{}]/.test(literal.text)) return false; // an interpolated string is built from other values
          return read.texts.some((text) => powershellValueIsSecret(kind, { text }, ctx));
        },
      },
      {
        // Perl hash elements: $ENV{NAME} = 'v', $config{'password'} = "v" (a subscript in braces; PHP and Ruby use brackets, read above)
        pattern: /(?<![A-Za-z0-9_$])\$[A-Za-z_][A-Za-z0-9_]{0,64}\{[ \t]{0,8}(["']?)([A-Za-z_][A-Za-z0-9_.-]{0,255})\1[ \t]{0,8}\}[ \t]{0,16}=(?![=~])[ \t]{0,16}(?=\S)/g,
        accept: (m, ctx) => {
          if (ctx.mode === 'prose' && ctx.fenceLang(m.index) === undefined) return false;
          const kind = nameKindFor(m[2], ctx);
          if (!kind) return false;
          const literal = callStringLiteral(m.input, m.index + m[0].length, ctx.path, ctx);
          if (literal === null) return false;
          m.spanEnd = literal.end;
          const read = callLiteralTexts(m, ctx, literal, m.index + m[0].length);
          if (read.verdict !== undefined) return read.verdict;
          return read.texts.some((text) => powershellValueIsSecret(kind, { text }, ctx));
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
        // XML element form: <property><name>X</name><value>Y</value></property>, <setting><key>X</key>..., with or without a namespace prefix
        // (<ns:name>X</ns:name><ns:value>Y</ns:value>). The prefix ends in a colon and the closing tag repeats the whole qualified name.
        hint: /<\/(?:[A-Za-z_][A-Za-z0-9_.-]{0,32}:)?(?:name|key|variable|env|parameter)/i,
        pattern: /<((?:[A-Za-z_][A-Za-z0-9_.-]{0,32}:)?(?:name|key|variable|env|parametername|parameterkey))>[ \t\r\n]*([A-Za-z_][A-Za-z0-9_.-]{0,1023})[ \t\r\n]*<\/\1>/gi,
        accept: (m, ctx) => {
          const kind = nameKindFor(m[2], ctx);
          return kind !== null && xmlPairIsSecret(m, kind, ctx);
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
        // A header written as a name/value pair, the value in another field: <add key="Authorization" value="Bearer T"/> (.NET, Spring, Camel),
        // {"name":"Authorization","value":"Bearer T"} (Postman, HAR, OpenAPI), `- name: Authorization` above `value: Bearer T` (Kubernetes,
        // GitHub Actions, Helm), `header = "Authorization"` / `value = "Bearer T"`. The value is searched for in the same bounded
        // object, YAML mapping or XML entry as for any secret-like name (see pairValueIsSecret).
        hint: /authorization/i,
        pattern:
          /(?<![A-Za-z0-9_$.-])(\\?["']?)(?:name|key|header|headername|header_name|header-name|field|fieldname)\1[ \t]*[:=][ \t]*(\\?["']?)((?:[A-Za-z]{1,20}-)?authorization)\2(?![A-Za-z0-9_.-])/gi,
        accept: (m, ctx) => {
          if (ctx.mode === 'code' && m[2] === '') return false; // a bare identifier in source code is not a header name
          return pairValueIsSecret(m, AUTHORIZATION_KIND, ctx);
        },
      },
      {
        // The same header in XML elements: <header><name>Authorization</name><value>Bearer T</value></header>, a plist
        // <key>Authorization</key><string>Bearer T</string>, with or without a namespace prefix.
        hint: /authorization/i,
        pattern: /<((?:[A-Za-z_][A-Za-z0-9_.-]{0,32}:)?(?:name|key|header|headername))>[ \t\r\n]*((?:[A-Za-z]{1,20}-)?authorization)[ \t\r\n]*<\/\1>/gi,
        appliesTo: (ctx) => ctx.xml,
        accept: (m, ctx) => xmlPairIsSecret(m, AUTHORIZATION_KIND, ctx),
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
        // The pattern finds the call and its first argument; the second argument, one complete quoted string ("""triple""", 'single',
        // "double" or `backtick`, escapes honoured, spaces allowed: a passphrase), is read by quotedArgument, one forward scan with no
        // backtracking, so no regex has to tell a quote that closes the string from one inside it.
        pattern:
          /(?:\.auth\(|(?<![A-Za-z0-9_$])(?:auth[ \t]{0,8}=[ \t]{0,8}\(|(?:HTTP(?:Basic|Digest|Proxy)Auth|BasicAuth|BasicCredentials|Credentials\.basic|PasswordAuthentication|UsernamePasswordCredentials|NetworkCredential|SetBasicAuth|Basic|basicAuth|basic_auth|withBasicAuth)[ \t]{0,4}\())[^,()\n]{1,200},[ \t]{0,8}(?=[@$rRbBfFuUL#]{0,3}["'\x60])/g,
        accept: (m, ctx) => {
          const start = m.index + m[0].length;
          // A backtick (Go raw strings run over lines), a Rust string, and triple quotes are read as whole literals too.
          const whole =
            !'"\'`'.includes(m.input[start]) ||
            m.input[start] === '`' ||
            (m.input[start] === '"' && /\.rs$/i.test(ctx.path)) ||
            (m.input.startsWith('"""', start) && SPANNING_TRIPLE_QUOTES.test(ctx.path));
          if (whole) {
            // a prefixed or raw literal (r"pw", @"pw", r#"pw"#): read as a whole literal; one over lines is judged like a heredoc
            const literal = callStringLiteral(m.input, start, ctx.path, ctx);
            if (literal === null) return false;
            m.spanEnd = literal.end;
            const read = callLiteralTexts(m, ctx, literal, start);
            if (read.verdict !== undefined) return read.verdict;
            if (literal.text === '' || (literal.interpolated && /[{}]/.test(literal.text))) return false;
            return read.texts.some((text) => isSecretValue({ kind: 'strong', value: text, quoted: true, separator: '=', mode: 'config', allowPath: false }));
          }
          const argument = quotedArgument(m.input, start);
          if (argument === null || argument.raw.length === 0) return false;
          m.spanEnd = argument.end;
          return isSecretValue({ kind: 'strong', value: unescapeQuoted(argument.raw), quoted: true, separator: '=', mode: 'config', allowPath: false });
        },
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
          return kind === 'strong' && directiveIsSecret(value, { allowPath: true });
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
          return kind === 'strong' && directiveIsSecret(value, { allowPath: true });
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
        accept: (m, ctx) => nameKindFor(m.groups.name, ctx) === 'strong' && directiveIsSecret({ text: unescapeQuoted(m.groups.dq), quoted: true }, { allowPath: true }),
      },
      {
        // OpenVPN inline credentials: <auth-user-pass> / user / password / </auth-user-pass>
        hint: /<auth-user-pass>/,
        pattern: /<auth-user-pass>[ \t]*\r?\n[^\n]{0,256}\n([^\n<]{1,1024})\n[ \t]*<\/auth-user-pass>/g,
        accept: (m) => directiveIsSecret({ text: m[1].trim(), quoted: false }),
      },
      {
        // Account passwords set from a script through standard input, the text read as whole shell words (single, double, $'...' and
        // escaped-space quoting, so a passphrase counts). Sources: a pipe from echo or printf, a here-string, a heredoc; consumers: chpasswd
        // (user:password per line, plain or -e hash), passwd (--stdin, or the password typed twice) and smbpasswd -s.
        hint: /passwd/,
        pattern: /(?<![A-Za-z0-9_./-])(?:chpasswd|passwd|smbpasswd)(?![A-Za-z0-9_.-])[^\n]{0,600}/g,
        accept: (m, ctx) => accountPasswordFromStdin(m, ctx),
      },
    ],
  },
  {
    id: 'hardcoded-signing-key',
    description:
      'Signing / HMAC key written as a string literal (random-looking, or a passphrase): jwt.sign / jwt.verify, jwt.encode / JWT.encode, Jwts signWith, SecretKeySpec, HMAC, createHmac, express-session / express-jwt { secret }, cookieParser',
    appliesTo: (ctx) => ctx.mode === 'code',
    hint: /\b(?:sign|verify|encode|decode|signWith|setSigningKey|verifyWith|SecretKeySpec|createHmac|HMAC|cookieParser|secret(?:OrKey|OrPrivateKey)?)\b|hmac\.new/,
    matchers: [
      {
        // jwt.sign(payload, "KEY"), jwt.verify(token, "KEY"), Python jwt.encode(payload, "KEY") / jwt.decode(token, key="KEY"), Ruby JWT.encode(payload, "KEY")
        pattern: /\b(?:jwt|jsonwebtoken|jws|JWT)\.(?:sign|verify|encode|decode)\(([^;]{0,300}?),[ \t]*(?:key[ \t]{0,4}=[ \t]{0,4})?(["'`])([^"'`\n]{8,4096})\2/g,
        accept: (m) => isSecondArgument(m[1]) && signingKeyIsSecret(m[3]),
      },
      {
        // Java JJWT: Jwts.builder().signWith(SignatureAlgorithm.HS256, "KEY"), Jwts.parser().setSigningKey("KEY"), signWith(Keys.hmacShaKeyFor("KEY".getBytes()))
        pattern: /\.(?:signWith|setSigningKey|verifyWith)\(([^;"'`\n]{0,200}?)(["'])([^"'\n]{1,4096})\2/g,
        accept: (m) => opensWithinCall(m[1]) && signingKeyIsSecret(m[3]),
      },
      {
        // Java / Kotlin: new SecretKeySpec("KEY".getBytes(), "HmacSHA256")
        pattern: /\bSecretKeySpec\([ \t]{0,64}(["'])([^"'\n]{1,4096})\1/g,
        accept: (m) => signingKeyIsSecret(m[2]),
      },
      {
        // Python: hmac.new(b"KEY", msg, ...), HMAC(key="KEY"), hmac.HMAC(b"KEY", ...)
        pattern: /(?:\bhmac\.new|(?<![A-Za-z0-9_$])HMAC)\([ \t]{0,64}(?:key[ \t]{0,4}=[ \t]{0,4})?[bBrRuU]{0,2}(["'])([^"'\n]{1,4096})\1/g,
        accept: (m) => signingKeyIsSecret(m[2]),
      },
      {
        // Node: crypto.createHmac('sha256', "KEY")
        pattern: /\bcreateHmac\([ \t]{0,64}(["'])[A-Za-z0-9-]{1,32}\1[ \t]{0,64},[ \t]{0,64}(["'`])([^"'`\n]{1,4096})\2/g,
        accept: (m) => signingKeyIsSecret(m[3]),
      },
      {
        // cookie-parser: cookieParser("KEY")
        pattern: /\bcookieParser\([ \t]{0,64}(["'`])([^"'`\n]{1,4096})\1/g,
        accept: (m) => signingKeyIsSecret(m[2]),
      },
      {
        // express-session / cookie-session / express-jwt / koa-jwt / passport-jwt options: session({ secret: "KEY" }), new JwtStrategy({ secretOrKey: "KEY" }, ...)
        pattern: /(?<![A-Za-z0-9_$])(["']?)(?:secret|secretOrKey|secretOrPrivateKey)\1[ \t]{0,16}:[ \t]{0,16}(["'`])([^"'`\n]{1,4096})\2/g,
        accept: (m) => inSigningOptions(m.input, m.index) && signingKeyIsSecret(m[3]),
      },
    ],
  },
  {
    id: 'hardcoded-secret-fallback',
    description:
      'process.env.<SECRET-like name> || "<literal>" in code, including env["X"], destructuring defaults, os.getenv("X", "<literal>") and the getter/default forms of other languages (C# ??, Kotlin ?:, Java getOrDefault / orElse, Ruby ENV.fetch, PHP ?:, Rust unwrap_or, Go if v == "") (a hardcoded default secret)',
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
        // process.env.NAME ?? `...` with a template literal that runs over lines (one line is read by the matcher above)
        pattern: new RegExp(
          String.raw`${ENV_ROOT}(?:\.([A-Za-z_$][A-Za-z0-9_$]{0,1023})|\[\s*(["'\x60])([^"'\x60\]\n]{1,1023})\2\s*\])\s*(?:\|\||\?\?)\s*(?=\x60)`,
          'g',
        ),
        accept: (m, ctx) => {
          if (!isSecretLikeName(m[1] ?? m[3])) return false;
          const at = m.index + m[0].length;
          const literal = callStringLiteral(m.input, at, ctx.path, ctx);
          if (literal === null || (literal.exhausted !== true && !literal.text.includes('\n'))) return false;
          m.spanEnd = literal.end;
          const read = callLiteralTexts(m, ctx, literal, at);
          if (read.verdict !== undefined) return read.verdict;
          return read.texts.some((text) => !text.includes('${'));
        },
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
      // The getter/default forms of the other languages (see ENV_GETTER and the section above it): the same finding, judged the same way.
      {
        // C# GetEnvironmentVariable("N") ?? "v", Kotlin System.getenv("N") ?: "v", Ruby ENV["N"] || "v", PHP $_ENV["N"] ?? "v", Python ... or "v"
        hint: ENV_GETTER_HINT,
        pattern: ENV_DEFAULT_OPERATOR,
        accept: (m, ctx) => (m.groups.op !== '//' || m.groups.getter.startsWith('$ENV')) && envDefaultIsSecret(m, ctx, m.index + m[0].length, { operator: true }),
      },
      {
        // Java getenv().getOrDefault("N", "v"), Ruby ENV.fetch("N", "v") / ENV.fetch("N") { "v" }, Scala, Elixir, Dart, Laravel env("N", "v"), getEnv helpers
        pattern: ENV_DEFAULT_ARGUMENT,
        accept: (m, ctx) =>
          (m.groups.block === undefined || /^ENV\.fetch$|getOrElse$/.test(m.groups.callee)) && envDefaultIsSecret(m, ctx, m.index + m[0].length),
      },
      {
        // Java Optional.ofNullable(System.getenv("N")).orElse("v"), Rust env::var("N").unwrap_or("v".into()) / .unwrap_or_else(|_| "v".to_string())
        hint: ENV_GETTER_HINT,
        pattern: ENV_DEFAULT_METHOD,
        accept: (m, ctx) => envDefaultIsSecret(m, ctx, m.index + m[0].length),
      },
      {
        // Java Objects.requireNonNullElse(System.getenv("N"), "v"), StringUtils.defaultIfBlank(...), MoreObjects.firstNonNull(...)
        hint: ENV_GETTER_HINT,
        pattern: ENV_DEFAULT_WRAPPER,
        accept: (m, ctx) => envDefaultIsSecret(m, ctx, m.index + m[0].length),
      },
      {
        // getter == null ? "v" : x, getter != null ? x : "v", C# getter is { } v ? v : "v"
        hint: ENV_GETTER_HINT,
        pattern: ENV_DEFAULT_TERNARY_TEST,
        accept: (m, ctx) => ternaryTestIsSecret(m, ctx),
      },
      {
        // System.getenv("N") != null ? System.getenv("N") : "v"
        hint: ENV_GETTER_HINT,
        pattern: ENV_DEFAULT_TERNARY_ELSE,
        accept: (m, ctx) => envDefaultIsSecret(m, ctx, m.index + m[0].length),
      },
      {
        // string.IsNullOrEmpty(Environment.GetEnvironmentVariable("N")) ? "v" : Environment.GetEnvironmentVariable("N")
        hint: ENV_GETTER_HINT,
        pattern: ENV_DEFAULT_TERNARY_THEN,
        accept: (m, ctx) => ternaryThenIsSecret(m, ctx),
      },
      {
        // Go: v := os.Getenv("N") ... if v == "" { v = "v" }
        appliesTo: (ctx) => /\.go$/i.test(ctx.path),
        pattern: ENV_GO_READ,
        accept: (m, ctx) => goEnvDefaultIsSecret(m, ctx),
      },
      {
        // Go: cmp.Or(os.Getenv("N"), "v")
        appliesTo: (ctx) => /\.go$/i.test(ctx.path),
        hint: /cmp\.Or/,
        pattern: GO_CMP_OR,
        accept: (m, ctx) => envDefaultIsSecret(m, ctx, m.index + m[0].length),
      },
      {
        // Go: if v := os.Getenv("N"); v != "" { return v } return "v"
        appliesTo: (ctx) => /\.go$/i.test(ctx.path),
        hint: /if[ \t]/,
        pattern: GO_IF_INIT_RETURN,
        accept: (m, ctx) => envDefaultIsSecret(m, ctx, m.index + m[0].length),
      },
      {
        // Rust: match env::var("N") { Ok(v) => v, Err(_) => "v".to_string() }
        appliesTo: (ctx) => /\.rs$/i.test(ctx.path),
        hint: /match/,
        pattern: RUST_ENV_MATCH,
        accept: (m, ctx) => envDefaultIsSecret(m, ctx, m.index + m[0].length),
      },
      {
        // Python: os.environ["N"] if "N" in os.environ else "v"
        appliesTo: (ctx) => /\.pyw?$/i.test(ctx.path),
        hint: ENV_GETTER_HINT,
        pattern: PY_ENV_CONDITIONAL,
        accept: (m, ctx) => envDefaultIsSecret(m, ctx, m.index + m[0].length),
      },
      {
        // Ruby: ENV.fetch "N", "v"
        hint: /ENV\.fetch/,
        pattern: RUBY_FETCH_BARE,
        accept: (m, ctx) => envDefaultIsSecret(m, ctx, m.index + m[0].length),
      },
      {
        // PowerShell: $env:N ?? 'v', if ($env:N) { $env:N } else { 'v' }
        appliesTo: (ctx) => /\.ps[md]?1$/i.test(ctx.path),
        hint: /\$env:/i,
        pattern: PS_ENV_DEFAULT,
        accept: (m, ctx) => envDefaultIsSecret(m, ctx, m.index + m[0].length, { operator: true }),
      },
      {
        appliesTo: (ctx) => /\.ps[md]?1$/i.test(ctx.path),
        hint: /\$env:/i,
        pattern: PS_ENV_IF_ELSE,
        accept: (m, ctx) => envDefaultIsSecret(m, ctx, m.index + m[0].length),
      },
      {
        // Java: Map<String, String> env = System.getenv(); ... env.getOrDefault("N", "v")
        hint: /System\.getenv\(\)/,
        pattern: JAVA_ENV_MAP_GET,
        accept: (m, ctx) => javaEnvMapVariables(ctx, m.input).has(m.groups.v) && envDefaultIsSecret(m, ctx, m.index + m[0].length),
      },
    ],
  },
  {
    id: 'private-jwk',
    description: 'JSON Web Key with private key material: d (EC, OKP, RSA), p/q/dp/dq/qi (RSA) or k (oct), as JSON, escaped JSON, YAML or an object literal',
    hint: /kty/,
    matchers: [
      {
        // Candidates: a private member name followed by a colon; accept() asks the per-file structural pass whether it sits in a JWK.
        pattern: /(?<![A-Za-z0-9_$])(?:dp|dq|qi|[dpqk])(?=\\{0,3}["']?[ \t]*:)/g,
        accept: (m, ctx) => {
          const end = privateJwkMembers(ctx, m.input).get(m.index);
          if (end === undefined) return false;
          m.spanEnd = end;
          return true;
        },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Public PEM blocks
// ---------------------------------------------------------------------------

// A public key or a certificate is verification material: it is committed on purpose (a JWT verification key, a CA bundle, a
// pinned server certificate), and its base64 body is as random-looking as any secret, so every name-based reader (YAML block
// scalars, heredocs, escaped JSON / dotenv strings, name/value pairs, ...) would report it under a secret-like name. Only these
// labels count. A PRIVATE KEY of any kind never matches (nothing in the alternation says PRIVATE), and it has a rule of its own.
const PUBLIC_PEM_BEGIN = '-----BEGIN ';
const PUBLIC_PEM_LABEL =
  /((?:RSA |EC |DSA )?PUBLIC KEY|(?:NEW )?CERTIFICATE REQUEST|(?:TRUSTED |X509 )?CERTIFICATE|X509 CRL|PGP PUBLIC KEY BLOCK)-----/y;
// Between the lines of a block: the line breaks private-key-block accepts (PEM_LINE_BREAK: real, escaped once or twice, \u000a, an XML
// character reference, a backslash line continuation) and blanks, plus the `", "` between the elements of a JSON or JS array that holds
// one line per element. Each repetition must consume a line break or a quoted comma, so the match stays linear.
const PUBLIC_PEM_SEPARATOR = new RegExp(String.raw`(?:[ \t]*(?:${PEM_LINE_BREAK}|["'][ \t]*,[ \t]*(?:\r?\n[ \t]*)?["']))+[ \t]*`, 'y');
// One body line: strict base64 ("/" may be written "\/", as PHP json_encode and org.json do). No headers (Proc-Type / DEK-Info belong
// to encrypted private keys), and padding ends the body. The two alternatives start with different characters (linear).
const PUBLIC_PEM_BODY_LINE = /(?:[A-Za-z0-9+]|\\?\/)+(={1,2})?/y;
// PGP armor: header lines ("Version: GnuPG v2") before the body, and a "=XXXX" CRC-24 line after it.
const PGP_ARMOR_HEADER = /[A-Za-z][A-Za-z-]{0,30}: [^\n\r\\"]{0,200}/y;
const PGP_CHECKSUM = /=[A-Za-z0-9+/]{4}/y;
// The smallest public key or certificate that exists: an Ed25519 / X25519 SubjectPublicKeyInfo is 44 bytes.
const MIN_PUBLIC_DER_BYTES = 44;

/** The first bytes of a base64 run (up to 6, from its first 8 characters), or null. */
const base64Head = (head) => (head.length < 4 ? null : [...Buffer.from(head.slice(0, head.length - (head.length % 4)), 'base64')]);

/**
 * Is a block body with this start (`head`, base64) and this many base64 characters (`chars`, padding left out) one complete
 * object of its kind? PEM: a DER SEQUENCE (first byte 0x30) whose encoded length is exactly the decoded body. PGP: one public-key
 * packet (tag 6, old or new format) that fits in the body. Either way at least MIN_PUBLIC_DER_BYTES. So a password dressed in
 * BEGIN / END lines (`-----BEGIN PUBLIC KEY-----\nMyS3cret...\n-----END PUBLIC KEY-----`) is not taken for a key.
 */
function publicBodyIsWhole(head, chars, pgp) {
  const decoded = Math.floor((chars * 6) / 8);
  const b = base64Head(head);
  if (b === null || b.length < 2 || decoded < MIN_PUBLIC_DER_BYTES) return false;
  if (pgp) {
    if ((b[0] & 0x80) === 0) return false;
    if (b[0] & 0x40) {
      if ((b[0] & 0x3f) !== 6) return false;
      const len = b[1] < 192 ? b[1] + 2 : b[1] < 224 && b.length > 2 ? ((b[1] - 192) << 8) + b[2] + 192 + 3 : -1;
      return len > 0 && len <= decoded;
    }
    if (((b[0] >> 2) & 0x0f) !== 6) return false;
    const type = b[0] & 3;
    const len = type === 0 ? b[1] + 2 : type === 1 && b.length > 2 ? ((b[1] << 8) | b[2]) + 3 : -1;
    return len > 0 && len <= decoded;
  }
  if (b[0] !== 0x30) return false;
  let total = -1;
  if (b[1] < 0x80) total = 2 + b[1];
  else if (b[1] === 0x81 && b.length > 2) total = 3 + b[2];
  else if (b[1] === 0x82 && b.length > 3) total = 4 + ((b[2] << 8) | b[3]);
  else if (b[1] === 0x83 && b.length > 4) total = 5 + ((b[2] << 16) | (b[3] << 8) | b[4]);
  return total === decoded;
}

/**
 * Where the complete public PEM block that starts at `at` (a "-----BEGIN " index) ends: a public label, one or more base64 lines,
 * and the END line of the same label. Returns -1 for anything else: an unclosed block, another label at the end, a stray line
 * (a header, a non-base64 character, text after the padding), no body, or a body that is not one whole DER object of the length its
 * header states (see publicBodyIsWhole; every DER body starts with "M" in base64). PGP armor may carry header lines and ends with a
 * checksum line. The walk stops at the first character that is neither a separator nor base64, so it never passes another BEGIN line.
 */
function publicPemBlockEnd(text, at) {
  PUBLIC_PEM_LABEL.lastIndex = at + PUBLIC_PEM_BEGIN.length;
  const label = PUBLIC_PEM_LABEL.exec(text);
  if (label === null) return -1;
  const pgp = label[1] === 'PGP PUBLIC KEY BLOCK';
  const close = `-----END ${label[1]}-----`;
  let i = PUBLIC_PEM_LABEL.lastIndex;
  let lines = 0;
  let headers = 0;
  let padded = false;
  let head = '';
  let chars = 0;
  const separator = () => {
    PUBLIC_PEM_SEPARATOR.lastIndex = i;
    if (PUBLIC_PEM_SEPARATOR.exec(text) === null) return false;
    i = PUBLIC_PEM_SEPARATOR.lastIndex;
    return true;
  };
  for (;;) {
    if (!separator()) return -1;
    if (pgp && lines === 0) {
      PGP_ARMOR_HEADER.lastIndex = i;
      if (PGP_ARMOR_HEADER.exec(text) !== null) {
        if ((headers += 1) > 16) return -1;
        i = PGP_ARMOR_HEADER.lastIndex;
        continue;
      }
    }
    if (lines > 0 && pgp && text[i] === '=') {
      PGP_CHECKSUM.lastIndex = i;
      if (PGP_CHECKSUM.exec(text) === null) return -1;
      i = PGP_CHECKSUM.lastIndex;
      if (!separator() || !text.startsWith(close, i)) return -1;
      return publicBodyIsWhole(head, chars, true) ? i + close.length : -1;
    }
    if (lines > 0 && !pgp && text.startsWith(close, i)) return publicBodyIsWhole(head, chars, false) ? i + close.length : -1;
    if (padded) return -1;
    PUBLIC_PEM_BODY_LINE.lastIndex = i;
    const body = PUBLIC_PEM_BODY_LINE.exec(text);
    if (body === null || (lines === 0 && !(pgp ? /[mx]/ : /M/).test(body[0][0]))) return -1;
    const run = body[0].replace(/[\\=]/g, '');
    if (head.length < 8) head += run.slice(0, 8 - head.length);
    chars += run.length;
    lines += 1;
    padded = body[1] !== undefined;
    i = PUBLIC_PEM_BODY_LINE.lastIndex;
  }
}

/**
 * The text with every complete public PEM block (PUBLIC KEY, RSA PUBLIC KEY, CERTIFICATE, a certificate chain: see
 * publicPemBlockEnd) blanked, from its BEGIN marker to its END marker. Line breaks stay, and so do offsets and line numbers.
 * The name-based rules read this text, so a public key is not judged as a secret under any name (a YAML public_key block, a
 * JWT_SECRET variable that holds a PEM public key, a CA bundle in a k8s value); anything around the block (a password line after
 * it, text glued to an escaped block) is still judged. The shape rules (private-key-block, provider tokens, URL passwords) read
 * the original text. Linear: a failed attempt only walks separators and base64, which cannot hold the next BEGIN marker.
 */
export function blankPublicPemBlocks(text) {
  if (!text.includes(PUBLIC_PEM_BEGIN)) return text;
  const blank = (from, to) => text.slice(from, to).replace(/[^\r\n]+/g, (run) => ' '.repeat(run.length));
  // An escaped line break written next to a block ("\n-----BEGIN", "-----END ...-----\n" in a JSON or dotenv string) goes with it,
  // or unescaping would leave an "n" per block behind, and a chain would read as a long "n n n" value. Only blanks and \n / \r
  // escapes on the block's own line: a password next to the block is never touched.
  const isEscapedBreak = (i) => text[i] === '\\' && (text[i + 1] === 'n' || text[i + 1] === 'r');
  const pieces = [];
  let copied = 0;
  for (let at = text.indexOf(PUBLIC_PEM_BEGIN); at !== -1; ) {
    let end = publicPemBlockEnd(text, at);
    if (end === -1) {
      at = text.indexOf(PUBLIC_PEM_BEGIN, at + 1);
      continue;
    }
    let start = at;
    PUBLIC_PEM_SEPARATOR.lastIndex = copied;
    if (copied > 0 && PUBLIC_PEM_SEPARATOR.exec(text) !== null && PUBLIC_PEM_SEPARATOR.lastIndex === at) {
      start = copied; // the separator between two blocks of a chain, in any form a block line break may take
    } else {
      for (;;) {
        if (start > copied && (text[start - 1] === ' ' || text[start - 1] === '\t')) start -= 1;
        else if (start - 1 > copied && isEscapedBreak(start - 2)) start -= 2;
        else break;
      }
    }
    for (;;) {
      if (text[end] === ' ' || text[end] === '\t') end += 1;
      else if (isEscapedBreak(end)) end += 2;
      else break;
    }
    pieces.push(text.slice(copied, start), blank(start, end));
    copied = end;
    at = text.indexOf(PUBLIC_PEM_BEGIN, end);
  }
  if (copied === 0) return text;
  pieces.push(text.slice(copied));
  return pieces.join('');
}

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

/**
 * What each finding matched, kept apart from the finding itself so that no report, spread copy or serialisation of a finding can carry it.
 * Held in memory for the run, compared with `evidenceKey`, and never printed, logged or stored.
 */
const EVIDENCE = new WeakMap();
/** Identity of a finding inside one run: its rule and the two evidence strings, with a length prefix so they cannot run together. */
const evidenceKey = (finding) => {
  const [whole, value] = EVIDENCE.get(finding) ?? ['', ''];
  return `${finding.rule}\t${whole.length}\t${whole}${value}`;
};

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
    properties: isPropertiesPath(filePath),
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
  // Public keys and certificates are not judged as secrets by the name-based rules (see blankPublicPemBlocks). The rules flagged
  // `lockfile: true` are the shape rules (PEM private keys, provider-shaped tokens, URL passwords, webhook URLs): they never look
  // at a name, so they keep reading the original text, and a private key or a token stays a finding whatever name holds it. The
  // blanked text has the same length and line breaks, so ctx's line index and fences serve both; its look-behind (hasBefore) reads
  // the original text, which can only make a rule look at more, never less.
  const judged = lockfile ? text : blankPublicPemBlocks(text);
  for (const rule of RULES) {
    if (lockfile && !rule.lockfile) continue; // lockfiles: targeted rules only (see LOCKFILE_NAMES)
    if (rule.appliesTo && !rule.appliesTo(ctx)) continue;
    const input = rule.lockfile ? text : judged;
    // The name hint is a speed-up for ordinary files; a credential file is always scanned in full.
    if (rule.hint && !strict && !rule.hint.test(input)) continue;
    for (const matcher of rule.matchers) {
      if (matcher.appliesTo && !matcher.appliesTo(ctx)) continue;
      if (matcher.hint && !matcher.hint.test(input)) continue;
      for (const match of input.matchAll(matcher.pattern)) {
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
        // EVIDENCE lets --history and --range tell whether a merge result carries a match that one of its parents already had. It
        // is compared in memory during the run only (a Set of strings): no hash of it is made, and it is never printed, logged or stored.
        const matchEnd = match.spanEnd ?? match.index + match[0].length;
        const evidence = [text.slice(match.index, matchEnd), match.attrStart === undefined || match.attrCoarse ? '' : text.slice(match.attrStart, match.attrEnd ?? matchEnd)];
        const finding = { path: filePath, line, lastLine, valueFirst, valueLast, rule: rule.id };
        EVIDENCE.set(finding, evidence);
        findings.push(finding);
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

/**
 * Git object ids (as `git hash-object --no-filters` computes them, in the repository's own hash) of working-tree files, so the
 * scanner never hashes file content itself. One git process covers every file whose path can be sent on a line; a file
 * that cannot (newline, carriage return or a leading quote in its name) is hashed in its own process, streamed from an open
 * descriptor so a file over the size limit is never held in memory. A file git cannot hash is missing from the map, and
 * the caller then treats the index versions as differing, which is the safe direction.
 * @param {Buffer[]} absolutePaths
 * @returns {Map<string, string>} the path bytes as a latin1 string -> object id
 */
function hashWorkingFiles(root, absolutePaths) {
  const ids = new Map();
  const batch = [];
  const single = [];
  for (const absolute of absolutePaths) {
    if (absolute.includes(10) || absolute.includes(13) || absolute[0] === 34) single.push(absolute);
    else batch.push(absolute);
  }
  if (batch.length > 0) {
    const input = Buffer.concat(batch.flatMap((absolute) => [absolute, Buffer.from('\n')]));
    const run = spawnSync('git', ['hash-object', '--no-filters', '--stdin-paths'], { cwd: root, input, maxBuffer: 64 * 1024 * 1024 });
    const lines = run.error || run.status !== 0 ? [] : run.stdout.toString('latin1').split('\n');
    if (lines.length === batch.length + 1) batch.forEach((absolute, i) => ids.set(absolute.toString('latin1'), lines[i]));
    else single.push(...batch); // any doubt about the batch: hash each file on its own
  }
  for (const absolute of single) {
    let fd;
    try {
      fd = openSync(absolute, 'r');
      const run = spawnSync('git', ['hash-object', '--no-filters', '--stdin'], { cwd: root, stdio: [fd, 'pipe', 'pipe'] });
      const id = run.error || run.status !== 0 ? '' : run.stdout.toString('latin1').trim();
      if (id !== '') ids.set(absolute.toString('latin1'), id);
    } catch {
      // unreadable: left out of the map
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
  return ids;
}

/** The object id git gives to `bytes` stored as a blob ('' when git cannot say). */
function hashBytes(root, bytes) {
  const run = spawnSync('git', ['hash-object', '--no-filters', '--stdin'], { cwd: root, input: bytes, maxBuffer: 1024 * 1024 });
  return run.error || run.status !== 0 ? '' : run.stdout.toString('latin1').trim();
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
  const tracked = listTracked(root);
  const workingIds = hashWorkingFiles(root, tracked.flatMap(({ raw }) => {
    const absolute = Buffer.concat([rootBytes, Buffer.from(path.sep), raw]);
    try {
      return lstatSync(absolute).isFile() ? [absolute] : [];
    } catch {
      return [];
    }
  }));
  for (const { raw, objects } of tracked) {
    const file = displayPath(raw);
    // Only a gitlink (a submodule commit pointer, no content here) is skipped, and only its own stage: every other
    // stage of an unmerged path is a file and is scanned, whatever mode the gitlink stage has.
    const files = objects.filter((o) => o.mode !== '160000');
    if (files.length < objects.length) skip('submodule');
    if (files.length === 0) continue;
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
          const workingId = workingIds.get(absolute.toString('latin1')) ?? '';
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
    const workingId = workingIds.get(absolute.toString('latin1')) ?? hashBytes(root, bytes);
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
// A lockfile is scanned with single-line rules only (no name/value pairing) and one multi-line rule, the PEM private key block
// (private-key-block: its header, optional header fields and the key material are separate lines). So a bump that touches a big
// lockfile in many places must not drag hundreds of unchanged lines around every change into the text that is size-checked and
// scanned: it keeps HISTORY_LOCKFILE_CONTEXT, and the wider text window only where a `-----BEGIN` line makes a PEM block possible
// (see pemBoundary), which costs nothing for a lockfile without key material.
const HISTORY_LOCKFILE_CONTEXT = { lines: 2, chars: 0 };
const HISTORY_TEXT_CONTEXT = { lines: HISTORY_CONTEXT_LINES, chars: HISTORY_CONTEXT_CHARS };
const PEM_BOUNDARY = '-----BEGIN';
/** The unchanged lines that stay in front of an added line of a lockfile: the last few, or all from the nearest `-----BEGIN` line on. */
function lockfileLookbehind(recent) {
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    if (recent[i].includes(PEM_BOUNDARY)) return { held: recent.slice(Math.min(i, Math.max(recent.length - HISTORY_LOCKFILE_CONTEXT.lines, 0))), pem: true };
  }
  return { held: recent.slice(-HISTORY_LOCKFILE_CONTEXT.lines), pem: false };
}

/**
 * The first SNIFF_BYTES bytes of `path` as it is in `commit` (`git cat-file blob <commit>:<path>`), or null when git
 * cannot produce them. The read is bounded: spawnSync stops the child at SNIFF_BYTES, so a huge blob is never held.
 */
function blobHead(root, commit, filePath) {
  const run = spawnSync('git', ['cat-file', 'blob', filePath === null ? commit : `${commit}:${filePath}`], {
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

// ---------------------------------------------------------------------------
// Merge results
// ---------------------------------------------------------------------------

/** The object ids of a `parents <id> <id> ...` line (none for a root commit, which prints a trailing blank), or null for any other text. */
function parseParentsLine(line) {
  if (!line.startsWith('parents')) return null;
  const rest = line.slice('parents'.length);
  if (rest === '' || rest === ' ') return [];
  if (rest[0] !== ' ') return null;
  const ids = rest.slice(1).split(' ');
  if (ids[ids.length - 1] === '') ids.pop();
  return ids.every((id) => /^[0-9a-f]{40,64}$/.test(id)) ? ids : null;
}

const MERGE_BATCH = 25; // merge commits per `git diff-tree --stdin` call, so one call's output stays small
const ZERO_OBJECT = /^0+$/;

/**
 * `git diff-tree --stdin -m -r -z --no-renames --raw` output as { commit id -> one Map per parent, in parent order } where each Map
 * holds path (latin1 of its raw bytes) -> { raw, oldMode, newMode, oldOid, newOid, status } of the merge result against that parent.
 * A parent whose tree equals the merge result has no entries (git may print no group for it: the callers count the groups).
 */
function parseMergeDiffs(out) {
  const groups = new Map();
  let current = null;
  let start = 0;
  const next = () => {
    if (start >= out.length) return null;
    let end = out.indexOf(0, start);
    if (end === -1) end = out.length;
    const token = out.subarray(start, end);
    start = end + 1;
    return token;
  };
  for (let token = next(); token !== null; token = next()) {
    if (token.length === 0) continue;
    if (token[0] === 0x3a) {
      const meta = token.toString('latin1').slice(1).split(' ');
      const raw = next();
      if (meta.length !== 5 || raw === null || current === null) throw new Error('git diff-tree printed output this scanner cannot parse');
      current.set(raw.toString('latin1'), { raw: Buffer.from(raw), oldMode: meta[0], newMode: meta[1], oldOid: meta[2], newOid: meta[3], status: meta[4] });
    } else {
      const id = token.toString('latin1');
      if (!/^[0-9a-f]{40,64}$/.test(id)) throw new Error('git diff-tree printed output this scanner cannot parse');
      current = new Map();
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(current);
    }
  }
  return groups;
}

/** The first SNIFF_BYTES bytes of a blob given by object id, or null when git cannot produce them (see blobHead). */
function objectHead(root, oid) {
  return blobHead(root, oid, null);
}

/**
 * A merge can complete a credential that neither parent held: one parent adds `"name": "JWT_SECRET"`, the other adds a nearby
 * `"value": "..."`, or one adds a PEM header and the other its key material, and git merges both without a conflict. `git log --cc`
 * shows only lines that differ from EVERY parent, so it shows none of it. This looks at the merge RESULT instead: for each file
 * where the result differs from every parent (a file equal to one parent holds nothing that parent did not), it scans the result
 * and reports a finding only when no parent's version of that file has the same finding (same rule, same matched text, compared
 * by digest and never printed). A credential a parent already held is that parent's, reported wherever the parent's side is
 * scanned; blaming it on the merge would blame a branch for commits that come in from its base.
 * A merge result of the scanner's own test files (isScannerFixture) is left out like any other version of them, and counted.
 * @returns {{hits: Map<string, object>, oversize: number, oversizeLimits: Map<number, number>, unscanned: number, skipped: Record<string, number>}}
 */
function scanMergeResults(root, merges) {
  const hits = new Map();
  const oversizeLimits = new Map();
  let oversize = 0;
  let unscanned = 0;
  const skipped = {};
  for (let from = 0; from < merges.length; from += MERGE_BATCH) {
    const batch = merges.slice(from, from + MERGE_BATCH);
    const run = spawnSync('git', ['diff-tree', '--stdin', '-m', '-r', '-z', '--no-renames', '--raw'], {
      cwd: root,
      input: `${batch.map((m) => m.commit).join('\n')}\n`,
      maxBuffer: 1024 * 1024 * 1024,
    });
    if (run.error || run.status !== 0) throw new Error('git diff-tree failed while reading merge commits');
    const groups = parseMergeDiffs(run.stdout);
    const candidates = [];
    for (const { commit, parents } of batch) {
      const perParent = groups.get(commit) ?? [];
      if (perParent.length > parents.length) throw new Error('git diff-tree printed more parents than a merge has');
      if (perParent.length < parents.length) continue; // the result equals a parent's tree: nothing of it is new
      for (const [key, entry] of perParent[0]) {
        if (entry.status === 'D' || entry.newMode === '160000') continue;
        const others = perParent.map((group) => group.get(key));
        if (others.some((other) => other === undefined || other.status === 'D')) continue; // equal to a parent's version
        if (isScannerFixture(displayPath(entry.raw))) {
          skipped[SCANNER_FIXTURE_REASON] = (skipped[SCANNER_FIXTURE_REASON] ?? 0) + 1;
          continue;
        }
        candidates.push({
          commit,
          file: displayPath(entry.raw),
          oid: entry.newOid,
          parentOids: others.map((other) => (other.oldMode === '160000' || ZERO_OBJECT.test(other.oldOid) ? null : other.oldOid)),
        });
      }
    }
    if (candidates.length === 0) continue;
    const blobs = readIndexBlobs(root, [...new Set(candidates.map((c) => c.oid))]);
    for (const candidate of candidates) {
      const { commit, file } = candidate;
      const blob = blobs.get(candidate.oid);
      if (blob === undefined) {
        unscanned += 1;
        continue;
      }
      if (blob.bytes === null || blob.size > sizeLimit(file)) {
        const head = objectHead(root, candidate.oid);
        if (head !== null && isBinaryContent(head)) continue;
        oversize += 1;
        unscanned += 1;
        oversizeLimits.set(sizeLimit(file), (oversizeLimits.get(sizeLimit(file)) ?? 0) + 1);
        continue;
      }
      const text = decodeText(blob.bytes);
      if (text === null) continue;
      const found = scanRanges(file, text);
      if (found.length === 0) continue;
      // What the parents already had. A parent version that cannot be read or scanned contributes nothing, which reports more.
      const known = new Set();
      const parentBlobs = readIndexBlobs(root, [...new Set(candidate.parentOids.filter((oid) => oid !== null))]);
      for (const oid of candidate.parentOids) {
        const parentBlob = oid === null ? undefined : parentBlobs.get(oid);
        if (parentBlob === undefined || parentBlob.bytes === null || parentBlob.size > sizeLimit(file)) continue;
        const parentText = decodeText(parentBlob.bytes);
        if (parentText === null) continue;
        for (const finding of scanRanges(file, parentText)) known.add(evidenceKey(finding));
      }
      for (const finding of found) {
        if (known.has(evidenceKey(finding))) continue;
        const key = `${commit}\t${file}\t${finding.rule}`;
        const entry = hits.get(key) ?? { commit, path: file, rule: finding.rule, count: 0 };
        entry.count += 1;
        hits.set(key, entry);
      }
    }
  }
  return { hits, oversize, oversizeLimits, unscanned, skipped };
}

/**
 * Scan every commit reachable from any ref, reporting only matches that touch a line the commit ADDED.
 * Unchanged context lines are scanned together with the added ones (so multi-line rules can see the
 * name next to a new value) but a match made only of context lines belongs to an earlier commit.
 * Merge commits are shown as combined diffs (--cc), so only lines that the merge itself introduced
 * (conflict resolutions) are scanned; everything else was added by a parent and is reported there.
 * @returns {Promise<{hits: {commit: string, path: string, rule: string, count: number}[], commits: number, oversize: number, oversizeLimits: Map<number, number>, unscanned: number, skipped: Record<string, number>}>}
 * `unscanned` counts every file version whose added lines were not examined (oversize, or content git would not show).
 * `skipped` counts the file versions left out on purpose, as the tree scan does: a verified binary (see isBinaryContent, checked
 * on the version's own first 8 KB, so a binary asset over the size limit does not count as oversize) is `binary`; a version of
 * the scanner's own test files (see isScannerFixture) is `scanner-fixture`.
 * `revisions` selects the commits (default every ref; range mode passes `<head> --not <base>`, so the walk and the diffs
 * cost what the range holds, not what the repository holds); `stdinRevisions` are more of them, one per line, written to git's
 * standard input (`--stdin`) so that any number of them fits (an all-zero base subtracts every other branch tip as `^<id>`);
 * `maxCount` limits the walk (range mode with an all-zero base).
 */
async function scanHistory(root, { revisions = ['--all'], stdinRevisions = null, maxCount = null } = {}) {
  const child = spawn(
    'git',
    [
      '-c', 'core.quotepath=false',
      'log', ...(maxCount === null ? [] : [`--max-count=${maxCount}`]), ...(stdinRevisions === null ? [] : ['--stdin']),
      '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--text',
      // Explicit prefixes: the parser strips "b/" from each "+++ " line, and a user's diff.noprefix (or mnemonicPrefix /
      // srcPrefix / dstPrefix) would otherwise drop it, so that a real top-level b/ directory got stripped instead.
      '-p', '--cc', '--src-prefix=a/', '--dst-prefix=b/', `-U${HISTORY_CONTEXT}`, '--format=commit %H%nparents %P',
      ...revisions, '--',
    ],
    { cwd: root, stdio: [stdinRevisions === null ? 'ignore' : 'pipe', 'pipe', 'pipe'] },
  );
  if (stdinRevisions !== null) {
    child.stdin.on('error', () => {}); // a git that exits early reports through its status, not through EPIPE here
    child.stdin.end(stdinRevisions.map((r) => `${r}\n`).join(''));
  }
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
  // The context kept after an added line. A lockfile keeps little, unless the line is (or follows) a PEM boundary.
  const contextFor = (path, pem = false) => (isLockfile(path) && !pem ? HISTORY_LOCKFILE_CONTEXT : HISTORY_TEXT_CONTEXT);
  // Drop the oldest held context line while the rest still covers the window (enough lines AND enough characters), or
  // while what is held could not fit the file's size limit anyway (bounded memory, whatever the line lengths). A lockfile is held
  // to the text window too (lockfileLookbehind picks what it uses).
  const trimRecent = () => {
    const window = HISTORY_TEXT_CONTEXT;
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
    } else if (commit && file && addedAny && isScannerFixture(file)) {
      // The scanner's own test file (exact path, see isScannerFixture): left out by design whatever its size, counted and
      // named in the report, reviewed by hand. The path is matched, never the content, so no fixture value is ever judged.
      skipped[SCANNER_FIXTURE_REASON] = (skipped[SCANNER_FIXTURE_REASON] ?? 0) + 1;
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

  const merges = []; // { commit, parents } of every merge commit walked (see scanMergeResults)
  let expectParents = false;
  const onLine = (line) => {
    if (expectParents) {
      // The line after each `commit <id>` line is `parents <id>...` (the format asks for it). Anything else is not output this
      // parser understands: fail closed rather than guess which commits were merges.
      expectParents = false;
      const parentIds = parseParentsLine(line); // a root commit prints "parents " (a trailing blank)
      if (parentIds === null) throw new Error('git log printed a commit header this scanner cannot parse');
      if (parentIds.length > 1) merges.push({ commit, parents: parentIds });
      return;
    }
    if (/^commit [0-9a-f]{40,64}$/.test(line)) {
      flush();
      commit = line.slice(7);
      commits += 1;
      file = null;
      headerPath = null;
      inHunk = false;
      expectParents = true;
    } else if (/^diff --(?:git|cc|combined) /.test(line)) {
      flush();
      file = null;
      headerPath = diffHeaderPath(line);
      inHunk = false;
      parents = 1;
    } else if (!inHunk && line.startsWith('Binary files ')) {
      // git refused to show this version's content (for example above core.bigFileThreshold). Only a verified binary is
      // left out (counted, as the tree scan counts it); anything else, or a path this parser cannot name, is unscanned.
      if (headerPath !== null && isScannerFixture(headerPath)) skipped[SCANNER_FIXTURE_REASON] = (skipped[SCANNER_FIXTURE_REASON] ?? 0) + 1;
      else if (headerPath !== null && versionIsVerifiedBinary(root, commit, headerPath)) skipped.binary = (skipped.binary ?? 0) + 1;
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
        let held = recent;
        let pem = content.includes(PEM_BOUNDARY);
        if (isLockfile(file ?? '')) {
          const look = lockfileLookbehind(recent);
          if (look.held.length < recent.length) dropped = true;
          held = look.held;
          pem = pem || look.pem;
        }
        if (dropped && lines.length > 0) keep('');
        for (const line of held) keep(line);
        recent = [];
        recentChars = 0;
        dropped = false;
        keep(content);
        addedAny = true; // an added line that is over the limit on its own still makes this version unscanned
        if (!overflow) addedLines.add(lines.length);
        ({ lines: afterLines, chars: afterChars } = contextFor(file ?? '', pem));
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

  try {
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
  } catch (error) {
    child.kill();
    throw error;
  }

  const code = await exited;
  if (code !== 0) throw new Error(`git log failed with exit code ${code}${summarizeStderr(stderr)}`);
  // The merge results: what the combined diff cannot show (see scanMergeResults).
  const merged = scanMergeResults(root, merges);
  for (const [key, entry] of merged.hits) if (!hits.has(key)) hits.set(key, entry);
  for (const [limit, n] of merged.oversizeLimits) oversizeLimits.set(limit, (oversizeLimits.get(limit) ?? 0) + n);
  for (const [reason, n] of Object.entries(merged.skipped)) skipped[reason] = (skipped[reason] ?? 0) + n;
  return { hits: [...hits.values()], commits, oversize: oversize + merged.oversize, oversizeLimits, unscanned: unscanned + merged.unscanned, skipped };
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

/**
 * The one line that names the versions of the scanner's own test files a history or range scan left out (see isScannerFixture),
 * or an empty string when there were none. It is part of the report so the exemption is never silent.
 */
export function formatFixtureNote(skipped = {}) {
  const n = skipped[SCANNER_FIXTURE_REASON] ?? 0;
  if (n === 0) return '';
  return (
    `note: ${n} version${n === 1 ? '' : 's'} of the scanner's own test files (app/src/lib/__tests__/checkSecrets*.test.js) ` +
    `${n === 1 ? 'was' : 'were'} not scanned: they hold secret-shaped fixtures by design and are reviewed by hand (the tree scan still covers them).`
  );
}

/** Format history-scan hits: commit, path, rule and counts only. */
export function formatHistoryReport(hits, { commits = 0, shallow = false, oversize = 0, unscanned = oversize, label = '--history', oversizeLimits = undefined, skipped = {} } = {}) {
  const lines = [];
  const fixtureNote = formatFixtureNote(skipped);
  if (fixtureNote !== '') lines.push(fixtureNote, '');
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

// The most commits --range reads for an all-zero base (see newBranchRevisions). With no other branch to subtract, a new branch
// can stand for the whole repository; that is --history's job, and an unbounded walk would run into the CI step's timeout. A
// branch with more new commits than this exits 2 (incomplete), never "no hits", after reporting any hit in the newest ones.
const NEW_BRANCH_MAX_COMMITS = 2000;

const USAGE = `Usage: node scripts/check-secrets.mjs [--history | --range <base>..<head>]

  (no flags)  scan all git-tracked text files; exit 1 on any finding
  --history   scan added lines of every commit on every ref (owner-run, not for CI)
  --range     scan added lines of the commits reachable from <head> but not from <base> (what CI runs on a pull
              request or push: catches a secret committed and removed again inside the range). Needs full history:
              a shallow clone or a commit that is not present exits 2. An all-zero <base> (a new or recreated
              branch) scans the commits reachable from <head> and from no branch under refs/remotes/origin/ that
              does not contain <head> (a branch at or past <head> never hides it; with no other branch, every
              commit reachable from <head>); more than ${NEW_BRANCH_MAX_COMMITS} exits 2. Recreating a branch at exactly
              another branch's tip therefore re-audits its whole history: check known old hits by hand with
              --range <fork-point>..<head>.
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
 * The revisions an all-zero --range base stands for: <head>, minus the tip of every branch under refs/remotes/origin/ that does NOT
 * contain <head> (`git for-each-ref --no-contains`). A push that creates a branch, or deletes and recreates it, has no "before"
 * commit, and scanning only its tip would pass a value that an earlier pushed commit added and the tip removed: the tree is clean
 * and the range looks clean. What such a push introduced is what no older branch on the remote already holds. The clone cannot
 * tell a branch that existed before the push from one created with it or after it (pushed in the same `git push`, or before a
 * re-run): a branch that contains <head> (the pushed branch itself, origin/HEAD, a descendant such as a `next` branch built on the
 * new tip, or another branch at exactly <head>) may be one of those, so it never subtracts anything. Only branches that do not
 * reach <head> do, and they cannot hide <head> itself. The price is a fail-closed full walk when main is recreated at exactly
 * another branch's tip (`git push origin develop:main`): that re-audits everything reachable from it (capped, see runRange).
 * With no such branch at all (a first push, a clone of a one-branch repository, no `origin` remote) every commit reachable from
 * <head> is new. Leaving a ref out only ever widens the walk, so anything that is not a plain commit id (a ref at a tag or tree
 * object, a line this cannot parse) is left out. The tips go to git on standard input (`^<id>` lines), never on the command line,
 * so a remote with tens of thousands of branches cannot overflow the argument list.
 * @returns {{revisions: string[], stdinRevisions: string[], others: number}} the `git log` revisions (command line and standard
 * input), and how many other branch tips they subtract
 */
function newBranchRevisions(root, head) {
  const out = git(['for-each-ref', `--no-contains=${head}`, '--format=%(objecttype) %(objectname)', 'refs/remotes/origin/'], root).toString('utf8');
  const tips = new Set();
  for (const line of out.split('\n')) {
    const match = /^commit ([0-9a-f]{40}(?:[0-9a-f]{24})?)$/.exec(line);
    if (match && match[1] !== head) tips.add(match[1]);
  }
  return { revisions: [head], stdinRevisions: [...tips].map((tip) => `^${tip}`), others: tips.size };
}

/**
 * --range <base>..<head>: scan the added lines of the commits reachable from head and not from base (`git log head --not base`,
 * so base need not be an ancestor: a pull request is judged by what it adds, wherever its base has moved to). An all-zero base
 * (a new or recreated branch) stands for every other branch of origin (see newBranchRevisions), and that walk is capped at
 * NEW_BRANCH_MAX_COMMITS. Same reader as --history (added-line logic, split-pair context, lockfile rules, --cc for merges) and
 * the same fail-closed semantics: hits exit 1; an unresolvable revision, a shallow clone, an unscanned file version or a capped
 * walk exit 2; a range without commits is clean. The output holds commit short ids, paths, rule names and counts, never
 * matched text.
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
  // A normal base: what head has and base does not. An all-zero base: what no other branch of origin holds, counted first (one
  // past the cap, which is cheap) so that a walk cut at the cap is known to be cut and never reported as complete.
  let revisions = [head, '--not', base];
  let stdinRevisions = null;
  let others = 0;
  let truncated = false;
  if (newRef) {
    ({ revisions, stdinRevisions, others } = newBranchRevisions(root, head));
    const count = spawnSync('git', ['rev-list', '--count', `--max-count=${NEW_BRANCH_MAX_COMMITS + 1}`, '--stdin', ...revisions, '--'], {
      cwd: root,
      input: stdinRevisions.map((r) => `${r}\n`).join(''),
      maxBuffer: 1024 * 1024,
    });
    if (count.error || count.status !== 0) throw new Error('git rev-list failed while counting the commits new to this branch');
    const counted = count.stdout.toString('utf8').trim();
    if (!/^\d+$/.test(counted)) throw new Error('git rev-list printed a count this scanner cannot parse');
    truncated = Number(counted) > NEW_BRANCH_MAX_COMMITS;
  }
  const { hits, commits, oversize, oversizeLimits, unscanned, skipped } = await scanHistory(
    root,
    newRef ? { revisions, stdinRevisions, maxCount: NEW_BRANCH_MAX_COMMITS } : { revisions },
  );
  const plural = commits === 1 ? '' : 's';
  const headShort = printable(headRevision).slice(0, 12);
  const newWhat = others > 0 ? 'new to this branch (reachable from no older branch under refs/remotes/origin/)' : `reachable from ${headShort}`;
  let scope = `${commits} commit${plural} in ${baseRevision.slice(0, 12)}..${headShort}`;
  if (newRef) {
    scope =
      others > 0
        ? `${commits} commit${plural} new to this branch (reachable from ${headShort} and from none of the ${others} other branch tip${others === 1 ? '' : 's'} under refs/remotes/origin/ that do not contain it; the base is all zeros)`
        : `all ${commits} commit${plural} reachable from ${headShort} (the base is all zeros and no branch under refs/remotes/origin/ without ${headShort} is known)`;
  }
  const cut =
    `the base is all zeros and more than ${NEW_BRANCH_MAX_COMMITS} commits are ${newWhat}, so only the newest ${NEW_BRANCH_MAX_COMMITS} were scanned ` +
    '(NEW_BRANCH_MAX_COMMITS). Run --history for the whole history, or --range with the commit the branch was created from as <base>.';
  if (hits.length > 0) {
    stderr.write(`${formatHistoryReport(hits, { commits, oversize, oversizeLimits, unscanned, label: '--range', skipped })}\n`);
    if (truncated) stderr.write(`warning: ${cut}\n`);
    return 1;
  }
  // An audit that did not look at everything is never reported as clean.
  const gaps = [];
  if (unscanned > 0) gaps.push(describeUnscanned(unscanned, oversize, oversizeLimits));
  if (truncated) gaps.push(cut);
  const fixtureNote = formatFixtureNote(skipped);
  if (gaps.length > 0) {
    // The fixture exemption is named in every result, an incomplete one included.
    if (fixtureNote !== '') stderr.write(`${fixtureNote}\n`);
    stderr.write(`check-secrets --range: INCOMPLETE, not a clean result (${commits} commits read, nothing found in them).\n${gaps.map((g) => `  ${g}`).join('\n')}\n`);
    return 2;
  }
  if (fixtureNote !== '') stdout.write(`${fixtureNote}\n`);
  if (commits === 0) {
    // Never with an all-zero base: a subtracted branch does not contain <head>, so <head> itself is always walked.
    stdout.write(`check-secrets --range: no commits in ${baseRevision.slice(0, 12)}..${headShort}, nothing to scan\n`);
    return 0;
  }
  stdout.write(`check-secrets --range: no hits in ${scope}${skippedNote(skipped)}\n`);
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
        stderr.write(`${formatHistoryReport(hits, { commits, shallow, oversize, oversizeLimits, unscanned, skipped })}\n`);
        return 1;
      }
      // An audit that did not look at everything is never reported as clean.
      const gaps = [];
      if (unscanned > 0) gaps.push(describeUnscanned(unscanned, oversize, oversizeLimits));
      if (shallow) gaps.push('this is a shallow clone, so only part of the history was available. Run "git fetch --unshallow" or scan a full clone.');
      const fixtureNote = formatFixtureNote(skipped);
      if (gaps.length > 0) {
        if (fixtureNote !== '') stderr.write(`${fixtureNote}\n`);
        stderr.write(`check-secrets --history: INCOMPLETE, not a clean result (${commits} commits read, nothing found in them).\n${gaps.map((g) => `  ${g}`).join('\n')}\n`);
        return 2;
      }
      if (fixtureNote !== '') stdout.write(`${fixtureNote}\n`);
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
