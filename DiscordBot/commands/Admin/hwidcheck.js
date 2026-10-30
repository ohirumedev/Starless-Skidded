const { MessageEmbed } = require("discord.js");
const User = require("../../../model/user.js");
const HwidBan = require("../../../model/hwidBan.js");
const { getUserHwids } = require("../../../structs/hwidManager.js");
const fs = require("fs");
const { isStaffMember } = require("../../../structs/discordStaff.js");
const config = JSON.parse(fs.readFileSync("./Config/config.json").toString());

module.exports = {
    commandInfo: {
        name: "hwidcheck",
        description: "View HWIDs stored in MongoDB for a player.",
        options: [
            {
                name: "username",
                description: "Target username.",
                required: true,
                type: 3,
            },
        ],
    },
    execute: async (interaction) => {
        await interaction.deferReply({ ephemeral: true });

        if (!isStaffMember(interaction)) {
            return interaction.editReply({ content: "You do not have permission. Only founders can use admin commands.", ephemeral: true });
        }

        const username = interaction.options.get("username").value;
        const user = await User.findOne({ username_lower: username.toLowerCase() }).lean();

        if (!user) {
            return interaction.editReply({ content: "User not found.", ephemeral: true });
        }

        const hwids = await getUserHwids(user.accountId);
        const bans = await HwidBan.find({
            $or: [{ accountId: user.accountId }, { hwid: { $in: hwids } }],
        }).lean();

        const lines =
            hwids.length > 0
                ? hwids.map((h) => `\`${h}\``).join("\n").slice(0, 900)
                : "_No HWIDs recorded yet (launcher login / Arc required)._";

        const embed = new MessageEmbed()
            .setTitle(`HWIDs — ${user.username}`)
            .setColor("#5865F2")
            .addFields(
                { name: "Launcher HWID", value: user.launcherHwid ? `\`${user.launcherHwid}\`` : "_none_" },
                { name: "All HWIDs", value: lines },
                {
                    name: "Active HWID bans",
                    value:
                        bans.length > 0
                            ? bans.map((b) => `\`${b.hwid}\` — ${b.reason}`).join("\n").slice(0, 900)
                            : "_none_",
                },
            )
            .setFooter({ text: `users.launcherHwid + users.hwids | hwid_bans collection` })
            .setTimestamp();

        return interaction.editReply({ embeds: [embed], ephemeral: true });
    },
};
