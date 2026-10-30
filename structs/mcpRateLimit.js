/**
 * mcpRateLimit.js
 * Per-endpoint, per-account rate limiting for MCP profile commands.
 *
 * Usage in mcp.js:
 *   const { mcpLimit } = require("../structs/mcpRateLimit.js");
 *   app.post("/fortnite/api/game/v2/profile/*/client/GiftCatalogEntry",
 *       verifyToken, mcpLimit("GiftCatalogEntry", 5, 60), async (req, res) => { … });
 */

const log = require("./log.js");

// In-memory store: Map<"accountId:command", { count, resetAt }>
// This is intentionally in-process (no Redis) so it survives restarts gracefully.
const _store = new Map();

// Sweep expired entries every 2 minutes to keep memory clean.
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of _store.entries()) {
        if (entry.resetAt <= now) _store.delete(key);
    }
}, 2 * 60 * 1000);

/**
 * Returns an Express middleware that rate-limits a single MCP command.
 *
 * @param {string} command    - Command name, used in error messages & keys.
 * @param {number} maxHits    - Max allowed calls within the window.
 * @param {number} windowSecs - Rolling window in seconds.
 */
function mcpLimit(command, maxHits, windowSecs) {
    const windowMs = windowSecs * 1000;

    return function mcpRateLimitMiddleware(req, res, next) {
        // verifyToken has already run, so req.user is populated.
        const accountId = req.user?.accountId;
        if (!accountId) return next(); // unauthenticated — let verifyToken handle it

        const key = `${accountId}:${command}`;
        const now = Date.now();
        let entry = _store.get(key);

        if (!entry || entry.resetAt <= now) {
            entry = { count: 0, resetAt: now + windowMs };
            _store.set(key, entry);
        }

        entry.count += 1;

        // Set standard rate-limit headers so clients can see their quota.
        res.setHeader("X-RateLimit-Limit", maxHits);
        res.setHeader("X-RateLimit-Remaining", Math.max(0, maxHits - entry.count));
        res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));

        if (entry.count > maxHits) {
            const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
            res.setHeader("Retry-After", retryAfter);

            log.debug(
                `[mcpRateLimit] ${accountId} exceeded limit for ${command} ` +
                `(${entry.count}/${maxHits} in ${windowSecs}s)`
            );

            return res.status(429).json({
                errorCode: "errors.com.epicgames.common.throttled",
                errorMessage: `You are sending requests too quickly. Please wait ${retryAfter} second(s).`,
                numericErrorCode: 1041,
                originatingService: "fortnite",
                intent: "prod",
            });
        }

        next();
    };
}

/**
 * Convenience presets for the most sensitive MCP endpoints.
 * Import these directly for cleaner code in mcp.js.
 */
const mcpLimits = {
    // Gifting: 5 gifts per 60 seconds per account
    GiftCatalogEntry:           mcpLimit("GiftCatalogEntry",           5,   60),
    // Shop purchases: 20 per 60 seconds
    PurchaseCatalogEntry:       mcpLimit("PurchaseCatalogEntry",       20,  60),
    // Locker changes: 30 per 30 seconds
    SetCosmeticLockerSlot:      mcpLimit("SetCosmeticLockerSlot",      30,  30),
    // Equip cosmetic: 30 per 30 seconds
    EquipBattleRoyaleCustomization: mcpLimit("EquipBattleRoyaleCustomization", 30, 30),
    // Quest reroll: 3 per 60 seconds
    FortRerollDailyQuest:       mcpLimit("FortRerollDailyQuest",       3,   60),
    // Generic QueryProfile: 60 per 30 seconds (high frequency, but cap abuse)
    QueryProfile:               mcpLimit("QueryProfile",               60,  30),
};

module.exports = { mcpLimit, mcpLimits };
