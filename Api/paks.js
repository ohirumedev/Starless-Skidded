/**
 * GET /phoenix/api/launcher/paks
 * Returns the list of pak files the launcher should check/download before launching.
 * Add your pak CDN URLs here. The launcher will download missing ones to:
 *   <fortnitePath>\FortniteGame\Content\Paks\
 */
const express = require("express");
const app = express.Router();
const fs = require("fs");

function getConfig() {
  try { return JSON.parse(fs.readFileSync("./Config/config.json").toString()); }
  catch { return {}; }
}

app.get("/phoenix/api/launcher/paks", (req, res) => {
  const config = getConfig();

  // Define your paks here — or move them to config.json under "paks": [...]
  const paks = config.paks || [
    // Example format — replace with your actual CDN links:
    // {
    //   "filename": "pakchunk100-WindowsClient.pak",
    //   "url": "https://cdn.yourserver.com/paks/pakchunk100-WindowsClient.pak",
    //   "size": 52428800
    // }
  ];

  return res.json({
    success: true,
    paks,
    paksDir: "FortniteGame\\Content\\Paks",
    message: paks.length === 0
      ? "No paks required."
      : `${paks.length} pak(s) required.`,
  });
});

module.exports = app;
