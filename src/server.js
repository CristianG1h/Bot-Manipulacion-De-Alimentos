"use strict";

const express = require("express");
const path = require("path");

const notifyRouter = require("./routes/notify");
const certificateRouter = require("./routes/certificate");
const chatwootRouter = require("./routes/chatwoot");
const Stats = require("./services/stats");

const app = express();

app.use(express.json({ limit: "2mb" }));

const dashboardPath = path.join(__dirname, "public", "dashboard.html");
const publicPath = path.join(__dirname, "public");

/**
 * Protección básica para dashboard.
 * Usuario y clave salen de variables de entorno:
 * DASHBOARD_USER
 * DASHBOARD_PASS
 */
function protegerDashboard(req, res, next) {
  const DASHBOARD_USER = process.env.DASHBOARD_USER;
  const DASHBOARD_PASS = process.env.DASHBOARD_PASS;

  if (!DASHBOARD_USER || !DASHBOARD_PASS) {
    console.warn("⚠️ DASHBOARD_USER o DASHBOARD_PASS no configurados");
    return res.status(503).send("Dashboard no configurado");
  }

  const auth = req.headers.authorization || "";

  if (!auth.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Dashboard VIP"');
    return res.status(401).send("Autenticación requerida");
  }

  const base64Credentials = auth.split(" ")[1];
  const credentials = Buffer.from(base64Credentials, "base64").toString("utf8");

  const separatorIndex = credentials.indexOf(":");

  if (separatorIndex === -1) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Dashboard VIP"');
    return res.status(401).send("Autenticación inválida");
  }

  const user = credentials.slice(0, separatorIndex);
  const pass = credentials.slice(separatorIndex + 1);

  if (user !== DASHBOARD_USER || pass !== DASHBOARD_PASS) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Dashboard VIP"');
    return res.status(401).send("Usuario o contraseña incorrectos");
  }

  return next();
}

// Archivos públicos del dashboard protegidos
app.use("/public", protegerDashboard, express.static(publicPath));

// Dashboard principal protegido
app.get("/", protegerDashboard, (req, res) => {
  res.sendFile(dashboardPath);
});

// Dashboard alternativo protegido
app.get("/dashboard", protegerDashboard, (req, res) => {
  res.sendFile(dashboardPath);
});

// API protegida
app.get("/api/stats", protegerDashboard, (req, res) => {
  res.json(Stats.getSnapshot());
});

// Healthcheck público para Render
app.get("/health", (req, res) => {
  res.status(200).send("OK TODO FUNCIONANDO PERRO");
});

// Chatwoot público porque Chatwoot necesita llamar este endpoint
app.use("/chatwoot", chatwootRouter);

// Notificaciones protegidas con x-api-key
app.use("/notify", notifyRouter);
app.use("/api/notify", notifyRouter);

// Certificados protegidos con x-api-key
app.use("/certificate", certificateRouter);
app.use("/notify/certificate", certificateRouter);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ Servidor activo en puerto ${PORT}`);
  console.log(`📊 Dashboard protegido en / y /dashboard`);
  console.log(`🔗 API stats protegida en /api/stats`);
  console.log(`💬 Chatwoot webhook activo en /chatwoot/webhook`);
  console.log(`📁 Dashboard path: ${dashboardPath}`);
});
