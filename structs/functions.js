const XMLBuilder = require("xmlbuilder");
const uuid = require("uuid");
const bcrypt = require("bcrypt");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const log = require("./log.js");

const User = require("../model/user.js");
const Profile = require("../model/profiles.js");
const profileManager = require("../structs/profile.js");
const Friends = require("../model/friends.js");
const SaCCodes = require("../model/saccodes.js");
const Arena = require("../model/arena.js");
const TournamentStanding = require("../model/tournamentStanding.js");
const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../Config/config.json")).toString(),
);

async function sleep(ms) {
  await new Promise((resolve, reject) => {
    setTimeout(resolve, ms);
  });
}

function GetVersionInfo(req) {
  let memory = {
    season: 0,
    build: 0.0,
    CL: "0",
    lobby: "",
  };

  if (req.headers["user-agent"]) {
    let CL = "";

    try {
      let BuildID = req.headers["user-agent"].split("-")[3].split(",")[0];

      if (!Number.isNaN(Number(BuildID))) CL = BuildID;
      else {
        BuildID = req.headers["user-agent"].split("-")[3].split(" ")[0];

        if (!Number.isNaN(Number(BuildID))) CL = BuildID;
      }
    } catch {
      try {
        let BuildID = req.headers["user-agent"].split("-")[1].split("+")[0];

        if (!Number.isNaN(Number(BuildID))) CL = BuildID;
      } catch {}
    }

    try {
      let Build = req.headers["user-agent"].split("Release-")[1].split("-")[0];

      if (Build.split(".").length == 3) {
        let Value = Build.split(".");
        Build = Value[0] + "." + Value[1] + Value[2];
      }

      memory.season = Number(Build.split(".")[0]);
      memory.build = Number(Build);
      memory.CL = CL;
      memory.lobby = `LobbySeason${memory.season}`;

      if (Number.isNaN(memory.season)) throw new Error();
    } catch {
      if (Number(memory.CL) < 3724489) {
        memory.season = 0;
        memory.build = 0.0;
        memory.CL = CL;
        memory.lobby = "LobbySeason0";
      } else if (Number(memory.CL) <= 3790078) {
        memory.season = 1;
        memory.build = 1.0;
        memory.CL = CL;
        memory.lobby = "LobbySeason1";
      } else {
        memory.season = 2;
        memory.build = 2.0;
        memory.CL = CL;
        memory.lobby = "LobbyWinterDecor";
      }
    }
  }

  return memory;
}

