---
name: constraint-debugging
description: >
  Evidence-first debugging for code you (or the user) don't fully understand,
  e.g. AI-generated repos. Use when a bug survived one fix attempt, the cause
  is unclear, a fix "should have worked", or you're about to blame code you
  only read. Skip for obvious one-line errors with a clear stack trace.
  Based on Cindy Sridharan's "How to effectively debug when you no longer
  understand the code" (Oct 2026).
---

# Constraint Debugging

Debugging is a constraint-satisfaction problem. Every gathered FACT is a
constraint. A HYPOTHESIS is valid only if it satisfies ALL facts.
Code shows what *can* happen, not what *did*. Read code LAST, to locate
the fix, never to invent the cause.

## Terms
- VARIABLE: the broken case.
- CONTROL: a case identical except for the suspected difference (last good
  deploy, flag off, working page, other user). If the happy path differs
  too much, use a "sad path" that fails differently.
- SIGNAL: any data point (log line, count, status code, config value).

## Step 0: Set up an evidence file
Create `debug/<bug-slug>.md` with sections: Facts, Signals, Hypotheses,
Matrix, Verdict, Human interventions. Every fact gets an ID (F1, F2...)
and a source citation (command + output excerpt, file:line, URL, log path,
timestamp). No citation = not a fact.

## Step 1: Gather facts, cheapest first, for BOTH control and variable
Layer 1: bug report, error text, logs, config, env vars, feature flags,
dependency versions, git diff between last-good and current, deploy history.
Record how each fact was gathered (which host/env, time window, tool).
Prefer countable facts (requests made, bytes, files, DNS answers, rows).

## Step 2: Isolate high-fidelity signals
- In variable but NOT control -> signal. Mark it.
- In both -> noise. Never steer by noise; use it only to eliminate.
- Sanity check: is the control broken the same way? If so, pick another.

## Step 3: Hypotheses-by-facts matrix
List 3-7 candidate hypotheses (rows) against facts (columns).
Mark each cell ✓ consistent / ✗ contradicts / ? unknown, with a cite.
- Read COLUMNS: a signal satisfied by only 1-2 hypotheses is STRONG.
  Symptoms like "slow", "500 errors", "high P99" are usually weak.
- Read ROWS: discard any row with a ✗.

## Step 4: If no row is all ✓, in this order
1. Re-verify how suspect facts were gathered (wrong env/time/version?).
2. Split coarse hypotheses ("the deploy" -> each change in it).
3. Merge over-fine ones ("page A broken", "page B broken" -> shared cause).
4. Combine complementary hypotheses; every cause must be necessary
   (remove one -> some fact unexplained).
5. Only then invent a new hypothesis, from existing facts only.

## Step 5: Progressive signal discovery
If all signals are weak or nothing fits, do NOT brainstorm more theories.
Go ONE layer down and gather new facts for control and variable, then
return to Step 2. Stop at the first strong signal. Example layers:
- Web/Shopify: app logs -> browser network tab/HAR & console -> API
  responses & headers -> CDN/DNS/hosting logs -> third-party scripts.
- Scripts/agents: output -> exit codes & stderr -> env/config at runtime
  -> process state, disk, network -> OS logs.

## Step 6: Validate against EVERY fact
The best candidate must satisfy all facts, including noise. One
contradiction = discard. Only now read code to find where to fix.

## Repros are hypotheses
A repro counts only if it reproduces the SAME strongest signal seen in the
real failure (same error, same count, same request pattern). Otherwise it
is a different bug; log it as noise.

## Elimination review (not confirmation)
Before claiming a root cause, run a reviewer (prefer a different model or
fresh context) whose only job is to find ONE fact the hypothesis fails,
check every claim has a citation (drop uncited claims), check the control,
and for combined causes remove each one and confirm a fact goes unexplained.
"Reviewer agrees" proves nothing; "reviewer couldn't break it" is the bar.

## Step 7: Report
- Root cause in one sentence, plus the strong signal that proved it.
- The matrix (short), discarded hypotheses and the fact that killed each.
- Fix options with tradeoffs; let the human choose when there's a business
  call (rollback, which fix, live store changes). Don't apply risky fixes
  to production without approval.
- A suggested guard: a log line, count, or check that would surface this
  signal by default next time (or gate deploys on it).
- Human interventions: each time a human supplied a control, fact or
  correction, note it as a gap to automate.

## Budget
Small/obvious bug: Steps 1, 2, 6 only. Stuck bug: full loop, cap at 3
layer descents before reporting back with facts gathered so far.
Summarize raw logs into counts/diffs before putting them in context.
