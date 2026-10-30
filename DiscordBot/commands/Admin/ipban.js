const { MessageEmbed } = require("discord.js");
const User = require("../../../model/user.js");
const { banIp, banAllUserIps, normalizeIp } = require("../../../structs/ipBanManager.js");
const fs = require("fs");
const { isStaffMember } = require("../../../structs/discordStaff.js");
const config = JSON.parse(fs.readFileSync("./Config/config.json").toString());

module.exports = {
    commandInfo: {
        name: "ipban",
        description: "IP-ban a player (blocks launcher + game from that network, like HWID ban).",
        options: [
            {
                name: "username",
                description: "Username to ban the player.",
                required: false,
                type: 3,
            },
            {
                name: "ip",
                description: "IP address to ban directly.",
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
        const ipRaw = interaction.options.get("ip")?.value;
        const reason = interaction.options.get("reason")?.value || "IP ban (admin)";

        if (!username && !ipRaw) {
            return interaction.editReply({
                content: "Provide either `username` (ban all IPs on account) or `ip` (ban one address).",
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

            banned = await banAllUserIps(user, reason, "admin");
        }

        if (ipRaw) {
            const ip = normalizeIp(ipRaw);
            if (!ip) {
                return interaction.editReply({ content: "Invalid IP address.", ephemeral: true });
            }
            await banIp(ip, { reason, source: "admin" });
            if (!banned.includes(ip)) banned.push(ip);
        }

        if (banned.length === 0) {
            return interaction.editReply({
                content: "No IPs found on that account yet. Ban by `ip` directly or wait until they log in once.",
                ephemeral: true,
            });
        }

        const embed = new MessageEmbed()
            .setTitle("IP Ban Applied")
            .setColor("#ff0000")
            .setDescription(`Banned **${banned.length}** IP(s) in MongoDB (\`ip_bans\` collection).`)
            .addFields(
                { name: "Reason", value: reason },
                { name: "IPs", value: banned.map((i) => `\`${i}\``).join("\n").slice(0, 1000) },
            )
            .setTimestamp();

        return interaction.editReply({ embeds: [embed], ephemeral: true });
    },
};
