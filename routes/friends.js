const express = require("express");
const app = express.Router();

const Friends = require("../model/friends.js");
const User = require("../model/user.js");
const friendManager = require("../structs/friend.js");
const functions = require("../structs/functions.js");
const log = require("../structs/log.js");
const { verifyToken } = require("../tokenManager/tokenVerify.js");

app.get("/friends/api/v1/*/settings", (req, res) => {
    res.json({});
});

app.put("/friends/api/v1/*/settings", verifyToken, (req, res) => {
    res.status(204).end();
});

app.get("/friends/api/v1/*/blocklist", (req, res) => {
    res.json([]);
});

app.get("/friends/api/public/list/fortnite/*/recentPlayers", (req, res) => {
    res.json([]);
});

app.all("/friends/api/v1/*/friends/:friendId/alias", verifyToken, async (req, res) => {
    res.status(204).end();
});

app.all("/friends/api/v1/*/friends/:friendId/note", verifyToken, (req, res) => {
    res.status(204).end();
});

// Get individual friend by ID
app.get("/friends/api/v1/:accountId/friends/:friendId", verifyToken, async (req, res) => {
    const friends = await Friends.findOne({ accountId: req.user.accountId }).lean();
    if (!friends) return res.status(404).json({ error: "not found" });

    const found = friends.list.accepted.find(i => i.accountId === req.params.friendId);
    if (!found) return res.status(404).json({ error: "friend not found" });

    res.json({
        accountId: found.accountId,
        groups: [],
        mutual: 0,
        alias: found.alias || "",
        note: "",
        favorite: false,
        created: found.created
    });
});

// Get all friends list (v1 style array)
app.get("/friends/api/v1/:accountId/friends", verifyToken, async (req, res) => {
    const friends = await Friends.findOne({ accountId: req.user.accountId }).lean();
    if (!friends) return res.json([]);

    res.json(friends.list.accepted.map(f => ({
        accountId: f.accountId,
        groups: [],
        mutual: 0,
        alias: f.alias || "",
        note: "",
        favorite: false,
        created: f.created
    })));
});

// Incoming friend requests (v1)
app.get("/friends/api/v1/:accountId/incoming", verifyToken, async (req, res) => {
    const friends = await Friends.findOne({ accountId: req.user.accountId }).lean();
    if (!friends) return res.json([]);

    res.json(friends.list.incoming.map(f => ({
        accountId: f.accountId,
        mutual: 0,
        favorite: false,
        created: f.created
    })));
});

// Outgoing friend requests (v1)
app.get("/friends/api/v1/:accountId/outgoing", verifyToken, async (req, res) => {
    const friends = await Friends.findOne({ accountId: req.user.accountId }).lean();
    if (!friends) return res.json([]);

    res.json(friends.list.outgoing.map(f => ({
        accountId: f.accountId,
        favorite: false,
        created: f.created
    })));
});

// Suggested friends (always empty — prevents 404)
app.get("/friends/api/v1/*/suggested", verifyToken, (req, res) => {
    res.json([]);
});

app.post("/friends/api/*/friends/:receiverId", verifyToken, async (req, res) => {
    const sender = await Friends.findOne({ accountId: req.user.accountId });
    const receiver = await Friends.findOne({ accountId: req.params.receiverId });
    if (!sender || !receiver) return res.status(403).end();

    if (sender.list.incoming.find(i => i.accountId == receiver.accountId)) {
        if (!await friendManager.acceptFriendReq(sender.accountId, receiver.accountId)) return res.status(403).end();
    } else if (!sender.list.outgoing.find(i => i.accountId == receiver.accountId)) {
        if (!await friendManager.sendFriendReq(sender.accountId, receiver.accountId)) return res.status(403).end();
    }

    res.status(204).end();
});

app.delete("/friends/api/*/friends/:receiverId", verifyToken, async (req, res) => {
    const sender = await Friends.findOne({ accountId: req.user.accountId });
    const receiver = await Friends.findOne({ accountId: req.params.receiverId });
    if (!sender || !receiver) return res.status(403).end();

    if (!await friendManager.deleteFriend(sender.accountId, receiver.accountId)) return res.status(403).end();

    res.status(204).end();
});

app.post("/friends/api/*/blocklist/:receiverId", verifyToken, async (req, res) => {
    const sender = await Friends.findOne({ accountId: req.user.accountId });
    const receiver = await Friends.findOne({ accountId: req.params.receiverId });
    if (!sender || !receiver) return res.status(403).end();

    if (!await friendManager.blockFriend(sender.accountId, receiver.accountId)) return res.status(403).end();

    res.status(204).end();
});

app.delete("/friends/api/*/blocklist/:receiverId", verifyToken, async (req, res) => {
    const sender = await Friends.findOne({ accountId: req.user.accountId });
    const receiver = await Friends.findOne({ accountId: req.params.receiverId });
    if (!sender || !receiver) return res.status(403).end();

    if (!await friendManager.deleteFriend(sender.accountId, receiver.accountId)) return res.status(403).end();

    res.status(204).end();
});

app.get("/friends/api/v1/:accountId/summary", verifyToken, async (req, res) => {
    const response = {
        "friends": [],
        "incoming": [],
        "outgoing": [],
        "suggested": [],
        "blocklist": [],
        "settings": {
            "acceptInvites": "public"
        }
    };

    const friends = await Friends.findOne({ accountId: req.user.accountId }).lean();
    if (!friends) return res.json(response);

    friends.list.accepted.forEach(acceptedFriend => {
        response.friends.push({
            "accountId": acceptedFriend.accountId,
            "groups": [],
            "mutual": 0,
            "alias": acceptedFriend.alias || "",
            "note": "",
            "favorite": false,
            "created": acceptedFriend.created
        });
    });

    friends.list.incoming.forEach(incomingFriend => {
        response.incoming.push({
            "accountId": incomingFriend.accountId,
            "mutual": 0,
            "favorite": false,
            "created": incomingFriend.created
        });
    });

    friends.list.outgoing.forEach(outgoingFriend => {
        response.outgoing.push({
            "accountId": outgoingFriend.accountId,
            "favorite": false,
            "created": outgoingFriend.created || new Date().toISOString()
        });
    });

    friends.list.blocked.forEach(blockedFriend => {
        response.blocklist.push({
            "accountId": blockedFriend.accountId
        });
    });

    res.json(response);
});

app.get("/friends/api/public/blocklist/*", verifyToken, async (req, res) => {
    const friends = await Friends.findOne({ accountId: req.user.accountId }).lean();
    if (!friends) return res.json({ "blockedUsers": [] });

    res.json({
        "blockedUsers": friends.list.blocked.map(i => i.accountId)
    });
});

module.exports = app;


module.exports = app;