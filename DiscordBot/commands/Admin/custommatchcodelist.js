const { isStaffMember } = require("../../../structs/discordStaff.js");
const MMCodes = require("../../../model/mmcodes.js");
const { MessageEmbed } = require("discord.js");
const log = require("../../../structs/log.js");
const config = require('../../../Config/config.json')

module.exports = {
    commandInfo: {
        name: "match-list",
        description: "match list and see how many players ingame.",
    },
    execute: async (interaction) => {
        if (!isStaffMember(interaction)) {
            return interaction.reply({ content: "You do not have permission. Only founders can use admin commands.", ephemeral: true });
        }

        try {
            const codes = await MMCodes.find({});

            if (codes.length === 0) {
                return interaction.reply({ content: "No custom matchmaking codes found.", ephemeral: true });
            }

            const embed = new MessageEmbed()
                .setTitle("Custom Matchmaking Codes")
                .setDescription("Here is the list of all custom matchmaking codes:")
                .setColor("GREEN")
                .setTimestamp()
                .setFooter({
                    text: "IRIS Backend",
                    iconURL: "https://i.imgur.com/essv7b1.png"
                });

            codes.forEach(code => {
                embed.addFields([
                    { name: "Code", value: code.code, inline: true },
                    { name: "IP", value: code.ip, inline: true },
                    { name: "Port", value: code.port.toString(), inline: true }
                ]);
            });

            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            log.error(error);
            return interaction.reply({ content: "An error occurred while fetching the codes.", ephemeral: true });
        }
    }
};