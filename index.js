// index.js
require("dotenv").config();

const { startBot, setBaseUrl } = require("./bot");
const createServer = require("./server");

// สร้างเว็บเซิร์ฟเวอร์ (Express)
createServer(setBaseUrl);

// รันบอท Discord
startBot();

console.log("🚀 Bot + Web started");
