const fs = require("fs");
const path = require("path");

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const { joinVoiceChannel } = require("@discordjs/voice");

const TOKEN = process.env.TOKEN;

const GUILD_ID = "1367976354104086629";
const VOICE_CHANNEL_ID = "1401074295022817381";
const OWNER_ID = "1058107732584050879";

/* ✅ روم الفيديو */
const VIDEO_ROOM = "1477417977472090316";

/* ✅ روم الليدر بورد + رتبة التحكم + الكاتاقوري المعتمدة */
const LEADERBOARD_CHANNEL_ID = "1484809257361870892";
const LEADERBOARD_ROLE_ID = "1426999940944756889";
const LEADERBOARD_CATEGORY_ID = "1398274126442922087";
const LEADERBOARD_SCOPE_VERSION = 2;

/* ✅ تحديث تلقائي كل 5 ثواني */
const LEADERBOARD_UPDATE_INTERVAL = 5000;

/* ✅ Self Mute AFK System */
const SELF_MUTE_AFK_CHANNEL_ID = "1371119823437824111";
const SELF_MUTE_EXEMPT_CHANNEL_IDS = [
  "1371119823437824111"
];
const SELF_MUTE_MOVE_DELAY_MS = 60 * 60 * 1000;

const selfMuteTimers = new Map();
const selfMuteStartedAt = new Map();

/* ✅ حالة النظام */
let mediaOnlyEnabled = true;

const LOG_SEND = "1367984035283996753";
const LOG_WARN = "1482927462168920186";
const LOG_WARNINGS = "1482927612627128516";
const LOG_DMALL = "1482927730050859080";
const LOG_CLEARWARN = "1482927958548287499";

/* WARN ROLES */
const WARN_ROLES = {
  1: "1482963105943126108",
  2: "1482963310860042300",
  3: "1482963374605340734",
  4: "1482963614775115837",
  5: "1482963685428433068",
  6: "1482963748267233412"
};

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "bot-data.json");

let saveTimeout = null;
let leaderboardInterval = null;
let leaderboardUpdating = false;

const activeVoiceSessions = new Map();

const db = {
  warnings: {},
  blacklist: {},
  leaderboard: {
    channelId: LEADERBOARD_CHANNEL_ID,
    messageId: null,
    scopeVersion: LEADERBOARD_SCOPE_VERSION,
    users: {}
  }
};

function ensureDataFolder() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadDatabase() {
  try {
    ensureDataFolder();

    if (!fs.existsSync(DATA_FILE)) {
      saveDatabase();
      return;
    }

    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);

    db.warnings = parsed.warnings || {};
    db.blacklist = parsed.blacklist || {};
    db.leaderboard = {
      channelId: parsed.leaderboard?.channelId || LEADERBOARD_CHANNEL_ID,
      messageId: parsed.leaderboard?.messageId || null,
      scopeVersion: parsed.leaderboard?.scopeVersion || 1,
      users: parsed.leaderboard?.users || {}
    };

    if (db.leaderboard.scopeVersion < LEADERBOARD_SCOPE_VERSION) {
      for (const userData of Object.values(db.leaderboard.users)) {
        userData.messages = 0;
        userData.voiceMs = 0;
        userData.updatedAt = Date.now();
      }

      db.leaderboard.scopeVersion = LEADERBOARD_SCOPE_VERSION;
      saveDatabase();
    }
  } catch (error) {
    console.error("❌ Failed to load database:", error);
  }
}

function saveDatabase() {
  try {
    ensureDataFolder();
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch (error) {
    console.error("❌ Failed to save database:", error);
  }
}

function scheduleSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    flushActiveVoiceSessions();
    saveDatabase();
  }, 500);
}

function isLeaderboardTrackedCategory(channel) {
  return !!channel && channel.parentId === LEADERBOARD_CATEGORY_ID;
}

function shouldTrackLeaderboardMessage(message) {
  return (
    !!message.guild &&
    message.guild.id === GUILD_ID &&
    !message.author.bot &&
    hasLeaderboardRole(message.member) &&
    isLeaderboardTrackedCategory(message.channel)
  );
}

function shouldTrackLeaderboardVoice(member, channel) {
  if (!member || member.user.bot || !channel || !channel.isVoiceBased()) return false;
  if (!hasLeaderboardRole(member)) return false;
  if (channel.id === SELF_MUTE_AFK_CHANNEL_ID) return false;
  if (member.guild.afkChannelId && channel.id === member.guild.afkChannelId) return false;
  if (member.voice?.channelId !== channel.id) return false;
  return isLeaderboardTrackedCategory(channel);
}

function commitVoiceSessionTime(userId, session, now = Date.now()) {
  if (!session || !session.counting) return;

  const elapsed = now - session.joinedAt;
  if (elapsed <= 0) return;

  const stats = getUserStats(userId);
  stats.voiceMs += elapsed;
  stats.updatedAt = now;
}

function refreshVoiceSessionTracking(member) {
  if (!member || member.user.bot) return;

  const session = activeVoiceSessions.get(member.id);
  if (!session) return;

  const now = Date.now();
  const currentChannel = member.voice?.channel || null;

  commitVoiceSessionTime(member.id, session, now);

  if (!currentChannel) {
    activeVoiceSessions.delete(member.id);
    scheduleSave();
    return;
  }

  activeVoiceSessions.set(member.id, {
    channelId: currentChannel.id,
    joinedAt: now,
    counting: shouldTrackLeaderboardVoice(member, currentChannel)
  });

  scheduleSave();
}

function getUserStats(userId) {
  if (!db.leaderboard.users[userId]) {
    db.leaderboard.users[userId] = {
      messages: 0,
      voiceMs: 0,
      manualPoints: 0,
      manualVoiceMs: 0,
      lastMessageAt: null,
      updatedAt: Date.now()
    };
  }

  if (typeof db.leaderboard.users[userId].manualPoints !== "number") {
    db.leaderboard.users[userId].manualPoints = 0;
  }

  if (typeof db.leaderboard.users[userId].manualVoiceMs !== "number") {
    db.leaderboard.users[userId].manualVoiceMs = 0;
  }

  return db.leaderboard.users[userId];
}

function addMessageCount(userId) {
  const stats = getUserStats(userId);
  stats.messages += 1;
  stats.lastMessageAt = Date.now();
  stats.updatedAt = Date.now();
  scheduleSave();
}

function startVoiceSession(member, channelId) {
  if (!member || activeVoiceSessions.has(member.id)) return;

  const channel = member.guild.channels.cache.get(channelId);

  activeVoiceSessions.set(member.id, {
    channelId,
    joinedAt: Date.now(),
    counting: shouldTrackLeaderboardVoice(member, channel)
  });
}

