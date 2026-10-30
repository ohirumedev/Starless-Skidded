const { MessageEmbed } = require("discord.js");
const { isStaffMember } = require("../../../structs/discordStaff.js");
const Users = require("../../../model/user.js");
const Profiles = require("../../../model/profiles.js");
const log = require("../../../structs/log.js");

// ─── All custom cosmetics ────────────────────────────────────────────────────

const CUSTOM_CHARACTERS = [
    // Original batch
    "AthenaCharacter:Character_2B",
    "AthenaCharacter:Character_AlderOptic",
    "AthenaCharacter:Character_AuroraDart",
    "AthenaCharacter:Character_AuroraDartBlueJay",
    "AthenaCharacter:Character_Cock",
    "AthenaCharacter:Character_CrimsonIris",
    "AthenaCharacter:Character_DrapeUltra",
    "AthenaCharacter:Character_DryEraseCod",
    "AthenaCharacter:Character_DyedDuelist",
    "AthenaCharacter:Character_Eternity",
    "AthenaCharacter:Character_finchvisit",
    "AthenaCharacter:Character_GatorCeladon",
    "AthenaCharacter:Character_GongFiddle",
    "AthenaCharacter:Character_IchorIncisor",
    "AthenaCharacter:Character_KelpLinenMagnesium",
    "AthenaCharacter:Character_PatronPoppet",
    "AthenaCharacter:Character_PineTrimSurge",
    "AthenaCharacter:Character_PinkJet",
    "AthenaCharacter:Character_QuarterClaspJoin",
    "AthenaCharacter:Character_PrairieSkip_Forge",
    "AthenaCharacter:Character_QuicheLorraineCrisp",
    "AthenaCharacter:Character_QuicheLorraineLime",
    "AthenaCharacter:Character_ShadeToll",
    "AthenaCharacter:Character_SharpMagnet",
    "AthenaCharacter:Character_skeleton",
    "AthenaCharacter:Character_SkiffGrind",
    "AthenaCharacter:Character_SkippingClouds",
    "AthenaCharacter:Character_Skirmish",
    "AthenaCharacter:Character_SpatialTravelWatt",
    "AthenaCharacter:Character_TechnoAwaken",
    "AthenaCharacter:Character_TameEagle",
    "AthenaCharacter:Character_ToothGreek",
    "AthenaCharacter:Character_TweakSmirk",
    "AthenaCharacter:Character_TwilightSpotShine",
    "AthenaCharacter:Character_VibrantShell",
    "AthenaCharacter:Character_VoltaicHuntress",
    "AthenaCharacter:Character_WildCard",
    "AthenaCharacter:CID_922_Athena_Commando_M_ParcelPrank",
    "AthenaCharacter:CID_A_329_Athena_Commando_F_Uproar_I5N5Z",
    // New batch
    "AthenaCharacter:Character_BluntWhimsy",
    "AthenaCharacter:Character_CactusRocker",
    "AthenaCharacter:Character_ChimeCurlCorn",
    "AthenaCharacter:Character_ChorusPunt",
    "AthenaCharacter:Character_ChubbyJingle",
    "AthenaCharacter:Character_CID_732_Athena_Commando_F_Stars",
    "AthenaCharacter:Character_CornerWeek",
    "AthenaCharacter:Character_DimeBlanketGrace",
    "AthenaCharacter:Character_CozyMechanic_Hen",
    "AthenaCharacter:Character_FearlessFlightHero",
    "AthenaCharacter:Character_FumeFleeceJig",
    "AthenaCharacter:Character_Handlebar",
    "AthenaCharacter:Character_HeadhunterStar",
    "AthenaCharacter:Character_MarchTreatBay",
    "AthenaCharacter:Character_MicroLeaf",
    "AthenaCharacter:Character_MirageHike",
    "AthenaCharacter:Character_PrivateJet",
    "AthenaCharacter:Character_RoseDust",
    "AthenaCharacter:Character_RowLiaison_Cafe",
    "AthenaCharacter:Character_ScareyBeary_Shadow",
    "AthenaCharacter:Character_SummitReedGrit",
    "AthenaCharacter:Character_SunriseCastle",
    "AthenaCharacter:Character_Temple",
    "AthenaCharacter:Character_TextileRam",
    "AthenaCharacter:CID_028_Athena_Commando_F",
];

const CUSTOM_PICKAXES = [
    "AthenaPickaxe:Pickaxe_Helix_skull",
    "AthenaPickaxe:Pickaxe_ID_505_MasterSword",
    "AthenaPickaxe:Pickaxe_leviathan",
    "AthenaPickaxe:Pickaxe_QuarterClaspAbove",
    "AthenaPickaxe:Pickaxe_ID_599_CavernFemale",
];

