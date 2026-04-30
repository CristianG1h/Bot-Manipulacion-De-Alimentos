"use strict";

const { TOKEN, PHONE_NUMBER_ID, GRAPH_VERSION } = require("../config");

async function sendPayload(payload) {
  if (!TOKEN) {
    console.error("❌ TOKEN no configurado");
    return;
  }

  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;

    console.log("📤 Enviando a Meta...");
    console.log("📍 URL:", url);
    console.log("📦 Payload:", JSON.stringify(payload, null, 2));

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await r.json();

    console.log("📥 META RESPONSE STATUS:", r.status);
    console.log("📥 META RESPONSE BODY:", JSON.stringify(data, null, 2));

    if (!r.ok) {
      console.error("❌ Error enviando mensaje:", r.status, data);
      return null;
    }

    console.log("✅ Enviado OK");

    if (data.messages?.[0]?.id) {
      console.log("🟢 Message ID:", data.messages[0].id);
    }

    return data;

  } catch (e) {
    console.error("❌ Fallo fetch a WhatsApp:", e);
    return null;
  }
}

async function sendText(to, bodyText) {
  if (!TOKEN) return;

  return await sendPayload({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: {
      body: bodyText,
    },
  });
}

module.exports = { sendPayload, sendText };
