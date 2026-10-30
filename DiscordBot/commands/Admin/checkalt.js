const { MessageEmbed } = require("discord.js");
const { isStaffMember } = require("../../../structs/discordStaff.js");
const User = require("../../../model/user.js");
const log = require("../../../structs/log.js");

module.exports = {
    commandInfo: {
        name: "checkalt",
        description: "Find all accounts that share an IP or HWID with a player (alt detection).",
        options: [
            {
                name: "username",
                description: "In-game username to check alts for.",
                required: true,
                type: 3,
            },
        ],
    },

    execute: async (interaction) => {
        if (!isStaffMember(interaction)) {
            return interaction.reply({
                content: "You do not have permission. Only staff can use admin commands.",
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const username = interaction.options.getString("username");

        // ── Look up target account ───────────────────────────────────────────
        const target = await User.findOne({ username_lower: username.toLowerCase() }).lean();
        if (!target) {
            return interaction.editReply({
                content: `No account found with the username **${username}**.`,
            });
        }

        // ── Collect all IPs and HWIDs from this account ──────────────────────
        const ips = [...new Set(
            [target.lastLauncherIp, ...(target.launcherIps || [])].filter(Boolean)
        )];
        const hwids = [...new Set(
            [target.launcherHwid, ...(target.hwids || [])].filter(Boolean)
        )];

        if (ips.length === 0 && hwids.length === 0) {
            return interaction.editReply({
                content: `**${target.username}** has no IP or HWID on file yet. They need to log in through the launcher first.`,
            });
        }

        // ── Query all other accounts that share any IP or HWID ───────────────
        const orClauses = [];
        if (ips.length > 0) {
            orClauses.push({ lastLauncherIp: { $in: ips } });
            orClauses.push({ launcherIps: { $in: ips } });
        }
        if (hwids.length > 0) {
            orClauses.push({ launcherHwid: { $in: hwids } });
            orClauses.push({ hwids: { $in: hwids } });
        }

        const relatedAccounts = await User.find({
            accountId: { $ne: target.accountId },
            $or: orClauses,
        }).lean();

        log.debug(
            `[checkalt] ${interaction.user.tag} checked alts for ${target.username} — found ${relatedAccounts.length} related accounts`
        );

        // ── Build the embed ──────────────────────────────────────────────────
        const embed = new MessageEmbed()
            .setTitle(`Alt Check — ${target.username}`)
            .setColor(relatedAccounts.length > 0 ? "#f97316" : "#22c55e")
            .setFooter({ text: "IRIS Backend • Alt Detection", iconURL: "https://i.imgur.com/essv7b1.png" })
            .setTimestamp();

        // Target account info
        embed.addField(
            "Target Account",
            [
                `**Username:** \`${target.username}\``,
                `**Account ID:** \`${target.accountId}\``,
                `**Status:** ${target.banned ? "🔴 Banned" : "🟢 Active"}`,
                `**IPs on file:** ${ips.length}`,
                `**HWIDs on file:** ${hwids.length}`,
            ].join("\n"),
            false
        );

        if (relatedAccounts.length === 0) {
            embed.setDescription("✅ No alternate accounts detected. No shared IPs or HWIDs found.");
            return interaction.editReply({ embeds: [embed] });
        }

        embed.setDescription(
            `⚠️ Found **${relatedAccounts.length}** account(s) sharing an IP or HWID with **${target.username}**.`
        );

        // For each related account, show what they share
        const rows = [];
        for (const acc of relatedAccounts) {
            const accIps = new Set([acc.lastLauncherIp, ...(acc.launcherIps || [])].filter(Boolean));
            const accHwids = new Set([acc.launcherHwid, ...(acc.hwids || [])].filter(Boolean));

            const sharedIps   = ips.filter(ip => accIps.has(ip));
            const sharedHwids = hwids.filter(h => accHwids.has(h));

            const reasons = [];
            if (sharedIps.length > 0)   reasons.push(`IP: \`${sharedIps[0]}\`${sharedIps.length > 1 ? ` +${sharedIps.length - 1} more` : ""}`);
            if (sharedHwids.length > 0) reasons.push(`HWID match`);

            const status = acc.banned ? "🔴" : "🟢";
            rows.push(
                `${status} **${acc.username}** — ${reasons.join(", ")}\n` +
                `\`${acc.accountId}\``
            );
        }

        // Discord field limit is 1024 chars — split into chunks if needed
        const CHUNK = 10;
        for (let i = 0; i < rows.length; i += CHUNK) {
            const slice = rows.slice(i, i + CHUNK);
            embed.addField(
                i === 0 ? `Related Accounts (${relatedAccounts.length})` : `\u200B`,
                slice.join("\n\n").slice(0, 1020) || "\u200B",
                false
            );
        }

        // Show the IPs for reference (truncated)
        if (ips.length > 0) {
            embed.addField(
                "Known IPs",
                ips.slice(0, 8).map(ip => `\`${ip}\``).join("\n") +
                (ips.length > 8 ? `\n… and ${ips.length - 8} more` : ""),
                true
            );
        }

        if (hwids.length > 0) {
            embed.addField(
                "Known HWIDs",
                hwids.slice(0, 4).map(h => `\`${h.slice(0, 24)}…\``).join("\n") +
                (hwids.length > 4 ? `\n… and ${hwids.length - 4} more` : ""),
                true
            );
        }

        return interaction.editReply({ embeds: [embed] });
    },
};
