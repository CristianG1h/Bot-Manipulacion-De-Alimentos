"use strict";

const {
  TOKEN,
  PHONE_NUMBER_ID,
  GRAPH_VERSION,
} = require("../config");

const WA_TOKEN = TOKEN || process.env.TOKEN || process.env.WHATSAPP_TOKEN;
const WA_PHONE_NUMBER_ID = PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID;
const WA_GRAPH_VERSION = GRAPH_VERSION || process.env.GRAPH_VERSION || "v22.0";

function maskRecipient(value = "") {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "desconocido";
  if (digits.length <= 4) return "****";
  return `${digits.slice(0, 4)}***${digits.slice(-2)}`;
}

function resumenPayload(payload = {}) {
  return {
    type: String(payload?.type || "desconocido"),
    to: maskRecipient(payload?.to),
    template: payload?.template?.name || null,
  };
}

function validateMetaConfig() {
  if (!WA_TOKEN) {
    console.error("❌ TOKEN no configurado");
    return false;
  }
  if (!WA_PHONE_NUMBER_ID) {
    console.error("❌ PHONE_NUMBER_ID no configurado");
    return false;
  }
  return true;
}

async function sendPayload(payload) {
  if (!validateMetaConfig()) return null;

  try {
    const url = `https://graph.facebook.com/${WA_GRAPH_VERSION}/${WA_PHONE_NUMBER_ID}/messages`;
    console.log("📤 Enviando mensaje a Meta:", resumenPayload(payload));

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WA_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = {}; }

    console.log("📥 Meta status:", response.status);
    if (!response.ok) {
      console.error("❌ Error enviando mensaje a Meta:", {
        status: response.status,
        code: data?.error?.code || null,
        type: data?.error?.type || null,
      });
      return null;
    }

    const messageId = data?.messages?.[0]?.id || null;
    console.log("✅ Mensaje enviado correctamente:", {
      messageId,
      type: payload?.type || "desconocido",
    });
    return data;
  } catch (error) {
    console.error("❌ Fallo enviando mensaje a WhatsApp:", error.message);
    return null;
  }
}

async function sendText(to, text) {
  return sendPayload({
    messaging_product: "whatsapp",
    to: String(to).replace("+", ""),
    type: "text",
    text: {
      preview_url: true,
      body: String(text || ""),
    },
  });
}

async function uploadMediaBuffer(buffer, {
  mimeType = "application/pdf",
  fileName = "documento.pdf",
} = {}) {
  if (!validateMetaConfig()) return null;
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error("Buffer de archivo vacío");
  }

  const maxBytes = Number(process.env.WHATSAPP_MAX_UPLOAD_BYTES || 15 * 1024 * 1024);
  if (buffer.length > maxBytes) {
    throw new Error(`Archivo demasiado grande para el límite configurado (${buffer.length} bytes)`);
  }

  const url = `https://graph.facebook.com/${WA_GRAPH_VERSION}/${WA_PHONE_NUMBER_ID}/media`;
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", new Blob([buffer], { type: mimeType }), fileName);

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}` },
    body: form,
  });

  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = {}; }

  if (!response.ok || !data?.id) {
    console.error("❌ Error subiendo archivo a Meta:", {
      status: response.status,
      code: data?.error?.code || null,
      type: data?.error?.type || null,
    });
    return null;
  }

  console.log("✅ PDF temporal subido a Meta:", {
    mediaId: data.id,
    bytes: buffer.length,
  });
  return data.id;
}

async function sendDocumentBuffer(to, buffer, {
  fileName = "documento.pdf",
  caption = "",
  mimeType = "application/pdf",
} = {}) {
  const mediaId = await uploadMediaBuffer(buffer, { mimeType, fileName });
  if (!mediaId) return null;

  const document = { id: mediaId, filename: fileName };
  if (caption) document.caption = String(caption).slice(0, 1024);

  return sendPayload({
    messaging_product: "whatsapp",
    to: String(to).replace("+", ""),
    type: "document",
    document,
  });
}

async function sendMainMenu(to) {
  return sendPayload({
    messaging_product: "whatsapp",
    to: String(to).replace("+", ""),
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text:
          "✨ *VIP Salud Ocupacional*\n\n" +
          "¡Hola! 👋 Bienvenido(a).\n\n" +
          "¿Qué proceso deseas realizar?",
      },
      action: {
        buttons: [
          { type: "reply", reply: { id: "menu_manipulacion", title: "🎓 Manipulación" } },
          { type: "reply", reply: { id: "menu_custodia", title: "📄 Custodia clínica" } },
        ],
      },
    },
  });
}

module.exports = {
  sendPayload,
  sendText,
  sendMainMenu,
  uploadMediaBuffer,
  sendDocumentBuffer,
};
