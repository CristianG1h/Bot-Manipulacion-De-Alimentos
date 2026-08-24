"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const router = express.Router();

const {
  sendPayload,
  sendText,
  sendDocumentBuffer,
} = require("../services/whatsapp");

const WEBHOOK_TOKEN = process.env.CHATWOOT_WEBHOOK_TOKEN;
const DOCUMENTS_DIR = path.join(__dirname, "../assets/company-documents-live");

const DOCUMENTS = {
  doc_rut: {
    fileName: "rut.pdf",
    caption:
      "📄 *RUT — VIP SALUD OCUPACIONAL SAS*\n\n" +
      "NIT: *901434471-7*\n" +
      "Adjuntamos el Registro Único Tributario (RUT) actualizado de la empresa.",
  },
  doc_camara: {
    fileName: "camara_comercio.pdf",
    caption:
      "🏢 *CÁMARA DE COMERCIO*\n\n" +
      "Adjuntamos el certificado de existencia y representación legal actualizado de *VIP SALUD OCUPACIONAL SAS*.",
  },
  doc_habilitacion: {
    fileName: "habilitacion_reps.pdf",
    caption:
      "🏥 *HABILITACIÓN / REPS*\n\n" +
      "Adjuntamos el documento de habilitación y declaración de autoevaluación de los servicios de salud de *VIP SALUD OCUPACIONAL SAS*.",
  },
  doc_licencia_sst: {
    fileName: "licencia_medico_sst.pdf",
    caption:
      "🩺 *LICENCIA MÉDICO SST*\n\n" +
      "Adjuntamos la licencia para la prestación de servicios en *Seguridad y Salud en el Trabajo*.",
  },
  bancolombia: {
    fileName: "bancolombia.pdf",
    caption:
      "🏦 *BANCOLOMBIA*\n\n" +
      "Titular: *VIP SALUD OCUPACIONAL SAS*\n" +
      "Tipo de cuenta: *Cuenta de ahorros*\n" +
      "Número: *21700001442*\n\n" +
      "Adjuntamos la certificación bancaria correspondiente.",
  },
  davivienda: {
    fileName: "davivienda.pdf",
    caption:
      "🏦 *DAVIVIENDA*\n\n" +
      "Titular: *VIP SALUD OCUPACIONAL SAS*\n" +
      "Tipo de cuenta: *Cuenta de ahorros*\n" +
      "Número: *001600128670*\n\n" +
      "Adjuntamos la certificación bancaria correspondiente.",
  },
};

const ROOT_MENU_TEXT =
  "✨ *VIP SALUD OCUPACIONAL*\n\n" +
  "¡Hola! 👋 Bienvenido(a).\n\n" +
  "¿Qué deseas realizar?";

function getPhone(body) {
  const raw =
    body.meta?.sender?.phone_number ||
    body.conversation?.meta?.sender?.phone_number ||
    body.contact?.phone_number ||
    null;

  return raw ? String(raw).replace(/\D/g, "") : null;
}

function getReplyId(body) {
  return (
    body?.content_attributes?.items?.[0]?.reply?.id ||
    body?.content_attributes?.reply?.id ||
    body?.content_attributes?.interactive?.list_reply?.id ||
    body?.content_attributes?.interactive?.button_reply?.id ||
    null
  );
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function getActionId(body) {
  const replyId = getReplyId(body);
  if (replyId) return replyId;

  const text = normalizeText(body.content);
  const byText = new Map([
    ["🎓 manipulación", "menu_manipulacion"],
    ["manipulación", "menu_manipulacion"],
    ["manipulacion", "menu_manipulacion"],
    ["📁 documentos vip", "menu_documentos_vip"],
    ["documentos vip", "menu_documentos_vip"],
    ["📄 certificados", "menu_certificados"],
    ["certificados", "menu_certificados"],
    ["📄 rut", "doc_rut"],
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
    ["🧰 calibración equipos", "doc_calibracion"],
    ["calibración equipos", "doc_calibracion"],
    ["calibracion equipos", "doc_calibracion"],
    ["⬅️ volver al menú", "menu_principal"],
    ["volver al menú", "menu_principal"],
    ["volver al menu", "menu_principal"],
  ]);

  return byText.get(text) || null;
}

function shouldShowRootMenu(body) {
  const text = normalizeText(body.content);
  return [
    "hola",
    "buenas",
    "buenos días",
    "buenos dias",
    "buen día",
    "buen dia",
    "buenas tardes",
    "buenas noches",
    "inicio",
    "menu",
    "menú",
    "start",
    "hi",
    "hello",
    "👋",
  ].includes(text);
}

async function sendRootMenu(to) {
  return sendPayload({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: ROOT_MENU_TEXT },
      action: {
        buttons: [
          {
            type: "reply",
            reply: { id: "menu_manipulacion", title: "🎓 Manipulación" },
          },
          {
            type: "reply",
            reply: { id: "menu_documentos_vip", title: "📁 Documentos VIP" },
          },
          {
            type: "reply",
            reply: { id: "menu_certificados", title: "📄 Certificados" },
          },
        ],
      },
    },
  });
}

