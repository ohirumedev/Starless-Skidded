const fs = require("fs");
const path = require("path");
const functions = require("./functions.js");

const DEFAULT_MAX_BATTLE_PASS_LEVEL = 1001;

function getMaxBattlePassLevel() {
  try {
    const cfg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../Config/config.json"), "utf8"),
    );
    const configured = Number(cfg.bMaxBattlePassLevel);
    if (configured > 0) return configured;
  } catch {
    /* use default */
  }
  return DEFAULT_MAX_BATTLE_PASS_LEVEL;
}

function loadBattlePass(season) {
  const battlePassFilePath = path.join(
    __dirname,
    "../responses/Athena/BattlePass",
    `Season${season}.json`,
  );
  if (!fs.existsSync(battlePassFilePath)) return null;
  return JSON.parse(fs.readFileSync(battlePassFilePath, "utf8"));
}

function normalizePurchaseInfoList(body) {
  if (
    body.purchaseInfoList &&
    Array.isArray(body.purchaseInfoList) &&
    body.purchaseInfoList.length > 0
  ) {
    const grouped = {};
    for (const entry of body.purchaseInfoList) {
      if (!entry || typeof entry.offerId !== "string") continue;
      const qty = Number(entry.purchaseQuantity) || 1;
      grouped[entry.offerId] = (grouped[entry.offerId] || 0) + qty;
    }

    const offerIds = Object.keys(grouped);
    if (offerIds.length > 0) {
      return {
        offerId: offerIds[0],
        purchaseQuantity: grouped[offerIds[0]],
        grouped,
      };
    }
  }

  if (typeof body.offerId === "string" && body.offerId.length > 0) {
    const qty = Number(body.purchaseQuantity) || 1;
    return {
      offerId: body.offerId,
      purchaseQuantity: qty,
      grouped: { [body.offerId]: qty },
    };
  }

  return null;
}

function getXpPerLevel(season) {
  if (season === 19) return 78450;
  if (season === 12) return 80000;
  return 80000;
}

function usesLinearBookXp(season) {
  return season >= 19;
}

function getBookXpForLevel(level, season) {
  const maxLevel = getMaxBattlePassLevel();
  const lv = Math.max(1, Math.min(maxLevel, Number(level) || 1));
  const xpPerLevel = getXpPerLevel(season);
  if (usesLinearBookXp(season)) return lv * xpPerLevel;
  return (lv - 1) * xpPerLevel;
}

function getLevelFromBookXp(bookXp, season) {
  const maxLevel = getMaxBattlePassLevel();
  const xpPerLevel = getXpPerLevel(season);
  const xp = Math.max(0, Number(bookXp) || 0);
  if (usesLinearBookXp(season)) {
    return Math.max(1, Math.min(maxLevel, Math.floor(xp / xpPerLevel)));
  }
  return Math.max(1, Math.min(maxLevel, Math.floor(xp / xpPerLevel) + 1));
}

function normalizeBookProgression(athena, season, applyProfileChanges) {
  if (!athena?.stats?.attributes) return false;

  const stats = athena.stats.attributes;
  const xpPerLevel = getXpPerLevel(season);
  const maxLevel = getMaxBattlePassLevel();
  const maxBookXp = getBookXpForLevel(maxLevel, season);

  let level = Math.max(1, Math.min(maxLevel, Number(stats.book_level) || 1));
  let bookXp = Math.max(0, Number(stats.book_xp) || 0);
  if (Number.isNaN(bookXp)) bookXp = 0;

  const levelFromXp = getLevelFromBookXp(bookXp, season);

  if (level > levelFromXp) {
    bookXp = getBookXpForLevel(level, season);
  } else if (levelFromXp > level) {
    level = levelFromXp;
  } else if (bookXp > getBookXpForLevel(level, season)) {
    bookXp = getBookXpForLevel(level, season);
  }

  if (bookXp > maxBookXp) bookXp = maxBookXp;
  level = Math.max(1, Math.min(maxLevel, level));

  const nextStats = {
    book_level: level,
    book_xp: bookXp,
    level,
    xp: bookXp,
    accountLevel: level,
  };

  let changed = false;
  for (const [name, value] of Object.entries(nextStats)) {
    if (stats[name] === value) continue;
    stats[name] = value;
    applyProfileChanges.push({
      changeType: "statModified",
      name,
      value,
    });
    changed = true;
  }

  if (usesBattleStars(season)) {
    if (syncBattleStars(athena, applyProfileChanges, level)) changed = true;
  }

  return changed;
}

