// server.js
require("dotenv").config();
const express = require("express");
const https = require("https");
const JSZip = require("jszip");
const { renderDownloadPage } = require("./webPage");

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
              `Discord API status ${res2.statusCode}: ${data.toString().slice(0, 200)}`
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

  // ทุก request เข้ามา → อัพเดต host ให้บอท
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

  // หน้าแสดงข้อมูลไฟล์ + ปุ่มดาวน์โหลด
  app.get("/f/:guildId/:channelId/:messageId/:attachmentId", async (req, res) => {
    const { guildId, channelId, messageId, attachmentId } = req.params;
    try {
      const file = await fetchAttachmentMeta(channelId, messageId, attachmentId);
      const html = renderDownloadPage(file, { guildId, channelId, messageId, attachmentId });
      res.send(html);
    } catch (err) {
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

        https.get(
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
                res.status(500).send("extract-error");
              }
            });
          }
        ).on("error", () => {
          res.status(500).send("cdn-error");
        });
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
