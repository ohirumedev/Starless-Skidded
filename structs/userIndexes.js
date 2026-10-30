const User = require("../model/user.js");
const log = require("./log.js");

const SPARSE_UNIQUE_FIELDS = ["googleId", "discordId", "launcherHwid"];

async function ensureSparseUserIndexes() {
    const collection = User.collection;

    for (const field of SPARSE_UNIQUE_FIELDS) {
        try {
            const indexes = await collection.indexes();
            const existing = indexes.find((idx) => idx.key && idx.key[field] === 1);

            if (existing && !existing.sparse) {
                await collection.dropIndex(existing.name);
                log.backend(`Dropped non-sparse users.${field} index (${existing.name})`);
            }

            await collection.createIndex({ [field]: 1 }, { unique: true, sparse: true });
        } catch (err) {
            const message = String(err?.message || err);
            if (!message.includes("already exists") && !message.includes("IndexOptionsConflict")) {
                log.debug(`User index ensure for ${field}: ${message}`);
            }
        }
    }
}

module.exports = { ensureSparseUserIndexes };