function usesBattleStars(season) {
  return season >= 11;
}

const BATTLE_STAR_ITEM_ID = "athena_battlestar";

function ensureBattleStarItem(profile, applyProfileChanges) {
  if (!profile.items[BATTLE_STAR_ITEM_ID]) {
    profile.items[BATTLE_STAR_ITEM_ID] = {
      templateId: "AccountResource:athenabattlestar",
      attributes: { platform: "shared" },
      quantity: 0,
    };
    applyProfileChanges.push({
      changeType: "itemAdded",
      itemId: BATTLE_STAR_ITEM_ID,
      item: profile.items[BATTLE_STAR_ITEM_ID],
    });
    return true;
  }
  return false;
}

function syncBattleStars(profile, applyProfileChanges, computedLevel) {
  const desiredBattleStars = Math.max(0, (computedLevel - 1) * 5);
  let changed = ensureBattleStarItem(profile, applyProfileChanges);
  if (profile.items[BATTLE_STAR_ITEM_ID].quantity !== desiredBattleStars) {
    profile.items[BATTLE_STAR_ITEM_ID].quantity = desiredBattleStars;
    applyProfileChanges.push({
      changeType: "itemQuantityChanged",
      itemId: BATTLE_STAR_ITEM_ID,
      quantity: desiredBattleStars,
    });
    changed = true;
  }
  return changed;
}

function addBattleStars(profile, amount, applyProfileChanges) {
  if (amount <= 0) return false;
  let changed = ensureBattleStarItem(profile, applyProfileChanges);
  profile.items[BATTLE_STAR_ITEM_ID].quantity += amount;
  applyProfileChanges.push({
    changeType: "itemQuantityChanged",
    itemId: BATTLE_STAR_ITEM_ID,
    quantity: profile.items[BATTLE_STAR_ITEM_ID].quantity,
  });
  return true;
}

function getBattleStarCost(tierIndex) {
  if (tierIndex > 0 && (tierIndex + 1) % 5 === 0) return 5;
  return 1;
}

function resolveTierIndexForOffer(athena, offerItemId) {
  const purchased = athena.stats.attributes.purchased_battle_pass_tier_offers || [];
  const existing = purchased.indexOf(offerItemId);
  if (existing !== -1) return existing;

  const hexTier = offerItemId.match(/^([0-9A-F]{32})$/i);
  if (hexTier) return purchased.length;

  const numeric = offerItemId.match(/(\d{1,3})/);
  if (numeric) {
    const tier = parseInt(numeric[1], 10);
    if (tier >= 1 && tier <= getMaxBattlePassLevel()) return tier - 1;
  }

  return purchased.length;
}

