// webPage.js
function renderDownloadPage(file, ids) {
  const { guildId, channelId, messageId, attachmentId } = ids;

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ดาวน์โหลดไฟล์ ${file.name}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@600;700;900&family=Poppins:wght@300;500;600;700&display=swap');

    * { margin:0; padding:0; box-sizing:border-box; }

    body {
      min-height:100vh;
      background: radial-gradient(circle at 20% 0%, #7c2bc0 0%, #1a1126 60%, #000 100%);
      font-family:'Poppins',sans-serif;
      display:flex;
      flex-direction:column;
      align-items:center;
      color:#fff;
      overflow:hidden;
      animation:fadeIn 0.7s ease-out forwards;
    }

    @keyframes fadeIn {
      from { opacity:0; transform:translateY(25px); }
      to   { opacity:1; transform:translateY(0); }
    }

    /* -------- HEADER -------- */
    .header {
      width:100%;
      padding:32px 0 20px;
      text-align:center;
    }

    .header span {
      font-family:'Orbitron';
      font-size:clamp(2.6rem,7vw,4.6rem);
      font-weight:900;
      letter-spacing:4px;
      background: linear-gradient(90deg, #ff9aff, #ae4cff, #6b99ff, #3cf2ff);
      -webkit-background-clip:text;
      -webkit-text-fill-color:transparent;
      background-size:200% 200%;
      animation: 
        neonShift 2.2s linear infinite,
        glowPulse 1.6s ease-in-out infinite alternate,
        floatText 5s ease-in-out infinite;
    }

    @keyframes neonShift {
      0%   { background-position:0% 50%; }
      100% { background-position:200% 50%; }
    }

    @keyframes glowPulse {
      0% { text-shadow:0 0 20px #ae4cff,0 0 40px #5b4cff; }
      100%{ text-shadow:0 0 35px #ff4fff,0 0 70px #50c7ff; }
    }

    @keyframes floatText {
      0%{ transform:translateY(0); }
      50%{ transform:translateY(-6px); }
      100%{ transform:translateY(0); }
    }

    /* -------- CARD -------- */
    .card {
      width:92%;
      max-width:420px;
      background:rgba(30,20,45,0.9);
      backdrop-filter:blur(8px);
      border-radius:20px;
      padding:28px 30px;
      box-shadow:0 0 25px rgba(160,70,255,0.55);
      animation:floatUp 0.9s ease-out;
    }

    @keyframes floatUp {
      from{ opacity:0; transform:translateY(30px); }
      to  { opacity:1; transform:translateY(0); }
    }

    .title {
      font-size:1.4rem;
      text-align:center;
      font-weight:700;
      margin-bottom:14px;
    }

    .filename {
      text-align:center;
      margin-bottom:24px;
      opacity:0.9;
      word-break:break-all;
    }

    /* -------- BUTTON -------- */
    .btn {
      width:100%;
      padding:14px 18px;
      font-size:1.05rem;
      color:#fff;
      border:none;
      cursor:pointer;
      border-radius:14px;
      font-weight:600;
      background:linear-gradient(135deg,#9d4dff,#6e30f5,#4bc9ff);
      background-size:260% 260%;
      box-shadow:0 0 20px rgba(160,70,255,0.9);
      animation:neonPulse 2.6s ease-in-out infinite;
      transition:0.22s ease;
    }

    @keyframes neonPulse {
      0%  { box-shadow:0 0 15px #ac49ff; }
      50% { box-shadow:0 0 30px #4fd5ff; }
      100%{ box-shadow:0 0 15px #ac49ff; }
    }

    .btn:hover {
      transform:translateY(-4px) scale(1.04);
      background-position:right;
      box-shadow:0 0 32px #59e0ff;
    }

    .meta {
      text-align:center;
      opacity:0.75;
      margin-top:15px;
      font-size:0.86rem;
    }

    /* -------- PREVIEW AREA -------- */
    .preview {
      margin-top:20px;
      border-radius:16px;
      background:rgba(12,6,25,0.85);
      padding:14px 14px 18px;
      border:1px solid rgba(144,94,255,0.6);
      box-shadow:0 0 15px rgba(120,70,255,0.4);
      max-height:360px;
      overflow:auto;
    }

    .preview-img {
      display:block;
      max-width:100%;
      max-height:260px;
      border-radius:12px;
      object-fit:contain;
      margin:0 auto;
      box-shadow:0 0 18px rgba(140,70,255,0.7);
    }

    .preview-code {
      font-family: "JetBrains Mono","Fira Code",monospace;
      font-size:0.78rem;
      white-space:pre;
      overflow-x:auto;
      line-height:1.4;
    }

    .preview-addon {
      font-size:0.9rem;
      text-align:center;
      opacity:0.9;
    }

    /* ███ LOADER OVERLAY ███ */
    #loaderOverlay {
      position:fixed;
      inset:0;
      background:rgba(10,0,25,0.75);
      backdrop-filter:blur(10px);
      display:none;
      align-items:center;
      justify-content:center;
      z-index:9999;
      animation:loaderFadeIn 0.35s ease-out forwards;
    }

    @keyframes loaderFadeIn {
      from{ opacity:0; }
      to  { opacity:1; }
    }

    @keyframes loaderFadeOut {
      from{ opacity:1; transform:scale(1); filter:blur(0); }
      to  { opacity:0; transform:scale(1.15); filter:blur(6px); }
    }

    .loaderRing {
      width:120px; height:120px;
      border-radius:50%;
      border:6px solid rgba(160,60,255,0.25);
      border-top-color:#bb55ff;
      animation:
        spin 1s linear infinite,
        glow 2s ease-in-out infinite alternate;
    }

    @keyframes spin { 
      to{ transform:rotate(360deg); } 
    }

    @keyframes glow {
      0%  { box-shadow:0 0 25px #b54cff; }
      100%{ box-shadow:0 0 60px #4bd3ff; }
    }

    .loaderText {
      margin-top:18px;
      font-size:1.25rem;
      font-weight:600;
      text-shadow:0 0 12px #c55bff;
      animation:blink 1.6s infinite;
      letter-spacing:2px;
    }

    @keyframes blink {
      0%,100%{ opacity:0.3; }
      50%    { opacity:1; }
    }
  </style>
</head>

<body>
  <div class="header"><span>Purple Shop</span></div>

  <div class="card">
    <div class="title">ดาวน์โหลดไฟล์</div>
    <div class="filename">${file.name}</div>

    <form method="GET" 
      action="/f/${encodeURIComponent(guildId)}/${encodeURIComponent(channelId)}/${encodeURIComponent(messageId)}/${encodeURIComponent(attachmentId)}/download">
      <button class="btn" type="submit">ดาวน์โหลดไฟล์</button>
    </form>

    <div class="meta">ขนาดไฟล์: ${(file.size / 1024).toFixed(1)} KB</div>

    <div id="preview" class="preview" style="display:none;"></div>
  </div>

  <!-- Loader overlay -->
  <div id="loaderOverlay">
    <div style="display:flex; flex-direction:column; align-items:center;">
      <div class="loaderRing"></div>
      <div class="loaderText">กำลังดาวน์โหลด…</div>
    </div>
  </div>

  <script>
    document.addEventListener("DOMContentLoaded", () => {
      const overlay = document.getElementById("loaderOverlay");
      const form = document.querySelector("form");
      const previewEl = document.getElementById("preview");

      const fileName = ${JSON.stringify(file.name || "")};
      const fileUrl  = ${JSON.stringify(file.url || "")};
      const iconUrl  = ${JSON.stringify(
        `/icon/${encodeURIComponent(guildId)}/${encodeURIComponent(channelId)}/${encodeURIComponent(
          messageId
        )}/${encodeURIComponent(attachmentId)}`
      )};

      // ====== Loader behavior ======
      if (form) {
        form.addEventListener("submit", () => {
          overlay.style.display = "flex";
          window.addEventListener(
            "focus",
            () => {
              overlay.style.animation = "loaderFadeOut 0.5s forwards";
              setTimeout(() => {
                overlay.style.display = "none";
                overlay.style.animation = "loaderFadeIn 0.35s ease-out forwards";
              }, 600);
            },
            { once: true }
          );
        });
      }

      // ====== Preview logic ======
      if (!fileName || !fileUrl || !previewEl) return;

      const lower = fileName.toLowerCase();
      const isPng = lower.endsWith(".png");
      const isJson = lower.endsWith(".json");
      const isJs = lower.endsWith(".js");
      const isZip = lower.endsWith(".zip");
      const isMcaddon = lower.endsWith(".mcaddon");

      // PNG → แสดงรูปอย่างเดียว
      if (isPng) {
        previewEl.style.display = "block";
        previewEl.innerHTML =
          '<img src="' + fileUrl + '" alt="preview" class="preview-img" />';
        return;
      }

      // JSON / JS → แสดงโค้ดอย่างเดียว
      if (isJson || isJs) {
        previewEl.style.display = "block";
        previewEl.innerHTML =
          '<div class="preview-code">กำลังโหลดโค้ด…</div>';
        const codeBox = previewEl.querySelector(".preview-code");

        fetch(fileUrl)
          .then(r => r.text())
          .then(txt => {
            if (txt.length > 8000) {
              txt = txt.slice(0, 8000) + "\\n... (ตัดบางส่วนออก – ไฟล์ยาวเกินไป)";
            }
            codeBox.textContent = txt;
          })
          .catch(() => {
            codeBox.textContent = "ไม่สามารถแสดงโค้ดได้";
          });
        return;
      }

      // ZIP / MCADDON → ลองโหลด icon จาก /icon/...
      if (isMcaddon || isZip) {
        previewEl.style.display = "block";
        previewEl.innerHTML =
          '<div class="preview-addon">กำลังโหลด icon…</div>';

        const addonBox = previewEl.querySelector(".preview-addon");
        const img = new Image();
        img.src = iconUrl;
        img.className = "preview-img";

        img.onload = () => {
          addonBox.innerHTML = "";
          addonBox.appendChild(img);
        };

        img.onerror = () => {
          addonBox.innerHTML =
            "ไม่พบ pack_icon.png ในไฟล์ หรือไม่สามารถดึง icon ได้";
        };

        return;
      }
    });
  </script>

</body>
</html>`;
}

module.exports = { renderDownloadPage };
