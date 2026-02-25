"use strict";

const { TOKEN, PHONE_NUMBER_ID, GRAPH_VERSION } = require("../config");

async function sendPayload(payload) {
  if (!TOKEN) return;

  try {
    const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await r.json();
    if (!r.ok) console.error("❌ Error enviando mensaje:", r.status, data);
    else console.log("✅ Enviado OK");
  } catch (e) {
    console.error("❌ Fallo fetch a WhatsApp:", e);
  }
}

async function sendText(to, bodyText) {
  if (!TOKEN) return;

  return sendPayload({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: bodyText },
  });
}

async function sendMainMenu(to) {
  if (!TOKEN) return;

  const bodyText =
    "✨ *VIP Salud Ocupacional*\n\n" +
    "¡Hola! 👋\n" +
    "Bienvenido(a) al proceso del *Curso de Manipulación de Alimentos*.\n\n" +
    "A través de este chat podrás registrarte para realizar el curso y obtener tu certificado oficial.\n\n" +
    "Selecciona una opción para continuar:";

  return sendPayload({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: [
          { type: "reply", reply: { id: "registrarme", title: "📋 Registrarme" } },
          { type: "reply", reply: { id: "enlace", title: "🔗 Instructivo y link" } },
          { type: "reply", reply: { id: "asesor", title: "❓ Necesito ayuda" } },
        ],
      },
    },
  });
}

module.exports = { sendPayload, sendText, sendMainMenu };