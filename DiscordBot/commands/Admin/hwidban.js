const { MessageEmbed } = require("discord.js");
const User = require("../../../model/user.js");
const { banHwid, banAllUserHwids } = require("../../../structs/hwidManager.js");
const fs = require("fs");
const { isStaffMember } = require("../../../structs/discordStaff.js");
const config = JSON.parse(fs.readFileSync("./Config/config.json").toString());

module.exports = {
    commandInfo: {
        name: "hwidban",
        description: "HWID-ban a player (blocks their PC even on new accounts).",
        options: [
            {
                name: "username",
                description: "Username to HWID-ban (bans all known HWIDs on their account).",
                required: false,
                type: 3,
            },
            {
                name: "hwid",
                description: "Single HWID hash to ban directly.",
                required: false,
                type: 3,
            },
            {
                name: "reason",
                description: "Ban reason stored in MongoDB.",
                required: false,
                type: 3,
            },
        ],
    },
    execute: async (interaction) => {
        await interaction.deferReply({ ephemeral: true });

        if (!isStaffMember(interaction)) {
            return interaction.editReply({ content: "You do not have permission. Only founders can use admin commands.", ephemeral: true });
        }

        const username = interaction.options.get("username")?.value;
        const hwid = interaction.options.get("hwid")?.value?.trim();
        const reason = interaction.options.get("reason")?.value || "HWID ban (admin)";

        if (!username && !hwid) {
            return interaction.editReply({
                content: "Provide either `username` (ban all HWIDs on account) or `hwid` (ban one hash).",
                ephemeral: true,
            });
        }

        let banned = [];

        if (username) {
            const user = await User.findOne({ username_lower: username.toLowerCase() }).lean();
            if (!user) {
                return interaction.editReply({ content: "User not found.", ephemeral: true });
            }

            await User.updateOne(
                { accountId: user.accountId },
                { $set: { banned: true, banReason: reason, bannedUntil: null } },
            );

            banned = await banAllUserHwids(user, reason, "admin");
        }

        if (hwid) {
            await banHwid(hwid, { reason, source: "admin" });
            if (!banned.includes(hwid)) banned.push(hwid);
        }

        if (banned.length === 0) {
            return interaction.editReply({
                content: "No HWIDs found on that account yet. Ban by `hwid` directly or wait until they launch with Arc.",
                ephemeral: true,
            });
        }

        const embed = new MessageEmbed()
            .setTitle("HWID Ban Applied")
            .setColor("#ff0000")
            .setDescription(`Banned **${banned.length}** HWID(s) in MongoDB (\`hwid_bans\` collection).`)
            .addFields(
                { name: "Reason", value: reason },
                { name: "HWIDs", value: banned.map((h) => `\`${h}\``).join("\n").slice(0, 1000) },
            )
            .setTimestamp();

        return interaction.editReply({ embeds: [embed], ephemeral: true });
    },
};
