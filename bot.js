// bot.js — forward .mcaddon/.zip from source guild → storage guild + link
require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

// ดิสที่ให้บอท "เฝ้าทั้งดิส" (ที่คนจะส่งไฟล์ .mcaddon / .zip)
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

        // เอา attachment ตัวแรกจากข้อความที่เพิ่งส่ง (เราส่งไฟล์เดียว/ครั้ง)
        const fAtt = forwarded.attachments.first();
        if (!fAtt) continue;

        const link = buildFileLink(baseUrl, forwarded, fAtt);
        const sizeKB = fAtt.size
          ? (fAtt.size / 1024).toFixed(1)
          : "0.0";

        entries.push({
          link,
          name: fAtt.name || att.name || "unknown",
          sizeKB,
        });
      } catch {
        // ถ้าส่งไฟล์ตัวใดตัวหนึ่งพัง ก็ข้ามไป แต่ไม่ให้บอทล้ม
        continue;
      }
    }

    if (entries.length === 0) return;

    // ลบข้อความต้นฉบับที่มีไฟล์ ทิ้ง
    try {
      await srcMsg.delete();
    } catch {
      // ถ้าลบไม่ได้ (สิทธิ์ไม่พอ) ก็ยังคงส่งลิงก์ได้
    }

    // สร้าง Embed สีม่วง พร้อมลิงก์ + ชื่อไฟล์ + ขนาดไฟล์
    const lines = entries.map(
      (e) =>
        `# [กดที่นี่เพื่อโหลดไฟล์](${e.link})\nℕ𝕒𝕞𝕖: \`${e.name}\`\n𝕊𝕚𝕫𝕖: \`${e.sizeKB} KB\``
    );

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6) // ม่วง
      .setDescription(lines.join("\n\n"))
      .setImage("https://www.animatedimages.org/data/media/562/animated-line-image-0379.gif");

    await message.channel.send({ embeds: [embed] });
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