async function sendManipulationMenu(to) {
  return sendPayload({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text:
          "🎓 *MANIPULACIÓN DE ALIMENTOS*\n\n" +
          "Selecciona una opción:",
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: { id: "ver_instructivo", title: "📘 Instructivo" },
          },
          {
            type: "reply",
            reply: { id: "descargar_certificado", title: "🎓 Descargar cert." },
          },
          {
            type: "reply",
            reply: { id: "hablar_asesor", title: "💬 Hablar asesor" },
          },
        ],
      },
    },
  });
}

async function sendDocumentsMenu(to) {
  return sendPayload({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: {
        type: "text",
        text: "📁 DOCUMENTOS VIP",
      },
      body: {
        text:
          "📁 *DOCUMENTOS VIP SALUD OCUPACIONAL*\n\n" +
          "Selecciona el documento que deseas recibir:",
      },
      footer: {
        text: "VIP Salud Ocupacional",
      },
      action: {
        button: "Ver documentos",
        sections: [
          {
            title: "Documentos de la IPS",
            rows: [
              {
                id: "doc_rut",
                title: "📄 RUT",
                description: "Registro Único Tributario actualizado",
              },
              {
                id: "doc_camara",
                title: "🏢 Cámara de Comercio",
                description: "Certificado de existencia y representación legal",
              },
              {
                id: "doc_bancos",
                title: "🏦 Cuentas bancarias",
                description: "Bancolombia y Davivienda",
              },
              {
                id: "doc_habilitacion",
                title: "🏥 Habilitación / REPS",
                description: "Documento de habilitación de servicios de salud",
              },
              {
                id: "doc_licencia_sst",
                title: "🩺 Licencia Médico SST",
                description: "Licencia de Seguridad y Salud en el Trabajo",
              },
              {
                id: "doc_calibracion",
                title: "🧰 Calibración equipos",
                description: "Certificados de calibración de equipos",
              },
              {
                id: "menu_principal",
                title: "⬅️ Volver al menú",
                description: "Regresar a las opciones principales",
              },
            ],
          },
        ],
      },
    },
  });
}

async function sendCertificatesMenu(to) {
  return sendPayload({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text:
          "📄 *CERTIFICADOS Y CONSTANCIAS*\n\n" +
          "Selecciona una opción:",
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: { id: "menu_custodia", title: "📄 Custodia clínica" },
          },
          {
            type: "reply",
            reply: { id: "descargar_certificado", title: "🎓 Manipulación" },
          },
          {
            type: "reply",
            reply: { id: "menu_principal", title: "⬅️ Volver" },
          },
        ],
      },
    },
  });
}

async function loadDocument(documentKey) {
  const config = DOCUMENTS[documentKey];
  if (!config) throw new Error(`Documento no configurado: ${documentKey}`);

  const fullPath = path.join(DOCUMENTS_DIR, config.fileName);
  const buffer = await fs.readFile(fullPath);

  if (!buffer.length) {
    throw new Error(`El archivo ${config.fileName} está vacío`);
  }

  return { ...config, buffer };
}