function getContentPages(req) {
  const memory = GetVersionInfo(req);

  const contentpages = JSON.parse(
    fs
      .readFileSync(
        path.join(__dirname, "..", "responses", "contentpages.json"),
      )
      .toString(),
  );

  let Language = "en";

  try {
    if (req.headers["accept-language"]) {
      if (
        req.headers["accept-language"].includes("-") &&
        req.headers["accept-language"] != "es-419"
      ) {
        Language = req.headers["accept-language"].split("-")[0];
      } else {
        Language = req.headers["accept-language"];
      }
    }
  } catch {}

  const modes = [
    "saveTheWorldUnowned",
    "battleRoyale",
    "creative",
    "saveTheWorld",
  ];
  const news = ["savetheworldnews", "battleroyalenews"];

  try {
    modes.forEach((mode) => {
      contentpages.subgameselectdata[mode].message.title =
        contentpages.subgameselectdata[mode].message.title[Language];
      contentpages.subgameselectdata[mode].message.body =
        contentpages.subgameselectdata[mode].message.body[Language];
    });
  } catch {}

  try {
    if (memory.build < 5.3) {
      news.forEach((mode) => {
        contentpages[mode].news.messages[0].image =
          "https://cdn.discordapp.com/attachments/927739901540188200/930879507496308736/discord.png";
        contentpages[mode].news.messages[1].image =
          "https://i.imgur.com/essv7b1.png";
      });
    }
  } catch {}

  try {
    contentpages.dynamicbackgrounds.backgrounds.backgrounds[0].stage = `season${memory.season}`;
    contentpages.dynamicbackgrounds.backgrounds.backgrounds[1].stage = `season${memory.season}`;

    if (memory.season == 10) {
      contentpages.dynamicbackgrounds.backgrounds.backgrounds[0].stage =
        "seasonx";
      contentpages.dynamicbackgrounds.backgrounds.backgrounds[1].stage =
        "seasonx";
    }

    if (memory.season === 14 || memory.build === 14.4) {
      contentpages.dynamicbackgrounds.backgrounds.backgrounds[0].stage = "summer";
      contentpages.dynamicbackgrounds.backgrounds.backgrounds[1].stage = "summer";
    }

    if (memory.build == 19.01) {
      contentpages.dynamicbackgrounds.backgrounds.backgrounds[0].stage =
        "winter2021";
      contentpages.dynamicbackgrounds.backgrounds.backgrounds[0].backgroundimage =
        "https://cdn.discordapp.com/attachments/927739901540188200/930880158167085116/t-bp19-lobby-xmas-2048x1024-f85d2684b4af.png";
      contentpages.subgameinfo.battleroyale.image =
        "https://cdn.discordapp.com/attachments/927739901540188200/930880421514846268/19br-wf-subgame-select-512x1024-16d8bb0f218f.jpg";
      contentpages.specialoffervideo.bSpecialOfferEnabled = "true";
    }

    if (memory.season == 20) {
      if (memory.build == 20.4) {
        contentpages.dynamicbackgrounds.backgrounds.backgrounds[0].backgroundimage =
          "https://cdn2.unrealengine.com/t-bp20-40-armadillo-glowup-lobby-2048x2048-2048x2048-3b83b887cc7f.jpg";
      } else {
        contentpages.dynamicbackgrounds.backgrounds.backgrounds[0].backgroundimage =
          "https://cdn2.unrealengine.com/t-bp20-lobby-2048x1024-d89eb522746c.png";
      }
    }

    if (memory.season == 21) {
      contentpages.dynamicbackgrounds.backgrounds.backgrounds[0].backgroundimage =
        "https://cdn2.unrealengine.com/s21-lobby-background-2048x1024-2e7112b25dc3.jpg";

      if (memory.build == 21.1) {
        contentpages.dynamicbackgrounds.backgrounds.backgrounds[0].stage =
          "season2100";
      }
      if (memory.build == 21.3) {
        contentpages.dynamicbackgrounds.backgrounds.backgrounds[0].backgroundimage =
          "https://cdn2.unrealengine.com/nss-lobbybackground-2048x1024-f74a14565061.jpg";
        contentpages.dynamicbackgrounds.backgrounds.backgrounds[0].stage =
          "season2130";
      }
    }

    if (memory.season == 22) {
      contentpages.dynamicbackgrounds.backgrounds.backgrounds[0].backgroundimage =
        "https://cdn2.unrealengine.com/t-bp22-lobby-square-2048x2048-2048x2048-e4e90c6e8018.jpg";
    }

    if (memory.season == 23) {
      if (memory.build == 23.1) {
        contentpages.dynamicbackgrounds.backgrounds.backgrounds[0].backgroundimage =
          "https://cdn2.unrealengine.com/t-bp23-winterfest-lobby-square-2048x2048-2048x2048-277a476e5ca6.png";
        contentpages.specialoffervideo.bSpecialOfferEnabled = "true";
      } else {
        contentpages.dynamicbackgrounds.backgrounds.backgrounds[0].backgroundimage =
          "https://cdn2.unrealengine.com/t-bp20-lobby-2048x1024-d89eb522746c.png";
      }
    }

    if (memory.season == 24) {
      contentpages.dynamicbackgrounds.backgrounds.backgrounds[0].backgroundimage =
        "https://cdn2.unrealengine.com/t-ch4s2-bp-lobby-4096x2048-edde08d15f7e.jpg";
    }

    if (memory.season == 25) {
      contentpages.dynamicbackgrounds.backgrounds.backgrounds[0].backgroundimage =
        "https://cdn2.unrealengine.com/s25-lobby-4k-4096x2048-4a832928e11f.jpg";
      contentpages.dynamicbackgrounds.backgrounds.backgrounds[0].backgroundimage =
        "https://cdn2.unrealengine.com/fn-shop-ch4s3-04-1920x1080-785ce1d90213.png";

      if (memory.build == 25.11) {
        contentpages.dynamicbackgrounds.backgrounds.backgrounds[0].backgroundimage =
          "https://cdn2.unrealengine.com/t-s25-14dos-lobby-4096x2048-2be24969eee3.jpg";
      }
    }

    if (memory.season == 27) {
      contentpages.dynamicbackgrounds.backgrounds.backgrounds[0].stage =
        "rufus";
    }

    if (memory.season >= 19) {
      const shopVaultStage = memory.season === 19 ? "worldcup" : "default";
      contentpages.shopSections.sectionList.sections = [
        {
          bSortOffersByOwnership: false,
          bShowIneligibleOffersIfGiftable: false,
          bEnableToastNotification: true,
          background: {
            stage: shopVaultStage,
            _type: "DynamicBackground",
            key: "vault",
          },
          _type: "ShopSection",
          landingPriority: 100,
          bHidden: false,
          sectionId: "Bundles",
          bShowTimer: true,
          sectionDisplayName: "Bundles",
          bShowIneligibleOffers: true,
        },
        {
          bSortOffersByOwnership: false,
          bShowIneligibleOffersIfGiftable: false,
          bEnableToastNotification: true,
          background: {
            stage: shopVaultStage,
            _type: "DynamicBackground",
            key: "vault",
          },
          _type: "ShopSection",
          landingPriority: 40,
          bHidden: false,
          sectionId: "Daily",
          bShowTimer: true,
          sectionDisplayName: "Daily",
          bShowIneligibleOffers: true,
        },
      ];
    }
  } catch {}

  return contentpages;
}

function mtxPlatformMatches(currencyItem, profile) {
  const platform = (currencyItem.attributes?.platform || "shared").toLowerCase();
  const current = (
    profile.stats?.attributes?.current_mtx_platform || "epicpc"
  ).toLowerCase();
  if (platform === "shared") return true;
  if (platform === current) return true;
  if (
    (platform === "epic" || platform === "epicpc") &&
    (current === "epic" || current === "epicpc")
  ) {
    return true;
  }
  return false;
}

