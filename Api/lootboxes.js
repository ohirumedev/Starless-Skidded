/**
 * Loot Boxes API
 *
 * GET  /phoenix/api/launcher/lootboxes        — list all boxes
 * POST /phoenix/api/launcher/lootboxes/open   — open a box (requires auth)
 *
 * Boxes:
 *   crystal_box     —  500 V-Bucks  — Common + Uncommon skins
 *   rare_box        — 2000 V-Bucks  — Rare skins only
 *   legendary_box   — 5000 V-Bucks  — Epic + Legendary skins
 *   custom_box      — 30000 V-Bucks — Custom cosmetics (/givecustomskins)
 */

const express = require("express");
const app     = express.Router();
const Profile = require("../model/profiles.js");
const log     = require("../structs/log.js");

/* ── helper: cosmetic icon URL from templateId ── */
function icon(templateId, override) {
  if (override) return override;
  if (!templateId) return "";
  const slug = templateId.includes(":") ? templateId.split(":").pop() : templateId;
  return `https://fortnite-api.com/images/cosmetics/br/${slug.toLowerCase()}/icon.png`;
}

/* ═══════════════════════════════════════════════════════════════════
   ITEM POOLS
   Each entry: { templateId, name, rarity }
═══════════════════════════════════════════════════════════════════ */

const COMMON_UNCOMMON = [
  { templateId:"AthenaCharacter:CID_001_Athena_Commando_F_Default",         name:"Jonesy",              rarity:"common"   },
  { templateId:"AthenaCharacter:CID_002_Athena_Commando_F_Default",         name:"Ramirez",             rarity:"common"   },
  { templateId:"AthenaCharacter:CID_003_Athena_Commando_F_Default",         name:"Hawk",                rarity:"common"   },
  { templateId:"AthenaCharacter:CID_004_Athena_Commando_F_Default",         name:"Renegade",            rarity:"common"   },
  { templateId:"AthenaCharacter:CID_005_Athena_Commando_F_Default",         name:"Headhunter",          rarity:"common"   },
  { templateId:"AthenaCharacter:CID_006_Athena_Commando_F_Default",         name:"Assault Trooper",     rarity:"common"   },
  { templateId:"AthenaCharacter:CID_017_Athena_Commando_M",                 name:"Aerial Assault Trooper", rarity:"uncommon" },
  { templateId:"AthenaCharacter:CID_028_Athena_Commando_F",                 name:"Aerial Assault One",  rarity:"uncommon" },
  { templateId:"AthenaCharacter:CID_029_Athena_Commando_F_Halloween",       name:"Ghoul Trooper",       rarity:"uncommon" },
  { templateId:"AthenaCharacter:CID_030_Athena_Commando_M_Halloween",       name:"Skull Trooper",       rarity:"uncommon" },
  { templateId:"AthenaCharacter:CID_035_Athena_Commando_M_Medieval",        name:"Black Knight",        rarity:"uncommon" },
  { templateId:"AthenaCharacter:CID_084_Athena_Commando_M_Assassin",        name:"Shade",               rarity:"uncommon" },
  { templateId:"AthenaCharacter:CID_113_Athena_Commando_F_BlueSuperHero",   name:"Triage Trooper",      rarity:"uncommon" },
  { templateId:"AthenaCharacter:CID_114_Athena_Commando_M_RedSuperHero",    name:"Carbide",             rarity:"uncommon" },
  { templateId:"AthenaCharacter:CID_159_Athena_Commando_M_Speedway",        name:"Burnout",             rarity:"uncommon" },
  { templateId:"AthenaCharacter:CID_162_Athena_Commando_F_Bullseye",        name:"Bullseye",            rarity:"uncommon" },
  { templateId:"AthenaCharacter:CID_175_Athena_Commando_M_Celestial",       name:"Galaxy",              rarity:"uncommon" },
  { templateId:"AthenaCharacter:CID_183_Athena_Commando_M_Modernmilitary",  name:"Sergeant Winter",     rarity:"uncommon" },
  { templateId:"AthenaCharacter:CID_302_Athena_Commando_M_BirthDay",        name:"Brite Bomber",        rarity:"uncommon" },
  { templateId:"AthenaCharacter:CID_315_Athena_Commando_M_Carnaval",        name:"Samba",               rarity:"uncommon" },
];

