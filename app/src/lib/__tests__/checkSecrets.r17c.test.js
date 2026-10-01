/**
 * Tests for the private JSON Web Key rule (`private-jwk`) of scripts/check-secrets.mjs.
 *
 * Every fake key below is built at RUNTIME from random bytes, so this file contains no key-shaped literal and passes the
 * scanner itself. Do not paste a real key here.
 *
 * Test runner: Vitest (run via `cd app && npm test`)
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  RULES,
  formatReport,
  scanText,
} from "../../../../scripts/check-secrets.mjs";

const HOSTILE_LIMIT_MS = 8000;
const SLOW = { timeout: 120_000 };
const CHILD_KILL_MS = 100_000;

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), "../../../..");
const SCANNER = path.join(REPO_ROOT, "scripts", "check-secrets.mjs");
const SCAN_MODULE_IMPORT = `import { scanText } from ${JSON.stringify(pathToFileURL(SCANNER).href)};`;

/** Hostile scans run in a child process with a hard kill timeout (a backtracking regex would hang the worker). */
function timeInChild(body) {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `${SCAN_MODULE_IMPORT}\nconst timings = [];\n${body}\nconsole.log(JSON.stringify(timings));`,
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: CHILD_KILL_MS,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim().split("\n").pop());
}

const RULE = "private-jwk";
/** Fake base64url key material of `bytes` random bytes. */
const b64 = (bytes) => randomBytes(bytes).toString("base64url");
const KTY = ["k", "ty"].join("");
const jwkRules = (filePath, text) =>
  scanText(filePath, text).filter((f) => f.rule === RULE);
/** The 1-based line holding `needle`. */
const lineOf = (text, needle) =>
  text.split("\n").findIndex((l) => l.includes(needle)) + 1;
/** All 8-character windows of a secret: none may appear in a report. */
const windows = (secret) =>
  Array.from({ length: Math.max(secret.length - 7, 0) }, (_, i) =>
    secret.slice(i, i + 8),
  );

function expectDetected(filePath, text, secret) {
  const findings = jwkRules(filePath, text);
  expect(
    findings.map((f) => f.line),
    text.slice(0, 120),
  ).toContain(lineOf(text, secret));
  const report = formatReport(scanText(filePath, text));
  for (const piece of windows(secret)) expect(report).not.toContain(piece);
}

const expectClean = (filePath, text) =>
  expect(jwkRules(filePath, text), text.slice(0, 160)).toEqual([]);

describe("private-jwk: rule registration", () => {
  it("is in RULES", () => {
    expect(RULES.map((r) => r.id)).toContain(RULE);
  });
});

