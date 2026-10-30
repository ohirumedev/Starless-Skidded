const fs = require("fs");
const config = JSON.parse(fs.readFileSync("./Config/config.json").toString());

function cleanIdList(list) {
    if (!Array.isArray(list)) return [];
    return list.map((id) => String(id || "").trim()).filter((id) => id.length > 0);
}

function getFounderRoleIds() {
    return cleanIdList(config.founderRoleIds);
}

function getModeratorUserIds() {
    return cleanIdList(config.moderators);
}

function isStaffMember(interaction) {
    if (!interaction?.user) return false;

    const moderatorIds = getModeratorUserIds();
    if (moderatorIds.includes(interaction.user.id)) return true;

    const member = interaction.member;
    if (!member?.roles?.cache) return false;

    const founderRoleIds = getFounderRoleIds();
    return founderRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

module.exports = {
    getFounderRoleIds,
    getModeratorUserIds,
    isStaffMember,
};