const RARE_ONLY = [
  { templateId:"AthenaCharacter:CID_085_Athena_Commando_M_Castleknave",     name:"Fate",                rarity:"rare" },
  { templateId:"AthenaCharacter:CID_086_Athena_Commando_F_Swashbuckler",    name:"Scimitar",            rarity:"rare" },
  { templateId:"AthenaCharacter:CID_087_Athena_Commando_F_Bling",           name:"Cuddle Team Leader",  rarity:"rare" },
  { templateId:"AthenaCharacter:CID_089_Athena_Commando_M_RetroSci",        name:"Spacefarer",          rarity:"rare" },
  { templateId:"AthenaCharacter:CID_096_Athena_Commando_M_BirthdayBoy",     name:"Birthday Boy",        rarity:"rare" },
  { templateId:"AthenaCharacter:CID_116_Athena_Commando_M_CarbideBlack",    name:"Omega",               rarity:"rare" },
  { templateId:"AthenaCharacter:CID_117_Athena_Commando_F_Patriot",         name:"Sun Strider",         rarity:"rare" },
  { templateId:"AthenaCharacter:CID_118_Athena_Commando_M_CircuitBreaker",  name:"Circuit Breaker",     rarity:"rare" },
  { templateId:"AthenaCharacter:CID_119_Athena_Commando_M_Dinosaur",        name:"Rex",                 rarity:"rare" },
  { templateId:"AthenaCharacter:CID_123_Athena_Commando_F_Metal",           name:"Scourge",             rarity:"rare" },
  { templateId:"AthenaCharacter:CID_135_Athena_Commando_M_EarlyBlack",      name:"Omen",                rarity:"rare" },
  { templateId:"AthenaCharacter:CID_138_Athena_Commando_M_ChickenWings",    name:"Cluck",               rarity:"rare" },
  { templateId:"AthenaCharacter:CID_143_Athena_Commando_F_Purrfect",        name:"Lynx",                rarity:"rare" },
  { templateId:"AthenaCharacter:CID_158_Athena_Commando_M_Bandolier",       name:"Bandolier",           rarity:"rare" },
  { templateId:"AthenaCharacter:CID_174_Athena_Commando_F_Deathknight",     name:"Dire",                rarity:"rare" },
  { templateId:"AthenaCharacter:CID_176_Athena_Commando_M_Viper",           name:"Viper",               rarity:"rare" },
  { templateId:"AthenaCharacter:CID_178_Athena_Commando_M_Royale",          name:"Royale Knight",       rarity:"rare" },
  { templateId:"AthenaCharacter:CID_188_Athena_Commando_M_AutoTech",        name:"Axiom",               rarity:"rare" },
  { templateId:"AthenaCharacter:CID_196_Athena_Commando_F_ScubaRebreather", name:"Abyss",               rarity:"rare" },
  { templateId:"AthenaCharacter:CID_204_Athena_Commando_M_Camo",            name:"Havoc",               rarity:"rare" },
  { templateId:"AthenaCharacter:CID_261_Athena_Commando_F_RusticWoodland",  name:"Woodsy",              rarity:"rare" },
  { templateId:"AthenaCharacter:CID_319_Athena_Commando_M_DiscoScratch",    name:"Funk Ops",            rarity:"rare" },
  { templateId:"AthenaCharacter:CID_323_Athena_Commando_M_Tech",            name:"Tech Ops",            rarity:"rare" },
  { templateId:"AthenaCharacter:CID_342_Athena_Commando_M_StreetRacerMetallic", name:"Nitro",           rarity:"rare" },
  { templateId:"AthenaCharacter:CID_349_Athena_Commando_M_TeriyakiFish",    name:"Nara",                rarity:"rare" },
  { templateId:"AthenaCharacter:CID_371_Athena_Commando_M_Downhill",        name:"Alpine Ace",          rarity:"rare" },
  { templateId:"AthenaCharacter:CID_372_Athena_Commando_F_Downhill",        name:"Snow Patroller",      rarity:"rare" },
  { templateId:"AthenaCharacter:CID_373_Athena_Commando_M_SkateboardFade",  name:"Bullseye",            rarity:"rare" },
  { templateId:"AthenaCharacter:CID_390_Athena_Commando_F_HolidaySki",      name:"Holly Striker",       rarity:"rare" },
  { templateId:"AthenaCharacter:CID_400_Athena_Commando_F_SkyOps",          name:"Sky Stalker",         rarity:"rare" },
];