function endVoiceSession(userId) {
  const session = activeVoiceSessions.get(userId);
  if (!session) return;

  commitVoiceSessionTime(userId, session);
  activeVoiceSessions.delete(userId);
  scheduleSave();
}

function moveVoiceSession(member, newChannelId) {
  if (!member) return;

  const session = activeVoiceSessions.get(member.id);

  if (!session) {
    startVoiceSession(member, newChannelId);
    return;
  }

  const now = Date.now();
  commitVoiceSessionTime(member.id, session, now);

  const channel = member.guild.channels.cache.get(newChannelId);

  activeVoiceSessions.set(member.id, {
    channelId: newChannelId,
    joinedAt: now,
    counting: shouldTrackLeaderboardVoice(member, channel)
  });

  scheduleSave();
}

function flushActiveVoiceSessions() {
  const now = Date.now();
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;

  for (const [userId, session] of activeVoiceSessions.entries()) {
    commitVoiceSessionTime(userId, session, now);

    const member = guild.members.cache.get(userId);
    const currentChannel = member?.voice?.channel || null;

    if (!currentChannel) {
      activeVoiceSessions.delete(userId);
      continue;
    }

    activeVoiceSessions.set(userId, {
      channelId: currentChannel.id,
      joinedAt: now,
      counting: shouldTrackLeaderboardVoice(member, currentChannel)
    });
  }
}

function clampNumber(value, min = 0) {
  return value < min ? min : value;
}

function getEffectiveVoiceMs(data) {
  return clampNumber((data.voiceMs || 0) + (data.manualVoiceMs || 0), 0);
}

function formatVoiceDuration(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) {
    return `${minutes} دقيقة`;
  }

  return `${hours} ساعة • ${minutes} دقيقة`;
}

function getLeaderboardScore(data) {
  const messagePoints = data.messages * 1;
  const voiceMinutes = Math.floor(getEffectiveVoiceMs(data) / 60000);
  const voicePoints = voiceMinutes * 3;
  return clampNumber(messagePoints + voicePoints + (data.manualPoints || 0), 0);
}

function sortLeaderboardEntries(guild) {
  return Object.entries(db.leaderboard.users)
    .filter(([userId]) => {
      const member = guild.members.cache.get(userId);
      return hasLeaderboardRole(member);
    })
    .sort((a, b) => {
      const aScore = getLeaderboardScore(a[1]);
      const bScore = getLeaderboardScore(b[1]);

      if (bScore !== aScore) {
        return bScore - aScore;
      }

      return getEffectiveVoiceMs(b[1]) - getEffectiveVoiceMs(a[1]);
    });
}

function buildLeaderboardEmbed(guild) {
  flushActiveVoiceSessions();

  const entries = sortLeaderboardEntries(guild).slice(0, 10);

  const description = entries.length
    ? entries
        .map(([userId, data], index) => {
          return [
            `**#${index + 1}** | <@${userId}>`,
            `> **النقاط:** \`${getLeaderboardScore(data)}\` | **الرسائل:** \`${data.messages}\` | **الوقت الصوتي:** \`${formatVoiceDuration(getEffectiveVoiceMs(data))}\``
          ].join("\n");
        })
        .join("\n\n")
    : "لا يوجد بيانات داخل الكاتاقوري المحددة حتى الآن.";

  return new EmbedBuilder()
    .setColor("#000000")
    .setAuthor({
      name: `${guild.name} Leaderboard`,
      iconURL: guild.iconURL({ dynamic: true }) || undefined
    })
    .setTitle("Leaderboards for N5BH")
    .setDescription(description)
    .addFields({
      name: "🕒 آخر تحديث",
      value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
      inline: true
    })
    .setFooter({
      text: "النقاط = رسائل وفويس الكاتاقوري المحددة + التعديل اليدوي"
    })
    .setTimestamp();
}

function buildLeaderboardControlEmbed(targetUser, stats) {
  return new EmbedBuilder()
    .setColor("#f39c12")
    .setAuthor({
      name: "Leaderboard Control Panel",
      iconURL: targetUser.displayAvatarURL()
    })
    .setTitle(`🎛 التحكم في ${targetUser.username}`)
    .setDescription(`<@${targetUser.id}>`)
    .addFields(
      { name: "⭐ النقاط الحالية", value: `${getLeaderboardScore(stats)}`, inline: true },
      { name: "💬 الرسائل", value: `${stats.messages}`, inline: true },
      { name: "🎤 الوقت الصوتي", value: formatVoiceDuration(getEffectiveVoiceMs(stats)), inline: true },
      { name: "🧮 النقاط اليدوية", value: `${stats.manualPoints || 0}`, inline: true },
      { name: "⏱ الفويس اليدوي", value: formatVoiceDuration(stats.manualVoiceMs || 0), inline: true },
      { name: "🆔 ID", value: targetUser.id, inline: false }
    )
    .setFooter({
      text: "هذه اللوحة للأونر فقط"
    })
    .setTimestamp();
}

function buildLeaderboardControlRows(userId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`lb_add_10_${userId}`)
        .setLabel("+10")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`lb_sub_10_${userId}`)
        .setLabel("-10")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`lb_add_100_${userId}`)
        .setLabel("+100")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`lb_sub_100_${userId}`)
        .setLabel("-100")
        .setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`lb_set_points_${userId}`)
        .setLabel("Set Points")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`lb_set_voice_${userId}`)
        .setLabel("Set Voice")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`lb_reset_${userId}`)
        .setLabel("Reset Manual")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`lb_refresh_${userId}`)
        .setLabel("Refresh")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function isOwner(userId) {
  return userId === OWNER_ID;
}

async function updateLeaderboardControlMessage(interaction, targetUserId) {
  const targetUser = await client.users.fetch(targetUserId).catch(() => null);
  if (!targetUser) {
    return interaction.reply({
      content: "❌ ما قدرت أجيب بيانات العضو.",
      ephemeral: true
    });
  }

  const stats = getUserStats(targetUserId);

  return interaction.update({
    embeds: [buildLeaderboardControlEmbed(targetUser, stats)],
    components: buildLeaderboardControlRows(targetUserId)
  });
}

async function findExistingLeaderboardMessage(channel) {
  try {
    const messages = await channel.messages.fetch({ limit: 20 });
    const botMessages = messages.filter(msg =>
      msg.author.id === client.user.id &&
      msg.embeds.length > 0 &&
      msg.components.length > 0 &&
      msg.components.some(row =>
        row.components.some(component => component.customId === "leaderboard_refresh")
      )
    );

    return botMessages.first() || null;
  } catch {
    return null;
  }
}

