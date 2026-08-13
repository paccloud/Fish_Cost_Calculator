// Guest-to-account adoption: detects and moves guest-owned records into the
// authenticated account scope at sign-in. See GitHub issue #88.
//
// Idempotency: each adopted account record carries a guestSourceId field equal
// to the originating guest record's local id. On retry, existing guestSourceIds
// are skipped, preventing duplicates even if the process is interrupted mid-run.
//
// Exclusions: custom species (stored outside the repository) and pending-delete
// tombstones are never included. Only calcs and custom yields are adopted.

/**
 * Returns the count of adoptable guest records.
 * @param {object} guestRepo - LocalRepository for the guest scope
 * @returns {Promise<{calcs: number, yields: number, total: number}>}
 */
export async function detectGuestRecords(guestRepo) {
  const [calcs, yields] = await Promise.all([
    guestRepo.getCalcs(),
    guestRepo.getYields(),
  ]);
  return { calcs: calcs.length, yields: yields.length, total: calcs.length + yields.length };
}

/**
 * Copies all eligible guest records into accountRepo, then removes them from
 * the guest scope. Safe to call multiple times — already-adopted records
 * (identified by guestSourceId on account-scope records) are skipped.
 *
 * @param {object} guestRepo   - LocalRepository for the guest scope
 * @param {object} accountRepo - LocalRepository for the account scope
 * @returns {Promise<{adoptedCalcs: number, adoptedYields: number}>}
 */
export async function adoptGuestRecords(guestRepo, accountRepo) {
  // Read both scopes concurrently.
  const [guestCalcs, guestYields, accountCalcs, accountYields] = await Promise.all([
    guestRepo.getCalcs(),
    guestRepo.getYields(),
    accountRepo.getCalcs(),
    accountRepo.getYields(),
  ]);

  // Build sets of guestSourceIds already present in the account scope so we
  // never create duplicate records when retrying an interrupted adoption.
  const adoptedCalcSourceIds = new Set(
    accountCalcs.filter((c) => c.guestSourceId).map((c) => c.guestSourceId),
  );
  const adoptedYieldSourceIds = new Set(
    accountYields.filter((y) => y.guestSourceId).map((y) => y.guestSourceId),
  );

  // Copy unadopted guest calcs into the account scope sequentially to stay
  // within the repository's per-key lock model.
  let adoptedCalcs = 0;
  for (const calc of guestCalcs) {
    if (adoptedCalcSourceIds.has(calc.id)) continue;
    const { id: _drop, scope: _s, syncStatus: _ss, createdAt, ...rest } = calc;
    await accountRepo.addCalc({ ...rest, createdAt, guestSourceId: calc.id });
    adoptedCalcs++;
  }

  let adoptedYields = 0;
  for (const yld of guestYields) {
    if (adoptedYieldSourceIds.has(yld.id)) continue;
    const { id: _drop, scope: _s, syncStatus: _ss, createdAt, ...rest } = yld;
    await accountRepo.addYield({ ...rest, createdAt, guestSourceId: yld.id });
    adoptedYields++;
  }

  // Remove the originals from the guest scope. removeCalc/removeYield is a
  // no-op when the id is not found, so re-running after a partial removal is safe.
  await Promise.all([
    ...guestCalcs.map((c) => guestRepo.removeCalc(c.id)),
    ...guestYields.map((y) => guestRepo.removeYield(y.id)),
  ]);

  return { adoptedCalcs, adoptedYields };
}
