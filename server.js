// server.js
require("dotenv").config();
const express = require("express");
const https = require("https");
const JSZip = require("jszip");
const multer = require("multer");
const { renderDownloadPage } = require("./webPage");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (!DISCORD_TOKEN) {
  console.error("❌ ERROR: DISCORD_TOKEN is required for server to call Discord API");
  process.exit(1);
}

// ห้องที่ใช้เก็บไฟล์จากแอป
const UPLOAD_CHANNEL_ID = "1440439526324441262";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
});

// อัปโหลดไฟล์จาก buffer ไปยัง Discord channel แล้วคืน metadata กลับมา
async function uploadToDiscordChannel(buffer, filename) {
  return new Promise((resolve, reject) => {
    const safeName = filename || "addon.mcaddon";
    const boundary = "---------------------------" + Date.now().toString(16);

    const payloadJson = JSON.stringify({ content: "" });

    const chunks = [];

    // payload_json part
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(
      Buffer.from(
        'Content-Disposition: form-data; name="payload_json"\r\n' +
          'Content-Type: application/json\r\n\r\n'
      )
    );
    chunks.push(Buffer.from(payloadJson + "\r\n"));

    // file part
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(
      Buffer.from(
        `Content-Disposition: form-data; name="files[0]"; filename="${safeName}"\r\n` +
          "Content-Type: application/octet-stream\r\n\r\n"
      )
    );
    chunks.push(buffer);
    chunks.push(Buffer.from("\r\n"));

    // end boundary
    chunks.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(chunks);

    const options = {
      hostname: "discord.com",
      port: 443,
      path: `/api/v10/channels/${UPLOAD_CHANNEL_ID}/messages`,
      method: "POST",
      headers: {
        Authorization: `Bot ${DISCORD_TOKEN}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length,
        "User-Agent": "PurpleShop-Uploader/1.0",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(
            new Error(`Discord upload failed ${res.statusCode}: ${data}`)
          );
        }
        try {
          const json = JSON.parse(data || "{}");
          const att = json.attachments && json.attachments[0];
          if (!att) {
            return reject(new Error("No attachment info from Discord"));
          }
          resolve({
            guildId: json.guild_id,
            channelId: json.channel_id,
            messageId: json.id,
            attachmentId: att.id,
          });
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on("error", (err) => reject(err));
    req.write(body);
    req.end();
  });
}

// ดึงข้อมูลไฟล์จาก Discord API ด้วย channel + message + attachmentId
function fetchAttachmentMeta(channelId, messageId, attachmentId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "discord.com",
      port: 443,
      path: `/api/v10/channels/${channelId}/messages/${messageId}`,
      method: "GET",
      headers: {
        Authorization: `Bot ${DISCORD_TOKEN}`,
        "User-Agent": "DiscordFileProxy/1.0",
      },
    };

    const req = https.request(options, (res2) => {
      let data = "";
      res2.on("data", (chunk) => (data += chunk));
      res2.on("end", () => {
        if (res2.statusCode !== 200) {
          return reject(
            new Error(
              `Discord API error ${res2.statusCode}: ${data || "no body"}`
            )
          );
        }
        try {
          const msg = JSON.parse(data || "{}");
          const att = (msg.attachments || []).find(
            (a) => String(a.id) === String(attachmentId)
          );
          if (!att) {
            return reject(new Error("Attachment not found on message"));
          }
          resolve(att);
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on("error", (err) => reject(err));
    req.end();
  });
}

function createServer(setBaseUrl) {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // ทุก request เข้ามา → อัพเดต host ให้บอท (ใช้ทำลิงก์ /f/...)
  app.use((req, res, next) => {
    const host = req.headers["host"];
    if (host && typeof setBaseUrl === "function") {
      setBaseUrl(host);
    }
    next();
  });

  app.get("/", (req, res) => {
    res.send("OK");
  });

  // อัปโหลดไฟล์จากแอป → ส่งต่อไปเก็บใน Discord แล้วตอบลิงก์กลับไป
  app.post("/api/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "no-file" });
      }

      const rawName =
        req.body.fileName || req.file.originalname || "PurpleShop_Addon.mcaddon";
      const safeName = String(rawName).replace(/[^0-9a-zA-Z_.\-]+/g, "_");

      const meta = await uploadToDiscordChannel(req.file.buffer, safeName);

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const filePath = [
        meta.guildId,
        meta.channelId,
        meta.messageId,
        meta.attachmentId,
      ]
        .map(encodeURIComponent)
        .join("/");

      const link = `${baseUrl}/f/${filePath}`;

      res.json({ link });
    } catch (err) {
      console.error("/api/upload error", err);
      res.status(500).json({ error: "upload-failed" });
    }
  });

  // หน้าแสดงข้อมูลไฟล์ + ปุ่มดาวน์โหลด
  app.get("/f/:guildId/:channelId/:messageId/:attachmentId", async (req, res) => {
    const { channelId, messageId, attachmentId } = req.params;
    try {
      const file = await fetchAttachmentMeta(channelId, messageId, attachmentId);
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const downloadUrl = `${baseUrl}/d/${[
        req.params.guildId,
        channelId,
        messageId,
        attachmentId,
      ]
        .map(encodeURIComponent)
        .join("/")}`;

      const html = renderDownloadPage({
        fileName: file.filename || file.name || "addon.mcaddon",
        fileSize: file.size || 0,
        downloadUrl,
      });

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (err) {
      console.error("GET /f error:", err);
      res.status(404).send("ไม่พบไฟล์หรือไม่สามารถดึงข้อมูลจาก Discord ได้");
    }
  });

  // เส้นทางดาวน์โหลดไฟล์จริง (proxy ไฟล์จาก Discord)
  app.get("/d/:guildId/:channelId/:messageId/:attachmentId", async (req, res) => {
    const { channelId, messageId, attachmentId } = req.params;

    try {
      const file = await fetchAttachmentMeta(channelId, messageId, attachmentId);
      const url = new URL(file.url);

      https.get(
        {
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: "GET",
        },
        (discordRes) => {
          if (discordRes.statusCode !== 200) {
            res
              .status(502)
              .send("ไม่สามารถดึงไฟล์จาก Discord ได้");
            return;
          }

          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${encodeURIComponent(
              file.filename || file.name || "addon.mcaddon"
            )}"`
          );
          res.setHeader(
            "Content-Type",
            file.content_type || file.contentType || "application/octet-stream"
          );

          discordRes.pipe(res);
        }
      );
    } catch (err) {
      console.error("GET /d error:", err);
      res.status(404).send("ไม่พบไฟล์หรือไม่สามารถดึงข้อมูลจาก Discord ได้");
    }
  });

  // ดึง pack_icon.png จากไฟล์ .zip / .mcaddon
  app.get(
    "/icon/:guildId/:channelId/:messageId/:attachmentId",
    async (req, res) => {
      const { channelId, messageId, attachmentId } = req.params;

      try {
        const file = await fetchAttachmentMeta(channelId, messageId, attachmentId);
        const url = new URL(file.url);

        https.get(
          {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: "GET",
          },
          (discordRes) => {
            if (discordRes.statusCode !== 200) {
              res.status(404).send("not-found");
              return;
            }

            const chunks = [];
            discordRes.on("data", (c) => chunks.push(c));
            discordRes.on("end", async () => {
              try {
                const buffer = Buffer.concat(chunks);
                const zip = await JSZip.loadAsync(buffer);

                const iconEntry =
                  zip.file("pack_icon.png") ||
                  zip.file("Rp/pack_icon.png") ||
                  zip.file("RP/pack_icon.png");

                if (!iconEntry) {
                  res.status(404).send("not-found");
                  return;
                }

                const iconBuf = await iconEntry.async("nodebuffer");
                res.setHeader("Content-Type", "image/png");
                res.send(iconBuf);
              } catch (err) {
                console.error("icon error:", err);
                res.status(404).send("not-found");
              }
            });
          }
        );
      } catch (err) {
        res.status(404).send("not-found");
      }
    }
  );

  app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
  });

  return app;
}

module.exports = createServer;
