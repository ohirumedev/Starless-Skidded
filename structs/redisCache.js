const fs = require("fs");

const config = JSON.parse(fs.readFileSync("./Config/config.json").toString());
const log = require("./log.js");
const memoryCache = new Map();

let redis = null;

if (config.redis?.enabled) {
    try {
        const Redis = require("ioredis");
        redis = new Redis(config.redis.url || "redis://127.0.0.1:6379", {
            maxRetriesPerRequest: 2,
            lazyConnect: true,
            enableOfflineQueue: false,
        });
        // Must attach error handler BEFORE connect() to prevent unhandled error crash
        redis.on("error", (err) => {
            log.debug(`Redis error (falling back to memory cache): ${err.message}`);
            redis = null;
        });
        redis.connect().catch((err) => {
            log.debug(`Redis connect failed (falling back to memory cache): ${err.message}`);
            redis = null;
        });
    } catch {
        redis = null;
    }
}

async function get(key) {
    if (redis) {
        try {
            const val = await redis.get(key);
            return val ? JSON.parse(val) : null;
        } catch {
            return memoryGet(key);
        }
    }
    return memoryGet(key);
}

function memoryGet(key) {
    const entry = memoryCache.get(key);
    if (!entry || entry.expires < Date.now()) {
        memoryCache.delete(key);
        return null;
    }
    return entry.value;
}

async function set(key, value, ttlSeconds = 60) {
    if (redis) {
        try {
            await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
            return;
        } catch {
            // fall through to memory
        }
    }
    memoryCache.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
}

async function del(key) {
    if (redis) {
        try {
            await redis.del(key);
        } catch {
            // ignore
        }
    }
    memoryCache.delete(key);
}

async function getOrSet(key, ttlSeconds, fn) {
    const cached = await get(key);
    if (cached !== null) return cached;
    const value = await fn();
    if (value !== undefined && value !== null) {
        await set(key, value, ttlSeconds);
    }
    return value;
}

function isRedisAvailable() {
    return !!redis && redis.status === "ready";
}

module.exports = { get, set, del, getOrSet, isRedisAvailable };