async function ensureLeaderboardMessage(guild) {
  const channel = guild.channels.cache.get(db.leaderboard.channelId);
  if (!channel || !channel.isTextBased()) return null;

  if (db.leaderboard.messageId) {
    try {
      const existingMessage = await channel.messages.fetch(db.leaderboard.messageId);
      return existingMessage;
    } catch {
      db.leaderboard.messageId = null;
      saveDatabase();
    }
  }

  const foundMessage = await findExistingLeaderboardMessage(channel);
  if (foundMessage) {
    db.leaderboard.messageId = foundMessage.id;
    saveDatabase();
    return foundMessage;
  }

  const newMessage = await channel.send({
    embeds: [buildLeaderboardEmbed(guild)],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("تحديث الليدر بورد")
          .setStyle(ButtonStyle.Secondary)
          .setCustomId("leaderboard_refresh")
      )
    ]
  });

  db.leaderboard.messageId = newMessage.id;
  saveDatabase();

  return newMessage;
}

async function updateLeaderboardMessage(guild) {
  if (leaderboardUpdating) return;
  leaderboardUpdating = true;

  try {
    const channel = guild.channels.cache.get(db.leaderboard.channelId);
    if (!channel || !channel.isTextBased()) return;

    const message = await ensureLeaderboardMessage(guild);
    if (!message) return;

    await message.edit({
      embeds: [buildLeaderboardEmbed(guild)],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel("تحديث الليدر بورد")
            .setStyle(ButtonStyle.Secondary)
            .setCustomId("leaderboard_refresh")
        )
      ]
    });

    saveDatabase();
  } catch (error) {
    console.error("❌ Failed to update leaderboard:", error);
  } finally {
    leaderboardUpdating = false;
  }
}

function hasLeaderboardRole(member) {
  return !!member && member.roles.cache.has(LEADERBOARD_ROLE_ID);
}

