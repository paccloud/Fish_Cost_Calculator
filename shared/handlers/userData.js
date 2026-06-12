/**
 * Transport-agnostic user-data handlers.
 *
 * Four handlers cover the full user-data CRUD contract:
 *   - handleListUserData   — GET  /api/user-data
 *   - handleCreateUserData — POST /api/user-data
 *   - handleUpdateUserData — PUT  /api/user-data/:id
 *   - handleDeleteUserData — DELETE /api/user-data/:id
 *
 * All four require an authenticated user.  Adapters extract the user id from
 * the token and pass it as `input.userId`.  The handler never touches HTTP
 * headers or JWT parsing.
 *
 * Ownership enforcement lives here so both backends enforce it identically.
 *
 * Drift resolved from the dual-backend state:
 *   - POST success message: server said "Added successfully"; production says
 *     "Data added successfully" — production shape wins.
 *   - PUT partial-update strategy: server used JS `||` fallback in application
 *     code; production used SQL COALESCE.  Production shape wins: the handler
 *     passes the raw input fields (null when absent) and the adapter does
 *     COALESCE.  Callers must send null (not undefined) for fields they want
 *     to leave unchanged.
 *   - Identifier location: id comes from the route parameter in both backends.
 *     The adapter passes it in input.id.  This is the live production contract.
 *   - Error responses: sanitized messages everywhere; raw driver errors never
 *     reach the caller.
 *
 * @module shared/handlers/userData
 */

// ---------------------------------------------------------------------------
// List user data
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ListUserDataRequest
 * @property {string|number} userId  - From the verified JWT / adapter
 */

/**
 * @typedef {Object} ListUserDataResponse
 * @property {number}   status
 * @property {Object}   body
 * @property {Array}    [body]        Array of user_data rows on success
 * @property {string}   [body.error]  Present on failure
 */

/**
 * List all user-data rows for the authenticated user.
 *
 * @param {ListUserDataRequest} input
 * @param {import('../db/interface.js').DbAdapter} db
 * @returns {Promise<ListUserDataResponse>}
 */
export async function handleListUserData(input, db) {
  const { userId } = input;

  if (!userId) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }

  try {
    const rows = await db.listUserData(userId);
    return { status: 200, body: rows };
  } catch (err) {
    console.error('[list-user-data] unexpected error:', err.message ?? err);
    return { status: 500, body: { error: 'Failed to fetch user data' } };
  }
}

// ---------------------------------------------------------------------------
// Create a user-data entry
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CreateUserDataRequest
 * @property {string|number} userId   - From the verified JWT / adapter
 * @property {unknown}       [species]
 * @property {unknown}       [product]
 * @property {unknown}       [yield]
 * @property {unknown}       [source]
 */

/**
 * @typedef {Object} CreateUserDataResponse
 * @property {number}          status
 * @property {Object}          body
 * @property {string|number}   [body.id]       Present on success
 * @property {string}          [body.message]  Present on success
 * @property {string}          [body.error]    Present on failure
 */

/**
 * Create a new user-data entry.
 *
 * @param {CreateUserDataRequest} input
 * @param {import('../db/interface.js').DbAdapter} db
 * @returns {Promise<CreateUserDataResponse>}
 */
export async function handleCreateUserData(input, db) {
  const { userId, species, product, yield: yieldVal, source } = input;

  if (!userId) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }

  if (
    !species || typeof species !== 'string' || species.trim() === '' ||
    !product || typeof product !== 'string' || product.trim() === '' ||
    yieldVal === undefined || yieldVal === null
  ) {
    return { status: 400, body: { error: 'Species, product, and yield are required' } };
  }

  const yieldNum = Number(yieldVal);
  if (Number.isNaN(yieldNum)) {
    return { status: 400, body: { error: 'Yield must be a number' } };
  }

  try {
    const row = await db.createUserData(userId, {
      species: species.trim(),
      product: product.trim(),
      yield: yieldNum,
      source: source || 'User Input',
    });
    return { status: 201, body: { id: row.id, message: 'Data added successfully' } };
  } catch (err) {
    console.error('[create-user-data] unexpected error:', err.message ?? err);
    return { status: 500, body: { error: 'Failed to add data' } };
  }
}