const EPIC_LEGENDARY = [
  { templateId:"AthenaCharacter:CID_073_Athena_Commando_F_Egypt",           name:"Sun Tan Specialist",  rarity:"epic"      },
  { templateId:"AthenaCharacter:CID_083_Athena_Commando_F_Bandolier",       name:"Raven",               rarity:"legendary" },
  { templateId:"AthenaCharacter:CID_090_Athena_Commando_M_Tactical",        name:"Assault Trooper",     rarity:"epic"      },
  { templateId:"AthenaCharacter:CID_100_Athena_Commando_M_BlazeKnockout",   name:"Blaze",               rarity:"legendary" },
  { templateId:"AthenaCharacter:CID_108_Athena_Commando_F_BlackKnight",     name:"Black Knight",        rarity:"legendary" },
  { templateId:"AthenaCharacter:CID_110_Athena_Commando_F_Jailbird",        name:"Prisoner",            rarity:"legendary" },
  { templateId:"AthenaCharacter:CID_111_Athena_Commando_F_Bling",           name:"Skully",              rarity:"epic"      },
  { templateId:"AthenaCharacter:CID_121_Athena_Commando_M_Safari",          name:"Raptor",              rarity:"epic"      },
  { templateId:"AthenaCharacter:CID_144_Athena_Commando_F_Eggplant",        name:"Bunnymoon",           rarity:"epic"      },
  { templateId:"AthenaCharacter:CID_146_Athena_Commando_M_SteelSoldier",    name:"Enforcer",            rarity:"epic"      },
  { templateId:"AthenaCharacter:CID_148_Athena_Commando_M_Commando",        name:"Commandos",           rarity:"epic"      },
  { templateId:"AthenaCharacter:CID_160_Athena_Commando_M_RockerPunk",      name:"Abstrakt",            rarity:"epic"      },
  { templateId:"AthenaCharacter:CID_161_Athena_Commando_F_Calamity",        name:"Calamity",            rarity:"legendary" },
  { templateId:"AthenaCharacter:CID_171_Athena_Commando_M_Catwoman",        name:"Shade",               rarity:"epic"      },
  { templateId:"AthenaCharacter:CID_172_Athena_Commando_F_BlaknBlack",      name:"Noir",                rarity:"legendary" },
  { templateId:"AthenaCharacter:CID_184_Athena_Commando_F_Rosette",         name:"Rose Team Leader",    rarity:"epic"      },
  { templateId:"AthenaCharacter:CID_185_Athena_Commando_F_Ghostbusters",    name:"Sanctum",             rarity:"legendary" },
  { templateId:"AthenaCharacter:CID_195_Athena_Commando_F_SpeedRacer",      name:"Whiplash",            rarity:"epic"      },
  { templateId:"AthenaCharacter:CID_200_Athena_Commando_F_Catwoman",        name:"Meowscles",           rarity:"legendary" },
  { templateId:"AthenaCharacter:CID_201_Athena_Commando_F_CrimsonSport",    name:"Midas",               rarity:"legendary" },
  { templateId:"AthenaCharacter:CID_231_Athena_Commando_M_Dino",            name:"Tricera Ops",         rarity:"epic"      },
  { templateId:"AthenaCharacter:CID_256_Athena_Commando_F_Tacticalurbane",  name:"Ragnarok",            rarity:"legendary" },
  { templateId:"AthenaCharacter:CID_288_Athena_Commando_F_Celestial",       name:"Moonwalker",          rarity:"epic"      },
  { templateId:"AthenaCharacter:CID_313_Athena_Commando_M_KpopFashion",     name:"K-Pop",               rarity:"epic"      },
  { templateId:"AthenaCharacter:CID_320_Athena_Commando_M_GhostCamoBlu",    name:"Ghoul Trooper Black", rarity:"legendary" },
  { templateId:"AthenaCharacter:CID_334_Athena_Commando_M_Clover",          name:"Lucky Rider",         rarity:"legendary" },
  { templateId:"AthenaCharacter:CID_344_Athena_Commando_M_IcePrincess",     name:"Ice King",            rarity:"legendary" },
  { templateId:"AthenaCharacter:CID_367_Athena_Commando_M_LightningBird",   name:"Volt",                rarity:"legendary" },
  { templateId:"AthenaCharacter:CID_407_Athena_Commando_M_BubbleBee",       name:"Bumble",              rarity:"legendary" },
  { templateId:"AthenaCharacter:CID_439_Athena_Commando_F_IronCross",       name:"Overseer",            rarity:"epic"      },
];