function exchangeBattlePassOffers(
  athena,
  commonCore,
  profile0,
  BattlePass,
  offerItemIdList,
  multiUpdateChanges,
  applyProfileChanges,
  makeId,
) {
  if (!Array.isArray(offerItemIdList) || offerItemIdList.length === 0) {
    return { ok: false, error: "missing_offers" };
  }

  if (!athena.stats.attributes.purchased_battle_pass_tier_offers) {
    athena.stats.attributes.purchased_battle_pass_tier_offers = [];
  }

  const purchased = athena.stats.attributes.purchased_battle_pass_tier_offers;
  ensureBattleStarItem(athena, multiUpdateChanges);
  let totalStarCost = 0;
  const tiersToGrant = [];

  for (const offerItemId of offerItemIdList) {
    if (typeof offerItemId !== "string" || !offerItemId) continue;
    if (purchased.includes(offerItemId)) continue;

    const tierIndex = resolveTierIndexForOffer(athena, offerItemId);
    if (tierIndex < 0 || tierIndex >= getMaxBattlePassLevel()) continue;
    const maxTier = Math.max(1, athena.stats.attributes.book_level || 1);
    if (tierIndex >= maxTier) continue;

    totalStarCost += getBattleStarCost(tierIndex);
    tiersToGrant.push({ offerItemId, tierIndex });
  }

  if (tiersToGrant.length === 0) {
    return { ok: false, error: "no_valid_offers" };
  }

  const currentStars =
    athena.items[BATTLE_STAR_ITEM_ID]?.quantity || 0;
  if (currentStars < totalStarCost) {
    return { ok: false, error: "insufficient_stars", required: totalStarCost };
  }

  athena.items[BATTLE_STAR_ITEM_ID].quantity -= totalStarCost;
  multiUpdateChanges.push({
    changeType: "itemQuantityChanged",
    itemId: BATTLE_STAR_ITEM_ID,
    quantity: athena.items[BATTLE_STAR_ITEM_ID].quantity,
  });

  for (const { offerItemId, tierIndex } of tiersToGrant) {
    purchased.push(offerItemId);
    grantBattlePassTiers(
      athena,
      commonCore,
      profile0,
      BattlePass,
      tierIndex,
      tierIndex + 1,
      multiUpdateChanges,
      applyProfileChanges,
      makeId,
      athena.stats.attributes.book_purchased,
    );
  }

  multiUpdateChanges.push({
    changeType: "statModified",
    name: "purchased_battle_pass_tier_offers",
    value: purchased,
  });

  return { ok: true, starsSpent: totalStarCost, tiersClaimed: tiersToGrant.length };
}

function applyTierLevelPurchase(athena, startingTier, endingTier, applyProfileChanges, season) {
  if (!athena?.stats?.attributes) return;
  normalizeBookProgression(athena, season, applyProfileChanges);
}

function syncBattlePassFromXp(profile, applyProfileChanges, season) {
  if (!profile?.stats?.attributes) return { changed: false };

  const oldLevel = Number(profile.stats.attributes.book_level || 1);
  const changed = normalizeBookProgression(profile, season, applyProfileChanges);
  const newLevel = Number(profile.stats.attributes.book_level || 1);

  return {
    changed,
    oldLevel,
    newLevel,
    leveledUp: newLevel > oldLevel,
  };
}

