/**
 * Transport-agnostic user-data handlers.
 *
 * Five handlers cover the CRUD + community-sharing lifecycle:
 *   - handleListUserData     — GET  /api/user-data
 *   - handleCreateUserData   — POST /api/user-data
 *   - handleUpdateUserData   — PUT  /api/user-data?id=:id
 *   - handleDeleteUserData   — DELETE /api/user-data?id=:id
 *   - handleSetUserDataSharing — POST/PATCH share toggling
 *
 * All operations require an authenticated user. Adapters pass the resolved
 * user id as `input.userId` — the handler never touches HTTP headers or JWT.
 *
 * Ownership enforcement (a user can only read/mutate their own entries) lives
 * here so both backends enforce it identically.
 *
 * @module shared/handlers/userData
 */

// ---------------------------------------------------------------------------
// List user data entries
// ---------------------------------------------------------------------------

/**
 * @param {{ userId: string|number }} input
 * @param {import('../db/interface.js').DbAdapter} db
 * @returns {Promise<{status: number, body: Object}>}
 */
export async function handleListUserData(input, db) {
  const { userId } = input;
  if (!userId) return { status: 401, body: { error: 'Unauthorized' } };

  try {
    const rows = await db.listUserData(userId);
    return { status: 200, body: rows };
  } catch (err) {
    console.error('[user-data list] error:', err.message ?? err);
    return { status: 500, body: { error: 'Failed to fetch user data' } };
  }
}

// ---------------------------------------------------------------------------
// Create user data entry
// ---------------------------------------------------------------------------

/**
 * @param {{ userId: string|number, species: unknown, product: unknown, yield: unknown, source?: string }} input
 * @param {import('../db/interface.js').DbAdapter} db
 * @returns {Promise<{status: number, body: Object}>}
 */
export async function handleCreateUserData(input, db) {
  const { userId, species, product, yield: yieldVal, source = 'User Input', clientId } = input;
  if (!userId) return { status: 401, body: { error: 'Unauthorized' } };

  if (!species || !product || yieldVal === undefined) {
    return { status: 400, body: { error: 'Species, product, and yield are required' } };
  }

  const safeClientId = (typeof clientId === 'string' && clientId.trim()) ? clientId.trim() : undefined;

  try {
    const row = await db.createUserDataEntry(userId, { species, product, yield: yieldVal, source, clientId: safeClientId });
    return {
      status: 200,
      body: {
        id: row.id,
        revision: row.revision ?? 1,
        created_at: row.created_at ?? null,
        updated_at: row.updated_at ?? null,
        message: 'Data added successfully',
      },
    };
  } catch (err) {
    console.error('[user-data create] error:', err.message ?? err);
    return { status: 500, body: { error: 'Failed to add data' } };
  }
}

// ---------------------------------------------------------------------------
// Update user data entry
// ---------------------------------------------------------------------------

/**
 * @param {{ userId: string|number, id: string|number, species?: unknown, product?: unknown, yield?: unknown, source?: string }} input
 * @param {import('../db/interface.js').DbAdapter} db
 * @returns {Promise<{status: number, body: Object}>}
 */
export async function handleUpdateUserData(input, db) {
  const { userId, id, species, product, yield: yieldVal, source, expectedRevision } = input;
  if (!userId) return { status: 401, body: { error: 'Unauthorized' } };
  if (!id) return { status: 400, body: { error: 'Entry id is required' } };

  try {
    const existing = await db.findUserDataEntryById(id, userId);
    if (!existing) return { status: 404, body: { error: 'Entry not found or not owned by user' } };

    if (expectedRevision !== undefined) {
      const currentRevision = existing.revision ?? 1;
      if (currentRevision !== Number(expectedRevision)) {
        return { status: 409, body: { error: 'Conflict: revision has changed since last read' } };
      }
    }

    await db.updateUserDataEntry(id, userId, { species, product, yield: yieldVal, source });
    return { status: 200, body: { message: 'Updated successfully' } };
  } catch (err) {
    console.error('[user-data update] error:', err.message ?? err);
    return { status: 500, body: { error: 'Failed to update data' } };
  }
}

// ---------------------------------------------------------------------------
// Delete user data entry
// ---------------------------------------------------------------------------

/**
 * @param {{ userId: string|number, id: string|number }} input
 * @param {import('../db/interface.js').DbAdapter} db
 * @returns {Promise<{status: number, body: Object}>}
 */
export async function handleDeleteUserData(input, db) {
  const { userId, id } = input;
  if (!userId) return { status: 401, body: { error: 'Unauthorized' } };
  if (!id) return { status: 400, body: { error: 'Entry id is required' } };

  try {
    const existing = await db.findUserDataEntryById(id, userId);
    if (!existing) return { status: 404, body: { error: 'Entry not found or not owned by user' } };

    await db.deleteUserDataEntry(id, userId);
    return { status: 200, body: { message: 'Deleted successfully' } };
  } catch (err) {
    console.error('[user-data delete] error:', err.message ?? err);
    return { status: 500, body: { error: 'Failed to delete data' } };
  }
}

// ---------------------------------------------------------------------------
// Toggle community sharing
// ---------------------------------------------------------------------------

/**
 * @param {{ userId: string|number, id: string|number, isShared: boolean }} input
 * @param {import('../db/interface.js').DbAdapter} db
 * @returns {Promise<{status: number, body: Object}>}
 */
export async function handleSetUserDataSharing(input, db) {
  const { userId, id, isShared } = input;
  if (!userId) return { status: 401, body: { error: 'Unauthorized' } };
  if (!id) return { status: 400, body: { error: 'Entry id is required' } };
  if (typeof isShared !== 'boolean') {
    return { status: 400, body: { error: 'isShared (boolean) is required' } };
  }

  try {
    const existing = await db.findUserDataEntryById(id, userId);
    if (!existing) return { status: 404, body: { error: 'Entry not found or not owned by user' } };

    await db.setUserDataSharing(id, userId, isShared);
    return {
      status: 200,
      body: { message: isShared ? 'Shared with community' : 'Removed from community' },
    };
  } catch (err) {
    console.error('[user-data sharing] error:', err.message ?? err);
    return { status: 500, body: { error: 'Failed to update sharing status' } };
  }
}