/* Custom cosmetics — these match what /givecustomskins grants.
   templateIds must be exactly what your game server recognises.
   iconUrl is set explicitly since these won't exist on fortnite-api.com */
const CUSTOM_COSMETICS = [
  { templateId:"AthenaCharacter:CID_A_001_Crystal_Custom_RedNova",         name:"Red Nova",           rarity:"legendary", iconOverride:"https://fortnite-api.com/images/cosmetics/br/cid_367_athena_commando_m_lightningbird/icon.png"       },
  { templateId:"AthenaCharacter:CID_A_002_Crystal_Custom_NeonWraith",      name:"Neon Wraith",        rarity:"legendary", iconOverride:"https://fortnite-api.com/images/cosmetics/br/cid_083_athena_commando_f_bandolier/icon.png"           },
  { templateId:"AthenaCharacter:CID_A_003_Crystal_Custom_VoidKnight",      name:"Void Knight",        rarity:"legendary", iconOverride:"https://fortnite-api.com/images/cosmetics/br/cid_344_athena_commando_m_iceprincess/icon.png"         },
  { templateId:"AthenaCharacter:CID_A_004_Crystal_Custom_PrismaticHunter", name:"Prismatic Hunter",   rarity:"legendary", iconOverride:"https://fortnite-api.com/images/cosmetics/br/cid_288_athena_commando_f_celestial/icon.png"           },
  { templateId:"AthenaCharacter:CID_A_005_Crystal_Custom_ShadowPulse",     name:"Shadow Pulse",       rarity:"legendary", iconOverride:"https://fortnite-api.com/images/cosmetics/br/cid_256_athena_commando_f_tacticalurbane/icon.png"      },
  { templateId:"AthenaCharacter:CID_A_006_Crystal_Custom_CosmicRift",      name:"Cosmic Rift",        rarity:"legendary", iconOverride:"https://fortnite-api.com/images/cosmetics/br/cid_175_athena_commando_m_celestial/icon.png"           },
  { templateId:"AthenaCharacter:CID_A_007_Crystal_Custom_GoldenHaze",      name:"Golden Haze",        rarity:"legendary", iconOverride:"https://fortnite-api.com/images/cosmetics/br/cid_201_athena_commando_f_crimsonsport/icon.png"        },
  { templateId:"AthenaCharacter:CID_A_008_Crystal_Custom_ArcaneStorm",     name:"Arcane Storm",       rarity:"legendary", iconOverride:"https://fortnite-api.com/images/cosmetics/br/cid_334_athena_commando_m_clover/icon.png"              },
  { templateId:"AthenaCharacter:CID_A_009_Crystal_Custom_CrimsonEdge",     name:"Crimson Edge",       rarity:"legendary", iconOverride:"https://fortnite-api.com/images/cosmetics/br/cid_100_athena_commando_m_blazeknockout/icon.png"       },
  { templateId:"AthenaCharacter:CID_A_010_Crystal_Custom_FrostByte",       name:"Frost Byte",         rarity:"legendary", iconOverride:"https://fortnite-api.com/images/cosmetics/br/cid_407_athena_commando_m_bubblebee/icon.png"           },
  { templateId:"AthenaCharacter:CID_A_011_Crystal_Custom_ObsidianWraith",  name:"Obsidian Wraith",    rarity:"legendary", iconOverride:"https://fortnite-api.com/images/cosmetics/br/cid_320_athena_commando_m_ghostcamoblu/icon.png"        },
  { templateId:"AthenaCharacter:CID_A_012_Crystal_Custom_StarForge",       name:"Star Forge",         rarity:"legendary", iconOverride:"https://fortnite-api.com/images/cosmetics/br/cid_185_athena_commando_f_ghostbusters/icon.png"        },
];