function grantBattlePassTiers(
  athena,
  profile,
  profile0,
  BattlePass,
  startingTier,
  endingTier,
  multiUpdateChanges,
  applyProfileChanges,
  makeId,
  includePaidRewards,
) {
  const lootList = [];
  let itemExists = false;

  for (let i = startingTier; i < endingTier; i++) {
    const freeTier = BattlePass.freeRewards[i] || {};
    const paidTier = includePaidRewards ? BattlePass.paidRewards[i] || {} : {};

    const processTier = (tierRewards, grantPaidMtx) => {
      for (const item in tierRewards) {
        const lower = item.toLowerCase();
        if (lower === "token:athenaseasonxpboost") {
          athena.stats.attributes.season_match_boost += tierRewards[item];
          multiUpdateChanges.push({
            changeType: "statModified",
            name: "season_match_boost",
            value: athena.stats.attributes.season_match_boost,
          });
        }
        if (lower === "token:athenaseasonfriendxpboost") {
          athena.stats.attributes.season_friend_match_boost += tierRewards[item];
          multiUpdateChanges.push({
            changeType: "statModified",
            name: "season_friend_match_boost",
            value: athena.stats.attributes.season_friend_match_boost,
          });
        }
        if (lower.startsWith("currency:mtx")) {
          for (const key in profile.items) {
            if (
              !profile.items[key].templateId?.toLowerCase().startsWith("currency:mtx")
            )
              continue;
            const platform = profile.items[key].attributes.platform?.toLowerCase();
            const currentPlatform =
              profile.stats.attributes.current_mtx_platform?.toLowerCase();
            if (platform !== currentPlatform && platform !== "shared") continue;
            profile.items[key].quantity += tierRewards[item];
            if (profile0?.items?.[key])
              profile0.items[key].quantity += tierRewards[item];
            break;
          }
        }
        if (lower.startsWith("homebasebanner")) {
          for (const key in profile.items) {
            if (profile.items[key].templateId.toLowerCase() === lower) {
              profile.items[key].attributes.item_seen = false;
              itemExists = true;
              applyProfileChanges.push({
                changeType: "itemAttrChanged",
                itemId: key,
                attributeName: "item_seen",
                attributeValue: profile.items[key].attributes.item_seen,
              });
            }
          }
          if (!itemExists) {
            const itemId = makeId();
            profile.items[itemId] = {
              templateId: item,
              attributes: { item_seen: false },
              quantity: 1,
            };
            applyProfileChanges.push({
              changeType: "itemAdded",
              itemId,
              item: profile.items[itemId],
            });
          }
          itemExists = false;
        }
        if (lower.startsWith("athena")) {
          for (const key in athena.items) {
            if (athena.items[key].templateId.toLowerCase() === lower) {
              athena.items[key].attributes.item_seen = false;
              itemExists = true;
              multiUpdateChanges.push({
                changeType: "itemAttrChanged",
                itemId: key,
                attributeName: "item_seen",
                attributeValue: athena.items[key].attributes.item_seen,
              });
            }
          }
          if (!itemExists) {
            const itemId = makeId();
            const newItem = {
              templateId: item,
              attributes: {
                max_level_bonus: 0,
                level: 1,
                item_seen: false,
                xp: 0,
                variants: [],
                favorite: false,
              },
              quantity: tierRewards[item],
            };
            athena.items[itemId] = newItem;
            multiUpdateChanges.push({
              changeType: "itemAdded",
              itemId,
              item: newItem,
            });
          }
          itemExists = false;
        }
        lootList.push({
          itemType: item,
          itemGuid: item,
          quantity: tierRewards[item],
        });
      }
    };

    processTier(freeTier, false);
    if (includePaidRewards) processTier(paidTier, true);
  }

  if (lootList.length > 0) {
    const giftBoxId = makeId();
    profile.items[giftBoxId] = {
      templateId: "GiftBox:gb_battlepass",
      attributes: {
        max_level_bonus: 0,
        fromAccountId: "",
        lootList,
      },
    };
    applyProfileChanges.push({
      changeType: "itemAdded",
      itemId: giftBoxId,
      item: profile.items[giftBoxId],
    });
  }

  multiUpdateChanges.push({
    changeType: "statModified",
    name: "book_level",
    value: athena.stats.attributes.book_level,
  });
}

function ensureVictoryCrownQuest(athena, makeId, applyProfileChanges) {
  const questKey = "S19-Quest:quest_s19_victorycrown_hidden";
  if (athena.items[questKey]) return;

  athena.items[questKey] = {
    templateId: "Quest:quest_s19_victorycrown_hidden",
    attributes: {
      creation_time: new Date().toISOString(),
      level: -1,
      item_seen: true,
      playlists: [],
      sent_new_notification: true,
      challenge_bundle_id: "S19-ChallengeBundle:QuestBundle_S19_VictoryCrown",
      xp_reward_scalar: 1,
      challenge_linked_quest_given: "",
      quest_pool: "",
      quest_state: "Active",
      bucket: "",
      last_state_change_time: new Date().toISOString(),
      challenge_linked_quest_parent: "",
      max_level_bonus: 0,
      xp: 0,
      quest_rarity: "uncommon",
      favorite: false,
      completion_quest_s19_victorycrown_hidden_obj0: 0,
    },
    quantity: 1,
  };

  applyProfileChanges.push({
    changeType: "itemAdded",
    itemId: questKey,
    item: athena.items[questKey],
  });
}

const VICTORY_CROWN_WIN_COUNTER = "VictoryCrown_Wins";