const CUSTOM_DANCES = [
    // Original batch
    "AthenaDance:EID_BeepBop",
    "AthenaDance:EID_BluePhoto_JSG4D",
    "AthenaDance:EID_BunnyHopping",
    "AthenaDance:EID_BusyBee",
    "AthenaDance:EID_Captivate",
    "AthenaDance:EID_CarCrash",
    "AthenaDance:EID_Dance149",
    "AthenaDance:EID_FuzzBall",
    "AthenaDance:EID_GasStation_104FQ",
    "AthenaDance:EID_GreatEscape",
    "AthenaDance:EID_Historian_2TEF8",
    "AthenaDance:EID_JadeTowel",
    "AthenaDance:EID_Keplinen",
    "AthenaDance:EID_KingDrive",
    "AthenaDance:EID_LeapFrog",
    "AthenaDance:EID_LevitateSnow",
    // New batch
    "AthenaDance:EID_YouthFlume",
    "AthenaDance:EID_VoidRedemption",
    "AthenaDance:EID_Vitality",
    "AthenaDance:EID_TriggerFinger",
    "AthenaDance:EID_SunMelt",
    "AthenaDance:EID_SunBurst",
    "AthenaDance:EID_SummitReedGrit",
    "AthenaDance:EID_StoneFly",
    "AthenaDance:EID_Scrolls",
    "AthenaDance:EID_Saxobeat",
    "AthenaDance:EID_SantaClara",
    "AthenaDance:EID_QuickRobbery",
    "AthenaDance:EID_PleaseHelp",
    "AthenaDance:EID_phuthon",
    "AthenaDance:EID_LovelyCurse",
    "AthenaDance:EID_LottaLove",
    "AthenaDance:EID_LosingMoments",
    "AthenaDance:EID_KelpLinenMagnesium",
];

const CUSTOM_MUSIC = [
    "AthenaMusicPack:MusicPack_ATL",
    "AthenaMusicPack:MusicPack_fromtostart",
    "AthenaMusicPack:MusicPack_nokia",
    "AthenaMusicPack:MusicPack_Rei_dos_demonios",
    "AthenaMusicPack:MusicPack_rock",
];

const ALL_CUSTOM_ITEMS = [
    ...CUSTOM_CHARACTERS,
    ...CUSTOM_PICKAXES,
    ...CUSTOM_DANCES,
    ...CUSTOM_MUSIC,
];

// ─── Helper: build an item object ────────────────────────────────────────────

function buildItem(templateId) {
    return {
        templateId,
        attributes: {
            max_level_bonus: 0,
            level: 1,
            item_seen: true,
            xp: 0,
            variants: [],
            favorite: false,
        },
        quantity: 1,
    };
}

// ─── Command ─────────────────────────────────────────────────────────────────

module.exports = {
    commandInfo: {
        name: "givecustomskins",
        description: "Give all custom server cosmetics to a player by in-game username.",
        options: [
            {
                name: "username",
                description: "In-game username of the player.",
                required: true,
                type: 3,
            },
        ],
    },

    execute: async (interaction) => {
        if (!isStaffMember(interaction)) {
            return interaction.reply({
                content: "You do not have permission. Only staff can use admin commands.",
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const username = interaction.options.getString("username");

        const targetUser = await Users.findOne({ username_lower: username.toLowerCase() });
        if (!targetUser) {
            return interaction.editReply({
                content: `No account found with the username **${username}**.`,
            });
        }

        const profile = await Profiles.findOne({ accountId: targetUser.accountId });
        if (!profile?.profiles?.athena) {
            return interaction.editReply({
                content: `Found account **${targetUser.username}** but their profile is missing.`,
            });
        }

        const athena = profile.profiles.athena;
        let added = 0;

        for (const templateId of ALL_CUSTOM_ITEMS) {
            if (!athena.items[templateId]) {
                athena.items[templateId] = buildItem(templateId);
                added++;
            }
        }

        athena.rvn = (athena.rvn || 0) + 1;
        athena.commandRevision = (athena.commandRevision || 0) + 1;

        await Profiles.updateOne(
            { accountId: targetUser.accountId },
            { $set: { "profiles.athena": athena } }
        );

        log.backend(
            `[givecustomskins] ${interaction.user.tag} gave ${added} new custom items to ${targetUser.username} (${targetUser.accountId})`
        );

        const embed = new MessageEmbed()
            .setTitle("Custom Cosmetics Granted")
            .setDescription(
                `Successfully gave all **${ALL_CUSTOM_ITEMS.length}** custom cosmetics to **${targetUser.username}**.\n` +
                `*(${added} new, ${ALL_CUSTOM_ITEMS.length - added} already owned)*`
            )
            .addFields(
                { name: "Skins",     value: `${CUSTOM_CHARACTERS.length}`, inline: true },
                { name: "Pickaxes",  value: `${CUSTOM_PICKAXES.length}`,   inline: true },
                { name: "Dances",    value: `${CUSTOM_DANCES.length}`,     inline: true },
                { name: "Music",     value: `${CUSTOM_MUSIC.length}`,      inline: true },
                { name: "Account ID", value: `\`${targetUser.accountId}\``, inline: false },
            )
            .setColor("PURPLE")
            .setFooter({ text: "IRIS Backend", iconURL: "https://i.imgur.com/essv7b1.png" })
            .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
    },
};