function deductMtxCurrency(commonCore, profile0, amount) {
  if (!commonCore?.items || amount <= 0) return { ok: false };

  for (const key in commonCore.items) {
    const item = commonCore.items[key];
    if (!item?.templateId?.toLowerCase().startsWith("currency:mtx")) continue;
    if (!mtxPlatformMatches(item, commonCore)) continue;

    const balance = Number(item.quantity) || 0;
    if (balance < amount) {
      return { ok: false, balance, required: amount };
    }

    item.quantity = balance - amount;
    if (profile0?.items?.["Currency:MtxPurchased"]) {
      profile0.items["Currency:MtxPurchased"].quantity = Math.max(
        0,
        (Number(profile0.items["Currency:MtxPurchased"].quantity) || 0) -
          amount,
      );
    }

    return { ok: true, itemId: key, quantity: item.quantity };
  }

  return { ok: false, balance: 0, required: amount };
}

function getBattlePassSeason(memory) {
  if (config.bEnableBattlepass && config.bBattlePassSeason) {
    return Number(config.bBattlePassSeason);
  }
  return memory?.season || 19;
}

function getItemShop() {
  let catalog;
  let CatalogConfig;

  try {
    catalog = JSON.parse(
      fs
        .readFileSync(path.join(__dirname, "..", "responses", "catalog.json"))
        .toString(),
    );
    CatalogConfig = JSON.parse(
      fs
        .readFileSync(
          path.join(__dirname, "..", "Config", "catalog_config.json"),
        )
        .toString(),
    );
  } catch (error) {
    log.error("Failed to read catalog files:", error);
    if (!catalog) {
      try {
        catalog = JSON.parse(
          fs
            .readFileSync(
              path.join(__dirname, "..", "responses", "catalog.json"),
            )
            .toString(),
        );
      } catch (e) {
        log.error("CRITICAL: Failed to read base catalog.json", e);
        return { storefronts: [] };
      }
    }
    CatalogConfig = {};
  }

  const todayAtMidnight = new Date();
  todayAtMidnight.setHours(24, 0, 0, 0);
  const todayOneMinuteBeforeMidnight = new Date(
    todayAtMidnight.getTime() - 60000,
  );
  const isoDate = todayOneMinuteBeforeMidnight.toISOString();

  const weeklyIndex = catalog.storefronts.findIndex(
    (p) => p.name === "BRWeeklyStorefront",
  );
  const dailyIndex = catalog.storefronts.findIndex(
    (p) => p.name === "BRDailyStorefront",
  );
  if (weeklyIndex !== -1) catalog.storefronts[weeklyIndex].catalogEntries = [];
  if (dailyIndex !== -1) catalog.storefronts[dailyIndex].catalogEntries = [];

  let bundleSlot = 0;
  let dailySlot = 0;

  try {
    for (let value in CatalogConfig) {
      if (value.startsWith("//")) continue;
      if (!Array.isArray(CatalogConfig[value].itemGrants)) continue;
      if (CatalogConfig[value].itemGrants.length == 0) continue;

      const key = value.toLowerCase();
      const isBundle =
        key.startsWith("bundle") || CatalogConfig[value].itemGrants.length > 1;
      const isDaily = key.startsWith("daily");
      const isFeatured = key.startsWith("featured");

      const sectionId = isBundle || isFeatured ? "Bundles" : "Daily";
      const tileSize =
        isBundle && bundleSlot === 0 ? "Large" : isBundle ? "Normal" : "Small";
      const storefrontIndex = isDaily ? dailyIndex : weeklyIndex;
      if (storefrontIndex === -1) continue;

      const CatalogEntry = {
        devName: "",
        offerId: "",
        fulfillmentIds: [],
        dailyLimit: -1,
        weeklyLimit: -1,
        monthlyLimit: -1,
        categories: isBundle ? ["Panel 0"] : [],
        prices: [
          {
            currencyType: "MtxCurrency",
            currencySubType: "",
            regularPrice: 0,
            finalPrice: 0,
            saleExpiration: "9999-12-02T01:12:00Z",
            basePrice: 0,
          },
        ],
        meta: { SectionId: sectionId, TileSize: tileSize },
        matchFilter: "",
        filterWeight: 0,
        appStoreId: [],
        requirements: [],
        offerType: "StaticPrice",
        giftInfo: {
          bIsEnabled: true,
          forcedGiftBoxTemplateId: "",
          purchaseRequirements: [],
          giftRecordIds: [],
        },
        refundable: true,
        metaInfo: [
          { key: "SectionId", value: sectionId },
          { key: "TileSize", value: tileSize },
        ],
        displayAssetPath: "",
        itemGrants: [],
        sortPriority: isBundle ? -200 + bundleSlot : dailySlot,
        catalogGroupPriority: isBundle ? 0 : 1,
      };

      if (isBundle) bundleSlot += 1;
      if (isDaily) dailySlot += 1;

      for (let itemGrant of CatalogConfig[value].itemGrants) {
        if (typeof itemGrant != "string") continue;
        if (itemGrant.length == 0) continue;

        CatalogEntry.itemGrants.push({ templateId: itemGrant, quantity: 1 });
      }

      if (isBundle) {
        CatalogEntry.devName = `BR.ItemShop.Bundle.${bundleSlot}`;
        CatalogEntry.metaInfo.push({ key: "RowName", value: CatalogEntry.devName });
        const primary = CatalogConfig[value].itemGrants[0] || "";
        if (primary.toLowerCase().startsWith("athenacharacter:")) {
          const cid = primary.split(":")[1];
          CatalogEntry.displayAssetPath = `/Game/Catalog/DisplayAssets/DA_Featured_${cid}.DA_Featured_${cid}`;
        }
      } else {
        CatalogEntry.devName = `BR.ItemShop.Daily.${dailySlot}`;
      }

      CatalogEntry.prices = [
        {
          currencyType: "MtxCurrency",
          currencySubType: "",
          regularPrice: CatalogConfig[value].price,
          finalPrice: CatalogConfig[value].price,
          saleExpiration: isoDate,
          basePrice: CatalogConfig[value].price,
        },
      ];

      if (CatalogEntry.itemGrants.length > 0) {
        let uniqueIdentifier = crypto
          .createHash("sha1")
          .update(
            `${JSON.stringify(CatalogConfig[value].itemGrants)}_${CatalogConfig[value].price}`,
          )
          .digest("hex");

        if (!CatalogEntry.devName || CatalogEntry.devName.startsWith("BR.ItemShop")) {
          CatalogEntry.offerId = uniqueIdentifier;
        } else {
          CatalogEntry.devName = uniqueIdentifier;
          CatalogEntry.offerId = uniqueIdentifier;
        }

        catalog.storefronts[storefrontIndex].catalogEntries.push(CatalogEntry);
      }
    }
  } catch {}

  const storefrontOrder = [
    "BRWeeklyStorefront",
    "BRDailyStorefront",
    "BRSeasonStorefront",
  ];
  catalog.storefronts.sort(
    (a, b) => storefrontOrder.indexOf(a.name) - storefrontOrder.indexOf(b.name),
  );

  for (const storefront of catalog.storefronts) {
    if (
      storefront.name === "BRWeeklyStorefront" ||
      storefront.name === "BRDailyStorefront"
    ) {
      storefront.catalogEntries.sort(
        (a, b) => (a.sortPriority || 0) - (b.sortPriority || 0),
      );
    }
  }

  return catalog;
}

