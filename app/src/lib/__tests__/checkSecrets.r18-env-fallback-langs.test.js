/**
 * Tests for scripts/check-secrets.mjs, review round 18: hardcoded environment fallbacks outside JavaScript. A secret-like variable
 * read through another language's standard getter, with a literal default (C# `??`, Kotlin `?:`, Java getOrDefault / Optional.orElse /
 * ternaries, Go `if v == "" { v = ... }`, Ruby ENV.fetch / `||`, PHP `?:` / `??`, Rust unwrap_or, Python `or`, ...), is the same finding
 * as `process.env.<NAME> || "<literal>"` (rule hardcoded-secret-fallback), judged the same way.
 *
 * Every fake credential below is assembled at RUNTIME from pieces, so this file contains no secret-shaped literal and passes the
 * scanner itself. Do not paste a real credential here.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanText } from '../../../../scripts/check-secrets.mjs';

const HOSTILE_LIMIT_MS = 8000;
const SLOW_TEST_MS = 120_000;
const SLOW = { timeout: SLOW_TEST_MS };
const CHILD_KILL_MS = 100_000;

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '../../../..');
const SCANNER = path.join(REPO_ROOT, 'scripts', 'check-secrets.mjs');
const SCAN_MODULE_IMPORT = `import { scanText } from ${JSON.stringify(pathToFileURL(SCANNER).href)};`;

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
const hasGit = () => spawnSync('git', ['--version']).status === 0;
const RULE = 'hardcoded-secret-fallback';

describe('review round 18: environment fallbacks outside JavaScript', () => {
  const NAME = secretName('JWT_', 'SECRET');
  const TOKEN = secretName('API_', 'TOKEN');
  const PASSWORD = secretName('DB_', 'PASS', 'WORD');
  const value = randomString(23, 18001);
  const guessable = ['change', 'me'].join('');
  const fallbacks = (file, text) => scanText(file, text).filter((f) => f.rule === RULE);
  const count = (file, text) => scanText(file, text).length;

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
  describe('(1) every supported language: a literal default under a secret-like name is reported', () => {
    const cases = [
      // C#
      ['C# ??', 'Auth.cs', `var key = Environment.GetEnvironmentVariable("${NAME}") ?? "${value}";\n`],
      ['C# ?? with a target argument', 'Auth.cs', `var key = Environment.GetEnvironmentVariable("${NAME}", EnvironmentVariableTarget.User) ?? "${value}";\n`],
      ['C# System.Environment ?? on the next line', 'Auth.cs', `var key = System.Environment.GetEnvironmentVariable("${NAME}") ??\n    "${value}";\n`],
      ['C# ?? verbatim string', 'Auth.cs', `var key = Environment.GetEnvironmentVariable("${NAME}") ?? @"${value}";\n`],
      ['C# ternary, getter in both condition and else', 'Auth.cs', `var key = Environment.GetEnvironmentVariable("${NAME}") != null ? Environment.GetEnvironmentVariable("${NAME}") : "${value}";\n`],
      ['C# ternary, IsNullOrEmpty then literal', 'Auth.cs', `var key = string.IsNullOrEmpty(Environment.GetEnvironmentVariable("${NAME}")) ? "${value}" : Environment.GetEnvironmentVariable("${NAME}");\n`],
      ['C# ternary, is { } pattern', 'Auth.cs', `var key = Environment.GetEnvironmentVariable("${NAME}") is { } v ? v : "${value}";\n`],
      ['C# ternary, == null then literal', 'Auth.cs', `var key = Environment.GetEnvironmentVariable("${NAME}") == null ? "${value}" : cached;\n`],
      // Java
      ['Java getOrDefault', 'Auth.java', `String key = System.getenv().getOrDefault("${NAME}", "${value}");\n`],
      ['Java getOrDefault over several lines', 'Auth.java', `String key = System.getenv().getOrDefault(\n    "${NAME}",\n    "${value}");\n`],
      ['Java ternary', 'Auth.java', `String key = System.getenv("${TOKEN}") != null ? System.getenv("${TOKEN}") : "${value}";\n`],
      ['Java ternary with .trim()', 'Auth.java', `String key = System.getenv("${TOKEN}") != null ? System.getenv("${TOKEN}").trim() : "${value}";\n`],
      ['Java Optional.orElse', 'Auth.java', `String key = Optional.ofNullable(System.getenv("${PASSWORD}")).orElse("${value}");\n`],
      ['Java Optional.orElseGet lambda', 'Auth.java', `String key = Optional.ofNullable(System.getenv("${PASSWORD}")).orElseGet(() -> "${value}");\n`],
      ['Java Optional with adapters', 'Auth.java', `String key = Optional.ofNullable(System.getenv("${PASSWORD}")).map(String::trim).filter(s -> !s.isBlank()).orElse("${value}");\n`],
      ['Java Objects.requireNonNullElse', 'Auth.java', `String key = Objects.requireNonNullElse(System.getenv("${NAME}"), "${value}");\n`],
      ['Java StringUtils.defaultIfBlank', 'Auth.java', `String key = StringUtils.defaultIfBlank(System.getenv("${NAME}"), "${value}");\n`],
      // Kotlin / Groovy / Scala
      ['Kotlin ?:', 'Auth.kt', `val key = System.getenv("${NAME}") ?: "${value}"\n`],
      ['Kotlin map index ?:', 'Auth.kt', `val key = System.getenv()["${NAME}"] ?: "${value}"\n`],
      ['Kotlin getOrElse block', 'Auth.kt', `val key = System.getenv().getOrElse("${NAME}") { "${value}" }\n`],
      ['Kotlin raw string', 'Auth.kts', `val key = System.getenv("${NAME}") ?: """${value}"""\n`],
      ['Groovy ?:', 'build.groovy', `def key = System.getenv('${NAME}') ?: '${value}'\n`],
      ['Scala sys.env.getOrElse', 'Auth.scala', `val key = sys.env.getOrElse("${NAME}", "${value}")\n`],
      ['Scala Option getOrElse', 'Auth.scala', `val key = sys.env.get("${NAME}").getOrElse("${value}")\n`],
      ['Scala Properties.envOrElse', 'Auth.scala', `val key = scala.util.Properties.envOrElse("${NAME}", "${value}")\n`],
      // Go
      ['Go if v == ""', 'main.go', `k := os.Getenv("${NAME}")\nif k == "" {\n\tk = "${value}"\n}\n`],
      ['Go on one line', 'main.go', `k := os.Getenv("${NAME}"); if k == "" { k = "${value}" }\n`],
      ['Go "" == v and var', 'main.go', `var k string = os.Getenv("${NAME}")\nif "" == k {\n\tk = "${value}"\n}\n`],
      ['Go len(v) == 0', 'main.go', `k := os.Getenv("${NAME}")\nif len(k) == 0 {\n\tk = "${value}"\n}\n`],
      ['Go LookupEnv !ok, raw string', 'main.go', `k, ok := os.LookupEnv("${NAME}")\nif !ok {\n\tk = \`${value}\`\n}\n`],
      ['Go struct field', 'main.go', `cfg.Key = os.Getenv("${NAME}")\nif cfg.Key == "" {\n\tcfg.Key = "${value}"\n}\n`],
      ['Go getEnv helper', 'main.go', `k := getEnv("${NAME}", "${value}")\n`],
      // Ruby
      ['Ruby ENV.fetch with a default', 'auth.rb', `KEY = ENV.fetch("${NAME}", "${value}")\n`],
      ['Ruby ENV.fetch block', 'auth.rb', `KEY = ENV.fetch('${NAME}') { '${value}' }\n`],
      ['Ruby ENV.fetch block with a parameter', 'auth.rb', `KEY = ENV.fetch("${NAME}") { |name| "${value}" }\n`],
      ['Ruby ENV[] ||', 'auth.rb', `KEY = ENV["${TOKEN}"] || "${value}"\n`],
      ['Ruby ENV.fetch(nil) ||', 'auth.rb', `KEY = ENV.fetch("${TOKEN}", nil) || "${value}"\n`],
      ['Ruby or', 'auth.rb', `KEY = ENV["${TOKEN}"] or "${value}"\n`],
      // PHP
      ['PHP getenv ?:', 'auth.php', `<?php\n$key = getenv("${NAME}") ?: "${value}";\n`],
      ['PHP getenv(local_only) ?:', 'auth.php', `<?php\n$key = getenv('${NAME}', true) ?: '${value}';\n`],
      ['PHP $_ENV ??', 'auth.php', `<?php\n$key = $_ENV["${TOKEN}"] ?? "${value}";\n`],
      ['PHP $_SERVER ??', 'auth.php', `<?php\n$key = $_SERVER['${TOKEN}'] ?? '${value}';\n`],
      ['PHP single quotes do not interpolate', 'auth.php', `<?php\n$key = getenv('${NAME}') ?: '$a${value}';\n`],
      ['Laravel env()', 'config/auth.php', `<?php\nreturn ['jwt' => env('${NAME}', '${value}')];\n`],
      ['Laravel Env::get', 'config/auth.php', `<?php\n$key = Env::get('${NAME}', '${value}');\n`],
      // Rust
      ['Rust unwrap_or(.into())', 'main.rs', `let key = std::env::var("${NAME}").unwrap_or("${value}".into());\n`],
      ['Rust unwrap_or_else(|_| .to_string())', 'main.rs', `let key = env::var("${TOKEN}").unwrap_or_else(|_| "${value}".to_string());\n`],
      ['Rust unwrap_or_else(String::from)', 'main.rs', `let key = env::var("${TOKEN}").unwrap_or_else(|_| String::from("${value}"));\n`],
      ['Rust .ok().unwrap_or', 'main.rs', `let key = env::var("${TOKEN}").ok().unwrap_or("${value}".to_owned());\n`],
      ['Rust option_env!', 'main.rs', `const KEY: &str = option_env!("${NAME}").unwrap_or("${value}");\n`],
      ['Rust closure block over lines', 'main.rs', `let key = std::env::var("${NAME}")\n    .unwrap_or_else(|_| {\n        "${value}".to_string()\n    });\n`],
      ['Rust raw string', 'main.rs', `let key = env::var("${NAME}").unwrap_or(r#"${value}"#.into());\n`],
      // Python (the default argument was already read; or and default= are new)
      ['Python os.environ.get default', 'settings.py', `KEY = os.environ.get("${NAME}", "${value}")\n`],
      ['Python default= keyword', 'settings.py', `KEY = os.environ.get("${NAME}", default="${value}")\n`],
      ['Python or', 'settings.py', `KEY = os.getenv("${NAME}") or "${value}"\n`],
      ['Python os.environ[] or', 'settings.py', `KEY = os.environ["${NAME}"] or "${value}"\n`],
      // Others
      ['Elixir System.get_env/2', 'config/runtime.exs', `key = System.get_env("${NAME}", "${value}")\n`],
      ['Elixir ||', 'config/runtime.exs', `key = System.get_env("${NAME}") || "${value}"\n`],
      ['Perl defined-or', 'auth.pl', `my $key = $ENV{${NAME}} // '${value}';\n`],
      ['Perl ||', 'auth.pl', `my $key = $ENV{'${NAME}'} || "${value}";\n`],
      ['Lua or', 'auth.lua', `local key = os.getenv("${NAME}") or "${value}"\n`],
      ['Swift ??', 'Auth.swift', `let key = ProcessInfo.processInfo.environment["${NAME}"] ?? "${value}"\n`],
      ['Dart ??', 'auth.dart', `final key = Platform.environment['${NAME}'] ?? '${value}';\n`],
      ['Dart fromEnvironment defaultValue', 'auth.dart', `const key = String.fromEnvironment('${NAME}', defaultValue: '${value}');\n`],
      ['Deno ??', 'auth.ts', `const key = Deno.env.get("${NAME}") ?? "${value}";\n`],
      ['C getenv ?: (GNU)', 'auth.c', `const char *key = getenv("${NAME}") ?: "${value}";\n`],
    ];

    it.each(cases)('%s', (_label, file, text) => {
      expect(fallbacks(file, text).length).toBeGreaterThan(0);
    });

    it('reports on the line that reads the variable', () => {
      expect(fallbacks('Auth.cs', `class A {\n  string k = Environment.GetEnvironmentVariable("${NAME}") ?? "${value}";\n}\n`).map((f) => f.line)).toEqual([2]);
      expect(fallbacks('main.go', `package main\n\nfunc k() string {\n\tk := os.Getenv("${NAME}")\n\tif k == "" {\n\t\tk = "${value}"\n\t}\n\treturn k\n}\n`).map((f) => f.line)).toEqual([4]);
    });

    it('judges the default like the JavaScript branch: a guessable constant counts too', () => {
      expect(fallbacks('app.js', `const k = process.env.${NAME} || '${guessable}';\n`).length).toBe(1);
      for (const [file, text] of [
        ['Auth.cs', `var k = Environment.GetEnvironmentVariable("${NAME}") ?? "${guessable}";\n`],
        ['Auth.java', `String k = System.getenv().getOrDefault("${NAME}", "${guessable}");\n`],
        ['auth.rb', `K = ENV.fetch("${NAME}", "${guessable}")\n`],
        ['main.rs', `let k = env::var("${NAME}").unwrap_or("${guessable}".into());\n`],
        ['main.go', `k := os.Getenv("${NAME}")\nif k == "" {\n\tk = "${guessable}"\n}\n`],
      ]) {
        expect(fallbacks(file, text).length, file).toBe(1);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('(2) what is not a hardcoded default', () => {
    const cases = [
      // a name that is not secret-like
      ['C# non-secret name', 'Auth.cs', `var r = Environment.GetEnvironmentVariable("APP_REGION") ?? "${value}";\n`],
      ['Java non-secret name', 'Auth.java', `String r = System.getenv().getOrDefault("APP_REGION", "${value}");\n`],
      ['Go non-secret name', 'main.go', `r := os.Getenv("APP_REGION")\nif r == "" {\n\tr = "${value}"\n}\n`],
      ['Rust non-secret name', 'main.rs', `let r = std::env::var("APP_REGION").unwrap_or("${value}".into());\n`],
      ['Laravel non-secret name', 'config/app.php', `<?php\nreturn ['name' => env('APP_NAME', '${value}')];\n`],
      ['name held in a variable', 'Auth.cs', `var k = Environment.GetEnvironmentVariable(name) ?? "${value}";\n`],
      // a default that is not a literal
      ['C# call', 'Auth.cs', `var k = Environment.GetEnvironmentVariable("${NAME}") ?? LoadSecret();\n`],
      ['C# throw', 'Auth.cs', `var k = Environment.GetEnvironmentVariable("${NAME}") ?? throw new InvalidOperationException("${NAME} is not set");\n`],
      ['Java variable', 'Auth.java', `String k = Optional.ofNullable(System.getenv("${PASSWORD}")).orElse(defaultPassword);\n`],
      ['Java orElseThrow', 'Auth.java', `String k = Optional.ofNullable(System.getenv("${PASSWORD}")).orElseThrow();\n`],
      ['Java ternary with a call', 'Auth.java', `String k = System.getenv("${TOKEN}") != null ? System.getenv("${TOKEN}") : fallbackToken();\n`],
      ['Java requireNonNullElse with a variable', 'Auth.java', `String k = Objects.requireNonNullElse(System.getenv("${NAME}"), fallback);\n`],
      ['Kotlin error()', 'Auth.kt', `val k = System.getenv("${NAME}") ?: error("${NAME} is not set")\n`],
      ['Go call', 'main.go', `k := os.Getenv("${NAME}")\nif k == "" {\n\tk = loadFromVault()\n}\n`],
      ['Ruby nil', 'auth.rb', `KEY = ENV.fetch("${NAME}", nil)\n`],
      ['Ruby raise block', 'auth.rb', `KEY = ENV.fetch("${TOKEN}") { raise "${TOKEN} is not set" }\n`],
      ['Ruby another variable', 'auth.rb', `KEY = ENV["${TOKEN}"] || ENV["LEGACY_KEY"]\n`],
      ['Ruby credentials', 'auth.rb', `KEY = ENV["${TOKEN}"] || Rails.application.credentials.api_token\n`],
      ['PHP null', 'auth.php', `<?php\n$k = getenv("${NAME}") ?: null;\n`],
      ['Rust unwrap_or_default', 'main.rs', `let k = std::env::var("${NAME}").unwrap_or_default();\n`],
      ['Rust closure call', 'main.rs', `let k = env::var("${TOKEN}").unwrap_or_else(|_| default_token());\n`],
      ['Rust panic!', 'main.rs', `let k = env::var("${TOKEN}").unwrap_or_else(|_| panic!("${TOKEN} is not set"));\n`],
      ['Rust expect', 'main.rs', `let k = env::var("${TOKEN}").expect("${TOKEN} must be set");\n`],
      ['Python call', 'settings.py', `KEY = os.environ.get("${NAME}") or load_secret()\n`],
      // an empty or interpolated default
      ['C# empty', 'Auth.cs', `var k = Environment.GetEnvironmentVariable("${NAME}") ?? "";\n`],
      ['PHP empty', 'auth.php', `<?php\n$k = $_ENV["${TOKEN}"] ?? '';\n`],
      ['C# interpolated', 'Auth.cs', `var k = Environment.GetEnvironmentVariable("${NAME}") ?? $"{Prefix}-{Suffix}";\n`],
      ['Kotlin ${} template', 'Auth.kt', `val k = System.getenv("${NAME}") ?: "\${prefix}-key"\n`],
      ['Kotlin $name template', 'Auth.kt', `val k = System.getenv("${NAME}") ?: "$fallbackSecret"\n`],
      ['Ruby #{} interpolation', 'auth.rb', `KEY = ENV["${TOKEN}"] || "#{prefix}-token"\n`],
      ['PHP {$} interpolation', 'auth.php', `<?php\n$k = $_ENV["${TOKEN}"] ?? "{$prefix}-token";\n`],
      ['PHP $name in double quotes', 'auth.php', `<?php\n$k = getenv('${NAME}') ?: "$fallback";\n`],
      ['Python f-string', 'settings.py', `KEY = os.getenv("${TOKEN}", f"{prefix}-token")\n`],
      ['Scala s-string', 'Auth.scala', `val k = sys.env.getOrElse("${NAME}", s"$base-x")\n`],
      ['Swift interpolation', 'Auth.swift', `let k = ProcessInfo.processInfo.environment["${NAME}"] ?? "\\(base)"\n`],
      ['Dart $name in single quotes', 'auth.dart', `final k = Platform.environment['${NAME}'] ?? '$base';\n`],
      ['Go empty assignment', 'main.go', `k := os.Getenv("${NAME}")\nif k == "" {\n\tk = ""\n}\n`],
      // a ternary whose literal branches are messages, not the variable's default
      ['ternary with two messages', 'Auth.cs', `var msg = Environment.GetEnvironmentVariable("${NAME}") != null ? "configured" : "missing";\n`],
      ['ternary on a negated test', 'Auth.java', `String msg = !(System.getenv("${NAME}") == null) ? "configured" : "missing";\n`],
      ['ternary unrelated to a getter', 'Auth.cs', `var msg = ok ? "configured" : "missing";\n`],
      // other shapes
      ['Go: the if tests for non-empty', 'main.go', `k := os.Getenv("${NAME}")\nif k != "" {\n\tk = "${value}"\n}\n`],
      ['Go: the default is too far below the read', 'main.go', `k := os.Getenv("${NAME}")\n${'\n'.repeat(12)}if k == "" {\n\tk = "${value}"\n}\n`],
      ['a method that sets a child process variable', 'main.rs', `Command::new("x").env("${TOKEN}", "${value}");\n`],
      ['a block after an if (getenv(...))', 'auth.c', `if (getenv("${NAME}")) { puts("${value}"); }\n`],
      ['a // comment after getenv', 'auth.c', `const char *k = getenv("${NAME}"); // "${value}" is the dev value\n`],
      ['the allow marker', 'Auth.cs', `var k = Environment.GetEnvironmentVariable("${NAME}") ?? "${value}"; // check-secrets:allow\n`],
      ['prose outside a code file', 'notes.md', `Environment.GetEnvironmentVariable("${NAME}") ?? "${value}"\n`],
    ];

    it.each(cases)('%s', (_label, file, text) => {
      expect(fallbacks(file, text)).toEqual([]);
    });

    it('a non-secret fallback in Go next to a variable named like a secret is still judged by secret-assignment alone', () => {
      // `secret = "..."` is an assignment to a secret-like name: that rule reports it whatever the fallback rule says.
      const text = `secret := os.Getenv("APP_REGION")\nif secret == "" {\n\tsecret = "${value}"\n}\n`;
      expect(scanText('main.go', text).map((f) => f.rule)).toEqual(['secret-assignment']);
    });

    it('leaves the JavaScript and Python branches as they were', () => {
      expect(fallbacks('app.js', `const k = process.env.${NAME} || '${value}';\n`).length).toBe(1);
      expect(fallbacks('app.js', `const k = process.env.${NAME} || '';\n`)).toEqual([]);
      expect(fallbacks('app.js', `const k = process.env.${NAME} || \`\${other}\`;\n`)).toEqual([]);
      expect(fallbacks('tools/db.py', `key = os.getenv("${NAME}", "${value}")\n`).length).toBe(1);
      expect(count('server/server.js', "const d = process.env.PORT || '3000';\n")).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('(3) the command line: tree and range scans', () => {
    const files = {
      'src/Auth.cs': `class A {\n  static string Key = Environment.GetEnvironmentVariable("${NAME}") ?? "${value}";\n}\n`,
      'src/Auth.java': `class A {\n  String k = System.getenv().getOrDefault("${NAME}", "${value}");\n}\n`,
      'src/main.go': `package main\n\nimport "os"\n\nfunc key() string {\n\tk := os.Getenv("${NAME}")\n\tif k == "" {\n\t\tk = "${value}"\n\t}\n\treturn k\n}\n`,
      'lib/auth.rb': `KEY = ENV.fetch("${NAME}", "${value}")\n`,
      'src/main.rs': `fn main() {\n    let k = std::env::var("${NAME}").unwrap_or("${value}".into());\n}\n`,
      'web/auth.php': `<?php\n$k = getenv("${NAME}") ?: "${value}";\n`,
    };

    it.skipIf(!hasGit())('the tree scan reports each file and never prints the value', SLOW, () => {
      const dir = makeRepo();
      commit(dir, files);
      const result = scan(dir);
      const output = result.stdout + result.stderr;
      expect(result.status, output).toBe(1);
      for (const [file, line] of [['src/Auth.cs', 2], ['src/Auth.java', 2], ['src/main.go', 6], ['lib/auth.rb', 1], ['src/main.rs', 2], ['web/auth.php', 2]]) {
        expect(output).toContain(`${file}:${line}  ${RULE}`);
      }
      expect(output).not.toContain(value);
      expect(output).not.toContain(value.slice(0, 8));
    });

    it.skipIf(!hasGit())('the range scan reports a fallback added by a commit, and a Go default added under an old read', SLOW, () => {
      const dir = makeRepo();
      const base = commit(dir, {
        'README.md': '# r18\n',
        'src/main.go': `package main\n\nimport "os"\n\nfunc key() string {\n\tk := os.Getenv("${NAME}")\n\treturn k\n}\n`,
      });
      commit(dir, {
        'src/Auth.cs': files['src/Auth.cs'],
        'src/main.go': `package main\n\nimport "os"\n\nfunc key() string {\n\tk := os.Getenv("${NAME}")\n\tif k == "" {\n\t\tk = "${value}"\n\t}\n\treturn k\n}\n`,
      });
      const result = scan(dir, '--range', `${base}..HEAD`);
      const output = result.stdout + result.stderr;
      expect(result.status, output).toBe(1);
      expect(output).toContain('src/Auth.cs');
      expect(output).toContain('src/main.go');
      expect(output).toContain(RULE);
      expect(output).not.toContain(value);
    });

    it.skipIf(!hasGit())('passes once each default is a reference instead of a literal', SLOW, () => {
      const dir = makeRepo();
      commit(dir, {
        'src/Auth.cs': `class A {\n  static string Key = Environment.GetEnvironmentVariable("${NAME}") ?? throw new InvalidOperationException("missing");\n}\n`,
        'src/main.go': `package main\n\nimport "os"\n\nfunc key() string {\n\tk := os.Getenv("${NAME}")\n\tif k == "" {\n\t\tpanic("missing")\n\t}\n\treturn k\n}\n`,
        'lib/auth.rb': `KEY = ENV.fetch("${NAME}")\n`,
        'src/main.rs': `fn main() {\n    let k = std::env::var("${NAME}").expect("missing");\n}\n`,
      });
      const result = scan(dir);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toContain('OK');
    });
  });

  // -------------------------------------------------------------------------
  describe('(4) hostile input stays linear', () => {
    it('scans large runs of getters with no default, open calls, chains and question marks quickly', SLOW, () => {
      const timings = timeInChild(`
        const N = ${JSON.stringify(NAME)};
        const size = 1_000_000;
        const fill = (unit) => unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
        const inputs = [
          ['a.cs', fill('Environment.GetEnvironmentVariable("' + N + '") ?? ')],
          ['a.java', fill('System.getenv("' + N + '"')],
          ['a.java', fill('getenv(' + ' '.repeat(60) + '"' + N + '"' + ' '.repeat(60))],
          ['a.java', fill('? x.y.z.getenv("' + N + '") ')],
          ['a.java', fill('System.getenv("' + N + '") != null ? aaaaaaaaaaaaaaaaaaaaaaa')],
          ['a.java', fill('Objects.requireNonNullElse(System.getenv("' + N + '"), ')],
          ['a.java', fill('? "a" : ')],
          ['a.rs', fill('env::var("' + N + '").map(a(b)).map(a(b)).map(a(b))')],
          ['a.rb', fill('ENV.fetch("' + N + '") { |' + 'a'.repeat(60))],
          ['a.php', fill("env('" + N + "', ")],
          ['a.pl', fill('$ENV{' + N + '} // ')],
          ['main.go', fill('k := os.Getenv("' + N + '")\\nif k == "" {\\n')],
        ];
        for (const [file, text] of inputs) {
          const t0 = performance.now();
          scanText(file, text);
          timings.push(performance.now() - t0);
        }
      `);
      for (const ms of timings) expect(ms).toBeLessThan(HOSTILE_LIMIT_MS);
    });
  });
});
