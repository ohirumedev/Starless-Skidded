const User = require("../model/user.js");

if (!global.launcherParties) global.launcherParties = new Map();

const MAX_PARTY = 4;

function getPartyForAccount(accountId) {
    for (const party of global.launcherParties.values()) {
        if (party.members.some((m) => m.accountId === accountId)) return party;
    }
    return null;
}

function partyToJson(party) {
    return {
        partyId: party.partyId,
        leaderId: party.leaderId,
        members: party.members.map((m) => ({
            accountId: m.accountId,
            displayName: m.displayName,
            ready: !!m.ready,
        })),
        maxSize: MAX_PARTY,
    };
}

async function createParty(accountId, displayName) {
    const existing = getPartyForAccount(accountId);
    if (existing) return { success: true, party: partyToJson(existing) };

    const partyId = `party_${accountId}_${Date.now()}`;
    const party = {
        partyId,
        leaderId: accountId,
        members: [{ accountId, displayName, ready: false }],
    };
    global.launcherParties.set(partyId, party);
    return { success: true, party: partyToJson(party) };
}

async function inviteToParty(leaderAccountId, targetUsername) {
    const party = getPartyForAccount(leaderAccountId);
    if (!party || party.leaderId !== leaderAccountId) {
        return { success: false, message: "Create a party first (you must be leader)." };
    }
    if (party.members.length >= MAX_PARTY) {
        return { success: false, message: "Party is full." };
    }

    const user = await User.findOne({
        username: new RegExp(`^${String(targetUsername).trim()}$`, "i"),
    }).lean();
    if (!user) return { success: false, message: "Player not found." };
    if (party.members.some((m) => m.accountId === user.accountId)) {
        return { success: false, message: "Player is already in your party." };
    }

    const otherParty = getPartyForAccount(user.accountId);
    if (otherParty) return { success: false, message: "That player is already in another party." };

    party.members.push({
        accountId: user.accountId,
        displayName: user.username,
        ready: false,
    });

    return { success: true, party: partyToJson(party), message: `${user.username} joined the party.` };
}

function setReady(accountId, ready) {
    const party = getPartyForAccount(accountId);
    if (!party) return { success: false, message: "You are not in a party." };

    const member = party.members.find((m) => m.accountId === accountId);
    if (!member) return { success: false, message: "Party member not found." };

    member.ready = !!ready;
    return { success: true, party: partyToJson(party) };
}

function leaveParty(accountId) {
    const party = getPartyForAccount(accountId);
    if (!party) return { success: true, party: null };

    party.members = party.members.filter((m) => m.accountId !== accountId);
    if (party.members.length === 0) {
        global.launcherParties.delete(party.partyId);
        return { success: true, party: null };
    }

    if (party.leaderId === accountId) {
        party.leaderId = party.members[0].accountId;
    }

    return { success: true, party: partyToJson(party) };
}

function getParty(accountId) {
    const party = getPartyForAccount(accountId);
    return { success: true, party: party ? partyToJson(party) : null };
}

module.exports = {
    createParty,
    inviteToParty,
    setReady,
    leaveParty,
    getParty,
};