function getOfferID(offerId) {
  const catalog = getItemShop();

  for (let storefront of catalog.storefronts) {
    let findOfferId = storefront.catalogEntries.find(
      (i) => i.offerId == offerId,
    );

    if (findOfferId)
      return {
        name: storefront.name,
        offerId: findOfferId,
      };
  }

  try {
    const staticCatalog = JSON.parse(
      fs
        .readFileSync(path.join(__dirname, "..", "responses", "catalog.json"))
        .toString(),
    );
    for (const storefront of staticCatalog.storefronts || []) {
      const entry = (storefront.catalogEntries || []).find(
        (i) => i.offerId === offerId,
      );
      if (entry) {
        return { name: storefront.name, offerId: entry };
      }
    }
  } catch (err) {
    log.debug(`getOfferID: static catalog lookup failed: ${err.message}`);
  }
}

function MakeID() {
  return uuid.v4();
}

function sendXmppMessageToAll(body) {
  if (!global.Clients) return;
  if (typeof body == "object") body = JSON.stringify(body);

  global.Clients.forEach((ClientData) => {
    ClientData.client.send(
      XMLBuilder.create("message")
        .attribute("from", `xmpp-admin@${global.xmppDomain}`)
        .attribute("xmlns", "jabber:client")
        .attribute("to", ClientData.jid)
        .element("body", `${body}`)
        .up()
        .toString(),
    );
  });
}

function sendXmppMessageToId(body, toAccountId) {
  if (!global.Clients) return;
  if (typeof body == "object") body = JSON.stringify(body);

  let receiver = global.Clients.find((i) => i.accountId == toAccountId);
  if (!receiver) return;

  receiver.client.send(
    XMLBuilder.create("message")
      .attribute("from", `xmpp-admin@${global.xmppDomain}`)
      .attribute("to", receiver.jid)
      .attribute("xmlns", "jabber:client")
      .element("body", `${body}`)
      .up()
      .toString(),
  );
}

function getPresenceFromUser(fromId, toId, offline) {
  if (!global.Clients) return;

  let SenderData = global.Clients.find((i) => i.accountId == fromId);
  let ClientData = global.Clients.find((i) => i.accountId == toId);

  if (!SenderData || !ClientData) return;

  let xml = XMLBuilder.create("presence")
    .attribute("to", ClientData.jid)
    .attribute("xmlns", "jabber:client")
    .attribute("from", SenderData.jid)
    .attribute("type", offline ? "unavailable" : "available");

  if (SenderData.lastPresenceUpdate.away)
    xml = xml
      .element("show", "away")
      .up()
      .element("status", SenderData.lastPresenceUpdate.status)
      .up();
  else xml = xml.element("status", SenderData.lastPresenceUpdate.status).up();

  ClientData.client.send(xml.toString());
}

