const { MessageEmbed } = require("discord.js");
const User = require("../../../model/user.js");
const { unbanAllUserIps } = require("../../../structs/ipBanManager.js");
const HwidBan = require("../../../model/hwidBan.js");
const fs = require("fs");
const { isStaffMember } = require("../../../structs/discordStaff.js");

module.exports = {
    commandInfo: {
        name: "unban",
        description: "Unban a user from the backend by their username.",
        options: [
            {
                name: "username",
                description: "Target username.",
                required: true,
                type: 3
            }
        ]
    },
    execute: async (interaction) => {
        await interaction.deferReply({ ephemeral: true });

        if (!isStaffMember(interaction)) {
            return interaction.editReply({ content: "You do not have permission. Only founders can use admin commands.", ephemeral: true });
        }

        const { options } = interaction;
        const targetUser = await User.findOne({ username_lower: (options.get("username").value).toLowerCase() });

        if (!targetUser) return interaction.editReply({ content: "The account username you entered does not exist.", ephemeral: true });

        // Always clear HWID and IP bans regardless of account ban status
        await targetUser.updateOne({ $set: { banned: false, banExpires: null, banReason: null } });

        const ipUnbanned = await unbanAllUserIps(targetUser);

        const hwids = [
            ...(targetUser.hwids || []),
            ...(targetUser.launcherHwid ? [targetUser.launcherHwid] : []),
        ];
        let hwidUnbanned = 0;
        for (const hwid of hwids) {
            const result = await HwidBan.deleteOne({ hwid });
            if (result.deletedCount > 0) hwidUnbanned++;
        }
        const byAccountId = await HwidBan.deleteMany({ accountId: targetUser.accountId });
        hwidUnbanned += byAccountId.deletedCount || 0;

        let dmStatus = "";
        if (targetUser.discordId) {
            try {
                const discordUser = await interaction.client.users.fetch(targetUser.discordId);
                const unbanEmbed = new MessageEmbed()
                    .setTitle("Account Unbanned")
                    .setDescription(`Your account **${targetUser.username}** has been unbanned from **IRIS Backend**.`)
                    .setColor("#56ff00")
                    .addField("Status", "You can now log back into the game.", false)
                    .setTimestamp()
                    .setFooter({
                        text: "IRIS Backend Admin Team",
                        iconURL: "https://i.imgur.com/essv7b1.png"
                    });

                await discordUser.send({ embeds: [unbanEmbed] });
                dmStatus = " (User notified via DM)";
            } catch (err) {
                dmStatus = " (Could not DM user - DMs closed or user not found)";
            }
        } else {
            dmStatus = " (User has no linked Discord ID)";
        }

        interaction.editReply({
            content: `✅ Successfully unbanned **${targetUser.username}**. Account ban cleared, IPs cleared: ${ipUnbanned}, HWIDs cleared: ${hwidUnbanned}.${dmStatus}`,
            ephemeral: true,
        });
    }
}