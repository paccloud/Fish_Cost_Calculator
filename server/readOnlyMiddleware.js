// API read-only mode for the move to Firebase (shared/readOnly.js, issue #130).
// Sign-in stays open; every other write under /api gets 503 so nothing in the
// database changes while it is copied. The Vercel functions apply the same rule
// in api/_lib/cors.js.
const READ_ONLY_ALLOWED_WRITES = new Set(['/api/login']);

function createReadOnlyMiddleware(readOnlyModulePromise = import('../shared/readOnly.js')) {
    return async function readOnlyMiddleware(req, res, next) {
        try {
            const { isBlockedWrite, READ_ONLY_BODY, READ_ONLY_STATUS } = await readOnlyModulePromise;
            const allowWrite = READ_ONLY_ALLOWED_WRITES.has(req.originalUrl.split('?')[0]);
            if (isBlockedWrite(req.method, { allowWrite })) {
                return res.status(READ_ONLY_STATUS).json(READ_ONLY_BODY);
            }
            return next();
        } catch (err) {
            return next(err);
        }
    };
}

module.exports = { createReadOnlyMiddleware };
