const axios = require("axios");
const fs = require("fs");
const config = JSON.parse(fs.readFileSync("./Config/config.json").toString());
const User = require("../model/user.js");
const log = require("../structs/log.js");

const DISCORD_API_URL = "https://discord.com/api";

async function fetchDiscordAvatarHash(discordId) {
    const token = String(config?.discord?.bot_token || "").trim();
    if (!token || !discordId) return null;

    try {
        const res = await axios.get(`${DISCORD_API_URL}/v10/users/${discordId}`, {
            headers: { Authorization: `Bot ${token}` },
            timeout: 8000,
        });
        return res.data?.avatar || null;
    } catch (err) {
        log.debug(`Discord avatar fetch failed for ${discordId}: ${err.message}`);
        return null;
    }
}

async function resolveDiscordAvatarUrl(user) {
    if (!user?.discordId) return null;

    let hash = user.discordAvatar;
    if (!hash) {
        hash = await fetchDiscordAvatarHash(user.discordId);
        if (hash && user.accountId) {
            await User.updateOne({ accountId: user.accountId }, { discordAvatar: hash });
        }
    }

    if (hash) {
        return `https://cdn.discordapp.com/avatars/${user.discordId}/${hash}.png?size=128`;
    }

    try {
        const index = Number((BigInt(user.discordId) >> 22n) % 6n);
        return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
    } catch {
        return null;
    }
}

module.exports = { resolveDiscordAvatarUrl };
