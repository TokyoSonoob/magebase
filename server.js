require("dotenv").config();
const express = require("express");
const JSZip = require("jszip");
const { renderDownloadPage } = require("./webPage");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (!DISCORD_TOKEN) {
  console.error("DISCORD_TOKEN is required");
  process.exit(1);
}

async function fetchMessage(channelId, messageId) {
  const url = `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bot ${DISCORD_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Discord API error ${res.status}`);
  return res.json();
}

async function fetchAttachmentMeta(channelId, messageId, attachmentId) {
  const data = await fetchMessage(channelId, messageId);
  const att = (data.attachments || []).find((a) => a.id === attachmentId);
  if (!att) return null;
  return {
    id: att.id,
    name: att.filename || att.name || "download",
    size: att.size ?? 0,
    url: att.url,
    contentType: att.content_type || "application/octet-stream",
  };
}

async function fetchAllAttachments(channelId, messageId) {
  const data = await fetchMessage(channelId, messageId);
  return (data.attachments || []).map((att) => ({
    id: att.id,
    name: att.filename || att.name || "download",
    size: att.size ?? 0,
    url: att.url,
    contentType: att.content_type || "application/octet-stream",
  }));
}

async function extractPackIconFromUrl(fileUrl) {
  const res = await fetch(fileUrl);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  try {
    const zip = await JSZip.loadAsync(buf);
    const files = Object.keys(zip.files);
    const matchPath =
      files.find((name) =>
        /(?:^|\/)icon_pack\.(png|jpe?g)$/i.test(name)
      ) ||
      files.find((name) =>
        /(?:^|\/)pack_icon\.(png|jpe?g)$/i.test(name)
      );
    if (!matchPath) return null;
    const imgFile = zip.file(matchPath);
    if (!imgFile) return null;
    const imgBuf = await imgFile.async("nodebuffer");
    const lower = matchPath.toLowerCase();
    let mime = "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) mime = "image/jpeg";
    const base64 = imgBuf.toString("base64");
    return `data:${mime};base64,${base64}`;
  } catch {
    return null;
  }
}

function createServer(setBaseUrl) {
  const app = express();

  app.use((req, _res, next) => {
    if (typeof setBaseUrl === "function") {
      const base = `${req.protocol}://${req.get("host")}`;
      setBaseUrl(base);
    }
    next();
  });

  app.get("/", (_req, res) => {
    res.send("Purple Shop Download Server OK");
  });

  app.get(
    "/f/:guildId/:channelId/:messageId/:attachmentId",
    async (req, res) => {
      const { guildId, channelId, messageId, attachmentId } = req.params;
      try {
        const meta = await fetchAttachmentMeta(
          channelId,
          messageId,
          attachmentId
        );
        if (!meta) return res.status(404).send("File not found");

        let iconUrl = null;
        const lowerName = meta.name.toLowerCase();
        if (lowerName.endsWith(".mcaddon")) {
          iconUrl = await extractPackIconFromUrl(meta.url);
        }

        const ids = {
          guildId,
          channelId,
          messageId,
          attachmentId,
          bundle: false,
        };
        const file = {
          name: meta.name,
          size: meta.size,
          url: `/f/${encodeURIComponent(guildId)}/${encodeURIComponent(
            channelId
          )}/${encodeURIComponent(messageId)}/${encodeURIComponent(
            attachmentId
          )}/download`,
          iconUrl,
        };

        const html = renderDownloadPage(file, ids);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.send(html);
      } catch (err) {
        console.error("GET /f error:", err);
        res.status(500).send("Internal error");
      }
    }
  );

  app.get(
    "/f/:guildId/:channelId/:messageId/:attachmentId/download",
    async (req, res) => {
      const { channelId, messageId, attachmentId } = req.params;
      try {
        const meta = await fetchAttachmentMeta(
          channelId,
          messageId,
          attachmentId
        );
        if (!meta) return res.status(404).send("File not found");

        const fileRes = await fetch(meta.url);
        if (!fileRes.ok) throw new Error(`Download failed: ${fileRes.status}`);

        res.setHeader(
          "Content-Type",
          fileRes.headers.get("content-type") ||
            meta.contentType ||
            "application/octet-stream"
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(meta.name)}"`
        );

        if (fileRes.body && typeof fileRes.body.pipe === "function") {
          fileRes.body.pipe(res);
        } else {
          const buf = Buffer.from(await fileRes.arrayBuffer());
          res.end(buf);
        }
      } catch (err) {
        console.error("DOWNLOAD error:", err);
        if (!res.headersSent) res.status(500).send("Internal download error");
      }
    }
  );

  app.get("/fb/:guildId/:channelId/:messageId", async (req, res) => {
    const { guildId, channelId, messageId } = req.params;
    try {
      const atts = await fetchAllAttachments(channelId, messageId);
      if (!atts.length) return res.status(404).send("File not found");

      let iconUrl = null;
      const candidates = atts.filter((a) =>
        a.name.toLowerCase().endsWith(".mcaddon")
      );
      if (candidates.length) {
        const shuffled = [...candidates].sort(() => Math.random() - 0.5);
        for (const att of shuffled) {
          iconUrl = await extractPackIconFromUrl(att.url);
          if (iconUrl) break;
        }
      }

      const totalSize = atts.reduce((s, a) => s + (a.size || 0), 0);
      const count = atts.length;

      const ids = { guildId, channelId, messageId, bundle: true };
      const file = {
        name: `รวมไฟล์ ${count} ไฟล์`,
        size: totalSize,
        url: `/fb/${encodeURIComponent(guildId)}/${encodeURIComponent(
          channelId
        )}/${encodeURIComponent(messageId)}/download`,
        iconUrl,
      };

      const html = renderDownloadPage(file, ids);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (err) {
      console.error("GET /fb error:", err);
      res.status(500).send("Internal error");
    }
  });

  app.get("/fb/:guildId/:channelId/:messageId/download", async (req, res) => {
    const { channelId, messageId } = req.params;
    try {
      const atts = await fetchAllAttachments(channelId, messageId);
      if (!atts.length) return res.status(404).send("File not found");

      const payload = {
        files: atts.map((a) => ({
          name: a.name,
          url: a.url,
        })),
      };

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.send(JSON.stringify(payload));
    } catch (err) {
      console.error("BUNDLE download json error:", err);
      if (!res.headersSent) res.status(500).send("Internal download error");
    }
  });

  return app;
}

module.exports = createServer;
