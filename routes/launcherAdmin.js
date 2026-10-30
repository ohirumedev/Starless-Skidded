const express = require("express");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const app = express.Router();
const config = JSON.parse(fs.readFileSync("./Config/config.json").toString());
const User = require("../model/user.js");
const analytics = require("../structs/analytics.js");
const webhooks = require("../structs/webhooks.js");
const redisCache = require("../structs/redisCache.js");
const { isUserBanned } = require("../structs/anticheatServer.js");
const { findBannedHwid } = require("../structs/hwidManager.js");
const { findBannedIp } = require("../structs/ipBanManager.js");
const gameServerRegistry = require("../structs/gameServerRegistry.js");
const log = require("../structs/log.js");

function adminAuth(req, res, next) {
    const token = String(req.headers["x-admin-token"] || req.query.token || "").trim();
    const expected = String(config.adminPanel?.token || "").trim();
    if (!config.adminPanel?.enabled || !expected || token !== expected) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    next();
}

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pulse Admin Panel</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
    header { padding: 20px 32px; border-bottom: 1px solid #334155; display: flex; align-items: center; justify-content: space-between; }
    h1 { font-size: 1.4rem; background: linear-gradient(90deg, #22d3ee, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    main { padding: 24px 32px; max-width: 1200px; margin: 0 auto; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; margin-bottom: 28px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; }
    .card h3 { font-size: 0.75rem; text-transform: uppercase; color: #94a3b8; margin-bottom: 8px; }
    .card .val { font-size: 2rem; font-weight: 700; color: #a855f7; }
    section { margin-bottom: 32px; }
    section h2 { font-size: 1.1rem; margin-bottom: 12px; }
    input, select, button, textarea { padding: 10px 14px; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: #e2e8f0; font-size: 0.9rem; }
    button { background: #7c3aed; border-color: #7c3aed; cursor: pointer; font-weight: 600; }
    button:hover { background: #6d28d9; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; align-items: center; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #334155; font-size: 0.85rem; }
    th { color: #94a3b8; font-size: 0.75rem; text-transform: uppercase; }
    .msg { padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; display: none; }
    .msg.ok { background: #14532d; display: block; }
    .msg.err { background: #7f1d1d; display: block; }
    #tokenGate { max-width: 400px; margin: 80px auto; padding: 32px; background: #1e293b; border-radius: 16px; border: 1px solid #334155; }
  </style>
</head>
<body>
  <div id="tokenGate">
    <h1 style="margin-bottom:16px">Admin Login</h1>
    <p style="color:#94a3b8;margin-bottom:16px">Enter your admin token from config.json</p>
    <div class="row"><input id="tokenInput" type="password" placeholder="Admin token" style="flex:1" /></div>
    <button onclick="saveToken()">Enter Panel</button>
  </div>
  <div id="panel" style="display:none">
    <header><h1>Pulse Admin Panel</h1><button onclick="logout()">Logout</button></header>
    <main>
      <div id="msg" class="msg"></div>
      <div class="grid" id="stats"></div>
      <section>
        <h2>Live Players</h2>
        <table><thead><tr><th>Username</th><th>Account ID</th></tr></thead><tbody id="players"></tbody></table>
      </section>
      <section>
        <h2>Ban User</h2>
        <div class="row">
          <input id="banEmail" placeholder="Email" style="flex:1" />
          <input id="banReason" placeholder="Reason" style="flex:2" />
          <button onclick="banUser()">Ban</button>
        </div>
      </section>
      <section>
        <h2>Shop Cache</h2>
        <div class="row"><button onclick="rotateShop()">Clear Shop Cache (force refresh)</button></div>
      </section>
      <section>
        <h2>Popular Cosmetics</h2>
        <table><thead><tr><th>Template ID</th><th>Purchases</th></tr></thead><tbody id="popular"></tbody></table>
      </section>
    </main>
  </div>
  <script>
    let token = localStorage.getItem('pulse_admin_token') || '';
    if (token) { document.getElementById('tokenGate').style.display='none'; document.getElementById('panel').style.display='block'; load(); setInterval(load, 15000); }
    function saveToken() { token = document.getElementById('tokenInput').value; localStorage.setItem('pulse_admin_token', token); location.reload(); }
    function logout() { localStorage.removeItem('pulse_admin_token'); location.reload(); }
    function hdr() { return { 'Content-Type': 'application/json', 'X-Admin-Token': token }; }
    function showMsg(t, ok) { const m = document.getElementById('msg'); m.textContent = t; m.className = 'msg ' + (ok ? 'ok' : 'err'); setTimeout(() => m.className = 'msg', 4000); }
    async function load() {
      try {
        const r = await fetch('/phoenix/api/admin/dashboard', { headers: hdr() });
        if (r.status === 401) { logout(); return; }
        const d = await r.json();
        document.getElementById('stats').innerHTML = [
          ['DAU', d.dau], ['Players Online', d.playersOnline], ['Peak Concurrent', d.peakConcurrent],
          ['Retention %', d.retentionRate], ['Purchases Today', d.purchasesToday]
        ].map(([l,v]) => '<div class="card"><h3>'+l+'</h3><div class="val">'+v+'</div></div>').join('');
        document.getElementById('players').innerHTML = (d.livePlayers||[]).map(p=>'<tr><td>'+p.username+'</td><td>'+p.accountId+'</td></tr>').join('') || '<tr><td colspan="2">No players online</td></tr>';
        document.getElementById('popular').innerHTML = (d.popularCosmetics||[]).map(p=>'<tr><td>'+p.templateId+'</td><td>'+p.count+'</td></tr>').join('') || '<tr><td colspan="2">No data yet</td></tr>';
      } catch(e) { showMsg('Failed to load dashboard', false); }
    }
    async function banUser() {
      const email = document.getElementById('banEmail').value;
      const reason = document.getElementById('banReason').value;
      const r = await fetch('/phoenix/api/admin/ban', { method: 'POST', headers: hdr(), body: JSON.stringify({ email, reason }) });
      const d = await r.json(); showMsg(d.message || (d.success ? 'Banned' : 'Failed'), d.success);
    }
    async function rotateShop() {
      const r = await fetch('/phoenix/api/admin/shop/clear-cache', { method: 'POST', headers: hdr() });
      const d = await r.json(); showMsg(d.message || 'Done', d.success);
    }
  </script>
</body>
</html>`;

app.get("/phoenix/admin", (req, res) => {
    if (!config.adminPanel?.enabled) {
        return res.status(404).send("Admin panel disabled.");
    }
    res.type("html").send(ADMIN_HTML);
});

app.get("/phoenix/api/admin/dashboard", adminAuth, async (req, res) => {
    try {
        const summary = await analytics.getSummary();
        const livePlayers = (global.Clients || []).map((c) => ({
            username: c.displayName || c.accountId,
            accountId: c.accountId,
        }));
        const sessions = gameServerRegistry.listPublicSessions?.() || { sessions: [] };
        return res.json({ ...summary, livePlayers, gameSessions: sessions.sessions || [] });
    } catch (err) {
        log.error(`Admin dashboard error: ${err}`);
        return res.status(500).json({ success: false });
    }
});

app.post("/phoenix/api/admin/ban", adminAuth, async (req, res) => {
    try {
        const email = String(req.body?.email || "").trim().toLowerCase();
        const reason = String(req.body?.reason || "Banned via admin panel").trim();
        if (!email) return res.status(400).json({ success: false, message: "Email required." });

        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ success: false, message: "User not found." });

        user.banned = true;
        user.banReason = reason;
        user.banExpires = null;
        await user.save();

        await webhooks.notifyBan({
            username: user.username,
            accountId: user.accountId,
            reason,
            bannedBy: "Admin Panel",
        });

        await redisCache.del(`launcher:profile:${user.accountId}`);

        return res.json({ success: true, message: `Banned ${user.username}.` });
    } catch (err) {
        log.error(`Admin ban error: ${err}`);
        return res.status(500).json({ success: false, message: "Ban failed." });
    }
});

app.post("/phoenix/api/admin/shop/clear-cache", adminAuth, async (req, res) => {
    try {
        await redisCache.del("launcher:shop:items");
        return res.json({ success: true, message: "Shop cache cleared." });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Failed to clear cache." });
    }
});

module.exports = app;
