const { unbanIp, normalizeIp } = require("../../../structs/ipBanManager.js");
const fs = require("fs");
const { isStaffMember } = require("../../../structs/discordStaff.js");
const config = JSON.parse(fs.readFileSync("./Config/config.json").toString());

module.exports = {
    commandInfo: {
        name: "ipunban",
        description: "Remove an IP ban from the backend.",
        options: [
            {
                name: "ip",
                description: "IP address to unban.",
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

        const ip = normalizeIp(interaction.options.get("ip")?.value);
        if (!ip) {
            return interaction.editReply({ content: "Invalid IP address.", ephemeral: true });
        }

        const removed = await unbanIp(ip);
        if (!removed) {
            return interaction.editReply({ content: `IP \`${ip}\` is not banned.`, ephemeral: true });
        }

        return interaction.editReply({ content: `Successfully unbanned IP \`${ip}\`.`, ephemeral: true });
    },
};