// ---------------------------------------------------------------------------
// Update a user-data entry
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} UpdateUserDataRequest
 * @property {string|number} userId   - From the verified JWT / adapter
 * @property {unknown}       [id]     - Entry id from route param
 * @property {unknown}       [species]
 * @property {unknown}       [product]
 * @property {unknown}       [yield]
 * @property {unknown}       [source]
 */

/**
 * @typedef {Object} UpdateUserDataResponse
 * @property {number}  status
 * @property {Object}  body
 * @property {string}  [body.message]  Present on success
 * @property {string}  [body.error]    Present on failure
 */

/**
 * Update an existing user-data entry owned by the authenticated user.
 * Partial updates are supported: fields sent as null keep their current value
 * (adapter uses COALESCE).  Ownership is enforced here.
 *
 * @param {UpdateUserDataRequest} input
 * @param {import('../db/interface.js').DbAdapter} db
 * @returns {Promise<UpdateUserDataResponse>}
 */
export async function handleUpdateUserData(input, db) {
  const { userId, id, species, product, yield: yieldVal, source } = input;

  if (!userId) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }

  const entryId = Number(id);
  if (!id || Number.isNaN(entryId)) {
    return { status: 400, body: { error: 'Invalid entry id' } };
  }

  try {
    const existing = await db.findUserDataById(entryId);

    if (!existing) {
      return { status: 404, body: { error: 'Entry not found or not owned by user' } };
    }

    // Ownership check — compare as strings to handle int vs string id types
    if (String(existing.user_id) !== String(userId)) {
      return { status: 404, body: { error: 'Entry not found or not owned by user' } };
    }

    await db.updateUserData(entryId, {
      species: species ?? null,
      product: product ?? null,
      yield: yieldVal !== undefined ? yieldVal : null,
      source: source ?? null,
    });

    return { status: 200, body: { message: 'Updated successfully' } };
  } catch (err) {
    console.error('[update-user-data] unexpected error:', err.message ?? err);
    return { status: 500, body: { error: 'Failed to update data' } };
  }
}

// ---------------------------------------------------------------------------
// Delete a user-data entry
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} DeleteUserDataRequest
 * @property {string|number} userId  - From the verified JWT / adapter
 * @property {unknown}       [id]    - Entry id from route param
 */

/**
 * @typedef {Object} DeleteUserDataResponse
 * @property {number}  status
 * @property {Object}  body
 * @property {string}  [body.message]  Present on success
 * @property {string}  [body.error]    Present on failure
 */

/**
 * Delete a user-data entry owned by the authenticated user.
 * Ownership is enforced in the handler.
 *
 * @param {DeleteUserDataRequest} input
 * @param {import('../db/interface.js').DbAdapter} db
 * @returns {Promise<DeleteUserDataResponse>}
 */
export async function handleDeleteUserData(input, db) {
  const { userId, id } = input;

  if (!userId) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }

  const entryId = Number(id);
  if (!id || Number.isNaN(entryId)) {
    return { status: 400, body: { error: 'Invalid entry id' } };
  }

  try {
    const existing = await db.findUserDataById(entryId);

    if (!existing) {
      return { status: 404, body: { error: 'Entry not found or not owned by user' } };
    }

    // Ownership check — compare as strings to handle int vs string id types
    if (String(existing.user_id) !== String(userId)) {
      return { status: 404, body: { error: 'Entry not found or not owned by user' } };
    }

    await db.deleteUserData(entryId);
    return { status: 200, body: { message: 'Deleted successfully' } };
  } catch (err) {
    console.error('[delete-user-data] unexpected error:', err.message ?? err);
    return { status: 500, body: { error: 'Failed to delete data' } };
  }
}
