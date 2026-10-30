const { MessageEmbed } = require("discord.js");
const log = require("./log.js");

const HWID_LOCK_MESSAGE =
  "you already created an account on this pc please login on that account!";

async function sendLauncherRegistrationDm(discordId, username, email, password) {
  if (!global.discordClient || !global.botConnected) {
    log.debug("Discord bot offline; could not DM launcher registration details.");
    return false;
  }

  try {
    const user = await global.discordClient.users.fetch(String(discordId).trim());
    const embed = new MessageEmbed()
      .setColor("#56ff00")
      .setTitle("Pulse Launcher — Account Created")
      .setDescription("Here are your Pulse account details. Keep them safe.")
      .addFields(
        { name: "Username", value: username, inline: true },
        { name: "Email", value: email, inline: true },
        { name: "Password", value: `||${password}||`, inline: true },
      )
      .setTimestamp()
      .setFooter({ text: "Pulse Servers" });

    await user.send({
      content: `Hello ${user.username}, your Pulse Launcher account was created successfully:`,
      embeds: [embed],
    });

    return true;
  } catch (err) {
    log.debug(`Launcher registration DM failed for ${discordId}: ${err.message}`);
    return false;
  }
}

module.exports = {
  HWID_LOCK_MESSAGE,
  sendLauncherRegistrationDm,
};
