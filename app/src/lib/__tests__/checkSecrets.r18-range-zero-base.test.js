/**
 * Tests for scripts/check-secrets.mjs, review round 18: `--range <base>..<head>` with an all-zero base. A push that creates a
 * branch, or deletes and recreates it, has no "before" commit. Scanning only the tip passed a value that an earlier pushed
 * commit added and the tip removed (the tree is clean and the range looked clean). The scan now covers the commits that no
 * other branch under refs/remotes/origin/ holds, or every commit reachable from the head when there is no other branch, capped
 * at NEW_BRANCH_MAX_COMMITS (more exits 2).
 *
 * Every fake credential below is assembled at RUNTIME from pieces, so this file contains no secret-shaped literal and passes the
 * scanner itself. Do not paste a real credential here.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SLOW_TEST_MS = 120_000;
const SLOW = { timeout: SLOW_TEST_MS };

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '../../../..');
const SCANNER = path.join(REPO_ROOT, 'scripts', 'check-secrets.mjs');

// The scanner's NEW_BRANCH_MAX_COMMITS. Not exported on purpose: the tests pin the documented number.
const CAP = 2000;
const ZERO = '0'.repeat(40);

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

const secretName = (...parts) => parts.join('');
const hasGit = () => spawnSync('git', ['--version']).status === 0;

describe('review round 18: --range with an all-zero base (a new or recreated branch)', () => {
  const NAME = secretName('JWT_', 'SECRET');
  const value = randomString(24, 18001);
  const leak = `${NAME}=${value}\n`;
  const clean = `${NAME}=change-me\n`;

  const dirs = [];
  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
  });
  const run = (cmd, args, cwd, input = undefined) =>
    spawnSync(cmd, args, { cwd, input, encoding: 'utf8', timeout: SLOW_TEST_MS, maxBuffer: 64 * 1024 * 1024 });
  const scan = (cwd, ...args) => run(process.execPath, [SCANNER, ...args], cwd);
  const git = (cwd, ...args) => run('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], cwd);
  const tempDir = () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'check-secrets-r18-'));
    dirs.push(dir);
    return dir;
  };
  const makeRepo = () => {
    const dir = tempDir();
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
  const output = (result) => `${result.stdout}\n${result.stderr}`;
  const noValue = (result) => {
    for (const piece of windows(value)) expect(output(result)).not.toContain(piece);
  };

  // -------------------------------------------------------------------------
  it.skipIf(!hasGit())('a recreated branch: a key added in its commit 2 and removed in commit 3 is reported; commits other branches hold are not', SLOW, () => {
    // The remote: main already carries an old leak that was cleaned up (like a known leak in history), and a feature branch.
    const upstream = makeRepo();
    commit(upstream, { 'base.txt': 'base\n' });
    const oldLeak = commit(upstream, { 'old.env': leak });
    commit(upstream, { 'old.env': clean });
    expect(git(upstream, 'checkout', '-q', '-b', 'feature').status).toBe(0);
    commit(upstream, { 'f.txt': 'f\n' });
    // main is deleted and recreated with three new commits: the key arrives in the second and is gone in the third.
    expect(git(upstream, 'checkout', '-q', 'main').status).toBe(0);
    const c1 = commit(upstream, { 'one.txt': 'one\n' });
    const c2 = commit(upstream, { 'x.env': leak });
    const c3 = commit(upstream, { 'x.env': clean });

    // The CI runner: a full clone, where origin/main (and origin/HEAD) hold the pushed commit, as actions/checkout leaves them.
    const runner = tempDir();
    expect(run('git', ['clone', '-q', upstream, runner], tmpdir()).status).toBe(0);
    expect(git(runner, 'rev-parse', 'refs/remotes/origin/main').stdout.trim()).toBe(c3);
    expect(scan(runner).status).toBe(0); // the reported gap: the tree is clean

    const result = scan(runner, '--range', `${ZERO}..${c3}`);
    expect(result.status, output(result)).toBe(1);
    expect(result.stderr).toContain(`${c2.slice(0, 7)}  x.env  secret-assignment  x1`);
    // Exactly the three new commits were walked: origin/main is the pushed branch (compared by commit, so it does not hide
    // them), and the commits origin/feature already holds, the old leak among them, are not blamed on this push.
    expect(result.stderr).toContain('1 hit in 1 of 3 commits');
    expect(result.stderr).not.toContain(oldLeak.slice(0, 7));
    noValue(result);

    // A head that a branch of origin contains (here origin/main, which is past it) never hides it: only branches that do not reach
    // the head are subtracted, so c1 itself is walked (review round 19).
    const old = scan(runner, '--range', `${ZERO}..${c1}`);
    expect(old.status, output(old)).toBe(0);
    expect(old.stdout).toContain('no hits in 1 commit new to this branch');
  });

  // Review round 19: a branch that contains the head (pushed with it, before the checkout, or before a re-run) hid every pushed commit.
  const recreatedMain = () => {
    const upstream = makeRepo();
    commit(upstream, { 'base.txt': 'base\n' });
    expect(git(upstream, 'branch', 'feature').status).toBe(0);
    commit(upstream, { 'one.txt': 'one\n' });
    const c2 = commit(upstream, { 'x.env': leak });
    const c3 = commit(upstream, { 'x.env': clean });
    return { upstream, c2, c3 };
  };

  it.skipIf(!hasGit())('a descendant branch present at checkout (next at c4, a child of c3) does not hide the pushed commits', SLOW, () => {
    const { upstream, c2, c3 } = recreatedMain();
    expect(git(upstream, 'checkout', '-q', '-b', 'next').status).toBe(0);
    commit(upstream, { 'n.txt': 'n\n' });
    expect(git(upstream, 'checkout', '-q', 'main').status).toBe(0);
    const runner = tempDir();
    expect(run('git', ['clone', '-q', upstream, runner], tmpdir()).status).toBe(0);
    expect(git(runner, 'rev-parse', 'refs/remotes/origin/next^').stdout.trim()).toBe(c3);
    const result = scan(runner, '--range', `${ZERO}..${c3}`);
    expect(result.status, output(result)).toBe(1);
    expect(result.stderr).toContain(`${c2.slice(0, 7)}  x.env  secret-assignment  x1`);
    expect(output(result)).not.toContain('no new commits');
    noValue(result);
  });

  it.skipIf(!hasGit())('the same commits pushed in one multi-ref push (c3:main c4:next) are still scanned', SLOW, () => {
    const work = makeRepo();
    commit(work, { 'base.txt': 'base\n' });
    const bare = tempDir();
    expect(run('git', ['init', '-q', '--bare', '-b', 'main', bare], tmpdir()).status).toBe(0);
    expect(git(work, 'push', '-q', bare, 'main:main', 'main:feature').status).toBe(0);
    commit(work, { 'one.txt': 'one\n' });
    const c2 = commit(work, { 'x.env': leak });
    const c3 = commit(work, { 'x.env': clean });
    const c4 = commit(work, { 'n.txt': 'n\n' });
    expect(git(work, 'push', '-q', '-f', bare, `${c3}:refs/heads/main`, `${c4}:refs/heads/next`).status).toBe(0);
    const runner = tempDir();
    expect(run('git', ['clone', '-q', bare, runner], tmpdir()).status).toBe(0);
    const result = scan(runner, '--range', `${ZERO}..${c3}`);
    expect(result.status, output(result)).toBe(1);
    expect(result.stderr).toContain(`${c2.slice(0, 7)}  x.env  secret-assignment  x1`);
    noValue(result);
  });

  it.skipIf(!hasGit())('main recreated at exactly another branch tip (develop:main) re-audits the history, fail-closed', SLOW, () => {
    // Documented: an equal-tip branch may have been pushed with main, so it subtracts nothing; an old, cleaned leak is reported.
    const upstream = makeRepo();
    commit(upstream, { 'base.txt': 'base\n' });
    expect(git(upstream, 'branch', 'stale').status).toBe(0); // an older branch, from before the leak: it is subtracted
    const oldLeak = commit(upstream, { 'old.env': leak });
    const head = commit(upstream, { 'old.env': clean });
    expect(git(upstream, 'branch', 'develop').status).toBe(0);
    const runner = tempDir();
    expect(run('git', ['clone', '-q', upstream, runner], tmpdir()).status).toBe(0);
    expect(git(runner, 'rev-parse', 'refs/remotes/origin/develop').stdout.trim()).toBe(head);
    const result = scan(runner, '--range', `${ZERO}..${head}`);
    expect(result.status, output(result)).toBe(1);
    expect(result.stderr).toContain(`${oldLeak.slice(0, 7)}  old.env  secret-assignment  x1`);
    noValue(result);
    // With develop one commit ahead the result is the same: a branch past the head never hides it either.
    expect(git(upstream, 'checkout', '-q', 'develop').status).toBe(0);
    const ahead1 = commit(upstream, { 'd.txt': 'd\n' });
    expect(git(runner, 'fetch', '-q', 'origin').status).toBe(0);
    expect(git(runner, 'rev-parse', 'refs/remotes/origin/develop').stdout.trim()).toBe(ahead1);
    const ahead = scan(runner, '--range', `${ZERO}..${head}`);
    expect(ahead.status, output(ahead)).toBe(1);
    expect(ahead.stderr).toContain(`${oldLeak.slice(0, 7)}  old.env  secret-assignment  x1`);
    noValue(ahead);
  });

  it.skipIf(!hasGit())('tens of thousands of other branch tips do not overflow the argument list (they go to git on stdin)', SLOW, () => {
    const dir = makeRepo();
    const base = commit(dir, { 'base.txt': 'base\n' });
    // 50,000 distinct one-commit branches off base, written as packed refs (one fast-import run, then one packed-refs file).
    const N = 50000;
    let stream = '';
    for (let i = 1; i <= N; i += 1) {
      stream += `commit refs/tmp/x\nmark :${i}\ncommitter t <t@example.invalid> ${1700000000 + i} +0000\ndata 2\nc\nfrom ${base}\nM 100644 inline b.txt\ndata ${String(i).length + 1}\n${i}\n\n`;
    }
    const marks = path.join(tempDir(), 'marks');
    expect(run('git', ['fast-import', '--quiet', `--export-marks=${marks}`], dir, stream).status).toBe(0);
    const ids = run('cat', [marks], dir).stdout.trim().split('\n').map((line) => line.split(' ')[1]);
    expect(ids).toHaveLength(N);
    const packed = ['# pack-refs with: peeled fully-peeled sorted ', ...ids.map((id, i) => `${id} refs/remotes/origin/b${String(i).padStart(6, '0')}`)];
    writeFileSync(path.join(dir, '.git', 'packed-refs'), `${packed.join('\n')}\n`);
    expect(git(dir, 'update-ref', '-d', 'refs/tmp/x').status).toBe(0);
    commit(dir, { 'one.txt': 'one\n' });
    const c2 = commit(dir, { 'x.env': leak });
    const c3 = commit(dir, { 'x.env': clean });
    const result = scan(dir, '--range', `${ZERO}..${c3}`);
    expect(result.status, output(result)).toBe(1);
    expect(result.stderr).toContain(`${c2.slice(0, 7)}  x.env  secret-assignment  x1`);
    expect(result.stderr).toContain('1 hit in 1 of 3 commits');
    expect(output(result)).not.toContain('rev-list failed');
  });

  it.skipIf(!hasGit())('a recreated branch without a leak passes and names what it scanned', SLOW, () => {
    const upstream = makeRepo();
    commit(upstream, { 'base.txt': 'base\n' });
    commit(upstream, { 'old.env': leak });
    commit(upstream, { 'old.env': clean });
    expect(git(upstream, 'branch', 'feature').status).toBe(0);
    commit(upstream, { 'one.txt': 'one\n' });
    const head = commit(upstream, { 'two.txt': 'two\n' });
    const runner = tempDir();
    expect(run('git', ['clone', '-q', upstream, runner], tmpdir()).status).toBe(0);
    const result = scan(runner, '--range', `${ZERO}..${head}`);
    expect(result.status, output(result)).toBe(0);
    expect(result.stdout).toContain('no hits in 2 commits new to this branch');
    expect(result.stdout).toContain('refs/remotes/origin/');
  });

  it.skipIf(!hasGit())('a fresh repository with no other branch: every commit reachable from the head is scanned', SLOW, () => {
    const dir = makeRepo();
    commit(dir, { 'one.txt': 'one\n' });
    const c2 = commit(dir, { 'x.env': leak });
    const c3 = commit(dir, { 'x.env': clean });
    expect(scan(dir).status).toBe(0);
    const result = scan(dir, '--range', `${ZERO}..${c3}`);
    expect(result.status, output(result)).toBe(1);
    expect(result.stderr).toContain(`${c2.slice(0, 7)}  x.env  secret-assignment  x1`);
    expect(result.stderr).toContain('1 hit in 1 of 3 commits');
    noValue(result);

    // Refs that cannot stand for "already on the remote" hide nothing: another remote's branch, and a remote-tracking ref at
    // an object that is not a commit (left out, which only widens the walk; never a git error).
    expect(git(dir, 'update-ref', 'refs/remotes/upstream/main', c3).status).toBe(0);
    const tree = git(dir, 'rev-parse', `${c3}^{tree}`).stdout.trim();
    expect(git(dir, 'update-ref', 'refs/remotes/origin/odd', tree).status).toBe(0);
    const again = scan(dir, '--range', `${ZERO}..${c3}`);
    expect(again.status, output(again)).toBe(1);
    expect(again.stderr).toContain('1 hit in 1 of 3 commits');

    const cleanDir = makeRepo();
    commit(cleanDir, { 'one.txt': 'one\n' });
    commit(cleanDir, { 'two.txt': 'two\n' });
    const cleanHead = commit(cleanDir, { 'x.env': clean });
    const ok = scan(cleanDir, '--range', `${ZERO}..${cleanHead}`);
    expect(ok.status, output(ok)).toBe(0);
    expect(ok.stdout).toContain('no hits in all 3 commits reachable from');
  });

  it.skipIf(!hasGit())(`more than ${CAP} new commits exits 2 (incomplete), never "no hits"; a hit in the newest ones is still reported`, SLOW, () => {
    const dir = makeRepo();
    // CAP + 1 commits in one fast-import run (a commit per git process would take minutes).
    let stream = '';
    for (let i = 1; i <= CAP + 1; i += 1) {
      const body = `line ${i}\n`;
      stream += `commit refs/heads/main\ncommitter t <t@example.invalid> ${1700000000 + i} +0000\ndata 2\nc\n`;
      stream += `M 100644 inline n.txt\ndata ${Buffer.byteLength(body)}\n${body}\n`;
    }
    expect(run('git', ['fast-import', '--quiet'], dir, stream).status).toBe(0);
    expect(git(dir, 'checkout', '-q', '-f', 'main').status).toBe(0);
    expect(git(dir, 'rev-list', '--count', 'HEAD').stdout.trim()).toBe(String(CAP + 1));
    const head = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    const over = scan(dir, '--range', `${ZERO}..${head}`);
    expect(over.status, output(over)).toBe(2);
    expect(over.stderr).toContain('INCOMPLETE');
    expect(over.stderr).toContain(`${CAP} commits read`);
    expect(over.stderr).toContain('NEW_BRANCH_MAX_COMMITS');
    expect(output(over)).not.toContain('no hits');

    // Exactly the cap is a complete walk.
    const atCap = scan(dir, '--range', `${ZERO}..${head}~1`);
    expect(atCap.status, output(atCap)).toBe(0);
    expect(atCap.stdout).toContain(`no hits in all ${CAP} commits`);
    // The cap counts the commits new to the branch, after the other branches are subtracted.
    const root = git(dir, 'rev-list', '--max-parents=0', 'HEAD').stdout.trim();
    expect(git(dir, 'update-ref', 'refs/remotes/origin/old', root).status).toBe(0);
    const subtracted = scan(dir, '--range', `${ZERO}..${head}`);
    expect(subtracted.status, output(subtracted)).toBe(0);
    expect(subtracted.stdout).toContain(`no hits in ${CAP} commits new to this branch`);
    expect(git(dir, 'update-ref', '-d', 'refs/remotes/origin/old').status).toBe(0);

    // A hit wins over the gap (exit 1), and the report still says the walk was cut.
    const leaky = commit(dir, { 'x.env': leak });
    const hit = scan(dir, '--range', `${ZERO}..${leaky}`);
    expect(hit.status, output(hit)).toBe(1);
    expect(hit.stderr).toContain(`${leaky.slice(0, 7)}  x.env  secret-assignment  x1`);
    expect(hit.stderr).toContain(`only the newest ${CAP} were scanned`);
    noValue(hit);
  });

  it.skipIf(!hasGit())('a normal base is unchanged: only what the head has and the base does not', SLOW, () => {
    const dir = makeRepo();
    commit(dir, { 'old.env': leak });
    const base = commit(dir, { 'old.env': clean });
    const head = commit(dir, { 'two.txt': 'two\n' });
    const result = scan(dir, '--range', `${base}..${head}`);
    expect(result.status, output(result)).toBe(0);
    expect(result.stdout).toContain(`no hits in 1 commit in ${base.slice(0, 12)}..${head.slice(0, 12)}`);
  });
});