describe("private-jwk: private keys are reported on the private member line", () => {
  it("EC key as one JSON line", () => {
    const d = b64(32);
    expectDetected(
      "keys/ec.json",
      `{"${KTY}":"EC","crv":"P-256","x":"${b64(32)}","y":"${b64(32)}","d":"${d}"}\n`,
      d,
    );
  });

  it("OKP (Ed25519) key", () => {
    const d = b64(32);
    expectDetected(
      "keys/ed.json",
      `{"crv":"Ed25519","d":"${d}","${KTY}":"OKP","x":"${b64(32)}"}\n`,
      d,
    );
  });

  it("symmetric oct key", () => {
    const k = b64(32);
    expectDetected(
      "keys/hmac.json",
      `{"${KTY}":"oct","alg":"HS256","k":"${k}"}\n`,
      k,
    );
  });

  it.each(["d", "p", "q", "dp", "dq", "qi"])(
    "RSA private member %s alone",
    (member) => {
      const value = b64(128);
      const text = `{\n  "${KTY}": "RSA",\n  "n": "${b64(256)}",\n  "e": "AQAB",\n  "${member}": "${value}"\n}\n`;
      expectDetected("keys/rsa.json", text, value);
    },
  );

  it("full RSA key: each private member line is reported", () => {
    const members = ["d", "p", "q", "dp", "dq", "qi"].map((name) => [
      name,
      b64(128),
    ]);
    const text = [
      `{`,
      `  "${KTY}": "RSA",`,
      `  "n": "${b64(256)}",`,
      `  "e": "AQAB",`,
      ...members.map(([n, v]) => `  "${n}": "${v}",`),
      `  "use": "sig"`,
      `}`,
    ].join("\n");
    const lines = jwkRules("rsa.json", text).map((f) => f.line);
    expect(lines).toEqual(members.map(([, v]) => lineOf(text, v)));
  });

  it("private member before kty, pretty-printed", () => {
    const d = b64(32);
    expectDetected(
      "jwk.json",
      `{\n  "d": "${d}",\n  "crv": "P-256",\n  "x": "${b64(32)}",\n  "y": "${b64(32)}",\n  "${KTY}": "EC"\n}\n`,
      d,
    );
  });

  it("value on the line after the member name", () => {
    const d = b64(32);
    const text = `{ "${KTY}" : "EC",\n  "d" :\n    "${d}" }\n`;
    expect(jwkRules("jwk.json", text).map((f) => f.line)).toEqual([2]);
  });

  it("private key inside a JWKS keys array next to public keys", () => {
    const k = b64(32);
    const doc = {
      keys: [
        { [KTY]: "RSA", kid: "a", n: b64(256), e: "AQAB" },
        { [KTY]: "oct", kid: "b", k },
        { [KTY]: "EC", crv: "P-256", x: b64(32), y: b64(32) },
      ],
    };
    expectDetected("jwks.json", JSON.stringify(doc, null, 2), k);
    expectDetected("jwks.min.json", JSON.stringify(doc), k);
  });

  it("JSON escaped inside a string", () => {
    const d = b64(32);
    const inner = JSON.stringify({
      [KTY]: "EC",
      crv: "P-256",
      x: b64(32),
      y: b64(32),
      d,
    });
    expectDetected(
      "src/config.js",
      `export const KEY = ${JSON.stringify(inner)};\n`,
      d,
    );
    expectDetected("settings.json", JSON.stringify({ signingKey: inner }), d);
  });

  it("YAML block mapping", () => {
    const d = b64(32);
    expectDetected(
      "config/jwt.yml",
      `jwt:\n  key:\n    ${KTY}: EC\n    crv: P-256\n    x: ${b64(32)}\n    y: ${b64(32)}\n    d: ${d}\n  issuer: me\n`,
      d,
    );
  });

  it("YAML list items with quoted values", () => {
    const k = b64(32);
    const text = `keys:\n  - ${KTY}: RSA\n    n: ${b64(256)}\n    e: AQAB\n  - ${KTY}: "oct"\n    k: "${k}"\n`;
    expectDetected("jwks.yaml", text, k);
  });

  it("YAML flow mapping", () => {
    const d = b64(32);
    expectDetected(
      "k.yml",
      `key: {${KTY}: OKP, crv: X25519, x: ${b64(32)}, d: ${d}}\n`,
      d,
    );
  });

  it("JS object literal with unquoted keys", () => {
    const qi = b64(128);
    expectDetected(
      "src/key.js",
      `const key = {\n  ${KTY}: 'RSA',\n  n: '${b64(256)}',\n  e: 'AQAB',\n  qi: '${qi}',\n};\n`,
      qi,
    );
  });

  it("Python dict", () => {
    const k = b64(32);
    expectDetected("key.py", `KEY = {'${KTY}': 'oct', 'k': '${k}'}\n`, k);
  });

  it("JWK in a Markdown fenced block", () => {
    const d = b64(32);
    expectDetected(
      "docs/keys.md",
      `Our key:\n\n\`\`\`json\n{"${KTY}":"EC","crv":"P-256","d":"${d}"}\n\`\`\`\n`,
      d,
    );
  });

  it("unpadded and padded base64url both count", () => {
    const k = `${randomBytes(31).toString("base64")}`;
    expectDetected(
      "k.json",
      `{"${KTY}":"oct","k":"${k}"}\n`,
      k.replace(/=+$/, ""),
    );
  });

  it("the allow marker on the private member line silences the finding", () => {
    const marker = ["check-secrets", ":allow"].join("");
    expectClean(
      "k.js",
      `const key = {\n  ${KTY}: 'oct',\n  k: '${b64(32)}', // ${marker}\n};\n`,
    );
  });
});

