"use strict";

const {
  TOKEN,
  PHONE_NUMBER_ID,
  GRAPH_VERSION,
} = require("../config");

const WA_TOKEN = TOKEN || process.env.TOKEN || process.env.WHATSAPP_TOKEN;
const WA_PHONE_NUMBER_ID = PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID;
const WA_GRAPH_VERSION = GRAPH_VERSION || process.env.GRAPH_VERSION || "v22.0";

async function sendPayload(payload) {
  if (!WA_TOKEN) {
    console.error("❌ TOKEN no configurado");
    return null;
  }

  if (!WA_PHONE_NUMBER_ID) {
    console.error("❌ PHONE_NUMBER_ID no configurado");
    return null;
  }

  try {
    const url = `https://graph.facebook.com/${WA_GRAPH_VERSION}/${WA_PHONE_NUMBER_ID}/messages`;

    console.log("📤 Enviando a Meta...");
    console.log("📍 URL:", url);
    console.log("📦 Payload:", JSON.stringify(payload, null, 2));

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
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { raw };
    }

    console.log("📥 META RESPONSE STATUS:", response.status);
    console.log("📥 META RESPONSE BODY:", JSON.stringify(data, null, 2));

    if (!response.ok) {
      console.error("❌ Error enviando mensaje:", response.status, data);
      return null;
    }

    console.log("✅ Enviado OK");

    if (data.messages?.[0]?.id) {
      console.log("🟢 Message ID:", data.messages[0].id);
    }

    return data;
  } catch (error) {
    console.error("❌ Fallo fetch a WhatsApp:", error.message);
    return null;
  }
}

async function sendText(to, text) {
  return await sendPayload({
    messaging_product: "whatsapp",
    to: String(to).replace("+", ""),
    type: "text",
    text: {
      preview_url: true,
      body: String(text || ""),
    },
  });
}

async function sendMainMenu(to) {
  return await sendPayload({
    messaging_product: "whatsapp",
    to: String(to).replace("+", ""),
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text:
          "✨ *VIP Salud Ocupacional*\n\n" +
          "¡Hola! 👋 Bienvenido(a) al *Curso de Manipulación de Alimentos*.\n\n" +
          "¿En qué te podemos ayudar?",
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: "ver_instructivo",
              title: "📄 Instructivo y link",
            },
          },
          {
            type: "reply",
            reply: {
              id: "hablar_asesor",
              title: "💬 Hablar con asesor",
            },
          },
        ],
      },
    },
  });
}

module.exports = {
  sendPayload,
  sendText,
  sendMainMenu,
};
