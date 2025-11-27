require("dotenv").config();
const { startBot, setBaseUrl } = require("./bot");
const createServer = require("./server");

const PORT = Number(process.env.PORT || 3000);
const app = createServer(setBaseUrl);

app.listen(PORT, () => {
  console.log("Server listening on", PORT);
});

startBot();
