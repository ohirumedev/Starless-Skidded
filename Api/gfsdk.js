/**
 * GET /phoenix/api/launcher/gfsdk
 * Serves GFSDK_Aftermath_Lib.x64.dll to the launcher.
 * The launcher downloads this and places it at:
 *   <fortnitePath>\27.11\Engine\Binaries\ThirdParty\Nvidia\NvidiaAftermath\GFSDK_Aftermath_Lib.x64.dll
 */
const express = require("express");
const app = express.Router();
const path = require("path");
const fs = require("fs");

app.get("/phoenix/api/launcher/gfsdk", (req, res) => {
    const dllPath = path.join(__dirname, "../Config/GFSDK_Aftermath_Lib.x64.dll");

    if (!fs.existsSync(dllPath)) {
        return res.status(404).json({ error: "GFSDK DLL not found on server. Place GFSDK_Aftermath_Lib.x64.dll in Config/." });
    }

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", 'attachment; filename="GFSDK_Aftermath_Lib.x64.dll"');
    res.sendFile(dllPath);
});

module.exports = app;
