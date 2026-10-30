const { Client, Intents, MessageEmbed, Constants } = require("discord.js");
const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_MEMBERS, Intents.FLAGS.GUILD_BANS, Intents.FLAGS.DIRECT_MESSAGES] });
global.discordClient = client;
global.botConnected = false;
global.adminDiscordCommands = new Set();
const fs = require("fs");
const path = require("path");
const config = JSON.parse(fs.readFileSync("./Config/config.json").toString());
const log = require("../structs/log.js");
const Users = require("../model/user.js");
const { getFounderRoleIds, getModeratorUserIds, isStaffMember } = require("../structs/discordStaff.js");

let publicCommandData = [];
let adminCommandData = [];

function buildAdminCommandPermissions(guild) {
    const permissions = [];

    for (const roleId of getFounderRoleIds()) {
        permissions.push({
            id: roleId,
            type: Constants.ApplicationCommandPermissionTypes.ROLE,
            permission: true,
        });
    }

    for (const userId of getModeratorUserIds()) {
        permissions.push({
            id: userId,
            type: Constants.ApplicationCommandPermissionTypes.USER,
            permission: true,
        });
    }

    return permissions;
}

async function syncGuildAdminCommands(guild) {
    const founderRoles = getFounderRoleIds();
    const moderators = getModeratorUserIds();

    if (founderRoles.length === 0 && moderators.length === 0) {
        log.error(
            "No founderRoleIds or moderators in config.json — admin commands cannot be restricted. Add your Founder role ID.",
        );
        return;
    }

    try {
        await guild.members.fetch();
    } catch (err) {
        log.error(`Could not fetch members for guild ${guild.name}: ${err.message}`);
    }

    const allowPermissions = buildAdminCommandPermissions(guild);
    if (allowPermissions.length === 0) {
        log.error(`Guild ${guild.name}: no founder roles or moderators configured.`);
        return;
    }

    const registered = await guild.commands.set(adminCommandData);
    const fullPermissions = [];

    for (const command of registered.values()) {
        if (!global.adminDiscordCommands.has(command.name)) continue;

        fullPermissions.push({
            id: command.id,
            permissions: allowPermissions,
        });
    }

    if (fullPermissions.length > 0) {
        await guild.commands.permissions.set({ fullPermissions });
    }

    log.bot(
        `Guild ${guild.name}: ${fullPermissions.length} admin command(s) — founders/moderators only (not visible to regular members).`,
    );
}

async function syncAllCommands() {
    global.adminDiscordCommands.clear();
    publicCommandData = [];
    adminCommandData = [];

    const loadCommands = (dir) => {
        fs.readdirSync(dir).forEach(file => {
            const filePath = path.join(dir, file);
            if (fs.lstatSync(filePath).isDirectory()) {
                loadCommands(filePath);
            } else if (file.endsWith(".js")) {
                try {
                    delete require.cache[require.resolve(filePath)];
                    const command = require(filePath);
                    if (!command.commandInfo) return;

                    const commandInfo = { ...command.commandInfo };
                    const isAdmin = filePath.includes(`${path.sep}Admin${path.sep}`);

                    if (isAdmin) {
                        global.adminDiscordCommands.add(commandInfo.name);
                        commandInfo.defaultPermission = false;
                        commandInfo.dmPermission = false;
                        adminCommandData.push(commandInfo);
                    } else {
                        publicCommandData.push(commandInfo);
                    }
                } catch (err) {
                    log.error(`Failed to load command at ${filePath}: ${err}`);
                }
            }
        });
    };

    loadCommands(path.join(__dirname, "commands"));

    await client.application.commands.set(publicCommandData);
    log.bot(`Synced ${publicCommandData.length} public command(s) globally (visible to all members).`);

    for (const guild of client.guilds.cache.values()) {
        try {
            await syncGuildAdminCommands(guild);
        } catch (err) {
            log.error(`Failed to sync admin commands in guild ${guild.id}: ${err.message}`);
        }
    }
}

