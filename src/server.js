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

app.use("/public", protegerDashboard, express.static(publicPath));

app.get("/", protegerDashboard, (req, res) => {
  res.sendFile(dashboardPath);
});

app.get("/dashboard", protegerDashboard, (req, res) => {
  res.sendFile(dashboardPath);
});

app.get("/api/stats", protegerDashboard, async (req, res) => {
  try {
    const data = await Stats.getSnapshot(req.query || {});
    return res.json(data);
  } catch (error) {
    console.error("❌ Error en /api/stats:", error);
    return res.status(500).json({
      ok: false,
      error: "Error cargando estadísticas",
    });
  }
});

app.get("/health", (req, res) => {
  res.status(200).send("OK TODO FUNCIONANDO PERRO");
});

app.use("/chatwoot", chatwootRouter);

app.use("/notify", notifyRouter);
app.use("/api/notify", notifyRouter);

app.use("/certificate", certificateRouter);
app.use("/notify/certificate", certificateRouter);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ Servidor activo en puerto ${PORT}`);
  console.log(`📊 Dashboard protegido en / y /dashboard`);
  console.log(`🔎 API stats con filtros activa en /api/stats`);
  console.log(`💬 Chatwoot webhook activo en /chatwoot/webhook`);
  console.log(`📁 Dashboard path: ${dashboardPath}`);
});