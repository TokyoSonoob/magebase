require("dotenv").config();

const { startBot, setBaseUrl } = require("./bot");
const createServer = require("./server");

createServer(setBaseUrl);
startBot();

console.log("🚀 Bot + Web started");
