require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const JSZip = require("jszip");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const SOURCE_GUILD_ID = "1438723080246788239";
const STORAGE_GUILD_ID = "1401622759582466229";
const STORAGE_CHANNEL_ID = "1440439526324441262";

let BASE_URL = null;
let UPLOAD_CHANNEL = null;
const channelWebhooks = new Map();

function setBaseUrl(origin) {
  if (!origin) return;
  const clean = String(origin).replace(/\/+$/, "");
  if (/^https?:\/\//i.test(clean)) {
    BASE_URL = clean;
  } else {
    BASE_URL = `http://${clean}`;
  }
}

function ensureBaseUrl() {
  if (BASE_URL) return BASE_URL;
  const port = process.env.PORT || 3000;
  return `http://localhost:${port}`;
}

async function initUploadChannel() {
  try {
    const guild = await client.guilds.fetch(STORAGE_GUILD_ID);
    const channel = await guild.channels.fetch(STORAGE_CHANNEL_ID);
    UPLOAD_CHANNEL = channel;
  } catch {}
}

async function extractPackIconBuffer(fileUrl) {
  try {
    const res = await fetch(fileUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files);
    const targetName =
      names.find(n => /icon_pack\.png$/i.test(n)) ||
      names.find(n => /pack_icon\.png$/i.test(n));
    if (!targetName) return null;
    const file = zip.file(targetName);
    if (!file) return null;
    return await file.async("nodebuffer");
  } catch {
    return null;
  }
}

async function uploadIconToStorage(buffer) {
  try {
    const sent = await UPLOAD_CHANNEL.send({
      files: [{ attachment: buffer, name: "icon_pack.png" }]
    });
    const att = sent.attachments.first();
    return att ? att.url : null;
  } catch {
    return null;
  }
}

function buildFileLink(baseUrl, message, attachment) {
  const parts = [
    message.guildId,
    message.channelId,
    message.id,
    attachment.id
  ].map(encodeURIComponent);
  return `${baseUrl}/f/${parts.join("/")}`;
}

function buildBundleLink(baseUrl, message) {
  const parts = [
    message.guildId,
    message.channelId,
    message.id
  ].map(encodeURIComponent);
  return `${baseUrl}/fb/${parts.join("/")}`;
}

async function getOrCreateWebhook(channel) {
  const cached = channelWebhooks.get(channel.id);
  if (cached) return cached;
  try {
    const hooks = await channel.fetchWebhooks();
    const existing = hooks.find(
      h => h.owner && h.owner.id === channel.client.user.id
    );
    if (existing) {
      channelWebhooks.set(channel.id, existing);
      return existing;
    }
  } catch {}
  try {
    const created = await channel.createWebhook({
      name: "Purple Forward",
      avatar: channel.client.user.displayAvatarURL({ extension: "png" })
    });
    channelWebhooks.set(channel.id, created);
    return created;
  } catch {
    return null;
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const ALLOWED_EXT = [".zip", ".mcaddon", ".json", ".js", ".png"];

client.once("ready", async () => {
  await initUploadChannel();
});

client.on("messageCreate", async message => {
  try {
    if (message.author.bot) return;

    if (!UPLOAD_CHANNEL) await initUploadChannel();
    if (!UPLOAD_CHANNEL) return;

    const baseUrl = ensureBaseUrl();

    if (
      message.guildId === STORAGE_GUILD_ID &&
      message.channelId === STORAGE_CHANNEL_ID
    ) {
      const msg = (await message.fetch().catch(() => null)) || message;
      if (!msg.attachments.size) return;
      for (const att of msg.attachments.values()) {
        const name = (att.name || "").toLowerCase();
        const ok = ALLOWED_EXT.some(ext => name.endsWith(ext));
        if (!ok) continue;
        const link = buildFileLink(baseUrl, msg, att);
        await msg.reply(`# [กดที่นี่เพื่อโหลดไฟล์](${link})`);
      }
      return;
    }

    if (message.guildId !== SOURCE_GUILD_ID) return;

    const src = (await message.fetch().catch(() => null)) || message;
    if (!src.attachments.size) return;

    const srcFiles = [...src.attachments.values()].filter(att => {
      const n = (att.name || "").toLowerCase();
      return n.endsWith(".mcaddon") || n.endsWith(".zip");
    });
    if (!srcFiles.length) return;

    const username = src.member?.displayName || src.author.username;
    const avatarURL = src.author.displayAvatarURL({
      extension: "png",
      size: 128
    });
    const content =
      src.content && src.content.trim().length ? src.content : null;

    let embed = null;

    if (srcFiles.length === 1) {
      const original = srcFiles[0];
      const forwarded = await UPLOAD_CHANNEL.send({
        files: [{ attachment: original.url, name: original.name }]
      });
      const fAtt = forwarded.attachments.first();
      if (!fAtt) return;
      const link = buildFileLink(baseUrl, forwarded, fAtt);
      const sizeKB = fAtt.size ? (fAtt.size / 1024).toFixed(1) : "0.0";

      let thumbUrl = null;
      if ((original.name || "").toLowerCase().endsWith(".mcaddon")) {
        const iconBuf = await extractPackIconBuffer(original.url);
        if (iconBuf) thumbUrl = await uploadIconToStorage(iconBuf);
      }

      embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setDescription(
          `# [กดที่นี่เพื่อโหลดไฟล์](${link})\nName: \`${fAtt.name}\`\nSize: \`${sizeKB} KB\``
        )
        .setImage(
          "https://www.animatedimages.org/data/media/562/animated-line-image-0379.gif"
        );
      if (thumbUrl) embed.setThumbnail(thumbUrl);
    } else {
      const filesPayload = srcFiles.map(att => ({
        attachment: att.url,
        name: att.name
      }));
      const forwarded = await UPLOAD_CHANNEL.send({ files: filesPayload });
      const fAtts = [...forwarded.attachments.values()];
      if (!fAtts.length) return;

      const bundleLink = buildBundleLink(baseUrl, forwarded);
      const count = fAtts.length;
      const lines = fAtts.map(a => {
        const sizeKB = a.size ? (a.size / 1024).toFixed(1) : "0.0";
        return `• \`${a.name}\` (\`${sizeKB} KB\`)`;
      });

      let thumbUrl = null;
      const mcaddons = srcFiles.filter(a =>
        (a.name || "").toLowerCase().endsWith(".mcaddon")
      );
      if (mcaddons.length) {
        const pool = [...mcaddons].sort(() => Math.random() - 0.5);
        for (const att of pool) {
          const iconBuf = await extractPackIconBuffer(att.url);
          if (iconBuf) {
            thumbUrl = await uploadIconToStorage(iconBuf);
            if (thumbUrl) break;
          }
        }
      }

      embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setDescription(
          `# [โหลดทั้งหมด ${count} ไฟล์](${bundleLink})\n\n${lines.join("\n")}`
        )
        .setImage(
          "https://www.animatedimages.org/data/media/562/animated-line-image-0379.gif"
        );
      if (thumbUrl) embed.setThumbnail(thumbUrl);
    }

    await src.delete().catch(() => {});

    const hook = await getOrCreateWebhook(src.channel);
    if (hook) {
      await hook.send({
        content,
        embeds: embed ? [embed] : [],
        username,
        avatarURL
      });
    } else {
      await src.channel.send({ content, embeds: embed ? [embed] : [] });
    }
  } catch {}
});

function startBot() {
  if (!DISCORD_TOKEN) return;
  client.login(DISCORD_TOKEN).catch(() => {});
}

module.exports = { startBot, setBaseUrl };
