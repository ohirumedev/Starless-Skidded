const config = require("../Config/config.json");

if (!global.launcherChatMessages) global.launcherChatMessages = [];

const MAX_MESSAGES = 250;

function isEnabled() {
    return config?.chat?.EnableGlobalChat !== false;
}

function listMessages(sinceMs = 0) {
    if (!isEnabled()) return [];
    const since = Number(sinceMs) || 0;
    return global.launcherChatMessages.filter((m) => m.sentAt >= since);
}

function sendMessage(accountId, displayName, text) {
    if (!isEnabled()) {
        return { success: false, message: "Global chat is disabled on this backend." };
    }

    const body = String(text || "").trim();
    if (!body) return { success: false, message: "Message cannot be empty." };
    if (body.length > 280) return { success: false, message: "Message is too long (280 max)." };

    const msg = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        accountId,
        displayName: String(displayName || "Player").slice(0, 32),
        text: body,
        sentAt: Date.now(),
    };

    global.launcherChatMessages.push(msg);
    if (global.launcherChatMessages.length > MAX_MESSAGES) {
        global.launcherChatMessages.splice(0, global.launcherChatMessages.length - MAX_MESSAGES);
    }

    return { success: true, message: msg };
}

module.exports = {
    isEnabled,
    listMessages,
    sendMessage,
};
