"use strict";

const express = require("express");
const path = require("path");

const notifyRouter = require("./routes/notify");
const certificateRouter = require("./routes/certificate");
const chatwootRouter = require("./routes/chatwoot");
const adminCertificadosRouter = require("./routes/adminCertificados");
const Stats = require("./services/stats");
const {
  startCustodiaBiofileSync,
  getCustodiaSyncStatus,
  syncCustodiaCompanies,
} = require("./services/biofileCustodiaSync");

const app = express();

app.use(express.json({ limit: "2mb" }));

const dashboardPath = path.join(__dirname, "public", "dashboard.html");
const publicPath = path.join(__dirname, "public");

const PREVIEW_TITLE = "Bot Manipulación de Alimentos";
const PREVIEW_DESCRIPTION =
  "Dashboard y estadísticas del bot de VIP Salud Ocupacional. Consulta actividad, accesos y seguimiento en tiempo real.";
const PREVIEW_URL = "https://bot-manipulacion-de-alimentos.onrender.com/";
const PREVIEW_IMAGE = "https://vip-mediconecta.app/tenant-logo.png";

function isPreviewBot(req) {
  const ua = String(req.headers["user-agent"] || "").toLowerCase();

  return (
    ua.includes("whatsapp") ||
    ua.includes("facebookexternalhit") ||
    ua.includes("facebot") ||
    ua.includes("twitterbot") ||
    ua.includes("telegrambot") ||
    ua.includes("linkedinbot") ||
    ua.includes("discordbot") ||
    ua.includes("slackbot")
  );
}

function renderPreviewHtml() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <title>${PREVIEW_TITLE}</title>

  <link rel="icon" type="image/png" href="${PREVIEW_IMAGE}" />
  <link rel="apple-touch-icon" href="${PREVIEW_IMAGE}" />

  <meta property="og:locale" content="es_CO" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Vip Salud Ocupacional" />
  <meta property="og:title" content="${PREVIEW_TITLE}" />
  <meta property="og:description" content="${PREVIEW_DESCRIPTION}" />
  <meta property="og:url" content="${PREVIEW_URL}" />
  <meta property="og:image" content="${PREVIEW_IMAGE}" />
  <meta property="og:image:secure_url" content="${PREVIEW_IMAGE}" />
  <meta property="og:image:type" content="image/png" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${PREVIEW_TITLE}" />
  <meta name="twitter:description" content="${PREVIEW_DESCRIPTION}" />
  <meta name="twitter:image" content="${PREVIEW_IMAGE}" />

  <style>
    body {
      margin: 0;
      min-height: 100vh;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #07111f;
      color: #f8fafc;
      display: grid;
      place-items: center;
      padding: 24px;
    }

    .card {
      max-width: 620px;
      text-align: center;
      background: #18263b;
      border: 1px solid rgba(96, 165, 250, .28);
      border-radius: 28px;
      padding: 34px;
      box-shadow: 0 30px 80px rgba(0,0,0,.28);
    }

    img {
      width: 82px;
      height: 82px;
      object-fit: contain;
      margin-bottom: 18px;
    }

    h1 {
      margin: 0;
      font-size: 34px;
      line-height: 1.1;
    }

    p {
      color: #9db7d8;
      font-size: 17px;
      line-height: 1.6;
    }

    .note {
      margin-top: 18px;
      color: #10b981;
      font-weight: 800;
    }
  </style>
</head>

<body>
  <main class="card">
    <img src="${PREVIEW_IMAGE}" alt="Vip Salud Ocupacional" />
    <h1>${PREVIEW_TITLE}</h1>
    <p>${PREVIEW_DESCRIPTION}</p>
    <div class="note">Panel privado protegido</div>
  </main>
</body>
</html>`;
}

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

// Archivos del dashboard protegidos
app.use("/public", protegerDashboard, express.static(publicPath));

// Misma URL principal:
// - WhatsApp/Facebook/Twitter reciben preview público
// - Usuarios normales reciben dashboard protegido
app.get("/", (req, res, next) => {
  if (isPreviewBot(req)) {
    return res.status(200).type("html").send(renderPreviewHtml());
  }

  return protegerDashboard(req, res, next);
}, (req, res) => {
  res.sendFile(dashboardPath);
});

// Dashboard protegido
app.get("/dashboard", protegerDashboard, (req, res) => {
  res.sendFile(dashboardPath);
});

// API protegida
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

// API certificados admin protegida
app.use("/api/admin-certificados", protegerDashboard, adminCertificadosRouter);

// Estado de la sincronización de empresas de Custodia Clínica con BIOFILE.
app.get("/api/custodia-sync-status", protegerDashboard, (_req, res) => {
  return res.json(getCustodiaSyncStatus());
});

// Permite verificar o forzar una actualización sin esperar las próximas 24 h.
app.post("/api/custodia-sync-now", protegerDashboard, async (_req, res) => {
  try {
    const result = await syncCustodiaCompanies({ reason: "manual-api" });
    return res.json({ ...result, status: getCustodiaSyncStatus() });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error.message,
      status: getCustodiaSyncStatus(),
    });
  }
});

// Healthcheck público para Render/UptimeRobot
app.get("/health", (req, res) => {
  res.status(200).send("OK TODO FUNCIONANDO PERRO");
});

// Chatwoot público porque Chatwoot debe llamar este endpoint
app.use("/chatwoot", chatwootRouter);

// Notificaciones protegidas por x-api-key
app.use("/notify", notifyRouter);
app.use("/api/notify", notifyRouter);

// Certificados protegidos por x-api-key
app.use("/certificate", certificateRouter);
app.use("/notify/certificate", certificateRouter);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ Servidor activo en puerto ${PORT}`);
  console.log(`📊 Dashboard protegido en / y /dashboard`);
  console.log(`🖼️ Preview público para bots en /`);
  console.log(`🔎 API stats con filtros activa en /api/stats`);
  console.log(`💬 Chatwoot webhook activo en /chatwoot/webhook`);
  console.log(`📁 Dashboard path: ${dashboardPath}`);

  // Render permanece encendido: se consulta BIOFILE al iniciar y luego cada 24 h.
  // Si la consulta falla, el catálogo embebido continúa disponible y se reintenta
  // en la siguiente ejecución o mediante /api/custodia-sync-now.
  startCustodiaBiofileSync();
});
