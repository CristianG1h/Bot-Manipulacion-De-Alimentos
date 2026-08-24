"use strict";

const express = require("express");
const router = express.Router();

// IMPORTANTE: se parchea sendPayload antes de cargar el router legado.
// De esta forma, cualquier regreso al menú principal desde los flujos antiguos
// (Manipulación/Custodia) muestra siempre el nuevo menú de 3 opciones.
const whatsapp = require("../services/whatsapp");
const originalSendPayload = whatsapp.sendPayload;
const { sendText, sendDocumentBuffer } = whatsapp;
const { isRateLimited } = require("../utils/rateLimit");
const Stats = require("../services/stats");
const { readDocument } = require("../services/companyDocuments");

const WEBHOOK_TOKEN = process.env.CHATWOOT_WEBHOOK_TOKEN;
const processedNewMenuIds = new Set();
setInterval(() => processedNewMenuIds.clear(), 24 * 60 * 60 * 1000).unref?.();

function newRootButtons() {
  return [
    { type: "reply", reply: { id: "menu_manipulacion", title: "🎓 Manipulación" } },
    { type: "reply", reply: { id: "menu_documentos", title: "📁 Documentos VIP" } },
    { type: "reply", reply: { id: "menu_certificados", title: "📄 Certificados" } },
  ];
}

function isLegacyRootPayload(payload) {
  const interactive = payload?.interactive;
  const buttons = interactive?.action?.buttons;
  if (payload?.type !== "interactive" || interactive?.type !== "button" || !Array.isArray(buttons)) return false;

  const ids = buttons.map((button) => button?.reply?.id).filter(Boolean);
  const text = String(interactive?.body?.text || "").toLowerCase();
  return ids.includes("menu_manipulacion") && ids.includes("menu_custodia") && text.includes("proceso deseas realizar");
}

whatsapp.sendPayload = async function sendPayloadWithNewRootMenu(payload) {
  if (isLegacyRootPayload(payload)) {
    payload = {
      ...payload,
      interactive: {
        ...payload.interactive,
        action: { ...payload.interactive.action, buttons: newRootButtons() },
      },
    };
  }
  return originalSendPayload(payload);
};

// Se carga después del parche anterior para conservar intactos los flujos
// existentes y reducir el riesgo de romper Manipulación o Custodia Clínica.
const legacyRouter = require("./chatwootLegacy");

function obtenerInboxIdDesdePayload(body) {
  return body.inbox?.id || body.inbox_id || body.conversation?.inbox_id || body.conversation?.inbox?.id || body.message?.inbox_id || body.message?.inbox?.id || body.conversation?.meta?.inbox?.id || body.conversation?.contact_inbox?.inbox_id || body.contact_inbox?.inbox_id || null;
}

function extractReplyId(body) {
  const candidates = [
    body?.content_attributes?.items?.[0]?.reply?.id,
    body?.content_attributes?.interactive?.button_reply?.id,
    body?.content_attributes?.interactive?.list_reply?.id,
    body?.content_attributes?.button_reply?.id,
    body?.content_attributes?.list_reply?.id,
    body?.content_attributes?.items?.[0]?.id,
  ].filter(Boolean);

  if (candidates.length) return String(candidates[0]);

  const text = String(body?.content || "").trim().toLowerCase();
  const byText = new Map([
    ["📁 documentos vip", "menu_documentos"],
    ["documentos vip", "menu_documentos"],
    ["📄 certificados", "menu_certificados"],
    ["certificados", "menu_certificados"],
    ["📄 rut actualizado", "doc_rut"],
    ["rut actualizado", "doc_rut"],
    ["rut", "doc_rut"],
    ["🏢 cámara de comercio", "doc_camara"],
    ["cámara de comercio", "doc_camara"],
    ["camara de comercio", "doc_camara"],
    ["🏦 cuentas bancarias", "doc_bancos"],
    ["cuentas bancarias", "doc_bancos"],
    ["🏥 habilitación / reps", "doc_habilitacion"],
    ["habilitación / reps", "doc_habilitacion"],
    ["habilitacion / reps", "doc_habilitacion"],
    ["🩺 licencia médico sst", "doc_licencia_sst"],
    ["licencia médico sst", "doc_licencia_sst"],
    ["licencia medico sst", "doc_licencia_sst"],
    ["🛠️ cert. calibración", "doc_calibracion"],
    ["cert. calibración", "doc_calibracion"],
    ["certificados de calibración", "doc_calibracion"],
    ["certificados de calibracion", "doc_calibracion"],
    ["⬅️ volver al inicio", "menu_inicio_nuevo"],
    ["volver al inicio", "menu_inicio_nuevo"],
    ["⬅️ volver", "menu_inicio_nuevo"],
  ]);
  return byText.get(text) || null;
}

