const { MessageEmbed } = require("discord.js");
const User = require("../../../model/user.js");
const IpBan = require("../../../model/ipBan.js");
const { getUserIps } = require("../../../structs/ipBanManager.js");
const fs = require("fs");
const { isStaffMember } = require("../../../structs/discordStaff.js");
const config = JSON.parse(fs.readFileSync("./Config/config.json").toString());

module.exports = {
    commandInfo: {
        name: "ipcheck",
        description: "View IPs stored in MongoDB for a player.",
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

        const ips = await getUserIps(user.accountId);
        const bans = await IpBan.find({
            $or: [{ accountId: user.accountId }, { ip: { $in: ips } }],
        }).lean();

        const lines =
            ips.length > 0
                ? ips.map((i) => `\`${i}\``).join("\n").slice(0, 900)
                : "_No IPs recorded yet (launcher login required)._";

        const embed = new MessageEmbed()
            .setTitle(`IPs — ${user.username}`)
            .setColor("#5865F2")
            .addFields(
                { name: "Last launcher IP", value: user.lastLauncherIp ? `\`${user.lastLauncherIp}\`` : "_none_" },
                { name: "All IPs", value: lines },
                {
                    name: "Active IP bans",
                    value:
                        bans.length > 0
                            ? bans.map((b) => `\`${b.ip}\` — ${b.reason}`).join("\n").slice(0, 900)
                            : "_none_",
                },
            )
            .setFooter({ text: "users.lastLauncherIp + users.launcherIps | ip_bans collection" })
            .setTimestamp();

        return interaction.editReply({ embeds: [embed], ephemeral: true });
    },
};
