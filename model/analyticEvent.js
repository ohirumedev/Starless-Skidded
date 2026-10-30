const mongoose = require("mongoose");

const AnalyticEventSchema = new mongoose.Schema(
    {
        type: { type: String, required: true, index: true },
        accountId: { type: String, default: "", index: true },
        username: { type: String, default: "" },
        metadata: { type: Object, default: {} },
        created: { type: Date, default: Date.now, index: true },
    },
    { collection: "analytic_events" },
);

AnalyticEventSchema.index({ type: 1, created: -1 });

module.exports = mongoose.model("AnalyticEventSchema", AnalyticEventSchema);
