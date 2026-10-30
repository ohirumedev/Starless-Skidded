const mongoose = require("mongoose");

/**
 * Stores a ban on a specific hardware component.
 * componentType examples: "gpu", "cpu", "motherboard", "disk", "mouse", "keyboard", "nic", "ram"
 * componentId is the raw identifier string sent by the client.
 */
const HardwareBanSchema = new mongoose.Schema(
    {
        componentType: { type: String, required: true },  // e.g. "gpu"
        componentId:   { type: String, required: true },  // raw hardware ID string
        accountId:     { type: String, default: null },
        username:      { type: String, default: null },
        reason:        { type: String, default: "Hardware ban" },
        bannedAt:      { type: Date,   default: Date.now },
        bannedUntil:   { type: Date,   default: null },
        source:        { type: String, default: "admin" },
    },
    { collection: "hardware_bans" },
);

HardwareBanSchema.index({ componentType: 1, componentId: 1 }, { unique: true });
HardwareBanSchema.index({ accountId: 1 });
HardwareBanSchema.index({ username: 1 });

module.exports = mongoose.model("HardwareBanSchema", HardwareBanSchema);