async function registerUser(discordId, username, email, plainPassword, launcherHwid = null, googleId = null) {
  email = email.toLowerCase();

  if (!username || !email || !plainPassword) {
    return {
      message: "Username, email, or password is required.",
      status: 400,
    };
  }

  if (launcherHwid) {
    const { HWID_LOCK_MESSAGE } = require("./launcherDiscord.js");
    if (await User.findOne({ launcherHwid })) {
      return { message: HWID_LOCK_MESSAGE, status: 403, hwidLocked: true };
    }
  }

  if (discordId && (await User.findOne({ discordId }))) {
    return { message: "You already created an account!", status: 400 };
  }

  if (googleId && (await User.findOne({ googleId }))) {
    return { message: "This Google account already has a Pulse account.", status: 400 };
  }

  if (await User.findOne({ email })) {
    return { message: "Email is already in use.", status: 400 };
  }

  if (await User.findOne({ username_lower: username.toLowerCase() })) {
    return {
      message: `The username "${username}" is already taken. Choose another or sign in.`,
      status: 409,
    };
  }

  const accountId = MakeID().replace(/-/gi, "");
  const matchmakingId = MakeID().replace(/-/gi, "");

  const emailFilter =
    /^([a-zA-Z0-9_\.\-])+\@(([a-zA-Z0-9\-])+\.)+([a-zA-Z0-9]{2,4})+$/;
  if (!emailFilter.test(email)) {
    return {
      message: "You did not provide a valid email address.",
      status: 400,
    };
  }
  if (username.length >= 25) {
    return {
      message: "Your username must be less than 25 characters long.",
      status: 400,
    };
  }
  if (username.length < 3) {
    return {
      message: "Your username must be at least 3 characters long.",
      status: 400,
    };
  }
  if (plainPassword.length >= 128) {
    return {
      message: "Your password must be less than 128 characters long.",
      status: 400,
    };
  }
  if (plainPassword.length < 4) {
    return {
      message: "Your password must be at least 4 characters long.",
      status: 400,
    };
  }

  const allowedCharacters =
    " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~".split(
      "",
    );
  for (let character of username) {
    if (!allowedCharacters.includes(character)) {
      return {
        message:
          "Your username has special characters, please remove them and try again.",
        status: 400,
      };
    }
  }

  const hashedPassword = await bcrypt.hash(plainPassword, 10);

  const userDoc = {
    created: new Date().toISOString(),
    accountId,
    username,
    username_lower: username.toLowerCase(),
    email,
    password: hashedPassword,
    matchmakingId,
  };

  if (discordId) userDoc.discordId = discordId;
  if (googleId) userDoc.googleId = googleId;
  if (launcherHwid) userDoc.launcherHwid = launcherHwid;

  try {
    await User.create(userDoc).then(async (i) => {
      await Profile.create({
        created: i.created,
        accountId: i.accountId,
        profiles: profileManager.createProfiles(i.accountId),
      });
      await Friends.create({ created: i.created, accountId: i.accountId });
      await Arena.create({ accountId: i.accountId, hype: 0, division: 0 });
    });
  } catch (err) {
    log.error("Error during user registration:", err);
    if (err.code == 11000) {
      const dupField = err.keyPattern ? Object.keys(err.keyPattern)[0] : "";
      const { HWID_LOCK_MESSAGE } = require("./launcherDiscord.js");

      if (dupField === "username" || dupField === "username_lower") {
        return {
          message: `The username "${username}" is already taken. Choose another or sign in.`,
          status: 409,
        };
      }
      if (dupField === "email") {
        return {
          message: `The email "${email}" is already registered. Sign in instead.`,
          status: 409,
        };
      }
      if (dupField === "googleId") {
        const dupValue = err.keyValue?.googleId;
        if (dupValue == null) {
          return {
            message: "Registration failed due to a database conflict. Restart the backend and try again.",
            status: 500,
          };
        }
        return {
          message: "This Google account already has a Pulse account. Please sign in instead.",
          status: 409,
        };
      }
      if (dupField === "discordId") {
        const dupValue = err.keyValue?.discordId;
        if (dupValue == null) {
          return {
            message: "Registration failed due to a database conflict. Restart the backend and try again.",
            status: 500,
          };
        }
        return {
          message: "This Discord account already has a Pulse account. Please sign in instead.",
          status: 409,
        };
      }
      if (dupField === "launcherHwid") {
        return { message: HWID_LOCK_MESSAGE, status: 403, hwidLocked: true };
      }

      return { message: "Username or email is already in use. Try signing in instead.", status: 409 };
    }

    return {
      message: "An unknown error has occurred, please try again later.",
      status: 400,
    };
  }

  return {
    message: `Successfully created an account with the username **${username}**`,
    status: 200,
  };
}

async function createSAC(code, username, creator) {
  if (!code || !username)
    return {
      message: "**Code** or **Ingame Username** is required.",
      status: 400,
    };

  const account = await User.findOne({ username });

  if (account == null) return { message: `**${username}** doesnt exist!` };

  if (await SaCCodes.findOne({ code }))
    return { message: `**${code}** already exist!`, status: 400 };

  if (await SaCCodes.findOne({ owneraccountId: account.accountId }))
    return {
      message: `**${username}** already has an **Code** (**${code}**)!`,
      status: 400,
    };
  const creatorprofile = await User.findOne({ discordId: creator });

  const allowedCharacters =
    "!\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~".split(
      "",
    );
  for (let character of allowedCharacters) {
    if (!allowedCharacters.includes(character))
      return { message: "The Code has special Characters!", status: 400 };
  }

  try {
    await SaCCodes.create({
      created: new Date().toISOString(),
      createdby: creatorprofile.accountId,
      owneraccountId: account.accountId,
      code,
      code_lower: code.toLowerCase(),
      code_higher: code.toUpperCase(),
    });
  } catch (error) {
    return { message: error, status: 400 };
  }

  return {
    message: "You successfully created an **Support a Creator** Code!",
    status: 200,
  };
}

