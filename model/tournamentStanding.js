const mongoose = require("mongoose");

const tournamentStandingSchema = new mongoose.Schema(
  {
    accountId: { type: String, required: true },
    eventId: { type: String, required: true },
    points: { type: Number, default: 0 },
    division: { type: Number, default: 0 },
  },
  {
    collection: "tournament_standings",
  },
);

tournamentStandingSchema.index({ accountId: 1, eventId: 1 }, { unique: true });
tournamentStandingSchema.index({ eventId: 1, points: -1 });

const TournamentStanding = mongoose.model(
  "TournamentStanding",
  tournamentStandingSchema,
);

module.exports = TournamentStanding;