/* ═══════════════════════════════════════════════════════════════════
   BOX DEFINITIONS
═══════════════════════════════════════════════════════════════════ */
const BOXES = [
  {
    id:          "crystal_box",
    name:        "Crystal Box",
    description: "Contains Common and Uncommon cosmetics. Great way to start building your locker!",
    price:       500,
    rarity:      "common",
    /* Skull Trooper — well-known CID with a confirmed fortnite-api icon */
    image:       "https://fortnite-api.com/images/cosmetics/br/cid_030_athena_commando_m_halloween/icon.png",
    color:       "#9ca3af",
    pool:        COMMON_UNCOMMON,
  },
  {
    id:          "rare_box",
    name:        "Rare Box",
    description: "Contains exclusively Rare cosmetics. Higher quality drops guaranteed every time.",
    price:       2000,
    rarity:      "rare",
    /* Rex — classic rare skin */
    image:       "https://fortnite-api.com/images/cosmetics/br/cid_119_athena_commando_m_dinosaur/icon.png",
    color:       "#60a5fa",
    pool:        RARE_ONLY,
  },
  {
    id:          "legendary_box",
    name:        "Legendary Box",
    description: "Contains Epic and Legendary cosmetics. One of the rarest items in the locker!",
    price:       5000,
    rarity:      "legendary",
    /* Raven — legendary with confirmed icon */
    image:       "https://fortnite-api.com/images/cosmetics/br/cid_083_athena_commando_f_bandolier/icon.png",
    color:       "#fbbf24",
    pool:        EPIC_LEGENDARY,
  },
  {
    id:          "custom_box",
    name:        "Custom Cosmetics Box",
    description: "Exclusive Crystal custom cosmetics not available anywhere else. Extremely rare!",
    price:       30000,
    rarity:      "legendary",
    /* Galaxy — exotic-looking skin for the custom box */
    image:       "https://fortnite-api.com/images/cosmetics/br/cid_175_athena_commando_m_celestial/icon.png",
    color:       "#a855f7",
    pool:        CUSTOM_COSMETICS,
  },
];

/* ═══════════════════════════════════════════════════════════════════
   GET /phoenix/api/launcher/lootboxes
═══════════════════════════════════════════════════════════════════ */
app.get("/phoenix/api/launcher/lootboxes", (req, res) => {
  const boxes = BOXES.map(b => ({
    id:           b.id,
    name:         b.name,
    description:  b.description,
    price:        b.price,
    rarity:       b.rarity,
    image:        b.image,
    color:        b.color,
    poolSize:     b.pool.length,
    /* Send first 20 preview icons for the spin reel */
    previewIcons: b.pool.slice(0, 20).map(item => icon(item.templateId, item.iconOverride)),
  }));

  return res.json({ success: true, boxes });
});

