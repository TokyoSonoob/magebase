// server.js — ultra light (สำหรับเครื่อง RAM น้อยมาก)
require("dotenv").config();
const express = require("express");
const https = require("https");
const { renderDownloadPage } = require("./webPage");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (!DISCORD_TOKEN) {
  console.error("❌ ERROR: DISCORD_TOKEN is required for server to call Discord API");
  process.exit(1);
}

// ดึงข้อมูลไฟล์จาก Discord API (เฉพาะ meta, ไม่โหลดตัวไฟล์ใหญ่)
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

// สร้างเซิร์ฟเวอร์หลัก — setBaseUrl อาจเป็น undefined ถ้าไม่ใช้บอท
function createServer(setBaseUrl) {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // อัปเดต host ให้บอทรู้ (ถ้ามีส่งฟังก์ชันมา)
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

  // เส้นทางดาวน์โหลดจริง — สตรีมตรงจาก Discord → ผู้ใช้ (ไม่โหลดเก็บใน RAM)
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

            // pipe ตรง ไม่โหลดทั้งไฟล์เก็บไว้ในหน่วยความจำ
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

  app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
  });

  return app;
}

module.exports = createServer;
