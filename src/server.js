"use strict";

const express = require("express");

const webhookRouter = require("./routes/webhook");
const notifyRouter = require("./routes/notify");
const certificateRouter = require("./routes/certificate");
const chatwootRouter = require("./routes/chatwoot");

const app = express();
app.use(express.json());

// Meta
app.use("/webhook", webhookRouter);

// Chatwoot
app.use("/chatwoot", chatwootRouter);

// Notificaciones
app.use("/notify", notifyRouter);
app.use("/api/notify", notifyRouter);

// Certificados
app.use("/notify/certificate", certificateRouter);

// Healthcheck
app.get("/", (req, res) => res.status(200).send("OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor activo en puerto ${PORT}. Webhook Meta: /webhook | Chatwoot: /chatwoot/webhook`);
});