async function sendConfiguredDocument(to, documentKey) {
  const config = DOCUMENTS[documentKey];

  try {
    const document = await loadDocument(documentKey);
    return await sendDocumentBuffer(to, document.buffer, {
      fileName: document.fileName,
      caption: document.caption,
      mimeType: "application/pdf",
    });
  } catch (error) {
    console.error(`❌ No se pudo enviar ${documentKey}:`, error.message);

    const fileName = config?.fileName || "documento.pdf";
    return sendText(
      to,
      "⚠️ *Documento temporalmente no disponible*\n\n" +
        `No encontramos el archivo *${fileName}* en el servidor. ` +
        "Por favor comunícate con un asesor para que te lo envíe directamente."
    );
  }
}

async function sendBankAccounts(to) {
  await sendConfiguredDocument(to, "bancolombia");
  return sendConfiguredDocument(to, "davivienda");
}

async function sendCalibrationMaintenance(to) {
  return sendPayload({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text:
          "🧰 *Certificados de calibración de equipos*\n\n" +
          "En este momento estamos actualizando los certificados para poder entregar siempre la versión más reciente.\n\n" +
          "Si necesitas este documento de manera prioritaria, puedes hablar con un asesor y te ayudará con la solicitud.",
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: { id: "hablar_asesor", title: "💬 Hablar asesor" },
          },
          {
            type: "reply",
            reply: { id: "menu_documentos_vip", title: "📁 Documentos VIP" },
          },
        ],
      },
    },
  });
}

async function handleAction(to, actionId) {
  if (actionId === "menu_principal") return sendRootMenu(to);
  if (actionId === "menu_manipulacion") return sendManipulationMenu(to);
  if (actionId === "menu_documentos_vip") return sendDocumentsMenu(to);
  if (actionId === "menu_certificados") return sendCertificatesMenu(to);
  if (actionId === "doc_rut") return sendConfiguredDocument(to, "doc_rut");
  if (actionId === "doc_camara") return sendConfiguredDocument(to, "doc_camara");
  if (actionId === "doc_habilitacion") return sendConfiguredDocument(to, "doc_habilitacion");
  if (actionId === "doc_licencia_sst") return sendConfiguredDocument(to, "doc_licencia_sst");
  if (actionId === "doc_bancos") return sendBankAccounts(to);
  if (actionId === "doc_calibracion") return sendCalibrationMaintenance(to);

  return null;
}

router.post("/webhook", async (req, res, next) => {
  try {
    if (WEBHOOK_TOKEN && String(req.query.token || "") !== WEBHOOK_TOKEN) {
      return next();
    }

    const body = req.body || {};
    if (body.event !== "message_created" || body.private === true) return next();

    const messageType = String(body.message_type ?? "").toLowerCase();
    const incoming = messageType === "incoming" || messageType === "0";
    if (!incoming) return next();

    const expectedInboxId = Number(process.env.CHATWOOT_INBOX_ID || 0);
    const payloadInboxId =
      body.inbox?.id ||
      body.inbox_id ||
      body.conversation?.inbox_id ||
      body.conversation?.inbox?.id ||
      body.message?.inbox_id ||
      body.message?.inbox?.id ||
      body.conversation?.meta?.inbox?.id ||
      body.conversation?.contact_inbox?.inbox_id ||
      body.contact_inbox?.inbox_id ||
      null;

    if (expectedInboxId && payloadInboxId && Number(payloadInboxId) !== expectedInboxId) {
      return next();
    }

    const to = getPhone(body);
    if (!to) return next();

    const actionId = getActionId(body);
    const handledAction = [
      "menu_principal",
      "menu_manipulacion",
      "menu_documentos_vip",
      "menu_certificados",
      "doc_rut",
      "doc_camara",
      "doc_bancos",
      "doc_habilitacion",
      "doc_licencia_sst",
      "doc_calibracion",
    ].includes(actionId);

    if (!handledAction && !shouldShowRootMenu(body)) return next();

    res.status(200).json({ ok: true });

    if (handledAction) {
      await handleAction(to, actionId);
      return;
    }

    await sendRootMenu(to);
  } catch (error) {
    console.error("❌ Error en menú/documentos VIP:", error);
    if (!res.headersSent) return next();
  }
});

module.exports = router;