function hasAdmin(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function hasManageChannels(member) {
  return member.permissions.has(PermissionsBitField.Flags.ManageChannels) || hasAdmin(member);
}

function hasModeration(member) {
  return (
    member.permissions.has(PermissionsBitField.Flags.KickMembers) ||
    member.permissions.has(PermissionsBitField.Flags.BanMembers) ||
    member.permissions.has(PermissionsBitField.Flags.ModerateMembers) ||
    hasAdmin(member)
  );
}

function denyReply(interaction) {
  return interaction.reply({
    content: "❌ لا يمكنك استخدام الأمر",
    ephemeral: true
  });
}

function warningMapGet(userId) {
  return db.warnings[userId] || null;
}

function warningMapSet(userId, value) {
  db.warnings[userId] = value;
  scheduleSave();
}

function warningMapDelete(userId) {
  delete db.warnings[userId];
  scheduleSave();
}

function blacklistGet(userId) {
  return db.blacklist[userId] || null;
}

function blacklistSet(userId, value) {
  db.blacklist[userId] = value;
  scheduleSave();
}

function blacklistDelete(userId) {
  delete db.blacklist[userId];
  scheduleSave();
}

function sendLog(interaction, channelId, embed, row) {
  const channel = interaction.guild.channels.cache.get(channelId);

  if (channel) {
    channel.send({
      embeds: [embed],
      components: row ? [row] : []
    }).catch(() => {});
  }
}

function parseChannelIds(input) {
  return input
    .split(",")
    .map(x => x.trim().replace(/[<#>]/g, ""))
    .filter(Boolean);
}

async function setRoleViewForChannel(channel, roleId, visible) {
  await channel.permissionOverwrites.edit(roleId, {
    ViewChannel: visible ? true : false
  }).catch(() => {});
}

async function setRoleSendForChannel(channel, roleId, allowed) {
  if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) {
    await channel.permissionOverwrites.edit(roleId, {
      SendMessages: allowed ? true : false
    }).catch(() => {});
  }
}

async function setRoleConnectForChannel(channel, roleId, allowed) {
  if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
    await channel.permissionOverwrites.edit(roleId, {
      Connect: allowed ? true : false,
      Speak: allowed ? true : false
    }).catch(() => {});
  }
}

async function applyActionToChannel(channel, roleId, action) {
  if (action === "hide") {
    await setRoleViewForChannel(channel, roleId, false);
  }

  if (action === "show") {
    await setRoleViewForChannel(channel, roleId, true);
  }

  if (action === "deny_send") {
    await setRoleSendForChannel(channel, roleId, false);
  }

  if (action === "allow_send") {
    await setRoleSendForChannel(channel, roleId, true);
  }

  if (action === "deny_connect") {
    await setRoleConnectForChannel(channel, roleId, false);
  }

  if (action === "allow_connect") {
    await setRoleConnectForChannel(channel, roleId, true);
  }
}

function isExcludedSelfMuteChannel(channelId) {
  return SELF_MUTE_EXEMPT_CHANNEL_IDS.includes(channelId);
}

function clearSelfMuteTracking(userId) {
  const existing = selfMuteTimers.get(userId);
  if (existing) {
    clearTimeout(existing);
  }

  selfMuteTimers.delete(userId);
  selfMuteStartedAt.delete(userId);
}

function armSelfMuteTimer(member) {
  const userId = member.id;
  const startedAt = selfMuteStartedAt.get(userId) || Date.now();

  selfMuteStartedAt.set(userId, startedAt);

  const elapsed = Date.now() - startedAt;
  const remaining = Math.max(1000, SELF_MUTE_MOVE_DELAY_MS - elapsed);

  const existing = selfMuteTimers.get(userId);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(async () => {
    try {
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) {
        clearSelfMuteTracking(userId);
        return;
      }

      const refreshedMember = await guild.members.fetch(userId).catch(() => null);
      if (!refreshedMember || !refreshedMember.voice) {
        clearSelfMuteTracking(userId);
        return;
      }

      const voiceState = refreshedMember.voice;

      if (
        !voiceState.channelId ||
        !voiceState.selfMute ||
        voiceState.channelId === SELF_MUTE_AFK_CHANNEL_ID ||
        isExcludedSelfMuteChannel(voiceState.channelId)
      ) {
        clearSelfMuteTracking(userId);
        return;
      }

      const afkChannel = guild.channels.cache.get(SELF_MUTE_AFK_CHANNEL_ID);
      if (!afkChannel || !afkChannel.isVoiceBased()) {
        clearSelfMuteTracking(userId);
        return;
      }

      await voiceState.setChannel(afkChannel, "Self-muted for 1 hour").catch(() => {});
      clearSelfMuteTracking(userId);
    } catch {
      clearSelfMuteTracking(userId);
    }
  }, remaining);

  selfMuteTimers.set(userId, timer);
}

function syncSelfMuteTracking(state) {
  const member = state.member;
  if (!member || member.user.bot) return;
  if (member.guild.id !== GUILD_ID) return;

  const channelId = state.channelId;

  if (
    !channelId ||
    channelId === SELF_MUTE_AFK_CHANNEL_ID ||
    isExcludedSelfMuteChannel(channelId) ||
    !state.selfMute
  ) {
    clearSelfMuteTracking(member.id);
    return;
  }

  armSelfMuteTimer(member);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const commands = [
  new SlashCommandBuilder()
    .setName("send")
    .setDescription("ارسال رسالة بالخاص")
    .addUserOption(o => o.setName("user").setDescription("الشخص").setRequired(true))
    .addStringOption(o => o.setName("message").setDescription("الرسالة").setRequired(true)),

  new SlashCommandBuilder()
    .setName("dmall")
    .setDescription("ارسال رسالة لكل السيرفر")
    .addStringOption(o => o.setName("message").setDescription("الرسالة").setRequired(true)),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("تحذير عضو")
    .addUserOption(o => o.setName("user").setDescription("الشخص").setRequired(true))
    .addIntegerOption(o =>
      o.setName("level")
        .setDescription("رقم الوارن")
        .setRequired(true)
        .addChoices(
          { name: "Warn 1", value: 1 },
          { name: "Warn 2", value: 2 },
          { name: "Warn 3", value: 3 },
          { name: "Warn 4", value: 4 },
          { name: "Warn 5", value: 5 },
          { name: "Warn 6", value: 6 }
        )
    )
    .addStringOption(o => o.setName("reason").setDescription("السبب").setRequired(true)),

  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("عرض تحذيرات عضو")
    .addUserOption(o => o.setName("user").setDescription("الشخص").setRequired(true)),

  new SlashCommandBuilder()
    .setName("clearwarnings")
    .setDescription("مسح التحذيرات")
    .addUserOption(o => o.setName("user").setDescription("الشخص").setRequired(true)),

  new SlashCommandBuilder()
    .setName("mediaonly")
    .setDescription("تشغيل او ايقاف نظام الصور فقط"),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("نظام الليدر بورد")
    .addStringOption(o =>
      o.setName("action")
        .setDescription("نوع العملية")
        .setRequired(true)
        .addChoices(
          { name: "setup", value: "setup" },
          { name: "refresh", value: "refresh" },
          { name: "stats", value: "stats" }
        )
    )
    .addUserOption(o =>
      o.setName("user")
        .setDescription("عضو معين لعرض احصائياته")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("leaderboardpanel")
    .setDescription("لوحة تحكم الليدر بورد للأونر فقط")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("العضو المطلوب التحكم فيه")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("طرد عضو")
    .addUserOption(o => o.setName("user").setDescription("العضو").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("السبب").setRequired(false)),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("باند عضو")
    .addUserOption(o => o.setName("user").setDescription("العضو").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("السبب").setRequired(false)),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("تايم اوت عضو")
    .addUserOption(o => o.setName("user").setDescription("العضو").setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setDescription("عدد الدقائق").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("السبب").setRequired(false)),

  new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("إزالة التايم اوت")
    .addUserOption(o => o.setName("user").setDescription("العضو").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("السبب").setRequired(false)),

  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("حذف رسائل")
    .addIntegerOption(o => o.setName("amount").setDescription("العدد").setRequired(true)),

  new SlashCommandBuilder()
    .setName("categoryhide")
    .setDescription("إخفاء كاتاقوري كاملة من رتبة")
    .addRoleOption(o => o.setName("role").setDescription("الرتبة").setRequired(true))
    .addChannelOption(o => o.setName("category").setDescription("الكاتاقوري").setRequired(true)),

  new SlashCommandBuilder()
    .setName("categoryshow")
    .setDescription("إظهار كاتاقوري كاملة لرتبة")
    .addRoleOption(o => o.setName("role").setDescription("الرتبة").setRequired(true))
    .addChannelOption(o => o.setName("category").setDescription("الكاتاقوري").setRequired(true)),

  new SlashCommandBuilder()
    .setName("channelhide")
    .setDescription("إخفاء روم من رتبة")
    .addRoleOption(o => o.setName("role").setDescription("الرتبة").setRequired(true))
    .addChannelOption(o => o.setName("channel").setDescription("الروم").setRequired(true)),

  new SlashCommandBuilder()
    .setName("channelshow")
    .setDescription("إظهار روم لرتبة")
    .addRoleOption(o => o.setName("role").setDescription("الرتبة").setRequired(true))
    .addChannelOption(o => o.setName("channel").setDescription("الروم").setRequired(true)),

  new SlashCommandBuilder()
    .setName("channelset")
    .setDescription("تعديل عدة رومات لرتبة معينة")
    .addRoleOption(o => o.setName("role").setDescription("الرتبة").setRequired(true))
    .addStringOption(o =>
      o.setName("channel_ids")
        .setDescription("ايديات الرومات مفصولة بفواصل")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("action")
        .setDescription("نوع التعديل")
        .setRequired(true)
        .addChoices(
          { name: "Hide", value: "hide" },
          { name: "Show", value: "show" },
          { name: "Deny Send", value: "deny_send" },
          { name: "Allow Send", value: "allow_send" },
          { name: "Deny Connect", value: "deny_connect" },
          { name: "Allow Connect", value: "allow_connect" }
        )
    ),

  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("إضافة شخص للبلاك ليست بالايدي")
    .addStringOption(o => o.setName("id").setDescription("ايدي الشخص").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("السبب").setRequired(false)),

  new SlashCommandBuilder()
    .setName("unblacklist")
    .setDescription("إزالة شخص من البلاك ليست")
    .addStringOption(o => o.setName("id").setDescription("ايدي الشخص").setRequired(true)),

  new SlashCommandBuilder()
    .setName("blacklistlist")
    .setDescription("عرض قائمة البلاك ليست")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

client.once("clientReady", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  loadDatabase();

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands }
  );

  console.log("✅ Commands Registered");

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;

  await guild.members.fetch().catch(() => {});

  const voiceChannel = guild.channels.cache.get(VOICE_CHANNEL_ID);
  if (voiceChannel && voiceChannel.isVoiceBased()) {
    joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true
    });
  }

  guild.voiceStates.cache.forEach(state => {
    if (!state.member) return;
    if (!state.member.user.bot && state.channelId) {
      startVoiceSession(state.member, state.channelId);
      syncSelfMuteTracking(state);
    }
  });

  await ensureLeaderboardMessage(guild);
  await updateLeaderboardMessage(guild);

  if (leaderboardInterval) clearInterval(leaderboardInterval);
  leaderboardInterval = setInterval(() => {
    updateLeaderboardMessage(guild).catch(() => {});
  }, LEADERBOARD_UPDATE_INTERVAL);
});

