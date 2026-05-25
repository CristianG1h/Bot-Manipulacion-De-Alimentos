"use strict";

const express = require("express");
const path = require("path");

const notifyRouter = require("./routes/notify");
const certificateRouter = require("./routes/certificate");
const chatwootRouter = require("./routes/chatwoot");
const Stats = require("./services/stats");

const app = express();

app.use(express.json({ limit: "2mb" }));

// Como tu public está dentro de src/public,
// usamos __dirname directamente.
const dashboardPath = path.join(__dirname, "public", "dashboard.html");
const publicPath = path.join(__dirname, "public");

// Archivos públicos
app.use("/public", express.static(publicPath));

// Dashboard principal
app.get("/", (req, res) => {
  res.sendFile(dashboardPath);
});

// Dashboard alternativo
app.get("/dashboard", (req, res) => {
  res.sendFile(dashboardPath);
});

// API que alimenta el dashboard
app.get("/api/stats", (req, res) => {
  res.json(Stats.getSnapshot());
});

// Healthcheck técnico
app.get("/health", (req, res) => {
  res.status(200).send("OK TODO FUNCIONANDO PERRO");
});

// Chatwoot
app.use("/chatwoot", chatwootRouter);

// Notificaciones de acceso
app.use("/notify", notifyRouter);
app.use("/api/notify", notifyRouter);

// Certificados
app.use("/certificate", certificateRouter);
app.use("/notify/certificate", certificateRouter);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ Servidor activo en puerto ${PORT}`);
  console.log(`📊 Dashboard activo en / y /dashboard`);
  console.log(`🔗 API stats activa en /api/stats`);
  console.log(`💬 Chatwoot webhook activo en /chatwoot/webhook`);
  console.log(`📁 Dashboard path: ${dashboardPath}`);
});
