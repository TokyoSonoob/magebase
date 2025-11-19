// bot.js — forward .mcaddon from source guild → storage guild + link
require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

// ดิสที่ให้บอท "เฝ้าทั้งดิส" (ที่คนจะส่งไฟล์ .mcaddon)
const SOURCE_GUILD_ID = "1438723080246788239";

// ดิสและห้องที่ใช้เก็บไฟล์จริง (คลังเก็บไฟล์ / ทำลิงก์)
const STORAGE_GUILD_ID = "1401622759582466229";
const STORAGE_CHANNEL_ID = "1440439526324441262";

let BASE_URL = null;
let UPLOAD_CHANNEL = null;

function setBaseUrl(host) {
  if (!host) return;
  const cleanHost = String(host).replace(/\/+$/, "");
  const isLocal =
    cleanHost.startsWith("localhost") || cleanHost.startsWith("127.0.0.1");
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

// ใช้กับห้องเก็บไฟล์ (STORAGE_CHANNEL_ID) เวลาอยากสร้างลิงก์จากไฟล์ที่อยู่ในห้องนั้นอยู่แล้ว
const ALLOWED_EXT = [".zip", ".mcaddon", ".json", ".js", ".png"];

async function initUploadChannel() {
  try {
    const guild = await client.guilds.fetch(STORAGE_GUILD_ID);
    const channel = await guild.channels.fetch(STORAGE_CHANNEL_ID);
    UPLOAD_CHANNEL = channel;
  } catch {
    // เงียบไว้ ถ้าหาไม่เจอเดี๋ยวลองใหม่ตอนมีข้อความเข้า
  }
}

client.once("ready", async () => {
  await initUploadChannel();
});

// helper สร้างลิงก์จาก message + attachment
function buildFileLink(baseUrl, message, attachment) {
  const filePath = [
    message.guildId,
    message.channelId,
    message.id,
    attachment.id,
  ]
    .map(encodeURIComponent)
    .join("/");

  return `${baseUrl}/f/${filePath}`;
}

client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;

    // ให้แน่ใจว่า UPLOAD_CHANNEL พร้อมใช้
    if (!UPLOAD_CHANNEL) {
      await initUploadChannel();
      if (!UPLOAD_CHANNEL) {
        return; // ยังหาไม่ได้ก็พักก่อน
      }
    }

    const baseUrl = ensureBaseUrl();

    // ─────────────────────────────────────────
    // 1) โหมดเดิม: ถ้าใครโพสต์ไฟล์ในห้องเก็บไฟล์โดยตรง → ตอบลิงก์ให้
    // ─────────────────────────────────────────
    if (
      message.guildId === STORAGE_GUILD_ID &&
      message.channelId === UPLOAD_CHANNEL.id
    ) {
      let msg = message;
      try {
        msg = await message.fetch();
      } catch {}

      if (!msg.attachments || msg.attachments.size === 0) return;

      for (const att of msg.attachments.values()) {
        const name = (att.name || "").toLowerCase();
        const ok = ALLOWED_EXT.some((ext) => name.endsWith(ext));
        if (!ok) continue;

        const link = buildFileLink(baseUrl, msg, att);

        await msg.reply(`\`# [กดที่นี่เพื่อโหลดไฟล์](${link})\``);
      }

      return;
    }

    // ─────────────────────────────────────────
    // 2) โหมดใหม่: เฝ้าทั้งดิส SOURCE_GUILD_ID
    //    ถ้ามีไฟล์ .mcaddon → ส่งไปเก็บที่ STORAGE_CHANNEL แล้วลบต้นฉบับ
    // ─────────────────────────────────────────
    if (message.guildId !== SOURCE_GUILD_ID) return;

    let srcMsg = message;
    try {
      srcMsg = await message.fetch();
    } catch {}

    if (!srcMsg.attachments || srcMsg.attachments.size === 0) return;

    // เลือกเฉพาะไฟล์ .mcaddon
    const mcaddonAtts = [];
    for (const att of srcMsg.attachments.values()) {
      const name = (att.name || "").toLowerCase();
      if (name.endsWith(".mcaddon")) {
        mcaddonAtts.push(att);
      }
    }

    if (mcaddonAtts.length === 0) return;

    const links = [];

    // ส่งแต่ละไฟล์ .mcaddon ไปเก็บใน STORAGE_CHANNEL
    for (const att of mcaddonAtts) {
      try {
        const forwarded = await UPLOAD_CHANNEL.send({
          files: [{ attachment: att.url, name: att.name }],
        });

        // เอา attachment ตัวแรกจากข้อความที่เพิ่งส่ง (เราส่งไฟล์เดียว/ครั้ง)
        const fAtt = forwarded.attachments.first();
        if (!fAtt) continue;

        const link = buildFileLink(baseUrl, forwarded, fAtt);
        links.push(link);
      } catch (e) {
        // ถ้าส่งไฟล์ตัวใดตัวหนึ่งพัง ก็ข้ามไป แต่ไม่ให้บอทล้ม
        continue;
      }
    }

    if (links.length === 0) return;

    // ลบข้อความต้นฉบับที่มีไฟล์ .mcaddon ทิ้ง
    try {
      await srcMsg.delete();
    } catch {
      // ถ้าลบไม่ได้ (สิทธิ์ไม่พอ) ก็ยังคงส่งลิงก์ได้
    }

    // ส่งข้อความแทนที่ พร้อมลิงก์ทุกไฟล์
    const replyText = links
      .map((link) => `# [กดที่นี่เพื่อโหลดไฟล์](${link})`)
      .join("\n");

    await message.channel.send(replyText);
  } catch {
    // กันบอทล้ม
  }
});

function startBot() {
  client.login(DISCORD_TOKEN).catch(() => {});
}

module.exports = {
  startBot,
  setBaseUrl,
};
