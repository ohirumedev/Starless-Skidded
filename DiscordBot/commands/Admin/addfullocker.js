const { MessageEmbed } = require("discord.js");
const path = require("path");
const fs = require("fs");
const destr = require("destr");
const { isStaffMember } = require("../../../structs/discordStaff.js");
const Users = require("../../../model/user.js");
const Profiles = require("../../../model/profiles.js");
const log = require("../../../structs/log.js");

module.exports = {
    commandInfo: {
        name: "addfullocker",
        description: "Give a player the full locker by their in-game username.",
        options: [
            {
                name: "username",
                description: "The in-game username of the player to give the full locker to.",
                required: true,
                type: 3 // STRING
            }
        ]
    },

    execute: async (interaction) => {
        if (!isStaffMember(interaction)) {
            return interaction.reply({
                content: "You do not have permission. Only staff can use admin commands.",
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const username = interaction.options.getString("username");

        // --- Lookup user by in-game username (case-insensitive) ---
        const targetUser = await Users.findOne({ username_lower: username.toLowerCase() });
        if (!targetUser) {
            return interaction.editReply({
                content: `No account found with the username **${username}**. Check the spelling and try again.`
            });
        }

        // --- Load the profile ---
        const profile = await Profiles.findOne({ accountId: targetUser.accountId });
        if (!profile || !profile.profiles || !profile.profiles.athena) {
            return interaction.editReply({
                content: `Found the account **${targetUser.username}** but their profile is missing or corrupted.`
            });
        }

        // --- Load allathena.json (master cosmetic catalogue) ---
        let allItems;
        try {
            allItems = destr(
                fs.readFileSync(
                    path.join(__dirname, "../../../Config/DefaultProfiles/allathena.json"),
                    "utf8"
                )
            );
        } catch (e) {
            log.error("addfullocker: Failed to read allathena.json", e);
            return interaction.editReply({ content: "Internal error: could not read the cosmetic catalogue." });
        }

        if (!allItems || !allItems.items) {
            return interaction.editReply({ content: "Internal error: allathena.json is empty or malformed." });
        }

        const athena = profile.profiles.athena;

        // --- Preserve existing loadout slots so they survive the overwrite ---
        const currentItems = athena.items || {};
        let loadouts = {};

        for (const key in currentItems) {
            const item = currentItems[key];
            if (
                key.toLowerCase().includes("loadout") ||
                (item.templateId && item.templateId.startsWith("CosmeticLocker:"))
            ) {
                loadouts[key] = item;
            }
        }

        // Fall back to default loadouts if the user has none yet
        if (Object.keys(loadouts).length === 0) {
            try {
                const defaultAthena = destr(
                    fs.readFileSync(
                        path.join(__dirname, "../../../Config/DefaultProfiles/athena.json"),
                        "utf8"
                    )
                );
                if (defaultAthena && defaultAthena.items) {
                    for (const key in defaultAthena.items) {
                        const item = defaultAthena.items[key];
                        if (
                            key.toLowerCase().includes("loadout") ||
                            (item.templateId && item.templateId.startsWith("CosmeticLocker:"))
                        ) {
                            loadouts[key] = item;
                        }
                    }
                }
            } catch (e) {
                log.error("addfullocker: Failed to read default athena.json for loadout restoration", e);
            }
        }

        // Full locker = every item from allathena + preserve loadouts
        const newItems = { ...allItems.items, ...loadouts };

        const itemCount = Object.keys(allItems.items).length;

        // --- Persist to database ---
        try {
            await Profiles.updateOne(
                { accountId: targetUser.accountId },
                {
                    $set: {
                        "profiles.athena.items": newItems,
                        "profiles.athena.rvn": (athena.rvn || 0) + 1,
                        "profiles.athena.commandRevision": (athena.commandRevision || 0) + 1
                    }
                }
            );
        } catch (err) {
            log.error("addfullocker: Database update failed", err);
            return interaction.editReply({ content: "Database error while saving the locker. Try again." });
        }

        log.backend(
            `[addfullocker] Staff ${interaction.user.tag} gave full locker (${itemCount} items) to ${targetUser.username} (${targetUser.accountId})`
        );

        const embed = new MessageEmbed()
            .setTitle("Full Locker Granted")
            .setDescription(
                `Successfully gave the **Full Locker** (${itemCount.toLocaleString()} items) to **${targetUser.username}**.`
            )
            .addFields(
                { name: "In-Game Name", value: `\`${targetUser.username}\``, inline: true },
                { name: "Account ID", value: `\`${targetUser.accountId}\``, inline: true },
                { name: "Items Added", value: `${itemCount.toLocaleString()}`, inline: true }
            )
            .setColor("GREEN")
            .setFooter({ text: "IRIS Backend", iconURL: "https://i.imgur.com/essv7b1.png" })
            .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
    }
};