function DecodeBase64(str) {
  return Buffer.from(str, "base64").toString();
}

function UpdateTokens() {
  fs.writeFileSync(
    "./tokenManager/tokens.json",
    JSON.stringify(
      {
        accessTokens: global.accessTokens,
        refreshTokens: global.refreshTokens,
        clientTokens: global.clientTokens,
      },
      null,
      2,
    ),
  );
}

const EVENT_LIST_CACHE = { path: null, mtimeMs: null, data: null };

function getTournamentsConfig() {
  try {
    const raw = fs.readFileSync(
      path.join(__dirname, "../Config/config.json"),
      "utf8",
    );
    const cfg = JSON.parse(raw);
    return cfg && cfg.tournaments ? cfg.tournaments : {};
  } catch {
    return {};
  }
}

function getConfiguredArenaEventId() {
  const key = getTournamentsConfig().arenaEventId;
  return typeof key === "string" ? key : "epicgames_Arena_S24_Solo";
}

function getConfiguredCupEventId() {
  const key = getTournamentsConfig().cupEventId;
  return typeof key === "string" ? key : "IRISTournament";
}

function loadEventList() {
  const eventListPath = path.join(
    __dirname,
    "./../responses/eventlistactive.json",
  );
  try {
    const st = fs.statSync(eventListPath);
    if (
      EVENT_LIST_CACHE.data &&
      EVENT_LIST_CACHE.mtimeMs === st.mtimeMs &&
      EVENT_LIST_CACHE.path === eventListPath
    ) {
      return EVENT_LIST_CACHE.data;
    }
    const data = JSON.parse(fs.readFileSync(eventListPath, "utf8"));
    EVENT_LIST_CACHE.path = eventListPath;
    EVENT_LIST_CACHE.mtimeMs = st.mtimeMs;
    EVENT_LIST_CACHE.data = data;
    return data;
  } catch (e) {
    log.error(`eventlistactive load failed: ${e}`);
    return { events: [], templates: [] };
  }
}

function findActiveEventWindow(eventEntry, playerDivision) {
  const windows = eventEntry.eventWindows || [];
  const ranked = windows.filter(
    (w) => w.metadata && typeof w.metadata.divisionRank === "number",
  );
  if (ranked.length > 0) {
    return ranked.find((w) => w.metadata.divisionRank === playerDivision)
      ?? ranked[0];
  }
  return windows[0];
}

function resolveEventIdFromPlaylist(eventList, playlistNormalized) {
  if (!playlistNormalized) return null;
  const list = playlistNormalized.toLowerCase();
  for (const event of eventList.events || []) {
    const templateIds = [
      ...new Set((event.eventWindows || []).map((w) => w.eventTemplateId)),
    ];
    for (const tid of templateIds) {
      const tmpl = eventList.templates.find((t) => t.eventTemplateId === tid);
      if (tmpl?.playlistId?.toLowerCase() === list) return event.eventId;
    }
  }
  return null;
}

async function resolveEventIdForAccount(accountId) {
  if (!accountId || !global.kv) return null;
  const playlist = await global.kv.get(`playerPlaylist:${accountId}`);
  return resolveEventIdFromPlaylist(loadEventList(), playlist);
}

async function migrateLegacyArenaIfNeeded(accountId) {
  const arenaEvtId = getConfiguredArenaEventId();
  const exists = await TournamentStanding.findOne({
    accountId,
    eventId: arenaEvtId,
  })
    .select("_id")
    .lean();
  if (exists) return;
  const legacy = await Arena.findOne({ accountId }).lean();
  if (!legacy) return;
  await TournamentStanding.updateOne(
    { accountId, eventId: arenaEvtId },
    {
      $set: {
        accountId,
        eventId: arenaEvtId,
        points: legacy.hype ?? 0,
        division: legacy.division ?? 0,
      },
    },
    { upsert: true },
  );
}

async function buildEventPlayerOverrides(accountId) {
  await migrateLegacyArenaIfNeeded(accountId);
  const eventList = loadEventList();
  const arenaEvtId = getConfiguredArenaEventId();
  const rows = await TournamentStanding.find({ accountId }).lean();
  const byEventId = Object.fromEntries(
    rows.map((r) => [r.eventId, r]),
  );

  const persistentScores = {};
  for (const ev of eventList.events || []) {
    const win =
      Array.isArray(ev.eventWindows) && ev.eventWindows.length > 0
        ? ev.eventWindows[0]
        : null;
    if (!win) continue;
    const tmpl = eventList.templates.find(
      (t) => t.eventTemplateId === win.eventTemplateId,
    );
    if (!tmpl?.persistentScoreId) continue;
    persistentScores[tmpl.persistentScoreId] =
      byEventId[ev.eventId]?.points ?? 0;
  }

  const arenaStanding = byEventId[arenaEvtId];
  const division = arenaStanding?.division ?? 0;

  // Also resolve Duos division token
  const arenaDuosEvtId = config.tournaments?.arenaDuosEventId || "epicgames_Arena_S24_Duos";
  const duosStanding = byEventId[arenaDuosEvtId];
  const duosDivision = duosStanding?.division ?? 0;

  return {
    persistentScores,
    tokens: [
      `ARENA_S24_Division${division + 1}`,
      `ARENA_S24_Division${duosDivision + 1}_Duos`,
    ],
  };}

