const mongoose = require("mongoose");

const HwidBanSchema = new mongoose.Schema(
    {
        hwid: { type: String, required: true, unique: true },
        accountId: { type: String, default: null },
        username: { type: String, default: null },
        reason: { type: String, default: "HWID ban" },
        bannedAt: { type: Date, default: Date.now },
        bannedUntil: { type: Date, default: null },
        source: { type: String, default: "admin" },
    },
    {
        collection: "hwid_bans",
    },
);

HwidBanSchema.index({ accountId: 1 });
HwidBanSchema.index({ username: 1 });

module.exports = mongoose.model("HwidBanSchema", HwidBanSchema);
