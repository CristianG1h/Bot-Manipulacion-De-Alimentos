"use strict";

const express = require("express");
const webhookRouter = require("./routes/webhook");
const { initDb } = require("./db/init");
const { DATABASE_URL, TOKEN, NUDGE_CHECK_EVERY_MS } = require("./config");
const { nudgeAbandonedSessions } = require("./jobs/nudge");

const app = express();
app.use(express.json());

// Webhook
app.use("/webhook", webhookRouter);

// Healthcheck
app.get("/", (req, res) => res.status(200).send("OK"));

(async () => {
  await initDb();

  // Job nudges
  if (DATABASE_URL && TOKEN) {
    setInterval(() => nudgeAbandonedSessions().catch((e) => console.error("❌ Nudge error:", e)), NUDGE_CHECK_EVERY_MS);
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`✅ Servidor activo en puerto ${PORT}. Webhook: /webhook`));
})();