const NEW_ACTIONS = new Set([
  "menu_documentos",
  "menu_certificados",
  "menu_inicio_nuevo",
  "doc_rut",
  "doc_camara",
  "doc_bancos",
  "doc_habilitacion",
  "doc_licencia_sst",
  "doc_calibracion",
]);

function getIncomingContext(body) {
  if (body?.event !== "message_created" || body?.private === true) return null;

  const messageType = String(body?.message_type ?? "").toLowerCase();
  const esIncoming = messageType === "incoming" || messageType === "0";
  if (!esIncoming) return null;

  const expectedInboxId = Number(process.env.CHATWOOT_INBOX_ID || 0);
  const payloadInboxId = obtenerInboxIdDesdePayload(body);
  if (!expectedInboxId || !payloadInboxId || Number(payloadInboxId) !== expectedInboxId) return null;

  const rawPhone = body.meta?.sender?.phone_number || body.conversation?.meta?.sender?.phone_number || body.contact?.phone_number || null;
  if (!rawPhone) return null;

  return {
    waId: String(rawPhone).replace(/\D/g, ""),
    messageId: body.id ? String(body.id) : null,
  };
}

async function sendRootMenu(to) {
  const menuText = "✨ *VIP SALUD OCUPACIONAL*\n\n¡Hola! 👋 Bienvenido(a).\n\n¿Qué deseas realizar?";
  const result = await originalSendPayload({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: menuText },
      action: { buttons: newRootButtons() },
    },
  });
  if (result) Stats.menuEnviado(to);
  return result;
}

async function sendDocumentsMenu(to) {
  const result = await originalSendPayload({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: {
        text:
          "📁 *DOCUMENTOS VIP SALUD OCUPACIONAL*\n\n" +
          "Selecciona el documento que deseas recibir:",
      },
      action: {
        button: "Ver documentos",
        sections: [
          {
            title: "Documentos disponibles",
            rows: [
              { id: "doc_rut", title: "📄 RUT actualizado", description: "Registro Único Tributario de VIP" },
              { id: "doc_camara", title: "🏢 Cámara de Comercio", description: "Existencia y representación legal" },
              { id: "doc_bancos", title: "🏦 Cuentas bancarias", description: "Bancolombia y Davivienda" },
              { id: "doc_habilitacion", title: "🏥 Habilitación / REPS", description: "Documento de habilitación de servicios" },
              { id: "doc_licencia_sst", title: "🩺 Licencia Médico SST", description: "Licencia de Seguridad y Salud en el Trabajo" },
              { id: "doc_calibracion", title: "🛠️ Cert. calibración", description: "Certificados de calibración de equipos" },
              { id: "menu_inicio_nuevo", title: "⬅️ Volver al inicio", description: "Regresar al menú principal" },
            ],
          },
        ],
      },
    },
  });
  if (result) Stats.mensajeEnviado("menu_documentos", "Menú Documentos VIP enviado");
  return result;
}

async function sendCertificatesMenu(to) {
  const result = await originalSendPayload({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: "📄 *CERTIFICADOS*\n\nSelecciona el certificado que necesitas:",
      },
      action: {
        buttons: [
          { type: "reply", reply: { id: "menu_custodia", title: "📄 Custodia clínica" } },
          { type: "reply", reply: { id: "descargar_certificado", title: "🎓 Cert. Manip." } },
          { type: "reply", reply: { id: "menu_inicio_nuevo", title: "⬅️ Volver" } },
        ],
      },
    },
  });
  if (result) Stats.mensajeEnviado("menu_certificados", "Menú Certificados enviado");
  return result;
}