client.once("ready", async () => {
    global.botConnected = true;
    log.bot("Bot is up and running!");

    if (config.bEnableBackendStatus) {
        if (!config.bBackendStatusChannelId || config.bBackendStatusChannelId.trim() === "") {
            log.error("The channel ID has not been set in config.json for bEnableBackendStatus.");
        } else {
            const channel = client.channels.cache.get(config.bBackendStatusChannelId);
            if (!channel) {
                log.error(`Cannot find the channel with ID ${config.bBackendStatusChannelId}`);
            } else {
                const embed = new MessageEmbed()
                    .setTitle("Backend Online")
                    .setDescription("IRIS Backend is now online")
                    .setColor("GREEN")
                    .setThumbnail("https://i.imgur.com/essv7b1.png")
                    .setFooter({
                        text: "IRIS Backend",
                        iconURL: "https://i.imgur.com/essv7b1.png",
                    })
                    .setTimestamp();

                channel.send({ embeds: [embed] }).catch(err => {
                    log.error(err);
                });
            }
        }
    }

    if (config.discord.bEnableInGamePlayerCount) {
        function updateBotStatus() {
            if (global.Clients && Array.isArray(global.Clients)) {
                client.user.setActivity(`${global.Clients.length} Players In-Game`, { type: "WATCHING" });
            }
        }

        updateBotStatus();
        setInterval(updateBotStatus, 10000);
    }

    try {
        await syncAllCommands();
    } catch (err) {
        log.error(`Failed to sync application commands: ${err}`);
    }
});

client.on("guildCreate", async (guild) => {
    try {
        await syncGuildAdminCommands(guild);
    } catch (err) {
        log.error(`Failed to register admin commands in new guild ${guild.id}: ${err.message}`);
    }
});

client.on("interactionCreate", async interaction => {
    if (interaction.isApplicationCommand() && global.adminDiscordCommands.has(interaction.commandName)) {
        if (!isStaffMember(interaction)) {
            return interaction.reply({
                content: "You do not have permission to use admin commands. Only founders can use these.",
                ephemeral: true,
            });
        }
    }

    const executeCommand = (dir, commandName) => {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
            const entryPath = path.join(dir, entry);
            if (fs.lstatSync(entryPath).isDirectory()) {
                if (executeCommand(entryPath, commandName)) return true;
                continue;
            }

            if (!entry.endsWith(".js")) continue;

            try {
                delete require.cache[require.resolve(entryPath)];
                const command = require(entryPath);
                if (!command.commandInfo || command.commandInfo.name !== commandName) continue;

                if (interaction.isApplicationCommand()) {
                    command.execute(interaction);
                } else if (interaction.isAutocomplete() && command.autocomplete) {
                    command.autocomplete(interaction);
                }
                return true;
            } catch (err) {
                log.error(`Failed to execute command at ${entryPath}: ${err}`);
            }
        }
        return false;
    };

    if (interaction.isApplicationCommand() || interaction.isAutocomplete()) {
        executeCommand(path.join(__dirname, "commands"), interaction.commandName);
    }
});

client.on("guildBanAdd", async (ban) => {
    if (!config.bEnableCrossBans)
        return;

    const memberBan = await ban.fetch();

    if (memberBan.user.bot)
        return;

    const userData = await Users.findOne({ discordId: memberBan.user.id });

    if (userData && userData.banned !== true) {
        await userData.updateOne({ $set: { banned: true } });

        let refreshToken = global.refreshTokens.findIndex(i => i.accountId == userData.accountId);

        if (refreshToken != -1)
            global.refreshTokens.splice(refreshToken, 1);
        let accessToken = global.accessTokens.findIndex(i => i.accountId == userData.accountId);

        if (accessToken != -1) {
            global.accessTokens.splice(accessToken, 1);
            let xmppClient = global.Clients.find(client => client.accountId == userData.accountId);
            if (xmppClient)
                xmppClient.client.close();
        }

        if (accessToken != -1 || refreshToken != -1) {
            await functions.UpdateTokens();
        }

        log.debug(`user ${memberBan.user.username} (ID: ${memberBan.user.id}) was banned on the discord and also in the game (Cross Ban active).`);
    }
});

client.on("guildBanRemove", async (ban) => {
    if (!config.bEnableCrossBans)
        return;

    if (ban.user.bot)
        return;

    const userData = await Users.findOne({ discordId: ban.user.id });

    if (userData && userData.banned === true) {
        await userData.updateOne({ $set: { banned: false } });

        log.debug(`User ${ban.user.username} (ID: ${ban.user.id}) is now unbanned.`);
    }
});


client.on("error", (err) => {
    log.error("Discord API Error:", err);
});

process.on("unhandledRejection", (reason, p) => {
    log.error("Unhandled promise rejection:", reason, p);
});

process.on("uncaughtException", (err, origin) => {
    log.error("Uncaught Exception:", err, origin);
});

process.on("uncaughtExceptionMonitor", (err, origin) => {
    log.error("Uncaught Exception Monitor:", err, origin);
});

if (!config.discord.bot_token || config.discord.bot_token.trim() === "") {
    log.error("Discord bot token is not set in config.json! Please add your bot token to enable the Discord bot.");
    global.botConnected = false;
} else {
    client.login(config.discord.bot_token).catch(err => {
        log.error("Failed to login to Discord bot. Please check your bot token in config.json");
        log.error(`Discord login error: ${err.message}`);
        global.botConnected = false;
    });
}
