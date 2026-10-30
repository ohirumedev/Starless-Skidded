const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
    {
        created: { type: Date, required: true },
        banned: { type: Boolean, default: false },
        bannedUntil: { type: Date, default: null },
        banReason: { type: String, default: null },
        matchmakerBannedUntil: { type: Date, default: null },
        matchmakerBanReason: { type: String, default: null },
        discordId: { type: String, unique: true, sparse: true },
        discordAvatar: { type: String, default: null },
        googleId: { type: String, unique: true, sparse: true },
        accountId: { type: String, required: true, unique: true },
        username: { type: String, required: true, unique: true },
        username_lower: { type: String, required: true, unique: true },
        email: { type: String, required: true, unique: true },
        password: { type: String, required: true },
        matchmakingId: { type: String, required: true, unique: true},
        isServer: { type: Boolean, default: false},
        currentSACCode: { type: String, default: null },
        lastUsernameChange: { type: Date, default: null },
        launcherHwid: { type: String, unique: true, sparse: true },
        hwids: { type: [String], default: [] },
        hwidLastSeen: { type: Date, default: null },
        lastLauncherIp: { type: String, default: null },
        launcherIps: { type: [String], default: [] },
        ipLastSeen: { type: Date, default: null },
        lastVbucksClaim: { type: Date, default: null },
        anticheatFlags: {
            type: [{
                reason:     { type: String },
                severity:   { type: String },
                detectedAt: { type: Date },
                ip:         { type: String, default: null },
                hwid:       { type: String, default: null },
                metadata:   { type: mongoose.Schema.Types.Mixed, default: null },
            }],
            default: [],
        },
        // Full hardware fingerprint — individual component IDs
        hardware: {
            type: {
                gpu:         { type: [String], default: [] },
                cpu:         { type: [String], default: [] },
                motherboard: { type: [String], default: [] },
                disk:        { type: [String], default: [] },
                ram:         { type: [String], default: [] },
                nic:         { type: [String], default: [] },
                mouse:       { type: [String], default: [] },
                keyboard:    { type: [String], default: [] },
                monitor:     { type: [String], default: [] },
            },
            default: {},
        },
        hardwareLastSeen: { type: Date, default: null },
    },
    {
        collection: "users"
    }
)

const model = mongoose.model('UserSchema', UserSchema);

module.exports = model;