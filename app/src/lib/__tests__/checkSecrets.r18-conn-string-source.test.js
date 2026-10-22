/**
 * Tests for scripts/check-secrets.mjs, review round 18: passwords inside semicolon-delimited connection strings (ADO.NET, ODBC,
 * OLE DB, SQL Server JDBC) in source code and config files (rule `connection-string-password`).
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

function windows(secret, size = 8) {
  const out = [];
  for (let i = 0; i + size <= secret.length; i += 1) out.push(secret.slice(i, i + size));
  return out;
}

const hasGit = () => spawnSync('git', ['--version']).status === 0;
const RULE = 'connection-string-password';

describe('review round 18: connection-string passwords in source code and config', () => {
  const pw = randomString(23, 18001);
  // Short and word-like: under the 8-character minimum of a config value and not random-looking, still a password here.
  const short = ['Sa', '12345'].join('');
  // An ODBC braced value may hold `;`: the braces are read whole.
  const bracedPw = `${randomString(8, 18002)};${randomString(14, 18003)}`;
  const PW = ['Pass', 'word'].join('');
  const PWD = ['P', 'WD'].join('');
  const PASS = ['pa', 'ss'].join('');
  const ado = (value) => `Server=db;User Id=sa;${PW}=${value};`;
  const rules = (file, text) => scanText(file, text).map((f) => f.rule);

  const dirs = [];
  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
  });
  const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: SLOW_TEST_MS, maxBuffer: 64 * 1024 * 1024 });
  const scan = (cwd, ...args) => run(process.execPath, [SCANNER, ...args], cwd);
  const git = (cwd, ...args) => run('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], cwd);
  const makeRepo = () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'check-secrets-r18-conn-'));
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
  describe('reports a literal password field', () => {
    const cases = [
      // Source code: the case from the review, then the other languages and literal forms.
      ['C#, the finding as reported', 'Data/Db.cs', `var connectionString = "${ado(pw)}";\n`],
      ['C#, a short word-like password', 'Data/Db.cs', `var connectionString = "${ado(short)}";\n`],
      ['C# verbatim string', 'Data/Db.cs', `var cs = @"${ado(pw)}";\n`],
      ['C# interpolated string, literal password', 'Data/Db.cs', `var cs = $"Server={host};User Id=sa;${PW}=${pw};";\n`],
      ['C#, concatenated over two lines', 'Data/Db.cs', `var cs = "Server=db;User Id=sa;" +\n    "${PW}=${pw};";\n`],
      ['C#, Data Source and no trailing ;', 'Data/Db.cs', `using var c = new SqlConnection("Data Source=db;Initial Catalog=app;User ID=sa;${PW}=${pw}");\n`],
      ['C#, value in the other quote holding a ;', 'Data/Db.cs', `var cs = "Server=db;User Id=sa;${PW}='${bracedPw}';";\n`],
      ['C#, connection string in a comment', 'Data/Db.cs', `// ${ado(pw)}\n`],
      ['JavaScript, double quotes', 'src/db.js', `const connectionString = "${ado(pw)}";\n`],
      ['JavaScript, single quotes, short password', 'src/db.js', `const connectionString = '${ado(short)}';\n`],
      ['TypeScript, template literal', 'src/db.ts', `const cs = \`Server=\${host};User Id=sa;${PW}=${pw};\`;\n`],
      ['Python, ODBC PWD in braces', 'db.py', `conn = pyodbc.connect("DRIVER={ODBC Driver 18 for SQL Server};SERVER=db;UID=sa;${PWD}={${bracedPw}}")\n`],
      ['Python, lower-case pwd', 'db.py', `conn = pyodbc.connect('driver={SQL Server};server=db;uid=sa;${PWD.toLowerCase()}=${pw}')\n`],
      ['Python f-string, literal password', 'db.py', `cs = f"SERVER={host};UID=sa;${PWD}=${pw}"\n`],
      ['Python, implicit concatenation', 'db.py', `cs = (\n    "DRIVER={ODBC Driver 18 for SQL Server};"\n    "SERVER=db;UID=sa;"\n    "${PWD}=${pw}"\n)\n`],
      ['Java, SQL Server JDBC URL', 'src/main/java/Db.java', `String url = "jdbc:sqlserver://db:1433;databaseName=app;user=sa;${PW.toLowerCase()}=${pw};";\n`],
      ['Java, ADO-style string', 'src/main/java/Db.java', `String cs = "${ado(pw)}";\n`],
      ['Go', 'db.go', `dsn := "server=db;user id=sa;${PW.toLowerCase()}=${pw};database=app"\n`],
      ['PHP, pass key, concatenated with .', 'db.php', `$dsn = "Server=db;Database=app;" . "User=sa;${PASS}=${pw};";\n`],
      ['VB.NET, OLE DB Jet database password', 'Db.vb', `Dim cs = "Provider=Microsoft.Jet.OLEDB.4.0;Data Source=app.mdb;Jet OLEDB:Database ${PW}=${pw};"\n`],
      ['VB.NET, & _ continuation', 'Db.vb', `Dim cs = "Server=db;User Id=sa;" & _\n    "${PW}=${pw};"\n`],
      // Config files: the same field in each of their value forms.
      ['appsettings.json ConnectionStrings', 'appsettings.json', `{\n  "ConnectionStrings": {\n    "Default": "${ado(short)}"\n  }\n}\n`],
      ['appsettings.Production.json', 'src/Api/appsettings.Production.json', `{ "ConnectionStrings": { "Db": "${ado(pw)}" } }\n`],
      [
        'web.config <connectionStrings><add connectionString=...>',
        'web.config',
        `<configuration>\n  <connectionStrings>\n    <add name="Default" connectionString="Data Source=db;Initial Catalog=app;User ID=sa;${PW}=${short}" providerName="System.Data.SqlClient" />\n  </connectionStrings>\n</configuration>\n`,
      ],
      ['app.config, single-quoted attribute', 'App.config', `<add name='Db' connectionString='Server=db;Uid=sa;Pwd=${pw};' />\n`],
      ['XML element text', 'settings.xml', `<settings><connectionString>${ado(pw)}</connectionString></settings>\n`],
      ['.env value', '.env', `DB_CONNECTION=${ado(short)}\n`],
      ['.env value, quoted', '.env.production', `ConnectionStrings__Default="${ado(pw)}"\n`],
      ['.env value that opens with the password field', '.env', `DB_CONNECTION=${PW}=${pw};Server=db;User Id=sa\n`],
      ['YAML value', 'docker-compose.yml', `services:\n  api:\n    environment:\n      ConnectionStrings__Default: "${ado(short)}"\n`],
      ['YAML folded scalar, password on the next line', 'config.yaml', `db: >-\n  Server=db;User Id=sa;\n  ${PW}=${pw};\n`],
      ['Markdown note', 'docs/notes.md', `Production: \`${ado(pw)}\`\n`],
    ];

    it.each(cases)('%s', (_label, file, text) => {
      expect(rules(file, text)).toContain(RULE);
    });

    it('reports the line of the password field', () => {
      const text = `// db\nvar cs = "Server=db;User Id=sa;" +\n    "${PW}=${pw};";\n`;
      expect(scanText('Db.cs', text).filter((f) => f.rule === RULE).map((f) => f.line)).toEqual([3]);
    });

    it('an allow marker on the line silences it', () => {
      expect(rules('Db.cs', `var cs = "${ado(pw)}"; // check-secrets:allow\n`)).not.toContain(RULE);
    });
  });

  // -------------------------------------------------------------------------
  describe('passes placeholders, references and strings with no password', () => {
    const values = [
      '${DB_PASSWORD}',
      '<password>',
      '<your-password>',
      'xxxxxxxx',
      'your_password',
      'myPassword',
      'yourStrong(!)Password',
      '********',
      '$(DB_PASSWORD)',
      '%DB_PASSWORD%',
      '#{DbPassword}',
      '__DB_PASSWORD__',
      '%s',
      '{0}',
      '?',
      '',
      '$password',
    ];
    it.each(values.map((v) => [v]))('placeholder %j in C#, JS, Python, appsettings.json, web.config and .env', (value) => {
      expect(rules('Db.cs', `var cs = "${ado(value)}";\n`)).not.toContain(RULE);
      expect(rules('db.js', `const cs = '${ado(value)}';\n`)).not.toContain(RULE);
      expect(rules('db.py', `cs = "SERVER=db;UID=sa;${PWD}=${value}"\n`)).not.toContain(RULE);
      expect(rules('appsettings.json', `{ "ConnectionStrings": { "Default": "${ado(value)}" } }\n`)).not.toContain(RULE);
      expect(rules('web.config', `<add name="Db" connectionString="${ado(value)}" />\n`)).not.toContain(RULE);
      expect(rules('.env', `DB_CONNECTION=${ado(value)}\n`)).not.toContain(RULE);
    });

    it('an XML-escaped placeholder in web.config passes', () => {
      expect(rules('web.config', `<add name="Db" connectionString="${ado('&lt;password&gt;')}" />\n`)).not.toContain(RULE);
    });

    it.each([
      ['C# Integrated Security', 'Db.cs', 'var cs = "Server=db;Database=app;Integrated Security=true;";\n'],
      ['C# Trusted_Connection', 'Db.cs', 'var cs = "Server=db;Database=app;Trusted_Connection=True;Encrypt=True;";\n'],
      ['JS Integrated Security', 'db.js', "const cs = 'Data Source=db;Initial Catalog=app;Integrated Security=SSPI';\n"],
      ['Python Trusted_Connection', 'db.py', 'conn = pyodbc.connect("DRIVER={ODBC Driver 18 for SQL Server};SERVER=db;DATABASE=app;Trusted_Connection=yes")\n'],
      ['Java integratedSecurity', 'Db.java', 'String url = "jdbc:sqlserver://db:1433;databaseName=app;integratedSecurity=true;";\n'],
      ['appsettings.json Integrated Security', 'appsettings.json', '{ "ConnectionStrings": { "Default": "Server=db;Database=app;Integrated Security=true;" } }\n'],
      [
        'web.config Integrated Security',
        'web.config',
        '<connectionStrings><add name="Default" connectionString="Data Source=db;Initial Catalog=app;Integrated Security=True" /></connectionStrings>\n',
      ],
      ['.env Integrated Security', '.env', 'DB_CONNECTION=Server=db;Database=app;Integrated Security=true;\n'],
    ])('no password field: %s', (_label, file, text) => {
      expect(scanText(file, text)).toEqual([]);
    });

    it.each([
      ['C# interpolation', 'Db.cs', `var cs = $"Server=db;User Id=sa;${PW}={password};";\n`],
      ['C# verbatim interpolation', 'Db.cs', `var cs = $@"Server=db;User Id=sa;${PW}={cfg.DbSecret};";\n`],
      ['C# concatenation', 'Db.cs', `var cs = "Server=db;User Id=sa;${PW}=" + password + ";";\n`],
      ['C# String.Format slot', 'Db.cs', `var cs = String.Format("Server=db;User Id=sa;${PW}={0};", pw);\n`],
      ['JS template expression', 'db.js', `const cs = \`Server=db;User Id=sa;${PW}=\${process.env.DB_PASSWORD};\`;\n`],
      ['Python f-string', 'db.py', `cs = f"SERVER=db;UID=sa;${PWD}={pwd}"\n`],
      ['Python str.format on the line', 'db.py', `cs = "SERVER=db;UID=sa;${PWD}={conn.secret}".format(conn=c)\n`],
      ['Python str.format on the next line', 'db.py', `cs = ("SERVER=db;UID=sa;${PWD}={conn.secret}"\n      .format(conn=c))\n`],
      ['Python % formatting', 'db.py', `cs = "SERVER=db;UID=sa;${PWD}=%s" % pwd\n`],
      ['Java concatenation', 'Db.java', `String url = "jdbc:sqlserver://db;databaseName=app;user=sa;${PW.toLowerCase()}=" + pw + ";";\n`],
      ['Go Sprintf', 'db.go', `dsn := fmt.Sprintf("server=%s;user id=%s;${PW.toLowerCase()}=%v", h, u, p)\n`],
      ['Rust format! capture', 'db.rs', `let cs = format!("server=db;user id=sa;${PW.toLowerCase()}={pw}");\n`],
      ['Swift interpolation', 'Db.swift', `let cs = "Server=db;User Id=sa;${PW}=\\(secret);"\n`],
      ['PHP complex interpolation', 'db.php', `$cs = "Server=db;User Id=sa;${PW}={$secret};";\n`],
      ['Ruby interpolation', 'db.rb', `cs = "Server=db;User Id=sa;${PW}=#{secret};"\n`],
      ['Kotlin template', 'Db.kt', `val cs = "Server=db;User Id=sa;${PW}=$secret;"\n`],
    ])('a value filled in at run time: %s', (_label, file, text) => {
      expect(rules(file, text)).not.toContain(RULE);
    });

    it.each([
      ['a lone pass= in a ;-separated query', 'a.js', `const q = "page=2;sort=asc;${PASS}=${pw}";\n`],
      ['a test summary', 'a.js', 'const summary = "tests: pass=12;fail=0";\n'],
      ['minified code outside a string', 'bundle.min.js', `function c(e){var t;host=e.host;user=e.user;${PASS}=e.secret;port=e.port;return t}\n`],
      ['shell commands separated by ;', 'deploy.sh', `host=db; user=sa; ${PASS}=hunter\n`],
      ['a bare line of code', 'Db.cs', `x = 1; user = GetUser(); ${PW.toLowerCase()} = GetSecret();\n`],
    ])('not a connection string: %s', (_label, file, text) => {
      expect(rules(file, text)).not.toContain(RULE);
    });
  });

  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // Review round 19: doubled-quote values, concatenation and Join chains, a value in its own literal, literal braces in interpolated
  // strings, fields after `: ` / `>` / a comment marker / prose, SSIS / SSRS / data-link files, multi-line literals whose inner line is
  // the connection string, more keys; and template references, ARM concat, printf / Ruby / Python slots and log templates as FPs.
  describe('review round 19', () => {
    const BT = '`';
    const TRIPLE = '"'.repeat(3);
    const b64 = `${randomString(43, 19001)}=`;
    const REPORTED = [
      ['VB doubled quotes', 'Db.vb', `Dim cs = "Server=db;User Id=sa;${PW}=""${pw}"";"\n`],
      ['C# verbatim doubled quotes', 'Db.cs', `var cs = @"Data Source=db;User ID=sa;${PW}=""${pw}""";\n`],
      ['PowerShell doubled single quotes', 'db.ps1', `$cs = 'Server=db;User Id=sa;${PW}=''${pw}'';'\n`],
      ['concatenation through a piece with no key', 'Db.cs', `var cs = "Server=db;User Id=sa;" +\n "App=EntityFramework;" +\n "${PW}=${pw};";\n`],
      ['concatenation, the password piece opens with ;', 'Db.cs', `var cs = "Server=db;User Id=sa" + ";${PW}=${pw}";\n`],
      ['C# string.Join', 'Db.cs', `var cs = string.Join(";", "Server=db", "User Id=sa", "${PW}=${pw}");\n`],
      ['Python ";".join([...])', 'db.py', `cs = ";".join(["SERVER=db", "UID=sa", "${PWD}=${pw}"])\n`],
      ['JavaScript [...].join(";")', 'db.js', `const cs = ["Server=db", "User Id=sa", "${PW}=${pw}"].join(";");\n`],
      ['Python f-string with a literal-brace ODBC value', 'db.py', `cs = f"DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={host};UID=sa;${PWD}={{${pw}}}"\n`],
      ['C# interpolated string with a literal-brace value', 'Db.cs', `var cs = $"Server={host};User Id=sa;${PW}={{${pw}}};";\n`],
      ['YAML value led by the password', 'config.yml', `conn: ${PW}=${pw};Server=db;User Id=sa\n`],
      ['a // comment led by the password', 'Db.cs', `// ${PW}=${pw};Server=db;User Id=sa\nvar x = 1;\n`],
      ['Markdown prose', 'notes.md', `Prod: ${PW}=${pw};Server=db;User Id=sa\n`],
      ['properties with a colon', 'db.properties', `db.conn: ${PW}=${pw};Server=db;User Id=sa\n`],
      ['SSIS .dtsConfig element text', 'pkg.dtsConfig', `<DTSConfiguration>\n<Configuration><ConfiguredValue>Data Source=db;User ID=sa;${PW}=${pw};</ConfiguredValue></Configuration>\n</DTSConfiguration>\n`],
      ['SSRS .rds', 'Shared.rds', `<RptDataSource>\n<ConnectionProperties><ConnectString>Data Source=db;Initial Catalog=x;${PW}=${pw}</ConnectString></ConnectionProperties>\n</RptDataSource>\n`],
      ['SSRS .rdl', 'Report.rdl', `<Report>\n<ConnectString>Data Source=db;Initial Catalog=x;${PW}=${pw}</ConnectString>\n</Report>\n`],
      ['OLE DB .udl', 'conn.udl', `[oledb]\n; Everything after this line is an OLE DB initstring\nProvider=SQLOLEDB.1;${PW}=${pw};Persist Security Info=True;User ID=sa;Data Source=db\n`],
      ['the value in a literal of its own (C#)', 'Db.cs', `var cs = "Server=db;User Id=sa;${PW}=" + "${pw}" + ";";\n`],
      ['the value in an adjacent literal (Python)', 'db.py', `cs = ("SERVER=db;UID=sa;${PWD}=" "${pw}")\n`],
      ['Java text block', 'Db.java', `String cs = ${TRIPLE}\n    Server=db;User Id=sa;${PW}=${pw};\n    ${TRIPLE};\n`],
      ['C# raw literal', 'Db.cs', `var cs = ${TRIPLE}\n    Server=db;User Id=sa;${PW}=${pw};\n    ${TRIPLE};\n`],
      ['Kotlin raw string', 'Db.kt', `val cs = ${TRIPLE}\n    Server=db;User Id=sa;${PW}=${pw};\n    ${TRIPLE}\n`],
      ['Go raw string', 'db.go', `var cs = ${BT}\n    Server=db;User Id=sa;${PW}=${pw};\n${BT}\n`],
      ['JavaScript template over lines', 'db.js', `const cs = ${BT}\n    Server=db;User Id=sa;${PW}=${pw};\n${BT};\n`],
      ['Npgsql PSW', 'Db.cs', `var cs = "Host=db;Username=u;PSW=${pw}";\n`],
      ['JDBC keyStoreSecret', 'Db.java', `String u = "jdbc:sqlserver://db;user=sa;keyStoreSecret=${pw};";\n`],
      ['JDBC clientKeyPassword', 'Db.java', `String u = "jdbc:sqlserver://db;user=sa;clientKeyPassword=${pw};";\n`],
    ];
    it.each(REPORTED)('reports: %s', (_label, file, text) => {
      expect(rules(file, text)).toContain(RULE);
    });

    it('Azure SignalR AccessKey= and App Configuration Secret= are azure-storage-key findings', () => {
      expect(rules('a.json', `{"cs": "Endpoint=https://x.service.signalr.net;AccessKey=${b64};Version=1.0;"}\n`)).toContain('azure-storage-key');
      expect(rules('a.json', `{"cs": "Endpoint=https://x.azconfig.io;Id=AbCd-l0-s0:1a2b3c;Secret=${b64}"}\n`)).toContain('azure-storage-key');
    });

    const PASSED = [
      ['an Ansible / Jinja template', 'web.config.j2', `<add name="db" connectionString="Data Source={{ sql_host }};User ID={{ sql_user }};${PW}={{ sql_pw }}" />\n`],
      ['a Helm template', 'configmap.yaml', `data:\n  conn: "Server={{ .Values.db.host }};User Id=sa;${PW}={{ .Values.db.pw }};"\n`],
      ['cookiecutter', 'cookie.json', `{"cs": "Server=db;User Id=sa;${PW}={{ cookiecutter.db_password }}"}\n`],
      ['Mustache', 'conn.mustache', `Server=db;User Id=sa;${PW}={{password}}\n`],
      ['an ARM template concat', 'azuredeploy.json', `{"v": "[concat('Server=tcp:', parameters('server'), ';Initial Catalog=', parameters('db'), ';${PW}=', parameters('adminPassword'), ';Encrypt=True;')]"}\n`],
      ['Java positional printf', 'Db.java', `String cs = String.format("Server=%1$s;User Id=sa;${PW}=%2$s;", host, pw);\n`],
      ['PHP positional sprintf', 'db.php', `<?php $cs = sprintf("Server=db;User Id=sa;${PW}=%1$s;", $pw);\n`],
      ['C wide and starred printf slots', 'db.c', `swprintf(b, L"Server=db;User Id=sa;${PW}=%ls;", pw);\nsprintf(b, "Server=db;UID=sa;${PWD}=%.*s;", n, pw);\nsprintf(b, "Server=db;UID=sa;${PWD}=%-*s;", n, pw);\nsprintf(b, "Server=db;UID=sa;${PWD}=%hs;", pw);\n`],
      ['Ruby named format slots', 'db.rb', `cs = format("Server=db;User Id=sa;${PW}=%{pw};", pw: x)\ncs2 = format("Server=db;User Id=sa;${PW}=%<pw>s;", pw: x)\n`],
      ['Python conversion slots', 'fmt.py', `cs = "Server=db;UID=sa;${PWD}={0!s}".format(pw)\ncs2 = "Server=db;UID=sa;${PWD}={pw!r}".format(pw=pw)\n`],
      ['Serilog message templates', 'Log.cs', `Log.Debug("Server={Server};User Id={User};${PW}={Pw}", s, u, p);\nLog.Debug("Server={Server};User Id={User};${PW}={@Pw}", s, u, p);\n`],
      ['a .Replace template', 'Db.cs', `var cs = "Server={host};User Id=sa;${PW}={pw};".Replace("{pw}", pw);\n`],
      ['a JS .replace template', 'db.js', `const cs = "Server={host};User Id=sa;${PW}={pw};".replace('{pw}', pw);\n`],
      ['a YAML template value', 'tmpl.yaml', `conn_template: "Server={host};User Id=sa;${PW}={pw};"\n`],
      ['cmd delayed expansion', 'run.cmd', `echo "Server=db;User Id=sa;${PW}=!DB_SECRET!;"\n`],
      ['tokenizer markers', 'tok.config', `<add name="db" connectionString="Server=db;User Id=sa;${PW}=@@DbSecret@@;" />\n`],
      ['a space-separated list (dovecot) is no connection string', 'notes.txt.js', `const t = \`connect = host=db dbname=mail user=mail ${PW.toLowerCase()}=\${pw}\`;\n`],
    ];
    it.each(PASSED)('passes: %s', (_label, file, text) => {
      expect(rules(file, text)).not.toContain(RULE);
    });

    it('the new readers stay linear on hostile input', SLOW, () => {
      const timings = timeInChild(`
        const P = 'Pass' + 'word';
        const cases = {
          doubled: '"Server=db;' + (';' + P + '=""').repeat(150000),
          chain: ('"a=b;" + ').repeat(150000) + '"' + P + '=x"',
          join: 'string.Join(";", ' + ('"a=b", ').repeat(150000) + '"' + P + '=x")',
          ownLiteral: ('"Server=db;' + P + '=" + ').repeat(150000),
          template: '"Server=db;' + (';' + P + '={{').repeat(150000),
          blanks: ('conn: ' + P + '=x' + ' '.repeat(60)).repeat(30000),
          textBlock: '"""\\n' + ('Server=db;' + P + '=;\\n').repeat(100000),
          backticks: ('\`' + P + '=;Server=db\`\\n').repeat(100000),
        };
        for (const [name, text] of Object.entries(cases)) {
          for (const file of ['a.cs', 'a.py', 'a.js', 'A.java', 'a.yml']) {
            const start = performance.now();
            scanText(file, text);
            timings.push([name + ' ' + file, performance.now() - start]);
          }
        }
      `);
      for (const [label, ms] of timings) expect(ms, label).toBeLessThan(HOSTILE_LIMIT_MS);
    });

    it.skipIf(!hasGit())('the tree scan and --range report the new shapes and pass the templates', SLOW, () => {
      const dir = makeRepo();
      const base = commit(dir, { 'README.md': '# r19\n' });
      commit(dir, {
        'src/Db.vb': `Dim cs = "Server=db;User Id=sa;${PW}=""${pw}"";"\n`,
        'src/Concat.cs': `var cs = "Server=db;User Id=sa;" +\n "App=EntityFramework;" +\n "${PW}=${pw};";\n`,
        'src/Db.java': `String cs = ${TRIPLE}\n    Server=db;User Id=sa;${PW}=${pw};\n    ${TRIPLE};\n`,
        'ssis/pkg.dtsConfig': `<DTSConfiguration>\n<Configuration><ConfiguredValue>Data Source=db;User ID=sa;${PW}=${pw};</ConfiguredValue></Configuration>\n</DTSConfiguration>\n`,
        'deploy/web.config.j2': `<add name="db" connectionString="Data Source={{ sql_host }};User ID={{ sql_user }};${PW}={{ sql_pw }}" />\n`,
      });
      for (const args of [[], ['--range', `${base}..HEAD`]]) {
        const result = scan(dir, ...args);
        const output = `${result.stdout}\n${result.stderr}`;
        expect(result.status, output).toBe(1);
        for (const file of ['src/Db.vb', 'src/Concat.cs', 'src/Db.java', 'ssis/pkg.dtsConfig']) expect(output, file).toContain(file);
        expect(output).not.toContain('deploy/web.config.j2');
        for (const piece of windows(pw)) expect(output).not.toContain(piece);
      }
    });
  });

  it('a hostile file of password fields scans in linear time', SLOW, () => {
    const timings = timeInChild(`
      const P = 'Pass' + 'word';
      const cases = {
        fields: 'Server=db;' + (';' + P + '=').repeat(200000),
        placeholders: '"Server=db;' + (';' + P + '=' + 'x'.repeat(250)).repeat(15000),
        bracedOpen: 'Server=db;' + ';PWD={'.repeat(200000),
        quotes: '"Server=db;' + ("'" + P + '=a1').repeat(150000),
        alternating: ('"Server=x;' + P + '=;"' + P + '=').repeat(100000),
        concatenated: ('"' + P + '=" + ').repeat(200000),
        unclosedLiteral: 'x = "Server=db;' + ('\\\\"' + P + '=a1;').repeat(100000),
        manyLines: ('cs = "Server=db;' + P + '=;"\\n').repeat(100000),
        bareLines: ('Server=db;\\n' + P + '=\\n').repeat(100000),
        spaces: (';' + ' '.repeat(60) + P + ' '.repeat(60) + '=' + ' '.repeat(60)).repeat(30000),
        entities: '"Server=db;' + (';' + P + '=' + '&lt;'.repeat(60)).repeat(20000),
        commentLine: '// ' + ('user=' + P + '=;').repeat(200000),
      };
      for (const [name, text] of Object.entries(cases)) {
        for (const file of ['a.cs', 'a.py', 'a.env', 'web.config', 'a.md']) {
          const start = performance.now();
          scanText(file, text);
          timings.push([name + ' ' + file, performance.now() - start]);
        }
      }
    `);
    for (const [label, ms] of timings) expect(ms, label).toBeLessThan(HOSTILE_LIMIT_MS);
  });

  // -------------------------------------------------------------------------
  it.skipIf(!hasGit())('the tree scan and --range report source and config connection strings without printing the value', SLOW, () => {
    const dir = makeRepo();
    const base = commit(dir, { 'README.md': '# demo\n' });
    expect(scan(dir).status).toBe(0);
    commit(dir, {
      'Data/Db.cs': `var connectionString = "${ado(pw)}";\n`,
      'src/db.js': `const connectionString = "${ado(pw)}";\n`,
      'db.py': `conn = pyodbc.connect("DRIVER={ODBC Driver 18 for SQL Server};SERVER=db;UID=sa;${PWD}=${pw}")\n`,
      'Db.java': `String url = "jdbc:sqlserver://db:1433;databaseName=app;user=sa;${PW.toLowerCase()}=${pw};";\n`,
      'web.config': `<connectionStrings><add name="Db" connectionString="Data Source=db;User ID=sa;${PW}=${pw}" /></connectionStrings>\n`,
    });
    for (const args of [[], ['--range', `${base}..HEAD`]]) {
      const result = scan(dir, ...args);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status, output).toBe(1);
      for (const file of ['Data/Db.cs', 'src/db.js', 'db.py', 'Db.java', 'web.config']) expect(output).toContain(file);
      expect(output).toContain(RULE);
      for (const piece of windows(pw)) expect(output).not.toContain(piece);
    }
  });
});
