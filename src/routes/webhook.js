"use strict";

const express = require("express");
const {
  TOKEN,
  VERIFY_TOKEN,
  TEXT_MAX_LEN,
} = require("../config");

const { isRateLimited } = require("../utils/rateLimit");
const { sendText, sendMainMenu } = require("../services/whatsapp");
const { sendToChatwoot } = require("../services/chatwoot");

const router = express.Router();

// ====== WEBHOOK VERIFY (GET) ======
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// ====== Helpers ======
function getProfileName(value, from) {
  const contact = value?.contacts?.find((c) => c.wa_id === from);
  return contact?.profile?.name || from;
}

async function syncIncomingToChatwoot({ value, from, text }) {
  try {
    if (!text) return;

    const profileName = getProfileName(value, from);

    await sendToChatwoot({
      phone: from,
      name: profileName,
      message: text,
    });
  } catch (err) {
    console.error("❌ Error sincronizando con Chatwoot:", err.message);
  }
}

async function sendCourseInfo(to) {
  const link = "https://vip-alimentos-703743967183.us-central1.run.app/login";
  const password = "Hola123";

  const msg =
    "🎓 *Curso de Manipulación de Alimentos*\n\n" +
    "A continuación te compartimos el instructivo para iniciar tu capacitación:\n\n" +
    `1️⃣ Ingresa al siguiente enlace:\n${link}\n\n` +
    "2️⃣ Usuario: *Cédula*\n" +
    `🔐 Contraseña: *${password}*\n\n` +
    "3️⃣ Una vez ingreses, haz clic en *INICIAR*.\n\n" +
    "4️⃣ Selecciona *Iniciar lección* y desarrolla toda la capacitación.\n\n" +
    "5️⃣ Al finalizar podrás descargar tu certificado, carnet y demás documentos.\n\n" +
    "Si presentas alguna dificultad durante el proceso, escríbenos y con gusto te ayudamos.\n" +
    "Quedamos atentos.";

  return sendText(to, msg);
}

async function sendAdvisorInfo(to) {
  return sendText(
    to,
    "📞 *Atención personalizada*\n\n" +
      "Para hablar con un asesor, comunícate directamente al:\n\n" +
      "📱 *313 401 0901*\n\n" +
      "Con gusto te ayudaremos."
  );
}

// ====== WEBHOOK RECEIVE (POST) ======
router.post("/", (req, res) => {
  res.sendStatus(200);

  (async () => {
    try {
      const body = req.body;
      const change = body?.entry?.[0]?.changes?.[0];
      const value = change?.value;

      const msg = value?.messages?.[0];
      if (!msg) return;

      const from = msg.from;

      // Rate limit
      const rl = isRateLimited(from);
      if (rl.limited) {
        if (TOKEN && rl.reason === "too_many") {
          await sendText(
            from,
            "⚠️ Estás enviando muchos mensajes muy rápido. Intenta de nuevo en unos minutos."
          );
        }
        return;
      }

      // Botones interactivos
      const buttonId = msg?.interactive?.button_reply?.id;
      if (buttonId) {
        if (buttonId === "enlace") return sendCourseInfo(from);
        if (buttonId === "asesor") return sendAdvisorInfo(from);
        return sendMainMenu(from);
      }

      // Solo texto
      const text = (msg.text?.body || "").trim();

      // Sincronizar a Chatwoot solo si es texto real
      if (text) {
        await syncIncomingToChatwoot({ value, from, text });
      }

      if (text && text.length > TEXT_MAX_LEN) {
        return sendText(
          from,
          `⚠️ El mensaje es muy largo. Envíalo en menos de ${TEXT_MAX_LEN} caracteres.`
        );
      }

      const t = text.toLowerCase();

      if (t === "menu" || t === "menú") return sendMainMenu(from);

      if (
        t === "enlace" ||
        t === "link" ||
        t === "curso" ||
        t === "instructivo" ||
        t === "instructivo y link"
      ) {
        return sendCourseInfo(from);
      }

      if (
        t === "ayuda" ||
        t === "asesor" ||
        t === "necesito ayuda"
      ) {
        return sendAdvisorInfo(from);
      }

      return sendMainMenu(from);
    } catch (e) {
      console.error("❌ Error procesando webhook:", e);
    }
  })();
});

module.exports = router;