async function getDivisionPoints(accountId, resolvedEventId, statType) {
  await migrateLegacyArenaIfNeeded(accountId);

  const eventList = loadEventList();
  const eventId =
    resolvedEventId
    ?? (await resolveEventIdForAccount(accountId))
    ?? getConfiguredArenaEventId();

  const eventEntry = eventList.events.find((e) => e.eventId === eventId);
  if (!eventEntry) {
    log.error(`Événement inconnu: ${eventId}`);
    throw new Error("Événement non trouvé dans eventlistactive.");
  }

  const standing = await TournamentStanding.findOne({
    accountId,
    eventId,
  }).lean();
  const playerDivision = standing ? standing.division : 0;

  const eventWindow = findActiveEventWindow(eventEntry, playerDivision);
  if (!eventWindow) {
    log.error("Fenêtre d'événement introuvable.");
    throw new Error("Division non trouvée dans la liste des événements.");
  }

  const templateEntry = eventList.templates.find(
    (template) => template.eventTemplateId === eventWindow.eventTemplateId,
  );
  const scoringRules = templateEntry?.scoringRules ?? [];
  const scoringRule = scoringRules.find((rule) => rule.trackedStat === statType);

  if (!scoringRule || !scoringRule.rewardTiers?.length) {
    return 0;
  }

  return scoringRule.rewardTiers[0].pointsEarned;
}

async function addEliminationHypePoints(user, resolvedEventId) {
  const accountId = user.account_id || user.accountId;
  const eventId =
    resolvedEventId
    ?? (await resolveEventIdForAccount(accountId))
    ?? getConfiguredArenaEventId();
  const points = await getDivisionPoints(
    accountId,
    eventId,
    "TEAM_ELIMS_STAT_INDEX",
  );
  return await updateHypePoints(user, points, eventId);
}

async function addVictoryHypePoints(user, resolvedEventId) {
  const accountId = user.account_id || user.accountId;
  const eventId =
    resolvedEventId
    ?? (await resolveEventIdForAccount(accountId))
    ?? getConfiguredArenaEventId();
  const points = await getDivisionPoints(
    accountId,
    eventId,
    "PLACEMENT_STAT_INDEX",
  );
  return await updateHypePoints(user, points, eventId);
}

async function grantVbucksForReason(accountId, reason, count = 1) {
  const perReward = config.Api?.reasons?.[reason];
  if (!perReward || perReward <= 0) return false;

  const amount = perReward * Math.max(1, Number(count) || 1);
  const filter = { accountId };

  let profileDoc = await Profile.findOne(filter);
  if (!profileDoc) return false;

  const commonCore = profileDoc.profiles?.common_core;
  const profile0 = profileDoc.profiles?.profile0;
  if (!commonCore?.items || !profile0?.items) return false;

  if (!commonCore.items["Currency:MtxPurchased"]) {
    commonCore.items["Currency:MtxPurchased"] = {
      templateId: "Currency:MtxPurchased",
      quantity: 0,
      attributes: { platform: "Epic" },
    };
  }
  if (!profile0.items["Currency:MtxPurchased"]) {
    profile0.items["Currency:MtxPurchased"] = {
      templateId: "Currency:MtxPurchased",
      quantity: 0,
      attributes: { platform: "Epic" },
    };
  }

  commonCore.items["Currency:MtxPurchased"].quantity += amount;
  profile0.items["Currency:MtxPurchased"].quantity += amount;
  commonCore.rvn = (commonCore.rvn || 0) + 1;
  commonCore.commandRevision = (commonCore.commandRevision || 0) + 1;
  profile0.rvn = (profile0.rvn || 0) + 1;
  profile0.commandRevision = (profile0.commandRevision || 0) + 1;

  await Profile.updateOne(filter, {
    $set: {
      "profiles.common_core": commonCore,
      "profiles.profile0": profile0,
    },
  });

  return true;
}

async function deductBusFareHypePoints(user, resolvedEventId) {
  const accountId = user.account_id || user.accountId;
  const eventId =
    resolvedEventId
    ?? (await resolveEventIdForAccount(accountId))
    ?? getConfiguredArenaEventId();
  const points = await getDivisionPoints(
    accountId,
    eventId,
    "MATCH_PLAYED_STAT",
  );
  return await updateHypePoints(user, -points, eventId);
}