describe("private-jwk: public keys and placeholders pass", () => {
  it("public EC, OKP and RSA keys", () => {
    expectClean(
      "ec.json",
      `{"${KTY}":"EC","crv":"P-256","x":"${b64(32)}","y":"${b64(32)}","use":"sig","kid":"1"}\n`,
    );
    expectClean(
      "ed.json",
      `{"${KTY}":"OKP","crv":"Ed25519","x":"${b64(32)}"}\n`,
    );
    expectClean(
      "rsa.json",
      `{"${KTY}":"RSA","n":"${b64(256)}","e":"AQAB","alg":"RS256"}\n`,
    );
  });

  it("public JWKS documents (pretty, minified, YAML)", () => {
    const doc = {
      keys: [
        {
          [KTY]: "RSA",
          use: "sig",
          kid: "r1",
          alg: "RS256",
          n: b64(256),
          e: "AQAB",
          x5c: [randomBytes(300).toString("base64")],
          x5t: b64(20),
        },
        {
          [KTY]: "EC",
          use: "sig",
          kid: "e1",
          crv: "P-384",
          x: b64(48),
          y: b64(48),
        },
        { [KTY]: "OKP", kid: "o1", crv: "Ed25519", x: b64(32) },
      ],
    };
    expectClean(".well-known/jwks.json", JSON.stringify(doc, null, 2));
    expectClean("jwks.json", JSON.stringify(doc));
    expectClean("jwks.js", `export default ${JSON.stringify(doc)};\n`);
    const yaml = doc.keys
      .map((key) =>
        Object.entries(key)
          .map(
            ([n, v], i) =>
              `${i === 0 ? "  - " : "    "}${n}: ${Array.isArray(v) ? `[${v[0]}]` : v}`,
          )
          .join("\n"),
      )
      .join("\n");
    expectClean("jwks.yml", `keys:\n${yaml}\n`);
  });

  it("private member names of another key type do not count", () => {
    expectClean(
      "a.json",
      `{"${KTY}":"EC","crv":"P-256","k":"${b64(32)}","p":"${b64(32)}"}\n`,
    );
    expectClean("b.json", `{"${KTY}":"oct","d":"${b64(32)}"}\n`);
    expectClean("c.json", `{"${KTY}":"OKP","dp":"${b64(32)}"}\n`);
  });

  it("objects without kty, or with an unknown kty", () => {
    expectClean(
      "a.json",
      `{"crv":"P-256","x":"${b64(32)}","d":"${b64(32)}"}\n`,
    );
    expectClean("b.json", `{"${KTY}":"XYZ","d":"${b64(32)}"}\n`);
    expectClean("c.json", `{"type":"EC","d":"${b64(32)}"}\n`);
  });

  it("a private member in a sibling or parent object does not count", () => {
    expectClean(
      "a.json",
      `{"meta":{"${KTY}":"EC","crv":"P-256","x":"${b64(32)}"},"d":"${b64(32)}"}\n`,
    );
    expectClean("b.json", `[{"${KTY}":"oct","kid":"1"},{"k":"${b64(32)}"}]\n`);
    expectClean(
      "c.yml",
      `jwk:\n  ${KTY}: EC\n  x: ${b64(32)}\nother:\n  d: ${b64(32)}\n`,
    );
  });

  it.each([
    ["angle-bracket placeholder", "<private-key>"],
    ["ellipsis", "..."],
    ["xxx", "xxx"],
    ["long xxx", "x".repeat(43)],
    ["template", "${JWK_D}"],
    ["moustache", "{{ jwk_d }}"],
    ["your-key-here", "your-private-key-here"],
    ["env reference", "process.env.JWK_D"],
    ["short value", "abc123"],
    ["word-like value", "privateKeyMaterialValue"],
    ["empty", ""],
  ])("placeholder: %s", (_, value) => {
    expectClean(
      "a.json",
      `{"${KTY}":"EC","crv":"P-256","x":"${b64(32)}","d":"${value}"}\n`,
    );
    expectClean("b.yml", `${KTY}: oct\nk: ${value}\n`);
    expectClean("c.js", `const k = { ${KTY}: 'oct', k: '${value}' };\n`);
  });

  it("JS code reading key members from variables", () => {
    expectClean(
      "src/jwk.js",
      `const jwk = { ${KTY}: 'EC', crv: 'P-256', x, y, d: privateScalar };\nconst k2 = { ${KTY}: 'oct', k: keyBytes.toString('base64url') };\n`,
    );
  });

  it("an object larger than the window is not read as one key", () => {
    const filler = Array.from(
      { length: 400 },
      (_, i) => `"f${i}":"${b64(30)}"`,
    ).join(",");
    expectClean("big.json", `{"${KTY}":"EC",${filler},"d":"${b64(32)}"}\n`);
  });
});

