// bot.js — forward .mcaddon/.zip from source guild → storage guild + link (via webhook)
require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
} = require("discord.js");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

// ดิสที่ให้บอท "เฝ้าทั้งดิส" (ที่คนจะส่งไฟล์ .mcaddon / .zip)
const SOURCE_GUILD_ID = "1438723080246788239";

// ดิสและห้องที่ใช้เก็บไฟล์จริง (คลังเก็บไฟล์ / ทำลิงก์)
const STORAGE_GUILD_ID = "1401622759582466229";
const STORAGE_CHANNEL_ID = "1440439526324441262";

let BASE_URL = null;
let UPLOAD_CHANNEL = null;

// cache webhook ต่อ channel
const channelWebhooks = new Map();

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

// หา / สร้าง webhook สำหรับ channel นั้น ๆ
async function getOrCreateWebhook(channel) {
  const cached = channelWebhooks.get(channel.id);
  if (cached) return cached;

  try {
    const hooks = await channel.fetchWebhooks();
    const existing = hooks.find(
      (h) => h.owner && h.owner.id === channel.client.user.id
    );
    if (existing) {
      channelWebhooks.set(channel.id, existing);
      return existing;
    }
  } catch {
    // เงียบ
  }

  try {
    const created = await channel.createWebhook({
      name: "Purple Forward",
      avatar: channel.client.user.displayAvatarURL({
        extension: "png",
      }),
    });
    channelWebhooks.set(channel.id, created);
    return created;
  } catch {
    return null;
  }
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
    // 2) เฝ้าทั้งดิส SOURCE_GUILD_ID
    //    ถ้ามีไฟล์ .mcaddon หรือ .zip → ส่งไปเก็บที่ STORAGE_CHANNEL แล้วลบต้นฉบับ
    // ─────────────────────────────────────────
    if (message.guildId !== SOURCE_GUILD_ID) return;

    let srcMsg = message;
    try {
      srcMsg = await message.fetch();
    } catch {}

    if (!srcMsg.attachments || srcMsg.attachments.size === 0) return;

    // เลือกเฉพาะไฟล์ .mcaddon หรือ .zip
    const forwardAtts = [];
    for (const att of srcMsg.attachments.values()) {
      const nameLower = (att.name || "").toLowerCase();
      if (nameLower.endsWith(".mcaddon") || nameLower.endsWith(".zip")) {
        forwardAtts.push(att);
      }
    }

    if (forwardAtts.length === 0) return;

    const entries = []; // { link, name, sizeKB }

    // ส่งแต่ละไฟล์ไปเก็บใน STORAGE_CHANNEL
    for (const att of forwardAtts) {
      try {
        const forwarded = await UPLOAD_CHANNEL.send({
          files: [{ attachment: att.url, name: att.name }],
        });

        const fAtt = forwarded.attachments.first();
        if (!fAtt) continue;

        const link = buildFileLink(baseUrl, forwarded, fAtt);
        const sizeKB = fAtt.size ? (fAtt.size / 1024).toFixed(1) : "0.0";

        entries.push({
          link,
          name: fAtt.name || att.name || "unknown",
          sizeKB,
        });
      } catch {
        continue;
      }
    }

    if (entries.length === 0) return;

    // เก็บข้อความต้นฉบับไว้ก่อน (เผื่อมี text)
    const originalContent =
      srcMsg.content && srcMsg.content.trim().length > 0
        ? srcMsg.content
        : null;

    // เตรียมชื่อ + รูปของคนส่ง
    const username =
      srcMsg.member?.displayName || srcMsg.author.username || "User";
    const avatarURL = srcMsg.author.displayAvatarURL({
      extension: "png",
      size: 128,
    });

    // ลบข้อความต้นฉบับ
    try {
      await srcMsg.delete();
    } catch {
      // ถ้าลบไม่ได้ก็เฉย ๆ
    }

    // สร้าง Embed สีม่วงพร้อมลิงก์ + ชื่อไฟล์ + ขนาดไฟล์
    const lines = entries.map(
      (e) =>
        `# [กดที่นี่เพื่อโหลดไฟล์](${e.link})\nℕ𝕒𝕞𝕖: \`${e.name}\`\n𝕊𝕚𝕫𝕖: \`${e.sizeKB} KB\``
    );

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setDescription(lines.join("\n\n"))
      .setImage(
        "https://www.animatedimages.org/data/media/562/animated-line-image-0379.gif"
      );

    const payload = {
      embeds: [embed],
    };

    if (originalContent) {
      payload.content = originalContent;
    }

    // ส่งผ่าน webhook โดยใช้ชื่อ + รูปของคนเดิม
    const hook = await getOrCreateWebhook(message.channel);
    if (hook) {
      await hook.send({
        ...payload,
        username,
        avatarURL,
      });
    } else {
      // fallback: ถ้าสร้าง webhook ไม่ได้ ใช้ channel.send ปกติ
      await message.channel.send(payload);
    }
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
 