async function updateHypePoints(user, pointsDelta, resolvedEventId) {
  const accountId = user.account_id || user.accountId;
  await migrateLegacyArenaIfNeeded(accountId);

  const eventId =
    resolvedEventId
    ?? (await resolveEventIdForAccount(accountId))
    ?? getConfiguredArenaEventId();

  const eventList = loadEventList();
  const ev = eventList.events.find((e) => e.eventId === eventId);

  if (!ev) {
    log.error(`Standing update aborted: unknown eventId ${eventId}`);
    return { success: false, data: `Unknown tournament: ${eventId}` };
  }

  if (!pointsDelta) {
    return { success: true, data: "Aucun point appliqué." };
  }

  const standing = await TournamentStanding.findOne({
    accountId,
    eventId,
  });

  let currentPts = standing ? standing.points : 0;
  let currentDiv = standing ? standing.division : 0;
  currentPts += pointsDelta;

  const arenaEvtId = getConfiguredArenaEventId();
  const useDivisions =
    !!ev?.eventWindows?.some(
      (w) =>
        w.metadata !== undefined &&
        typeof w.metadata.divisionRank === "number",
    );

  const nextDivision = useDivisions
    ? getNextDivision(currentPts, currentDiv)
    : currentDiv;

  await TournamentStanding.updateOne(
    { accountId, eventId },
    {
      $set: {
        accountId,
        eventId,
        points: currentPts,
        division: nextDivision,
      },
    },
    { upsert: true },
  );

  if (useDivisions && eventId === arenaEvtId) {
    await Arena.updateOne(
      { accountId },
      {
        $set: {
          accountId,
          hype: currentPts,
          division: nextDivision,
        },
      },
      { upsert: true },
    );
  }

  const detail = useDivisions
    ? `Points mis à jour à ${currentPts}, Division actuelle : ${nextDivision} (${eventId})`
    : `Points mis à jour à ${currentPts} (${eventId})`;

  return { success: true, data: detail };
}

function getNextDivision(hypePoints, currentDivision) {
  const thresholds = [
    400, 800, 1200, 2000, 3000, 5000, 7500, 10000, 14999, 15000,
  ];
  for (let i = 0; i < thresholds.length; i++) {
    if (hypePoints < thresholds[i]) return i;
  }
  return currentDivision;
}

function getAccountIdData(UserID) {
  const account_id = UserID ? UserID.split("|")[1] : "";

  return account_id;
}

function PlaylistNames(playlist) {
  switch (playlist) {
    case "2":
      return "Playlist_DefaultSolo";
    case "10":
      return "Playlist_DefaultDuo";
    case "9":
      return "Playlist_DefaultSquad";
    case "50":
      return "Playlist_50v50";
    case "11":
      return "Playlist_50v50";
    case "13":
      return "Playlist_HighExplosives_Squads";
    case "22":
      return "Playlist_5x20";
    case "36":
      return "Playlist_Blitz_Solo";
    case "37":
      return "Playlist_Blitz_Duos";
    case "19":
      return "Playlist_Blitz_Squad";
    case "33":
      return "Playlist_Carmine";
    case "32":
      return "Playlist_Fortnite";
    case "23":
      return "Playlist_HighExplosives_Solo";
    case "24":
      return "Playlist_HighExplosives_Squads";
    case "44":
      return "Playlist_Impact_Solo";
    case "45":
      return "Playlist_Impact_Duos";
    case "46":
      return "Playlist_Impact_Squads";
    case "35":
      return "Playlist_PlaygroundV2";
    case "playlist_playgroundv2":
    case "Playlist_PlaygroundV2":
      return "Playlist_PlaygroundV2";
    case "30":
      return "Playlist_SkySupply";
    case "42":
      return "Playlist_SkySupply_Duos";
    case "43":
      return "Playlist_SkySupply_Squads";
    case "41":
      return "Playlist_Snipers";
    case "39":
      return "Playlist_Snipers_Solo";
    case "40":
      return "Playlist_Snipers_Duos";
    case "26":
      return "Playlist_SolidGold_Solo";
    case "27":
      return "Playlist_SolidGold_Squads";
    case "28":
      return "Playlist_ShowdownAlt_Solo";
    case "playlist_showdownalt_solo":
    case "Playlist_ShowdownAlt_Solo":
      return "Playlist_ShowdownAlt_Solo";
    case "playlist_showdownalt_duos":
    case "Playlist_ShowdownAlt_Duos":
      return "Playlist_ShowdownAlt_Duos";
    case "solo":
      return "2";
    case "duo":
      return "10";
    case "squad":
      return "9";
    default:
      return playlist;
  }
}

function GeneratePassword(length) {
  const charset =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
  let retVal = "";
  for (let i = 0, n = charset.length; i < length; ++i) {
    retVal += charset.charAt(Math.floor(Math.random() * n));
  }
  return retVal;
}

function ParseDuration(duration) {
  const amount = parseInt(duration.slice(0, -1));
  const unit = duration.slice(-1).toLowerCase();

  if (isNaN(amount)) return null;

  const now = new Date();
  switch (unit) {
    case "h":
      return new Date(now.getTime() + amount * 60 * 60 * 1000);
    case "d":
      return new Date(now.getTime() + amount * 24 * 60 * 60 * 1000);
    case "w":
      return new Date(now.getTime() + amount * 7 * 24 * 60 * 60 * 1000);
    case "m":
      return new Date(now.getTime() + amount * 30 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
}

module.exports = {
  sleep,
  GetVersionInfo,
  getContentPages,
  getItemShop,
  getOfferID,
  deductMtxCurrency,
  getBattlePassSeason,
  MakeID,
  sendXmppMessageToAll,
  sendXmppMessageToId,
  getPresenceFromUser,
  registerUser,
  createSAC,
  DecodeBase64,
  UpdateTokens,
  getAccountIdData,
  addEliminationHypePoints,
  addVictoryHypePoints,
  grantVbucksForReason,
  deductBusFareHypePoints,
  resolveEventIdForAccount,
  getConfiguredArenaEventId,
  getConfiguredCupEventId,
  buildEventPlayerOverrides,
  PlaylistNames,
  GeneratePassword,
  ParseDuration,
};
