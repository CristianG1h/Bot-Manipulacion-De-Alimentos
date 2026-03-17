"use strict";

/**
 * src/routes/chatwoot.js
 *
 * Flujo:
 *  1. Usuario escribe → bot responde con menú
 *  2. Usuario pide instructivo/link → bot lo envía directo por WhatsApp
 *  3. Usuario pregunta algo que el bot no sabe → deja conversación abierta en Chatwoot
 *     para que un asesor humano la atienda
 *
 * Las respuestas van DIRECTO a WhatsApp vía Graph API (WHATSAPP_TOKEN).
 * Chatwoot solo actúa como puente de entrada del webhook.
 */

const express = require("express");
const router = express.Router();

const { sendPayload, sendText } = require("../services/whatsapp");
const { isRateLimited } = require("../utils/rateLimit");
const { TEXT_MAX_LEN } = require("../config");
const { isProcessedMessage, markMessageProcessed, cleanupProcessedMessages } = require("../db/queries");
const { DATABASE_URL } = require("../config");

let lastCleanupAt = 0;
const CLEANUP_EVERY_MS = 30 * 60 * 1000;

// ─── Configura aquí tu instructivo ───────────────────────────────────────────
const COURSE_LINK     = process.env.COURSE_LINK     || "https://www.tu-curso.com";
const COURSE_PASSWORD = process.env.COURSE_PASSWORD || "curso234";
// ─────────────────────────────────────────────────────────────────────────────

// ── GET /chatwoot/webhook  (healthcheck) ──
router.get("/webhook", (req, res) => res.status(200).send("OK"));

// ── POST /chatwoot/webhook  (entrada principal) ──
router.post("/webhook", async (req, res) => {
  // Responder inmediato para que Chatwoot no reintente
  res.status(200).json({ ok: true });

  try {
    const body = req.body;

    // Solo mensajes entrantes del usuario (no notas internas, no outgoing)
    if (body.event !== "message_created")  return;
    if (body.message_type !== "incoming")  return;
    if (body.private === true)             return;

    // ── Extraer wa_id (número del usuario) ──────────────────────────────────
    // Chatwoot lo envía en distintos lugares según su versión.
    // Probamos de más específico a más general.
    const rawPhone =
      body.meta?.sender?.phone_number ||
      body.conversation?.meta?.sender?.phone_number ||
      body.contact?.phone_number ||
      null;

    if (!rawPhone) {
      console.log("❌ No se pudo extraer teléfono del payload Chatwoot");
      console.log("📩 Payload:", JSON.stringify(body, null, 2));
      return;
    }

    // Quitar todo excepto dígitos (ej: "+57300..." → "57300...")
    const wa_id = rawPhone.replace(/\D/g, "");
    console.log(`📩 Mensaje entrante wa_id: ${wa_id}`);

    // ── Rate limiting ────────────────────────────────────────────────────────
    const rl = isRateLimited(wa_id);
    if (rl.limited) {
      if (rl.reason === "too_many") {
        await sendText(wa_id, "⚠️ Estás enviando muchos mensajes muy rápido. Intenta en unos minutos.");
      }
      return;
    }

    // ── Deduplicación ────────────────────────────────────────────────────────
    const messageId = body.id ? String(body.id) : null;
    if (messageId && DATABASE_URL) {
      if (await isProcessedMessage(messageId)) {
        console.log("⏭️ Duplicado ignorado:", messageId);
        return;
      }
      await markMessageProcessed(messageId);
      const now = Date.now();
      if (now - lastCleanupAt > CLEANUP_EVERY_MS) {
        lastCleanupAt = now;
        cleanupProcessedMessages().catch((e) => console.error("❌ Cleanup:", e));
      }
    }

    // ── Detectar si es botón interactivo de WhatsApp ─────────────────────────
    const buttonId = body.content_attributes?.items?.[0]?.reply?.id || null;

    if (buttonId) {
      console.log("🔘 Botón:", buttonId);
      return await handleButton(wa_id, buttonId);
    }

    // ── Texto libre ──────────────────────────────────────────────────────────
    const rawText = (body.content || "").trim();

    if (!rawText) return; // vacío, ignorar

    if (rawText.length > TEXT_MAX_LEN) {
      await sendText(wa_id, `⚠️ El mensaje es muy largo. Máximo ${TEXT_MAX_LEN} caracteres.`);
      return;
    }

    const t = rawText.toLowerCase();

    // Palabras clave reconocidas → respuesta automática
    if (["hola", "buenas", "buenos días", "buen día", "buenas tardes", "buenas noches", "inicio", "menu", "menú", "start", "hi", "hello"].includes(t)) {
      return await sendMainMenu(wa_id);
    }

    if (["instructivo", "link", "enlace", "curso", "acceso", "contraseña"].some(k => t.includes(k))) {
      return await sendCourseInfo(wa_id);
    }

    // No reconoce el mensaje → dejar abierto para asesor humano en Chatwoot
    console.log(`🤷 Mensaje no reconocido de ${wa_id}: "${rawText}" — dejando para asesor`);
    await sendText(
      wa_id,
      "👋 Gracias por escribirnos.\n\nEn un momento un asesor revisará tu mensaje y te responderá.\n\nSi necesitas el instructivo del curso, escribe *instructivo*."
    );
    // La conversación queda abierta en Chatwoot para atención humana

  } catch (error) {
    console.error("❌ Error en /chatwoot/webhook:", error);
  }
});

// ─────────────────────────────────────────────
// Manejo de botones
// ─────────────────────────────────────────────
async function handleButton(wa_id, buttonId) {
  if (buttonId === "ver_instructivo") return await sendCourseInfo(wa_id);
  if (buttonId === "hablar_asesor") {
    await sendText(
      wa_id,
      "👤 *Atención personalizada*\n\nUn asesor revisará tu mensaje y te contactará pronto.\n\nTambién puedes llamarnos al:\n📱 *313 401 0901*"
    );
    // Conversación queda abierta en Chatwoot
    return;
  }
  // Botón no reconocido → menú
  return await sendMainMenu(wa_id);
}

// ─────────────────────────────────────────────
// Menú principal
// ─────────────────────────────────────────────
async function sendMainMenu(to) {
  return await sendPayload({
    messaging_product: "whatsapp",
    to,
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
          { type: "reply", reply: { id: "ver_instructivo", title: "📄 Instructivo y link" } },
          { type: "reply", reply: { id: "hablar_asesor",   title: "💬 Hablar con asesor"  } },
        ],
      },
    },
  });
}

// ─────────────────────────────────────────────
// Instructivo y link del curso
// ─────────────────────────────────────────────
async function sendCourseInfo(to) {
  const msg =
    "🎓 *Curso de Manipulación de Alimentos*\n\n" +
    "Aquí tienes el acceso para iniciar tu capacitación:\n\n" +
    `1️⃣ Ingresa al enlace:\n${COURSE_LINK}\n\n` +
    "2️⃣ Usuario: tu correo electrónico\n" +
    `🔐 Contraseña: ${COURSE_PASSWORD}\n\n` +
    "3️⃣ Haz clic en *INICIAR*.\n\n" +
    "4️⃣ Selecciona *Iniciar lección* y completa toda la capacitación.\n\n" +
    "5️⃣ Al finalizar podrás descargar tu *certificado* y demás documentos.\n\n" +
    "Si tienes alguna dificultad, escríbenos y te ayudamos. 🙌";

  await sendText(to, msg);
}

module.exports = router;
 
