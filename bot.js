﻿// bot.js — clean version
require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

const GUILD_ID = "1401622759582466229";
const CHANNEL_ID = "1440439526324441262";

let BASE_URL = null;
let UPLOAD_CHANNEL = null;

function setBaseUrl(host) {
  if (!host) return;
  const cleanHost = String(host).replace(/\/+$/, "");
  const isLocal = cleanHost.startsWith("localhost") || cleanHost.startsWith("127.0.0.1");
  const proto = isLocal ? "http" : "https";
  BASE_URL = `${proto}://${cleanHost}`;
}

function ensureBaseUrl() {
  if (BASE_URL) return BASE_URL;
  const port = process.env.PORT || 3000;
  return `http://localhost:${port}`;
}

if (!DISCORD_TOKEN) {
  console.error("❌ ERROR: Please set DISCORD_TOKEN in .env");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const ALLOWED_EXT = [".zip", ".mcaddon", ".json", ".js", ".png"];

async function initUploadChannel() {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(CHANNEL_ID);
    UPLOAD_CHANNEL = channel;
  } catch (e) {
    console.error("Failed to init upload channel:", e.message);
  }
}

async function ensureUploadChannel() {
  if (UPLOAD_CHANNEL) return UPLOAD_CHANNEL;
  await initUploadChannel();
  return UPLOAD_CHANNEL;
}

// ใช้โดย server.js: อัป buffer เข้า Discord แล้วคืน message กลับไป
async function uploadBufferToDiscord(buffer, fileName) {
  const channel = await ensureUploadChannel();
  if (!channel) throw new Error("UPLOAD_CHANNEL not ready");

  const msg = await channel.send({
    files: [{ attachment: buffer, name: fileName || "file.mcaddon" }],
  });
  return msg;
}

client.once("ready", async () => {
  console.log(`✅ Discord bot logged in as ${client.user.tag}`);
  await initUploadChannel();
});

client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;
    if (!UPLOAD_CHANNEL) return;
    if (message.guildId !== GUILD_ID) return;
    if (message.channelId !== UPLOAD_CHANNEL.id) return;

    let msg = message;
    try {
      msg = await message.fetch();
    } catch {}

    if (!msg.attachments || msg.attachments.size === 0) return;

    const baseUrl = ensureBaseUrl();

    for (const att of msg.attachments.values()) {
      const name = (att.name || "").toLowerCase();
      const ok = ALLOWED_EXT.some((ext) => name.endsWith(ext));
      if (!ok) continue;

      const filePath = [
        msg.guildId,
        msg.channelId,
        msg.id,
        att.id,
      ]
        .map(encodeURIComponent)
        .join("/");

      const link = `${baseUrl}/f/${filePath}`;

      await msg.reply(`\`# [กดที่นี่เพื่อโหลดไฟล์](${link})\``);
    }
  } catch {}
});

function startBot() {
  client.login(DISCORD_TOKEN).catch((e) => {
    console.error("Login failed:", e.message);
  });
}

module.exports = {
  startBot,
  setBaseUrl,
  uploadBufferToDiscord, // ✅ เพิ่มให้ server.js เรียกใช้
};