describe("private-jwk: hostile input stays linear", () => {
  it("scans adversarial inputs quickly", SLOW, () => {
    const timings = timeInChild(`
        const K = ['k', 'ty'].join('');
        const n = 400000;
        const cases = {
          openBraces: '{"' + K + '":"EC",'.repeat(1) + '{"d":"'.repeat(n / 6),
          unclosedValues: '{"' + K + '":"EC",' + '"d":"AAAAAAAAAAAAAAAAAAAA'.repeat(n / 22),
          manyKty: ('{"' + K + '":"oct","k":"x",').repeat(n / 22),
          manyMembers: '{"' + K + '":"RSA",' + '"d":"ab","p":"cd",'.repeat(n / 18) + '}',
          deepNesting: '{'.repeat(n) + '}'.repeat(n),
          yamlLines: (K + ': EC\\n  d: AAAA\\n- d: x\\n').repeat(n / 20),
          longLine: K + ': ' + 'A'.repeat(n * 4),
          escapes: ('\\\\\\\\"' + K + '\\\\\\\\":').repeat(n / 12),
          colons: ('d:' + K + ':').repeat(n / 6),
        };
        for (const [name, text] of Object.entries(cases)) {
          const t0 = performance.now();
          scanText('hostile.json', text);
          scanText('hostile.yml', text);
          scanText('hostile.js', text);
          timings.push([name, performance.now() - t0]);
        }
      `);
    for (const [name, ms] of timings)
      expect(ms, name).toBeLessThan(HOSTILE_LIMIT_MS);
  });
});

describe("private-jwk: tree scan", () => {
  it(
    "the CLI fails on a committed private JWK and never prints the key",
    SLOW,
    () => {
      const dir = mkdtempSync(path.join(tmpdir(), "jwk-"));
      try {
        const run = (args) =>
          spawnSync("git", args, { cwd: dir, encoding: "utf8" });
        run(["init", "-q"]);
        const d = b64(32);
        writeFileSync(
          path.join(dir, "public.json"),
          JSON.stringify(
            { keys: [{ [KTY]: "EC", crv: "P-256", x: b64(32), y: b64(32) }] },
            null,
            2,
          ),
        );
        writeFileSync(
          path.join(dir, "private.json"),
          JSON.stringify(
            { [KTY]: "EC", crv: "P-256", x: b64(32), y: b64(32), d },
            null,
            2,
          ),
        );
        run(["add", "."]);
        const result = spawnSync(process.execPath, [SCANNER], {
          cwd: dir,
          encoding: "utf8",
        });
        expect(result.status).toBe(1);
        const output = result.stdout + result.stderr;
        expect(output).toContain("private.json");
        expect(output).toContain(RULE);
        expect(output).not.toContain("public.json");
        for (const piece of windows(d)) expect(output).not.toContain(piece);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
