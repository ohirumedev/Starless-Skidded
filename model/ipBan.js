const mongoose = require("mongoose");

const IpBanSchema = new mongoose.Schema(
    {
        ip: { type: String, required: true, unique: true },
        accountId: { type: String, default: null },
        username: { type: String, default: null },
        reason: { type: String, default: "IP ban" },
        bannedAt: { type: Date, default: Date.now },
        bannedUntil: { type: Date, default: null },
        source: { type: String, default: "admin" },
    },
    {
        collection: "ip_bans",
    },
);

IpBanSchema.index({ accountId: 1 });
IpBanSchema.index({ username: 1 });

module.exports = mongoose.model("IpBanSchema", IpBanSchema);
