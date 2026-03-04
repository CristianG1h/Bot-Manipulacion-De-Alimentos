"use strict";

const express = require("express");

const webhookRouter = require("./routes/webhook");
const notifyRouter = require("./routes/notify");
const certificateRouter = require("./routes/certificate");
const pullRouter = require("./routes/pull");

const { initDb } = require("./db/init");
const { DATABASE_URL, TOKEN, NUDGE_CHECK_EVERY_MS } = require("./config");
const { nudgeAbandonedSessions } = require("./jobs/nudge");

const app = express();
app.use(express.json());

// Rutas
app.use("/webhook", webhookRouter);

// ✅ Notificaciones (rutas equivalentes)
app.use("/notify", notifyRouter);        // POST /notify/access
app.use("/api/notify", notifyRouter);    // POST /api/notify/access  (ALIAS)

// Certificados (ojo: queda como POST /notify/certificate/lo-que-definas-en-router)
app.use("/notify/certificate", certificateRouter);

// API (pull, etc.)
app.use("/api", pullRouter);

// Healthcheck
app.get("/", (req, res) => res.status(200).send("OK"));

(async () => {
  await initDb();

  if (DATABASE_URL && TOKEN) {
    setInterval(
      () => nudgeAbandonedSessions().catch((e) => console.error("❌ Nudge error:", e)),
      NUDGE_CHECK_EVERY_MS
    );
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () =>
    console.log(`✅ Servidor activo en puerto ${PORT}. Webhook: /webhook`)
  );
})();
