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
  ButtonStyle
} = require("discord.js");

const { joinVoiceChannel } = require("@discordjs/voice");

const TOKEN = process.env.TOKEN;

const GUILD_ID = "1367976354104086629";
const VOICE_CHANNEL_ID = "1401074295022817381";

/* ✅ روم الفيديو */
const VIDEO_ROOM = "1477417977472090316";

/* ✅ روم الليدر بورد + رتبة التحكم */
const LEADERBOARD_CHANNEL_ID = "1484809257361870892";
const LEADERBOARD_ROLE_ID = "1426999940944756889";

/* ✅ تحديث تلقائي كل 5 ثواني */
const LEADERBOARD_UPDATE_INTERVAL = 5000;

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
  leaderboard: {
    channelId: LEADERBOARD_CHANNEL_ID,
    messageId: null,
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
    db.leaderboard = {
      channelId: parsed.leaderboard?.channelId || LEADERBOARD_CHANNEL_ID,
      messageId: parsed.leaderboard?.messageId || null,
      users: parsed.leaderboard?.users || {}
    };
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

function getUserStats(userId) {
  if (!db.leaderboard.users[userId]) {
    db.leaderboard.users[userId] = {
      messages: 0,
      voiceMs: 0,
      lastMessageAt: null,
      updatedAt: Date.now()
    };
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

function startVoiceSession(userId, channelId) {
  if (activeVoiceSessions.has(userId)) return;

  activeVoiceSessions.set(userId, {
    channelId,
    joinedAt: Date.now()
  });
}

function endVoiceSession(userId) {
  const session = activeVoiceSessions.get(userId);
  if (!session) return;

  const stats = getUserStats(userId);
  const elapsed = Date.now() - session.joinedAt;

  if (elapsed > 0) {
    stats.voiceMs += elapsed;
    stats.updatedAt = Date.now();
  }

  activeVoiceSessions.delete(userId);
  scheduleSave();
}

function moveVoiceSession(userId, newChannelId) {
  const session = activeVoiceSessions.get(userId);

  if (!session) {
    startVoiceSession(userId, newChannelId);
    return;
  }

  const stats = getUserStats(userId);
  const elapsed = Date.now() - session.joinedAt;

  if (elapsed > 0) {
    stats.voiceMs += elapsed;
  }

  activeVoiceSessions.set(userId, {
    channelId: newChannelId,
    joinedAt: Date.now()
  });

  stats.updatedAt = Date.now();
  scheduleSave();
}

function flushActiveVoiceSessions() {
  const now = Date.now();

  for (const [userId, session] of activeVoiceSessions.entries()) {
    const elapsed = now - session.joinedAt;
    if (elapsed <= 0) continue;

    const stats = getUserStats(userId);
    stats.voiceMs += elapsed;
    stats.updatedAt = now;

    activeVoiceSessions.set(userId, {
      channelId: session.channelId,
      joinedAt: now
    });
  }
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
  const voiceMinutes = Math.floor(data.voiceMs / 60000);
  const voicePoints = voiceMinutes * 3;
  return messagePoints + voicePoints;
}

function sortLeaderboardEntries() {
  return Object.entries(db.leaderboard.users).sort((a, b) => {
    const aScore = getLeaderboardScore(a[1]);
    const bScore = getLeaderboardScore(b[1]);

    if (bScore !== aScore) {
      return bScore - aScore;
    }

    return b[1].voiceMs - a[1].voiceMs;
  });
}

function buildLeaderboardEmbed(guild) {
  flushActiveVoiceSessions();

  const entries = sortLeaderboardEntries().slice(0, 10);

  const description = entries.length
    ? entries
        .map(([userId, data], index) => {
          return [
            `**#${index + 1}** | <@${userId}>`,
            `> **النقاط:** \`${getLeaderboardScore(data)}\` | **الرسائل:** \`${data.messages}\` | **الوقت الصوتي:** \`${formatVoiceDuration(data.voiceMs)}\``
          ].join("\n");
        })
        .join("\n\n")
    : "لا يوجد بيانات حتى الآن.";

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
      text: "النقاط = الرسائل + وقت الفويس"
    })
    .setTimestamp();
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
  return member.roles.cache.has(LEADERBOARD_ROLE_ID);
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

function sendLog(interaction, channelId, embed, row) {
  const channel = interaction.guild.channels.cache.get(channelId);

  if (channel) {
    channel.send({
      embeds: [embed],
      components: row ? [row] : []
    }).catch(() => {});
  }
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
    )
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
      startVoiceSession(state.id, state.channelId);
    }
  });

  await ensureLeaderboardMessage(guild);
  await updateLeaderboardMessage(guild);

  if (leaderboardInterval) clearInterval(leaderboardInterval);
  leaderboardInterval = setInterval(() => {
    updateLeaderboardMessage(guild).catch(() => {});
  }, LEADERBOARD_UPDATE_INTERVAL);
});

client.on("messageCreate", async message => {
  if (!message.guild || message.guild.id !== GUILD_ID) return;
  if (message.author.bot) return;

  addMessageCount(message.author.id);

  if (!mediaOnlyEnabled) return;
  if (message.channel.id !== VIDEO_ROOM) return;

  if (message.attachments.size === 0) {
    return message.delete().catch(() => {});
  }

  if (message.content && message.content.trim() !== "") {
    return message.delete().catch(() => {});
  }
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "leaderboard_refresh") return;

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
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const user = interaction.user;

  if (interaction.commandName === "mediaonly") {
    mediaOnlyEnabled = !mediaOnlyEnabled;

    return interaction.reply({
      content: mediaOnlyEnabled ? "✅ تم تشغيل النظام" : "❌ تم ايقاف النظام",
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
          { name: "🎤 الوقت الصوتي", value: formatVoiceDuration(stats.voiceMs), inline: true }
        )
        .setFooter({ text: interaction.guild.name })
        .setTimestamp();

      return interaction.reply({
        embeds: [embed],
        ephemeral: true
      });
    }
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
    startVoiceSession(member.id, newChannelId);
    return;
  }

  if (oldChannelId && !newChannelId) {
    endVoiceSession(member.id);
    return;
  }

  if (oldChannelId && newChannelId && oldChannelId !== newChannelId) {
    moveVoiceSession(member.id, newChannelId);
  }
});

process.on("SIGINT", () => {
  flushActiveVoiceSessions();
  saveDatabase();
  process.exit(0);
});

process.on("SIGTERM", () => {
  flushActiveVoiceSessions();
  saveDatabase();
  process.exit(0);
});

client.login(TOKEN);