async function recordVictoryCrownWin(profileDoc, accountId, incrementBy = 1) {
  if (!profileDoc?.profiles?.athena) {
    return { ok: false, reason: "no_athena_profile" };
  }

  const athena = profileDoc.profiles.athena;
  const increment = Math.max(1, Number(incrementBy) || 1);
  const ApplyProfileChanges = [];

  if (!athena.stats?.attributes) {
    athena.stats = { attributes: {} };
  }
  if (!athena.stats.attributes.named_counters) {
    athena.stats.attributes.named_counters = {};
  }

  if (!athena.stats.attributes.named_counters[VICTORY_CROWN_WIN_COUNTER]) {
    athena.stats.attributes.named_counters[VICTORY_CROWN_WIN_COUNTER] = {
      current_count: 0,
      last_incremented_time: "",
    };
  }

  athena.stats.attributes.named_counters[VICTORY_CROWN_WIN_COUNTER].current_count +=
    increment;
  athena.stats.attributes.named_counters[VICTORY_CROWN_WIN_COUNTER].last_incremented_time =
    new Date().toISOString();

  handleVictoryCrownCounterIncrement(
    athena,
    VICTORY_CROWN_WIN_COUNTER,
    increment,
    functions.MakeID,
    ApplyProfileChanges,
  );

  const crownWins =
    athena.stats.attributes.named_counters[VICTORY_CROWN_WIN_COUNTER].current_count;
  const quest = athena.items?.["S19-Quest:quest_s19_victorycrown_hidden"];
  if (quest?.attributes) {
    quest.attributes.completion_quest_s19_victorycrown_hidden_obj0 = crownWins;
    ApplyProfileChanges.push({
      changeType: "itemAttrChanged",
      itemId: "S19-Quest:quest_s19_victorycrown_hidden",
      attributeName: "completion_quest_s19_victorycrown_hidden_obj0",
      attributeValue: crownWins,
    });
  }

  athena.rvn = (athena.rvn || 0) + 1;
  athena.commandRevision = (athena.commandRevision || 0) + 1;

  ApplyProfileChanges.push({
    changeType: "statModified",
    name: "named_counters",
    value: athena.stats.attributes.named_counters,
  });

  await profileDoc.updateOne({
    $set: { "profiles.athena": athena },
  });

  return {
    ok: true,
    accountId,
    crownWins:
      athena.stats.attributes.named_counters[VICTORY_CROWN_WIN_COUNTER].current_count,
    questProgress:
      athena.items?.["S19-Quest:quest_s19_victorycrown_hidden"]?.attributes
        ?.completion_quest_s19_victorycrown_hidden_obj0 ?? 0,
    applyProfileChanges: ApplyProfileChanges,
  };
}

function handleVictoryCrownCounterIncrement(
  athena,
  counterName,
  incrementBy,
  makeId,
  applyProfileChanges,
) {
  const lower = counterName.toLowerCase();
  if (!lower.includes("victory") && !lower.includes("crown")) return false;

  ensureVictoryCrownQuest(athena, makeId, applyProfileChanges);

  const questKey = "S19-Quest:quest_s19_victorycrown_hidden";
  const quest = athena.items[questKey];
  if (quest) {
    quest.attributes.completion_quest_s19_victorycrown_hidden_obj0 =
      (quest.attributes.completion_quest_s19_victorycrown_hidden_obj0 || 0) +
      incrementBy;
    applyProfileChanges.push({
      changeType: "itemAttrChanged",
      itemId: questKey,
      attributeName: "completion_quest_s19_victorycrown_hidden_obj0",
      attributeValue:
        quest.attributes.completion_quest_s19_victorycrown_hidden_obj0,
    });
  }

  const emoteTemplate = "AthenaDance:EID_RealCrown";
  let ownsEmote = false;
  for (const key in athena.items) {
    if (athena.items[key].templateId?.toLowerCase() === emoteTemplate.toLowerCase()) {
      ownsEmote = true;
      break;
    }
  }
  if (!ownsEmote) {
    const itemId = makeId();
    athena.items[itemId] = {
      templateId: emoteTemplate,
      attributes: {
        max_level_bonus: 0,
        level: 1,
        item_seen: false,
        xp: 0,
        variants: [],
        favorite: false,
      },
      quantity: 1,
    };
    applyProfileChanges.push({
      changeType: "itemAdded",
      itemId,
      item: athena.items[itemId],
    });
  }

  return true;
}

function getServerConfig() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, "../Config/config.json"), "utf8"),
    );
  } catch {
    return {};
  }
}

function getGameserverBattlePassState(athena) {
  const stats = athena?.stats?.attributes || {};
  return {
    book_level: Math.max(1, Number(stats.book_level) || 1),
    book_xp: Math.max(0, Number(stats.book_xp) || 0),
  };
}

