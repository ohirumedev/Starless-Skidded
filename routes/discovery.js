const Express = require("express");
const app = Express.Router();
const discovery = require("./../responses/Discovery/discovery_frontend.json");

function getDiscoveryResults() {
    const panel = discovery.Panels?.[0];
    return panel?.Pages?.[0]?.results || [];
}

function getAllLinkData() {
    return getDiscoveryResults().map((entry) => entry.linkData);
}

function findLinkData(mnemonicOrCode) {
    for (const entry of getDiscoveryResults()) {
        const linkData = entry.linkData;
        if (
            linkData.mnemonic === mnemonicOrCode ||
            entry.linkCode === mnemonicOrCode
        ) {
            return linkData;
        }
    }
    return null;
}

function sendDiscoverySurface(req, res) {
    res.json(discovery);
}

app.get("*/api/v2/discovery/surface/*", sendDiscoverySurface);
app.post("*/api/v2/discovery/surface/*", sendDiscoverySurface);

app.get("*/discovery/surface/*", sendDiscoverySurface);
app.post("*/discovery/surface/*", sendDiscoverySurface);

app.get("/fortnite/api/discovery/accessToken/:branch", async (req, res) => {
    res.json({
        "branchName": req.params.branch,
        "appId": "Fortnite",
        "token": "IRISbackendogfncenteruwuwu"
    });
});

app.post("/links/api/fn/mnemonic", async (req, res) => {
    const all = getAllLinkData();

    if (Array.isArray(req.body) && req.body.length > 0) {
        const wanted = new Set(
            req.body.map((item) =>
                typeof item === "string" ? item : item.mnemonic || item.linkCode
            )
        );
        return res.json(all.filter((linkData) => wanted.has(linkData.mnemonic)));
    }

    if (req.body && Array.isArray(req.body.mnemonics)) {
        const wanted = new Set(req.body.mnemonics);
        return res.json(all.filter((linkData) => wanted.has(linkData.mnemonic)));
    }

    res.json(all);
});

app.get("/links/api/fn/mnemonic", async (req, res) => {
    res.json(getAllLinkData());
});

app.get("/links/api/fn/mnemonic/:playlist/related", async (req, res) => {
    const response = {
        parentLinks: [],
        links: {}
    };

    if (req.params.playlist) {
        const linkData = findLinkData(req.params.playlist);
        if (linkData) {
            response.links[req.params.playlist] = linkData;
        }
    }

    res.json(response);
});

app.get("/links/api/fn/mnemonic/*", async (req, res) => {
    const mnemonic = decodeURIComponent(req.url.split("/").slice(-1)[0]);
    const linkData = findLinkData(mnemonic);
    if (linkData) {
        return res.json(linkData);
    }
    res.status(404).end();
});

module.exports = app;
