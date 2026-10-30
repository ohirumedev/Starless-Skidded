const User = require("../../../model/user.js");
const fs = require("fs");
const { isStaffMember } = require("../../../structs/discordStaff.js");
const config = JSON.parse(fs.readFileSync("./Config/config.json").toString());

module.exports = {
    commandInfo: {
        name: "matchmaker",
        description: "Manage matchmaking bans.",
        options: [
            {
                name: "ban",
                description: "Ban a user from matchmaking only.",
                type: 1,
                options: [
                    {
                        name: "username",
                        description: "Target username.",
                        required: true,
                        type: 3
                    },
                    {
                        name: "duration",
                        description: "Duration (e.g., 10m, 1h, 1d).",
                        required: true,
                        type: 3
                    },
                    {
                        name: "reason",
                        description: "Reason for the matchmaking ban.",
                        required: false,
                        type: 3
                    }
                ]
            }
        ]
    },
    execute: async (interaction) => {
        await interaction.deferReply({ ephemeral: true });

        if (!isStaffMember(interaction)) {
            return interaction.editReply({ content: "You do not have permission. Only founders can use admin commands.", ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();
        if (subcommand !== "ban") {
            return interaction.editReply({ content: "Unknown subcommand.", ephemeral: true });
        }

        const username = interaction.options.getString("username");
        const durationStr = interaction.options.getString("duration");
        const reason = interaction.options.getString("reason") || "No reason provided";

        const targetUser = await User.findOne({ username_lower: username.toLowerCase() });
        if (!targetUser) {
            return interaction.editReply({ content: "The account username you entered does not exist.", ephemeral: true });
        }

        const match = durationStr.match(/^(\d+)([mhd])$/i);
        if (!match) {
            return interaction.editReply({ content: "Invalid duration format! Use e.g., 10m, 1h, 1d.", ephemeral: true });
        }

        const amount = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();
        const bannedUntil = new Date();

        if (unit === "m") {
            bannedUntil.setMinutes(bannedUntil.getMinutes() + amount);
        } else if (unit === "h") {
            bannedUntil.setHours(bannedUntil.getHours() + amount);
        } else {
            bannedUntil.setDate(bannedUntil.getDate() + amount);
        }

        await targetUser.updateOne({
            $set: {
                matchmakerBannedUntil: bannedUntil,
                matchmakerBanReason: reason
            }
        });

        return interaction.editReply({
            content: `Successfully matchmaker banned **${targetUser.username}** until <t:${Math.floor(bannedUntil.getTime() / 1000)}:F> (<t:${Math.floor(bannedUntil.getTime() / 1000)}:R>).`,
            ephemeral: true
        });
    }
};