client.on("guildMemberAdd", async member => {
  if (member.guild.id !== GUILD_ID) return;

  const blacklisted = blacklistGet(member.id);
  if (!blacklisted) return;

  await member.kick(`Blacklisted: ${blacklisted.reason || "No reason"}`).catch(() => {});
});

client.on("messageCreate", async message => {
  if (!message.guild || message.guild.id !== GUILD_ID) return;
  if (message.author.bot) return;

  if (mediaOnlyEnabled && message.channel.id === VIDEO_ROOM) {
    if (message.attachments.size === 0) {
      return message.delete().catch(() => {});
    }

    if (message.content && message.content.trim() !== "") {
      return message.delete().catch(() => {});
    }
  }

  if (shouldTrackLeaderboardMessage(message)) {
    addMessageCount(message.author.id);
  }
});

client.on("interactionCreate", async interaction => {
  if (interaction.isButton()) {
    if (interaction.customId === "leaderboard_refresh") {
      if (!interaction.member || !hasLeaderboardRole(interaction.member)) {
        return interaction.reply({
          content: "❌ ما عندك صلاحية استخدام زر التحديث.",
          ephemeral: true
        });
      }

      await updateLeaderboardMessage(interaction.guild);

      return interaction.reply({
        content: "✅ تم تحديث الليدر بورد.",
        ephemeral: true
      });
    }

    if (interaction.customId.startsWith("lb_")) {
      if (!isOwner(interaction.user.id)) {
        return interaction.reply({
          content: "❌ هذه اللوحة للأونر فقط.",
          ephemeral: true
        });
      }

      const parts = interaction.customId.split("_");
      const action = parts[1];
      const maybeSub = parts[2];
      const targetUserId = parts[parts.length - 1];
      const stats = getUserStats(targetUserId);

      if (action === "add" && maybeSub === "10") {
        stats.manualPoints += 10;
        stats.updatedAt = Date.now();
        scheduleSave();
        await updateLeaderboardMessage(interaction.guild);
        return updateLeaderboardControlMessage(interaction, targetUserId);
      }

      if (action === "sub" && maybeSub === "10") {
        stats.manualPoints -= 10;
        stats.updatedAt = Date.now();
        scheduleSave();
        await updateLeaderboardMessage(interaction.guild);
        return updateLeaderboardControlMessage(interaction, targetUserId);
      }

      if (action === "add" && maybeSub === "100") {
        stats.manualPoints += 100;
        stats.updatedAt = Date.now();
        scheduleSave();
        await updateLeaderboardMessage(interaction.guild);
        return updateLeaderboardControlMessage(interaction, targetUserId);
      }

      if (action === "sub" && maybeSub === "100") {
        stats.manualPoints -= 100;
        stats.updatedAt = Date.now();
        scheduleSave();
        await updateLeaderboardMessage(interaction.guild);
        return updateLeaderboardControlMessage(interaction, targetUserId);
      }

      if (action === "reset") {
        stats.manualPoints = 0;
        stats.manualVoiceMs = 0;
        stats.updatedAt = Date.now();
        scheduleSave();
        await updateLeaderboardMessage(interaction.guild);
        return updateLeaderboardControlMessage(interaction, targetUserId);
      }

      if (action === "refresh") {
        return updateLeaderboardControlMessage(interaction, targetUserId);
      }

      if (action === "set" && maybeSub === "points") {
        const modal = new ModalBuilder()
          .setCustomId(`lbmodal_points_${targetUserId}`)
          .setTitle("Set Manual Points");

        const input = new TextInputBuilder()
          .setCustomId("manual_points")
          .setLabel("اكتب النقاط اليدوية")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(stats.manualPoints || 0));

        modal.addComponents(
          new ActionRowBuilder().addComponents(input)
        );

        return interaction.showModal(modal);
      }

      if (action === "set" && maybeSub === "voice") {
        const modal = new ModalBuilder()
          .setCustomId(`lbmodal_voice_${targetUserId}`)
          .setTitle("Set Manual Voice");

        const hoursInput = new TextInputBuilder()
          .setCustomId("manual_voice_hours")
          .setLabel("الساعات")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue("0");

        const minutesInput = new TextInputBuilder()
          .setCustomId("manual_voice_minutes")
          .setLabel("الدقائق")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue("0");

        modal.addComponents(
          new ActionRowBuilder().addComponents(hoursInput),
          new ActionRowBuilder().addComponents(minutesInput)
        );

        return interaction.showModal(modal);
      }
    }
  }

  if (interaction.isModalSubmit()) {
    if (!isOwner(interaction.user.id)) {
      return interaction.reply({
        content: "❌ هذا التعديل للأونر فقط.",
        ephemeral: true
      });
    }

    if (interaction.customId.startsWith("lbmodal_points_")) {
      const targetUserId = interaction.customId.replace("lbmodal_points_", "");
      const stats = getUserStats(targetUserId);
      const raw = interaction.fields.getTextInputValue("manual_points").trim();
      const parsed = Number(raw);

      if (Number.isNaN(parsed)) {
        return interaction.reply({
          content: "❌ لازم تكتب رقم صحيح.",
          ephemeral: true
        });
      }

      stats.manualPoints = parsed;
      stats.updatedAt = Date.now();
      scheduleSave();
      await updateLeaderboardMessage(interaction.guild);

      const targetUser = await client.users.fetch(targetUserId).catch(() => null);
      if (!targetUser) {
        return interaction.reply({
          content: "✅ تم تعديل النقاط، لكن ما قدرت أجيب العضو.",
          ephemeral: true
        });
      }

      return interaction.reply({
        embeds: [buildLeaderboardControlEmbed(targetUser, stats)],
        components: buildLeaderboardControlRows(targetUserId),
        ephemeral: true
      });
    }

    if (interaction.customId.startsWith("lbmodal_voice_")) {
      const targetUserId = interaction.customId.replace("lbmodal_voice_", "");
      const stats = getUserStats(targetUserId);

      const rawHours = interaction.fields.getTextInputValue("manual_voice_hours").trim();
      const rawMinutes = interaction.fields.getTextInputValue("manual_voice_minutes").trim();

      const hours = Number(rawHours);
      const minutes = Number(rawMinutes);

      if (Number.isNaN(hours) || Number.isNaN(minutes) || hours < 0 || minutes < 0) {
        return interaction.reply({
          content: "❌ لازم تكتب ساعات ودقائق بشكل صحيح.",
          ephemeral: true
        });
      }

      stats.manualVoiceMs = ((hours * 60) + minutes) * 60 * 1000;
      stats.updatedAt = Date.now();
      scheduleSave();
      await updateLeaderboardMessage(interaction.guild);

      const targetUser = await client.users.fetch(targetUserId).catch(() => null);
      if (!targetUser) {
        return interaction.reply({
          content: "✅ تم تعديل الفويس، لكن ما قدرت أجيب العضو.",
          ephemeral: true
        });
      }

      return interaction.reply({
        embeds: [buildLeaderboardControlEmbed(targetUser, stats)],
        components: buildLeaderboardControlRows(targetUserId),
        ephemeral: true
      });
    }
  }

  if (!interaction.isChatInputCommand()) return;

  const user = interaction.user;

  if (interaction.commandName === "mediaonly") {
    mediaOnlyEnabled = !mediaOnlyEnabled;

    return interaction.reply({
      content: mediaOnlyEnabled ? "✅ تم تشغيل النظام" : "❌ تم ايقاف النظام",
      ephemeral: true
    });
  }

  if (interaction.commandName === "leaderboardpanel") {
    if (!isOwner(interaction.user.id)) {
      return interaction.reply({
        content: "❌ هذا الأمر للأونر فقط.",
        ephemeral: true
      });
    }

    const targetUser = interaction.options.getUser("user");
    const stats = getUserStats(targetUser.id);

    return interaction.reply({
      embeds: [buildLeaderboardControlEmbed(targetUser, stats)],
      components: buildLeaderboardControlRows(targetUser.id),
      ephemeral: true
    });
  }

  if (interaction.commandName === "leaderboard") {
    if (!interaction.member || !hasLeaderboardRole(interaction.member)) {
      return interaction.reply({
        content: `❌ هذا الأمر يحتاج رتبة <@&${LEADERBOARD_ROLE_ID}>`,
        ephemeral: true
      });
    }

    const action = interaction.options.getString("action");
    const targetUser = interaction.options.getUser("user") || user;

    if (action === "setup") {
      db.leaderboard.channelId = LEADERBOARD_CHANNEL_ID;

      const existingChannel = interaction.guild.channels.cache.get(db.leaderboard.channelId);
      let existingMessage = null;

      if (db.leaderboard.messageId && existingChannel && existingChannel.isTextBased()) {
        existingMessage = await existingChannel.messages.fetch(db.leaderboard.messageId).catch(() => null);
      }

      if (!existingMessage && existingChannel && existingChannel.isTextBased()) {
        existingMessage = await findExistingLeaderboardMessage(existingChannel);
        if (existingMessage) {
          db.leaderboard.messageId = existingMessage.id;
          saveDatabase();
        }
      }

      if (!existingMessage) {
        const msg = await ensureLeaderboardMessage(interaction.guild);
        await updateLeaderboardMessage(interaction.guild);

        return interaction.reply({
          content: msg
            ? `✅ تم إنشاء الليدر بورد في <#${LEADERBOARD_CHANNEL_ID}>`
            : "❌ ما قدرت أنشئ رسالة الليدر بورد.",
          ephemeral: true
        });
      }

      await updateLeaderboardMessage(interaction.guild);

      return interaction.reply({
        content: "✅ الليدر بورد موجود مسبقًا وتم تحديثه فقط.",
        ephemeral: true
      });
    }

    if (action === "refresh") {
      await updateLeaderboardMessage(interaction.guild);

      return interaction.reply({
        content: `✅ تم تحديث الليدر بورد في <#${LEADERBOARD_CHANNEL_ID}>`,
        ephemeral: true
      });
    }

    if (action === "stats") {
      flushActiveVoiceSessions();

      const stats = getUserStats(targetUser.id);

      const embed = new EmbedBuilder()
        .setColor("#000000")
        .setAuthor({
          name: "Member Activity Stats",
          iconURL: targetUser.displayAvatarURL()
        })
        .setTitle(`📊 احصائيات ${targetUser.username}`)
        .setDescription(`<@${targetUser.id}>`)
        .addFields(
          { name: "⭐ النقاط", value: `${getLeaderboardScore(stats)}`, inline: true },
          { name: "💬 عدد الرسائل", value: `${stats.messages}`, inline: true },
          { name: "🎤 الوقت الصوتي", value: formatVoiceDuration(getEffectiveVoiceMs(stats)), inline: true },
          { name: "🧮 النقاط اليدوية", value: `${stats.manualPoints || 0}`, inline: true },
          { name: "⏱ الفويس اليدوي", value: formatVoiceDuration(stats.manualVoiceMs || 0), inline: true }
        )
        .setFooter({ text: "الإحصائيات تحسب فقط داخل الكاتاقوري المحددة ولأصحاب الرتبة" })
        .setTimestamp();

      return interaction.reply({
        embeds: [embed],
        ephemeral: true
      });
    }
  }

  if (interaction.commandName === "kick") {
    if (!hasModeration(interaction.member)) return denyReply(interaction);

    const target = interaction.options.getMember("user");
    const reason = interaction.options.getString("reason") || "No reason";

    if (!target) {
      return interaction.reply({ content: "❌ ما قدرت أحدد العضو.", ephemeral: true });
    }

    await target.kick(reason).catch(() => {});

    return interaction.reply({
      content: `✅ تم طرد ${target.user.tag}`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "ban") {
    if (!hasModeration(interaction.member)) return denyReply(interaction);

    const target = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason") || "No reason";

    await interaction.guild.members.ban(target.id, { reason }).catch(() => {});

    return interaction.reply({
      content: `✅ تم باند ${target.tag}`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "timeout") {
    if (!hasModeration(interaction.member)) return denyReply(interaction);

    const target = interaction.options.getMember("user");
    const minutes = interaction.options.getInteger("minutes");
    const reason = interaction.options.getString("reason") || "No reason";

    if (!target) {
      return interaction.reply({ content: "❌ ما قدرت أحدد العضو.", ephemeral: true });
    }

    await target.timeout(minutes * 60 * 1000, reason).catch(() => {});

    return interaction.reply({
      content: `✅ تم تايم اوت ${target.user.tag} لمدة ${minutes} دقيقة`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "untimeout") {
    if (!hasModeration(interaction.member)) return denyReply(interaction);

    const target = interaction.options.getMember("user");
    const reason = interaction.options.getString("reason") || "No reason";

    if (!target) {
      return interaction.reply({ content: "❌ ما قدرت أحدد العضو.", ephemeral: true });
    }

    await target.timeout(null, reason).catch(() => {});

    return interaction.reply({
      content: `✅ تم فك التايم اوت عن ${target.user.tag}`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "purge") {
    if (!hasModeration(interaction.member)) return denyReply(interaction);

    const amount = interaction.options.getInteger("amount");

    if (amount < 1 || amount > 100) {
      return interaction.reply({
        content: "❌ العدد لازم يكون بين 1 و 100",
        ephemeral: true
      });
    }

    await interaction.channel.bulkDelete(amount, true).catch(() => {});

    return interaction.reply({
      content: `✅ تم حذف ${amount} رسالة`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "categoryhide" || interaction.commandName === "categoryshow") {
    if (!hasManageChannels(interaction.member)) return denyReply(interaction);

    const role = interaction.options.getRole("role");
    const category = interaction.options.getChannel("category");

    if (!category || category.type !== ChannelType.GuildCategory) {
      return interaction.reply({
        content: "❌ لازم تختار كاتاقوري صحيحة",
        ephemeral: true
      });
    }

    const visible = interaction.commandName === "categoryshow";

    await setRoleViewForChannel(category, role.id, visible);

    const children = interaction.guild.channels.cache.filter(ch => ch.parentId === category.id);
    for (const [, child] of children) {
      await setRoleViewForChannel(child, role.id, visible);
    }

    return interaction.reply({
      content: visible
        ? `✅ تم إظهار الكاتاقوري ${category.name} للرتبة ${role.name}`
        : `✅ تم إخفاء الكاتاقوري ${category.name} عن الرتبة ${role.name}`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "channelhide" || interaction.commandName === "channelshow") {
    if (!hasManageChannels(interaction.member)) return denyReply(interaction);

    const role = interaction.options.getRole("role");
    const channel = interaction.options.getChannel("channel");
    const visible = interaction.commandName === "channelshow";

    await setRoleViewForChannel(channel, role.id, visible);

    return interaction.reply({
      content: visible
        ? `✅ تم إظهار الروم ${channel.name} للرتبة ${role.name}`
        : `✅ تم إخفاء الروم ${channel.name} عن الرتبة ${role.name}`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "channelset") {
    if (!hasManageChannels(interaction.member)) return denyReply(interaction);

    const role = interaction.options.getRole("role");
    const ids = parseChannelIds(interaction.options.getString("channel_ids"));
    const action = interaction.options.getString("action");

    let done = 0;
    let failed = 0;

    for (const id of ids) {
      const channel = interaction.guild.channels.cache.get(id);
      if (!channel) {
        failed++;
        continue;
      }

      await applyActionToChannel(channel, role.id, action).catch(() => {});
      done++;
    }

    return interaction.reply({
      content: `✅ تم التنفيذ على ${done} روم${failed ? ` | فشل: ${failed}` : ""}`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "blacklist") {
    if (!hasAdmin(interaction.member)) return denyReply(interaction);

    const targetId = interaction.options.getString("id").trim();
    const reason = interaction.options.getString("reason") || "No reason";

    blacklistSet(targetId, {
      id: targetId,
      reason,
      by: user.id,
      at: Date.now()
    });

    const member = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (member) {
      await member.kick(`Blacklisted: ${reason}`).catch(() => {});
    }

    return interaction.reply({
      content: `✅ تم إضافة ${targetId} للبلاك ليست`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "unblacklist") {
    if (!hasAdmin(interaction.member)) return denyReply(interaction);

    const targetId = interaction.options.getString("id").trim();
    blacklistDelete(targetId);

    return interaction.reply({
      content: `✅ تم إزالة ${targetId} من البلاك ليست`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "blacklistlist") {
    if (!hasAdmin(interaction.member)) return denyReply(interaction);

    const entries = Object.values(db.blacklist);

    if (!entries.length) {
      return interaction.reply({
        content: "لا يوجد أحد في البلاك ليست",
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setColor("#8b0000")
      .setTitle("Blacklist List")
      .setDescription(
        entries
          .map((entry, index) => `**#${index + 1}** \`${entry.id}\` | ${entry.reason}`)
          .join("\n")
      )
      .setTimestamp();

    return interaction.reply({
      embeds: [embed],
      ephemeral: true
    });
  }

  if (interaction.commandName === "send") {
    const target = interaction.options.getUser("user");
    const message = interaction.options.getString("message");

    try {
      await target.send(`${message}\n\n<@${target.id}>`);

      await interaction.reply({
        content: "تم إرسال الرسالة بنجاح",
        ephemeral: true
      });

      const embed = new EmbedBuilder()
        .setColor("#2ecc71")
        .setAuthor({
          name: "📩 Send Command Used",
          iconURL: user.displayAvatarURL()
        })
        .setThumbnail(target.displayAvatarURL())
        .addFields(
          { name: "👤 المرسل", value: `<@${user.id}>`, inline: true },
          { name: "🆔 ID المرسل", value: user.id, inline: true },
          { name: "📨 المستلم", value: `<@${target.id}>`, inline: true },
          { name: "🆔 ID المستلم", value: target.id, inline: true },
          { name: "💬 محتوى الرسالة", value: message },
          { name: "📍 الروم", value: `<#${interaction.channel.id}>`, inline: true },
          { name: "🖥 السيرفر", value: interaction.guild.name, inline: true },
          { name: "📊 الحالة", value: "✅ تم الإرسال", inline: true }
        )
        .setTimestamp()
        .setFooter({
          text: `Server ID: ${interaction.guild.id}`
        });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("فتح بروفايل المرسل")
          .setStyle(ButtonStyle.Link)
          .setURL(`https://discord.com/users/${user.id}`)
      );

      sendLog(interaction, LOG_SEND, embed, row);
    } catch {
      return interaction.reply({
        content: "ما قدرت أرسل له خاص",
        ephemeral: true
      });
    }
  }

  if (interaction.commandName === "dmall") {
    const message = interaction.options.getString("message");

    await interaction.reply({
      content: "⏳ جاري إرسال الرسالة للأعضاء...",
      ephemeral: true
    });

    let success = 0;
    let failed = 0;

    const members = await interaction.guild.members.fetch();

    for (const [, member] of members) {
      if (member.user.bot) continue;

      try {
        await member.send(`${message}\n\n<@${member.id}>`);
        success++;
      } catch {
        failed++;
      }
    }

    const embed = new EmbedBuilder()
      .setColor("#3498db")
      .setTitle("📨 DM All Used")
      .addFields(
        { name: "🛡 بواسطة", value: `<@${user.id}>`, inline: true },
        { name: "✅ تم الإرسال", value: `${success}`, inline: true },
        { name: "❌ فشل", value: `${failed}`, inline: true },
        { name: "💬 الرسالة", value: message }
      )
      .setTimestamp();

    sendLog(interaction, LOG_DMALL, embed);

    return interaction.editReply({
      content: `✅ انتهى الإرسال\nنجح: ${success}\nفشل: ${failed}`
    });
  }

  if (interaction.commandName === "warn") {
    const target = interaction.options.getMember("user");
    const level = interaction.options.getInteger("level");
    const reason = interaction.options.getString("reason");

    if (!target) {
      return interaction.reply({
        content: "❌ ما قدرت أحدد العضو.",
        ephemeral: true
      });
    }

    warningMapSet(target.id, {
      level,
      reason,
      moderator: user.id,
      time: Date.now(),
      channel: interaction.channel.id
    });

    for (const role of Object.values(WARN_ROLES)) {
      if (target.roles.cache.has(role)) {
        await target.roles.remove(role).catch(() => {});
      }
    }

    const roleId = WARN_ROLES[level];

    await target.roles.add(roleId).catch(() => {});

    if (level === 4) {
      await target.kick(reason).catch(() => {});
    }

    if (level === 6) {
      await target.ban({ reason }).catch(() => {});
    }

    const embed = new EmbedBuilder()
      .setColor("#e67e22")
      .setTitle("⚠ Warn Added")
      .addFields(
        { name: "👤 المستخدم", value: `<@${target.id}>`, inline: true },
        { name: "🆔 ID", value: target.id, inline: true },
        { name: "🚨 المستوى", value: `Warn ${level}`, inline: true },
        { name: "⚠ السبب", value: reason },
        { name: "🛡 المشرف", value: `<@${user.id}>`, inline: true },
        { name: "📍 الروم", value: `<#${interaction.channel.id}>`, inline: true },
        { name: "🖥 السيرفر", value: interaction.guild.name, inline: true }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    sendLog(interaction, LOG_WARN, embed);
  }

  if (interaction.commandName === "warnings") {
    const target = interaction.options.getUser("user");
    const data = warningMapGet(target.id);

    if (!data) {
      return interaction.reply({
        content: "لا يوجد تحذيرات لهذا المستخدم",
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setColor("#f1c40f")
      .setTitle("⚠ Warnings List")
      .addFields(
        { name: "👤 المستخدم", value: `<@${target.id}>`, inline: true },
        { name: "🆔 ID", value: target.id, inline: true },
        { name: "🚨 المستوى", value: `Warn ${data.level}`, inline: true },
        { name: "⚠ السبب", value: data.reason },
        { name: "🛡 المشرف", value: `<@${data.moderator}>`, inline: true },
        { name: "📍 الروم", value: `<#${data.channel}>`, inline: true },
        { name: "🕒 وقت التحذير", value: `<t:${Math.floor(data.time / 1000)}:F>` }
      )
      .setTimestamp()
      .setFooter({ text: interaction.guild.name });

    await interaction.reply({ embeds: [embed] });
    sendLog(interaction, LOG_WARNINGS, embed);
  }

  if (interaction.commandName === "clearwarnings") {
    const target = interaction.options.getMember("user");

    if (!target) {
      return interaction.reply({
        content: "❌ ما قدرت أحدد العضو.",
        ephemeral: true
      });
    }

    warningMapDelete(target.id);

    for (const role of Object.values(WARN_ROLES)) {
      if (target.roles.cache.has(role)) {
        await target.roles.remove(role).catch(() => {});
      }
    }

    await interaction.reply({
      content: "تم مسح التحذيرات",
      ephemeral: true
    });

    const embed = new EmbedBuilder()
      .setColor("#2ecc71")
      .setTitle("🧹 Warnings Cleared")
      .addFields(
        { name: "👤 المستخدم", value: `<@${target.id}>` },
        { name: "🛡 بواسطة", value: `<@${user.id}>` }
      )
      .setTimestamp();

    sendLog(interaction, LOG_CLEARWARN, embed);
  }
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  refreshVoiceSessionTracking(newMember);

  const data = warningMapGet(newMember.id);
  if (!data) return;

  const warnRole = WARN_ROLES[data.level];
  if (!warnRole) return;

  const hadRole = oldMember.roles.cache.has(warnRole);
  const hasRole = newMember.roles.cache.has(warnRole);

  if (hadRole && !hasRole) {
    const logs = await newMember.guild.fetchAuditLogs({
      limit: 1,
      type: 25
    }).catch(() => null);

    if (!logs) return;

    const entry = logs.entries.first();
    if (!entry) return;

    if (entry.executor.id !== client.user.id) {
      await newMember.roles.add(warnRole).catch(() => {});
    }
  }
});

client.on("voiceStateUpdate", async (oldState, newState) => {
  const botId = client.user.id;

  if (oldState.id === botId) {
    if (oldState.channelId && newState.channelId && newState.channelId !== VOICE_CHANNEL_ID) {
      try {
        await newState.setChannel(VOICE_CHANNEL_ID);
      } catch {}
    }

    if (oldState.channelId && !newState.channelId) {
      try {
        const targetChannel = oldState.guild.channels.cache.get(VOICE_CHANNEL_ID);
        if (targetChannel && targetChannel.isVoiceBased()) {
          joinVoiceChannel({
            channelId: targetChannel.id,
            guildId: oldState.guild.id,
            adapterCreator: oldState.guild.voiceAdapterCreator,
            selfDeaf: true
          });
        }
      } catch {}
    }

    return;
  }

  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;
  if (member.guild.id !== GUILD_ID) return;

  const oldChannelId = oldState.channelId;
  const newChannelId = newState.channelId;

  if (!oldChannelId && newChannelId) {
    startVoiceSession(member, newChannelId);
    syncSelfMuteTracking(newState);
    return;
  }

  if (oldChannelId && !newChannelId) {
    endVoiceSession(member.id);
    syncSelfMuteTracking(newState);
    return;
  }

  if (oldChannelId && newChannelId && oldChannelId !== newChannelId) {
    moveVoiceSession(member, newChannelId);
  }

  syncSelfMuteTracking(newState);
});

process.on("SIGINT", () => {
  for (const timer of selfMuteTimers.values()) {
    clearTimeout(timer);
  }

  flushActiveVoiceSessions();
  saveDatabase();
  process.exit(0);
});

process.on("SIGTERM", () => {
  for (const timer of selfMuteTimers.values()) {
    clearTimeout(timer);
  }

  flushActiveVoiceSessions();
  saveDatabase();
  process.exit(0);
});

client.login(TOKEN);
