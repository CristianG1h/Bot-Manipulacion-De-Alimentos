"use strict";

const express = require("express");
const { isRateLimited } = require("../utils/rateLimit");

const router = express.Router();

function getTextFromMessage(body) {
  return (body.content || "").trim();
}

function isIncomingUserMessage(body) {
  return body.event === "message_created" &&
    body.message_type === "incoming" &&
    body.private !== true;
}

async function sendChatwootReply(conversationId, content) {
  const baseUrl = (process.env.CHATWOOT_BASE_URL || "").replace(/\/+$/, "");
  const accountId = process.env.CHATWOOT_ACCOUNT_ID;
  const apiToken = process.env.CHATWOOT_API_TOKEN;

  if (!baseUrl || !accountId || !apiToken) {
    throw new Error("Faltan CHATWOOT_BASE_URL, CHATWOOT_ACCOUNT_ID o CHATWOOT_API_TOKEN");
  }

  const url = `${baseUrl}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      api_access_token: apiToken,
    },
    body: JSON.stringify({
      content,
      message_type: "outgoing",
      private: false,
    }),
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`Chatwoot API ${response.status}: ${raw}`);
  }

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function buildReply(text) {
  const t = text.toLowerCase();

  if (t === "menu" || t === "menú") {
    return (
      "✨ *VIP Salud Ocupacional*\n\n" +
      "Bienvenido(a) al *Curso de Manipulación de Alimentos*.\n\n" +
      "Escribe una de estas opciones:\n" +
      "• *curso*\n" +
      "• *certificado*\n" +
      "• *asesor*"
    );
  }

  if (
    t === "enlace" ||
    t === "link" ||
    t === "curso" ||
    t === "instructivo" ||
    t === "instructivo y link"
  ) {
    return (
      "📘 *Curso de Manipulación de Alimentos*\n\n" +
      "A continuación te compartimos el instructivo para iniciar tu capacitación:\n\n" +
      "1️⃣ Ingresa al siguiente enlace:\n" +
      "https://vip-alimentos-703743967183.us-central1.run.app/login\n\n" +
      "2️⃣ Usuario: *Cédula*\n" +
      "3️⃣ Contraseña: *Hola123*\n\n" +
      "4️⃣ Una vez ingreses, haz clic en *INICIAR*.\n" +
      "5️⃣ Selecciona *Iniciar lección* y desarrolla toda la capacitación.\n\n" +
      "Si presentas alguna dificultad, escríbenos *asesor*."
    );
  }

  if (
    t === "ayuda" ||
    t === "asesor" ||
    t === "necesito ayuda"
  ) {
    return (
      "👩‍💼 *Atención personalizada*\n\n" +
      "Para hablar con un asesor, comunícate directamente al:\n\n" +
      "*313 401 0901*\n\n" +
      "Con gusto te ayudaremos."
    );
  }

  if (t.includes("certificado")) {
    return (
      "📄 Para ayudarte con tu certificado, envíanos por favor tu *número de cédula*."
    );
  }

  return (
    "Hola 👋 Gracias por escribirnos.\n\n" +
    "Puedes escribir:\n" +
    "• *curso*\n" +
    "• *certificado*\n" +
    "• *asesor*\n" +
    "• *menu*"
  );
}

router.post("/webhook", async (req, res) => {
  res.status(200).json({ ok: true });

  try {
    const body = req.body;
    console.log("📩 CHATWOOT WEBHOOK:", JSON.stringify(body, null, 2));

    if (!isIncomingUserMessage(body)) {
      return;
    }

    const conversationId = body.conversation?.id;
    const text = getTextFromMessage(body);
    const contactPhone =
      body.conversation?.meta?.sender?.phone_number ||
      body.sender?.phone_number ||
      body.contact?.phone_number ||
      "unknown";

    if (!conversationId || !text) {
      return;
    }

    const rl = isRateLimited(contactPhone);
    if (rl.limited) {
      await sendChatwootReply(
        conversationId,
        "⚠️ Estás enviando muchos mensajes muy rápido. Intenta de nuevo en unos minutos."
      );
      return;
    }

    const reply = await buildReply(text);
    await sendChatwootReply(conversationId, reply);
  } catch (error) {
    console.error("❌ CHATWOOT WEBHOOK ERROR:", error);
  }
});

module.exports = router;