async function sendOneCompanyDocument(to, key) {
  try {
    const doc = readDocument(key);
    await sendText(to, doc.message);
    const result = await sendDocumentBuffer(to, doc.pdfBuffer, {
      fileName: doc.fileName,
      caption: doc.caption,
      mimeType: "application/pdf",
    });
    if (!result) throw new Error("Meta no aceptó el documento");
    Stats.mensajeEnviado("documento_vip", `${doc.title} enviado`);
    return result;
  } catch (error) {
    console.error(`❌ Error enviando documento VIP ${key}:`, error.message);
    Stats.metaError(`Error documento VIP ${key}: ${error.message}`);
    return sendText(to, "⚠️ No pude adjuntar este documento en este momento. Intenta nuevamente o solicita ayuda a un asesor.");
  }
}

async function sendBankDocuments(to) {
  // El usuario pidió recibir las dos certificaciones dentro de la misma opción,
  // cada una con su explicación independiente, sin abrir un segundo menú.
  await sendOneCompanyDocument(to, "bancolombia");
  return sendOneCompanyDocument(to, "davivienda");
}

async function sendCalibrationMaintenance(to) {
  const text =
    "🛠️ *Certificados de calibración de los equipos*\n\n" +
    "En este momento estamos *actualizando los certificados* para poder entregarte la versión más reciente de cada equipo.\n\n" +
    "Si los necesitas con prioridad, puedes hablar con un asesor y te ayudará con la solicitud.";

  return originalSendPayload({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text },
      action: {
        buttons: [
          { type: "reply", reply: { id: "hablar_asesor", title: "💬 Hablar asesor" } },
          { type: "reply", reply: { id: "menu_documentos", title: "📁 Documentos" } },
        ],
      },
    },
  });
}

async function handleNewAction(to, actionId) {
  if (actionId === "menu_documentos") return sendDocumentsMenu(to);
  if (actionId === "menu_certificados") return sendCertificatesMenu(to);
  if (actionId === "menu_inicio_nuevo") return sendRootMenu(to);
  if (actionId === "doc_rut") return sendOneCompanyDocument(to, "rut");
  if (actionId === "doc_camara") return sendOneCompanyDocument(to, "camara");
  if (actionId === "doc_bancos") return sendBankDocuments(to);
  if (actionId === "doc_habilitacion") return sendOneCompanyDocument(to, "habilitacion");
  if (actionId === "doc_licencia_sst") return sendOneCompanyDocument(to, "licencia_sst");
  if (actionId === "doc_calibracion") return sendCalibrationMaintenance(to);
  return null;
}

router.post("/webhook", async (req, res, next) => {
  const actionId = extractReplyId(req.body || {});
  if (!actionId || !NEW_ACTIONS.has(actionId)) return next();

  if (!WEBHOOK_TOKEN) return res.status(503).json({ ok: false, error: "Webhook no configurado" });
  if (String(req.query.token || "") !== WEBHOOK_TOKEN) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const context = getIncomingContext(req.body || {});
  if (!context) return next();

  if (context.messageId) {
    if (processedNewMenuIds.has(context.messageId)) return res.status(200).json({ ok: true, duplicate: true });
    processedNewMenuIds.add(context.messageId);
  }

  const rl = isRateLimited(context.waId);
  if (rl.limited) {
    Stats.rateLimitado(context.waId);
    res.status(200).json({ ok: true, rate_limited: true });
    if (rl.reason === "too_many") await sendText(context.waId, "⚠️ Demasiados mensajes seguidos. Intenta en unos minutos.");
    return;
  }

  Stats.mensajeRecibido(context.waId);
  res.status(200).json({ ok: true });

  try {
    await handleNewAction(context.waId, actionId);
  } catch (error) {
    console.error("❌ Error procesando nuevo menú VIP:", error);
    Stats.metaError(`Error nuevo menú VIP: ${error.message}`);
  }
});

// Todos los flujos ya existentes continúan funcionando desde aquí.
router.use(legacyRouter);

module.exports = router;
