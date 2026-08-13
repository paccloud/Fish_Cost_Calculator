/**
 * Neon (Postgres) data-layer adapter.
 *
 * Exposes the DbAdapter interface (shared/db/interface.js) over the Neon
 * serverless pool used by Vercel functions.
 *
 * Module system: ESM — compatible with api/*.js (Vercel serverless, ESM).
 *
 * @module api/_lib/neonDb
 */

import { query } from './db.js';
import { ERR_DUPLICATE_USER } from '../../shared/db/interface.js';

/**
 * Build the Neon DbAdapter (stateless — delegates to the shared Neon pool).
 *
 * @returns {import('../../shared/db/interface.js').DbAdapter}
 */
export function makeNeonAdapter() {
  return {
    /**
     * Find a user by username.
     * @param {string} username
     * @returns {Promise<{id: string|number, username: string, password: string}|null>}
     */
    async findUserByUsername(username) {
      const result = await query(
        'SELECT id, username, password FROM users WHERE username = $1',
        [username]
      );
      return result.rows[0] ?? null;
    },

    /**
     * Create a user.  Translates Postgres unique-constraint violation (23505)
     * to ERR_DUPLICATE_USER so the handler core stays driver-agnostic.
     *
     * @param {string} username
     * @param {string} hashedPassword
     * @returns {Promise<{id: string|number, username: string}>}
     */
    async createUser(username, hashedPassword) {
      try {
        const result = await query(
          'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username',
          [username, hashedPassword]
        );
        return result.rows[0];
      } catch (err) {
        if (err.code === '23505') {
          const dupErr = new Error('Username already exists');
          dupErr.code = ERR_DUPLICATE_USER;
          throw dupErr;
        }
        throw err;
      }
    },

    /**
     * List all saved calculations for a user, ordered by date DESC.
     * Returns client_id, is_private, created_at, updated_at for reconciliation.
     *
     * @param {string|number} userId
     * @returns {Promise<Array>}
     */
    async listSavedCalcs(userId) {
      const result = await query(
        `SELECT id, user_id, name, species, product, cost, yield, result, date,
                client_id, is_private,
                COALESCE(created_at, date) AS created_at,
                COALESCE(updated_at, date) AS updated_at
         FROM calculations WHERE user_id = $1 ORDER BY date DESC`,
        [userId]
      );
      return result.rows;
    },

    /**
     * Insert a new calculation idempotently using client_id.
     * If a row with the same client_id already exists for this user, returns
     * the existing row instead of inserting a duplicate.
     * is_private defaults to TRUE; the date/timestamp is server-generated.
     *
     * @param {string|number} userId
     * @param {{ name, species, product, cost, yield, result, clientId? }} fields
     * @returns {Promise<{id: string|number, created_at: string, updated_at: string}>}
     */
    async saveCalc(userId, fields) {
      const { name, species, product, cost, yield: yieldVal, result, clientId } = fields;

      if (clientId) {
        // Check for existing row with this clientId owned by this user.
        const existing = await query(
          `SELECT id, COALESCE(created_at, date) AS created_at, COALESCE(updated_at, date) AS updated_at
             FROM calculations WHERE client_id = $1 AND user_id = $2`,
          [clientId, userId]
        );
        if (existing.rows.length > 0) return existing.rows[0];

        // No duplicate — insert with clientId.
        const dbResult = await query(
          `INSERT INTO calculations
             (user_id, name, species, product, cost, yield, result, date,
              client_id, is_private, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(),
                   $8, TRUE, NOW(), NOW())
           RETURNING id, created_at, updated_at`,
          [userId, name, species, product, cost, yieldVal, result, clientId]
        );
        return dbResult.rows[0];
      }

      // Legacy path: no clientId — plain insert, private by default.
      const dbResult = await query(
        `INSERT INTO calculations
           (user_id, name, species, product, cost, yield, result, date,
            is_private, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(),
                 TRUE, NOW(), NOW())
         RETURNING id, created_at, updated_at`,
        [userId, name, species, product, cost, yieldVal, result]
      );
      return dbResult.rows[0];
    },

    /**
     * Find a single calculation by its id. Returns at minimum {id, user_id}.
     *
     * @param {string|number} id
     * @returns {Promise<{id: string|number, user_id: string|number}|null>}
     */
    async findCalcById(id) {
      const result = await query(
        'SELECT id, user_id FROM calculations WHERE id = $1',
        [id]
      );
      return result.rows[0] ?? null;
    },

    /**
     * Delete a calculation by its id.
     * Ownership must be verified by the caller (handler) before calling this.
     *
     * @param {string|number} id
     * @returns {Promise<void>}
     */
    async deleteCalc(id) {
      await query('DELETE FROM calculations WHERE id = $1', [id]);
    },

    async listPublicCalcs() {
      const result = await query(
        `SELECT id, species, product, cost, yield, result, date
         FROM calculations
         WHERE is_private IS NOT TRUE
         ORDER BY date DESC
         LIMIT 100`
      );
      return result.rows;
    },

    async getFishData() {
      const speciesResult = await query(`
        SELECT id, name, scientific_name, category
        FROM species
        ORDER BY category, name
      `);

      const yieldsResult = await query(`
        SELECT species_id, from_state, to_state, yield_percent, range_min, range_max
        FROM fish_yields
        ORDER BY species_id, from_state, to_state
      `);

      const profilesResult = await query(`
        SELECT species_id, description, culinary_uses, edible_portions, url
        FROM species_profiles
      `);

      const fishData = {};
      const profiles = {};
      const speciesMap = {};

      for (const species of speciesResult.rows) {
        speciesMap[species.id] = species;
        fishData[species.name] = {
          scientific_name: species.scientific_name,
          category: species.category,
          conversions: {},
        };
      }

      for (const yieldRow of yieldsResult.rows) {
        const species = speciesMap[yieldRow.species_id];
        if (!species || !fishData[species.name]) continue;

        const fromLabel = yieldRow.from_state !== 'Round'
          && yieldRow.from_state !== 'Whole'
          && yieldRow.from_state !== 'Raw Whole'
          ? `From ${yieldRow.from_state}: `
          : '';
        const label = `${fromLabel}${yieldRow.to_state}`;

        fishData[species.name].conversions[label] = {
          yield: Number.parseFloat(yieldRow.yield_percent),
          range: yieldRow.range_min && yieldRow.range_max
            ? [Number.parseFloat(yieldRow.range_min), Number.parseFloat(yieldRow.range_max)]
            : null,
          from: yieldRow.from_state,
          to: yieldRow.to_state,
        };
      }

      for (const profile of profilesResult.rows) {
        const species = speciesMap[profile.species_id];
        if (!species) continue;

        profiles[species.name] = {
          description: profile.description,
          culinary_uses: profile.culinary_uses,
          edible_portions: profile.edible_portions,
          url: profile.url,
        };
      }

      return {
        fishData,
        profiles,
        source: {
          title: 'Recoveries and Yields from Pacific Fish and Shellfish',
          authors: ['Chuck Crapo', 'Brian Paust', 'Jerry Babbitt'],
          publisher: 'Alaska Sea Grant College Program',
          publication: 'Marine Advisory Bulletin No. 37',
          year: 2004,
        },
      };
    },

    async listContributors() {
      const result = await query(
        `SELECT c.*, u.username, COUNT(ud.id) as contribution_count
         FROM contributors c
         JOIN users u ON c.user_id = u.id
         LEFT JOIN user_data ud ON c.user_id = ud.user_id
         WHERE c.show_on_page = true
         GROUP BY c.id, u.username
         ORDER BY contribution_count DESC`
      );
      return result.rows;
    },

    async getContributorProfile(userId) {
      const result = await query(
        'SELECT * FROM contributors WHERE user_id = $1',
        [userId]
      );
      return result.rows[0] ?? null;
    },

    async saveContributorProfile(userId, profile) {
      const existing = await query(
        'SELECT id FROM contributors WHERE user_id = $1',
        [userId]
      );

      if (existing.rows[0]) {
        await query(
          `UPDATE contributors
           SET display_name = $1,
               organization = $2,
               bio = $3,
               show_on_page = $4,
               updated_at = NOW()
           WHERE user_id = $5`,
          [profile.display_name, profile.organization, profile.bio, profile.show_on_page, userId]
        );
        return { created: false };
      }

      const result = await query(
        `INSERT INTO contributors (user_id, display_name, organization, bio, show_on_page, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         RETURNING id`,
        [userId, profile.display_name, profile.organization, profile.bio, profile.show_on_page]
      );
      return { id: result.rows[0].id, created: true };
    },

    async listUserData(userId) {
      const result = await query(
        'SELECT id, species, product, yield, source, is_shared FROM user_data WHERE user_id = $1',
        [userId]
      );
      return result.rows;
    },

    async createUserDataEntry(userId, fields) {
      const { species, product, yield: yieldVal, source = 'User Input' } = fields;
      const result = await query(
        'INSERT INTO user_data (user_id, species, product, yield, source) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [userId, species, product, yieldVal, source]
      );
      return result.rows[0];
    },

    async findUserDataEntryById(id, userId) {
      const result = await query(
        'SELECT id, species, product, yield, source FROM user_data WHERE id = $1 AND user_id = $2',
        [id, userId]
      );
      return result.rows[0] ?? null;
    },

    async updateUserDataEntry(id, userId, fields) {
      const { species, product, yield: yieldVal, source } = fields;
      await query(
        `UPDATE user_data
         SET species = COALESCE($1, species),
             product = COALESCE($2, product),
             yield   = COALESCE($3, yield),
             source  = COALESCE($4, source)
         WHERE id = $5 AND user_id = $6`,
        [species, product, yieldVal, source, id, userId]
      );
    },

    async deleteUserDataEntry(id, userId) {
      await query(
        'DELETE FROM user_data WHERE id = $1 AND user_id = $2',
        [id, userId]
      );
    },

    async setUserDataSharing(id, userId, isShared) {
      await query(
        'UPDATE user_data SET is_shared = $1 WHERE id = $2 AND user_id = $3',
        [isShared, id, userId]
      );
    },
  };
}