/* ═══════════════════════════════════════════════════════════════════
   POST /phoenix/api/launcher/lootboxes/open
   Body: { boxId: "crystal_box" | "rare_box" | "legendary_box" | "custom_box" }
   Headers: Authorization: bearer eg1~<token>
═══════════════════════════════════════════════════════════════════ */
app.post("/phoenix/api/launcher/lootboxes/open", async (req, res) => {
  try {
    /* ── 1. Auth ── */
    const authHeader = req.headers["authorization"] || "";
    const rawToken   = authHeader.replace(/^bearer\s+/i, "").replace(/^eg1~/i, "");

    if (!rawToken) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const tokenEntry = global.accessTokens?.find(
      t => t.token === rawToken || t.token === `eg1~${rawToken}`,
    );

    if (!tokenEntry?.accountId) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const { accountId } = tokenEntry;

    /* ── 2. Find box ── */
    const { boxId } = req.body || {};
    const box = BOXES.find(b => b.id === boxId);
    if (!box) {
      return res.status(400).json({ success: false, message: "Invalid box." });
    }

    /* ── 3. Load profile ── */
    const profileDoc = await Profile.findOne({ accountId });
    if (!profileDoc) {
      return res.status(404).json({ success: false, message: "Profile not found." });
    }

    const cc = profileDoc.profiles?.common_core;
    const p0 = profileDoc.profiles?.profile0;

    if (!cc?.items || !p0?.items) {
      return res.status(500).json({ success: false, message: "Profile corrupted." });
    }

    /* ── 4. Deduct V-Bucks ── */
    const vbucksKey = "Currency:MtxPurchased";
    const balance = cc.items[vbucksKey]?.quantity ?? 0;

    if (balance < box.price) {
      return res.status(400).json({
        success: false,
        message: `Not enough V-Bucks. You need ${box.price.toLocaleString()} but have ${balance.toLocaleString()}.`,
      });
    }

    cc.items[vbucksKey].quantity -= box.price;
    if (p0.items[vbucksKey]) p0.items[vbucksKey].quantity -= box.price;
    cc.rvn = (cc.rvn || 0) + 1;
    cc.commandRevision = (cc.commandRevision || 0) + 1;
    p0.rvn = (p0.rvn || 0) + 1;
    p0.commandRevision = (p0.commandRevision || 0) + 1;

    /* ── 5. Pick random item ── */
    const item = box.pool[Math.floor(Math.random() * box.pool.length)];

    /* ── 6. Grant item to locker (athena profile) ── */
    const itemKey = item.templateId;
    if (!p0.items[itemKey]) {
      p0.items[itemKey] = {
        templateId: item.templateId,
        quantity:   1,
        attributes: { item_seen: false, favorite: false },
      };
      p0.rvn = (p0.rvn || 0) + 1;
      p0.commandRevision = (p0.commandRevision || 0) + 1;
    }

    /* ── 7. Save ── */
    await Profile.updateOne(
      { accountId },
      { $set: { "profiles.common_core": cc, "profiles.profile0": p0 } },
    );

    const newBalance = cc.items[vbucksKey].quantity;
    log.backend(`LootBox: ${accountId} opened "${box.name}" → ${item.name} (${item.rarity}) | cost ${box.price} | balance ${newBalance}`);

    return res.json({
      success:  true,
      item: {
        templateId: item.templateId,
        name:       item.name,
        rarity:     item.rarity,
        iconUrl:    icon(item.templateId, item.iconOverride),
      },
      balance:  newBalance,
      boxName:  box.name,
    });

  } catch (err) {
    log.error(`LootBox open error: ${err?.message || err}`);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = app;
