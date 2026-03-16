"use strict";

const express = require("express");

const webhookRouter = require("./routes/webhook");
const notifyRouter = require("./routes/notify");
const certificateRouter = require("./routes/certificate");

const app = express();
app.use(express.json());

// Rutas
app.use("/webhook", webhookRouter);

// ✅ Notificaciones
app.use("/notify", notifyRouter);      // POST /notify/access
app.use("/api/notify", notifyRouter);  // POST /api/notify/access

// ✅ Certificados
app.use("/notify/certificate", certificateRouter);

// Healthcheck
app.get("/", (req, res) => res.status(200).send("OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor activo en puerto ${PORT}. Webhook: /webhook`);
});
