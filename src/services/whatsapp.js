"use strict";

const { TOKEN, PHONE_NUMBER_ID, GRAPH_VERSION } = require("../config");
const Stats = require("./stats");

async function sendPayload(payload) {
  if (!TOKEN) {
    console.error("❌ TOKEN no configurado");
    return null;
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
      Stats.metaError(`Meta ${r.status}: ${data?.error?.message || "Error enviando mensaje"}`);
      return null;
    }

    console.log("✅ Enviado OK");
    Stats.mensajeEnviado("whatsapp", "Mensaje enviado correctamente a Meta");

    if (data.messages?.[0]?.id) {
      console.log("🟢 Message ID:", data.messages[0].id);
    }

    return data;

  } catch (e) {
    console.error("❌ Fallo fetch a WhatsApp:", e);
    Stats.metaError(`Fallo fetch a WhatsApp: ${e.message}`);
    return null;
  }
}