async function applyGameserverMatchProgress(profileDoc, accountId, options = {}) {
  const cfg = getServerConfig();
  const season =
    Number(options.season) || Number(cfg.bBattlePassSeason) || 19;
  const enableBattlePass =
    options.enableBattlePass !== false && cfg.bEnableBattlepass !== false;

  const athena = profileDoc.profiles?.athena;
  if (!athena?.stats?.attributes) {
    return { ok: false, error: "no_athena" };
  }

  const onlyFetch = Boolean(options.onlyFetch);
  if (onlyFetch) {
    return {
      ok: true,
      accountId,
      onlyFetch: true,
      ...getGameserverBattlePassState(athena),
    };
  }

  const ApplyProfileChanges = [];
  const stats = athena.stats.attributes;
  const oldBookLevel = Number(stats.book_level || 1);
  const level = Math.max(0, Number(options.level) || 0);
  const matchXpGain = Math.max(0, Number(options.matchXpGain) || 0);

  if (level > 0) {
    const maxLevel = getMaxBattlePassLevel();
    const cappedLevel = Math.max(1, Math.min(maxLevel, level));
    const targetXp = getBookXpForLevel(cappedLevel, season);
    const currentLevel = Number(stats.book_level) || 1;

    if (cappedLevel > currentLevel) {
      stats.book_level = cappedLevel;
      stats.level = cappedLevel;
      stats.accountLevel = cappedLevel;
    }
    if (targetXp > (Number(stats.book_xp) || 0)) {
      stats.book_xp = targetXp;
      stats.xp = targetXp;
    }
  } else if (matchXpGain > 0) {
    stats.book_xp = (Number(stats.book_xp) || 0) + matchXpGain;
    stats.xp = stats.book_xp;
  } else {
    return {
      ok: true,
      accountId,
      skipped: true,
      ...getGameserverBattlePassState(athena),
    };
  }

  const progress = syncBattlePassFromXp(athena, ApplyProfileChanges, season);

  if (progress.leveledUp && enableBattlePass) {
    const BattlePassData = loadBattlePass(season);
    const commonCore = profileDoc.profiles.common_core;
    const profile0 = profileDoc.profiles.profile0;
    if (BattlePassData && commonCore) {
      const multiUpdateChanges = [];
      grantBattlePassTiers(
        athena,
        commonCore,
        profile0,
        BattlePassData,
        progress.oldLevel,
        progress.newLevel,
        multiUpdateChanges,
        ApplyProfileChanges,
        functions.MakeID,
        athena.stats.attributes.book_purchased,
      );
      if (multiUpdateChanges.length > 0 || ApplyProfileChanges.length > 0) {
        commonCore.rvn = (commonCore.rvn || 0) + 1;
        commonCore.commandRevision = (commonCore.commandRevision || 0) + 1;
        await profileDoc.updateOne({
          $set: {
            "profiles.common_core": commonCore,
            "profiles.profile0": profile0,
          },
        });
      }
    }
  }

  const newBookLevel = Number(athena.stats.attributes.book_level) || oldBookLevel;
  const shouldSave =
    ApplyProfileChanges.length > 0 ||
    progress.changed ||
    newBookLevel > oldBookLevel;

  if (shouldSave) {
    athena.rvn = (athena.rvn || 0) + 1;
    athena.commandRevision = (athena.commandRevision || 0) + 1;
    await profileDoc.updateOne({
      $set: { "profiles.athena": athena },
    });
  }

  return {
    ok: true,
    accountId,
    book_level: athena.stats.attributes.book_level,
    book_xp: athena.stats.attributes.book_xp,
    leveledUp: progress.leveledUp || newBookLevel > oldBookLevel,
    oldLevel: oldBookLevel,
    newLevel: newBookLevel,
  };
}

module.exports = {
  loadBattlePass,
  normalizePurchaseInfoList,
  normalizeBookProgression,
  getBookXpForLevel,
  getXpPerLevel,
  syncBattlePassFromXp,
  applyTierLevelPurchase,
  grantBattlePassTiers,
  exchangeBattlePassOffers,
  addBattleStars,
  usesBattleStars,
  handleVictoryCrownCounterIncrement,
  ensureVictoryCrownQuest,
  recordVictoryCrownWin,
  VICTORY_CROWN_WIN_COUNTER,
  getGameserverBattlePassState,
  applyGameserverMatchProgress,
  getMaxBattlePassLevel,
};
