// server.js
require("dotenv").config();
const express = require("express");
const https = require("https");
const JSZip = require("jszip");
const multer = require("multer");
const { renderDownloadPage } = require("./webPage");
const { uploadBufferToDiscord } = require("./bot");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (!DISCORD_TOKEN) {
  console.error("❌ ERROR: DISCORD_TOKEN is required for server to call Discord API");
  process.exit(1);
}

// ดึงข้อมูลไฟล์จาก Discord API ด้วย channel + message + attachmentId
function fetchAttachmentMeta(channelId, messageId, attachmentId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "discord.com",
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
              `Discord API status ${res2.statusCode}: ${data
                .toString()
                .slice(0, 200)}`
            )
          );
        }
        try {
          const msg = JSON.parse(data);
          const atts = msg.attachments || [];
          const att = atts.find((a) => String(a.id) === String(attachmentId));
          if (!att) return reject(new Error("Attachment not found in message"));
          resolve({
            name: att.filename || att.name || "file",
            url: att.url,
            size: att.size || 0,
            contentType: att.content_type || "application/octet-stream",
          });
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

// สร้างเซิร์ฟเวอร์หลัก — รับ setBaseUrl จาก bot.js
function createServer(setBaseUrl) {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // ตั้ง multer สำหรับรับไฟล์จากแอป
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  });

  // ทุก request เข้ามา → อัพเดต host ให้บอท (ใช้ตอนบอทสร้างลิงก์ในดิส)
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

  // === API จากแอป: อัปโหลดไฟล์ → ส่งต่อเข้า Discord → ตอบลิงก์กลับไป ===
  // ใช้ร่วมกับ SERVER_UPLOAD_URL = "https://magebase.onrender.com/api/upload"
  app.post("/api/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "no-file" });
        return;
      }

      const buffer = req.file.buffer;
      let fileName =
        req.body.fileName ||
        req.file.originalname ||
        "PurpleShop_Addon.mcaddon";

      // กันชื่อหลุด ๆ หน่อย
      fileName = fileName.replace(/[^\w.\-]/g, "_");

      // ส่งไฟล์เข้า Discord ผ่านบอท
      const msg = await uploadBufferToDiscord(buffer, fileName);

      const att = msg.attachments.first();
      if (!att) {
        res.status(500).json({ error: "no-attachment" });
        return;
      }

      const guildId = msg.guildId;
      const channelId = msg.channelId;
      const messageId = msg.id;
      const attachmentId = att.id;

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const filePath = [guildId, channelId, messageId, attachmentId]
        .map(encodeURIComponent)
        .join("/");

      const link = `${baseUrl}/f/${filePath}`;

      // ให้ฝั่งแอปอ่านได้ทั้ง json.link และ json.url
      res.json({ link, url: link });
    } catch (err) {
      console.error("Upload error:", err);
      res.status(500).json({ error: "upload-failed" });
    }
  });

  // หน้าแสดงข้อมูลไฟล์ + ปุ่มดาวน์โหลด
  app.get("/f/:guildId/:channelId/:messageId/:attachmentId", async (req, res) => {
    const { guildId, channelId, messageId, attachmentId } = req.params;
    try {
      const file = await fetchAttachmentMeta(channelId, messageId, attachmentId);
      const html = renderDownloadPage(file, {
        guildId,
        channelId,
        messageId,
        attachmentId,
      });
      res.send(html);
    } catch (err) {
      console.error("GET /f error:", err.message);
      res
        .status(404)
        .send("ไม่พบไฟล์ หรือไม่สามารถอ่านข้อมูลจาก Discord ได้");
    }
  });

  // เส้นทางดาวน์โหลดจริง
  app.get(
    "/f/:guildId/:channelId/:messageId/:attachmentId/download",
    async (req, res) => {
      const { channelId, messageId, attachmentId } = req.params;
      try {
        const file = await fetchAttachmentMeta(channelId, messageId, attachmentId);

        const url = new URL(file.url);
        const options = {
          hostname: url.hostname,
          path: url.pathname + url.search,
          protocol: url.protocol,
          headers: {
            "User-Agent": "DiscordFileProxy/1.0",
          },
        };

        https
          .get(options, (discordRes) => {
            if (discordRes.statusCode !== 200) {
              res
                .status(500)
                .send(
                  "ไม่สามารถดาวน์โหลดไฟล์จาก Discord ได้ (cdn status " +
                    discordRes.statusCode +
                    ")"
                );
              return;
            }

            res.setHeader(
              "Content-Disposition",
              `attachment; filename="${encodeURIComponent(file.name)}"`
            );
            res.setHeader(
              "Content-Type",
              file.contentType || "application/octet-stream"
            );

            discordRes.pipe(res);
          })
          .on("error", () => {
            res.status(500).send("เกิดข้อผิดพลาดขณะดาวน์โหลดไฟล์");
          });
      } catch (err) {
        console.error("download error:", err.message);
        res
          .status(404)
          .send("ไม่พบไฟล์ หรือไม่สามารถอ่านข้อมูลจาก Discord ได้");
      }
    }
  );

  // เส้นทางดึง pack_icon.png จากไฟล์ .zip / .mcaddon
  app.get(
    "/icon/:guildId/:channelId/:messageId/:attachmentId",
    async (req, res) => {
      const { channelId, messageId, attachmentId } = req.params;

      try {
        const file = await fetchAttachmentMeta(channelId, messageId, attachmentId);
        const url = new URL(file.url);

        https
          .get(
            {
              hostname: url.hostname,
              path: url.pathname + url.search,
              protocol: url.protocol,
              headers: { "User-Agent": "DiscordFileProxy/1.0" },
            },
            (discordRes) => {
              if (discordRes.statusCode !== 200) {
                res.status(500).send("cdn-error");
                return;
              }

              const chunks = [];
              discordRes.on("data", (d) => chunks.push(d));
              discordRes.on("end", async () => {
                try {
                  const buffer = Buffer.concat(chunks);
                  const zip = await JSZip.loadAsync(buffer);
                  const fileNames = Object.keys(zip.files);

                  const iconPath = fileNames.find((name) =>
                    name.toLowerCase().endsWith("pack_icon.png")
                  );

                  if (!iconPath) {
                    res.status(404).send("no-pack-icon");
                    return;
                  }

                  const iconFile = await zip.file(iconPath).async("nodebuffer");
                  res.setHeader("Content-Type", "image/png");
                  res.send(iconFile);
                } catch (e) {
                  console.error("extract icon error:", e.message);
                  res.status(500).send("extract-error");
                }
              });
            }
          )
          .on("error", () => {
            res.status(500).send("cdn-error");
          });
      } catch (err) {
        console.error("icon error:", err.message);
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
