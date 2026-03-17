"use strict";
 
/**
 * src/routes/chatwoot.js — v3
 *
 * Mejoras:
 *  - Detección de botones más robusta (por id Y por texto del title)
 *  - Modo asesor: bot se silencia cuando el usuario pide ayuda humana
 *  - Timeout 5 min: si no hay respuesta humana, el bot retoma con aviso
 */
 
const express = require("express");
const router = express.Router();
 
const { sendPayload, sendText } = require("../services/whatsapp");
const { isRateLimited } = require("../utils/rateLimit");
const { TEXT_MAX_LEN, DATABASE_URL } = require("../config");
const {
  isProcessedMessage,
  markMessageProcessed,
  cleanupProcessedMessages,
} = require("../db/queries");
 
let lastCleanupAt = 0;
const CLEANUP_EVERY_MS = 30 * 60 * 1000;
 
// ─── Config del curso ─────────────────────────────────────────────────────────
const COURSE_LINK     = process.env.COURSE_LINK     || "https://vip-alimentos-703743967183.us-central1.run.app/login";
const COURSE_PASSWORD = process.env.COURSE_PASSWORD || "CEDULA";
 
// ─── Modo asesor ──────────────────────────────────────────────────────────────
// Guarda en memoria los wa_id que están esperando asesor humano
// { wa_id: { since: timestamp, timer: TimeoutHandle } }
const advisorMode = new Map();
 
const ADVISOR_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos
 
function setAdvisorMode(wa_id) {
  // Si ya tenía un timer anterior, limpiarlo
  clearAdvisorMode(wa_id, false);
 
  const timer = setTimeout(async () => {
    advisorMode.delete(wa_id);
    console.log(`⏰ Timeout asesor expirado para ${wa_id} — bot retoma`);
    await sendText(
      wa_id,
      "⏱️ Han pasado 5 minutos sin respuesta de nuestro equipo.\n\n" +
      "Si aún necesitas ayuda puedes:\n\n" +
      "📱 Llamarnos al *313 401 0901*\n" +
      "📄 O escribir *instructivo* para recibir el link del curso.\n\n" +
      "Seguimos a tu disposición. 🙌"
    );
  }, ADVISOR_TIMEOUT_MS);
 
  advisorMode.set(wa_id, { since: Date.now(), timer });
  console.log(`👤 Modo asesor activado para ${wa_id}`);
}
 
function clearAdvisorMode(wa_id, log = true) {
  const entry = advisorMode.get(wa_id);
  if (entry) {
    clearTimeout(entry.timer);
    advisorMode.delete(wa_id);
    if (log) console.log(`✅ Modo asesor desactivado para ${wa_id}`);
  }
}
 
function isInAdvisorMode(wa_id) {
  return advisorMode.has(wa_id);
}
 
// ─── Helpers de detección de botón ───────────────────────────────────────────
// Chatwoot puede enviar el botón de varias formas según su versión:
//   1. content_attributes.items[0].reply.id  (formato rico)
//   2. content con el texto del title del botón
function extractButtonId(body) {
  // Forma 1: estructura rica
  const id = body.content_attributes?.items?.[0]?.reply?.id;
  if (id) return id;
 
  // Forma 2: el texto coincide con el title de algún botón conocido
  const text = (body.content || "").trim().toLowerCase();
  if (text === "📄 instructivo y link" || text === "instructivo y link") return "ver_instructivo";
  if (text === "❓ hablar con asesor" || text === "hablar con asesor")   return "hablar_asesor";
 
  return null;
}
 
// ─────────────────────────────────────────────────────────────────────────────
// GET /chatwoot/webhook (healthcheck)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/webhook", (req, res) => res.status(200).send("OK"));
 
// ─────────────────────────────────────────────────────────────────────────────
// POST /chatwoot/webhook (entrada principal)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/webhook", async (req, res) => {
  res.status(200).json({ ok: true });
 
  try {
    const body = req.body;
 
    // ── Filtros básicos ──────────────────────────────────────────────────────
    if (body.event !== "message_created") return;
    if (body.message_type !== "incoming") return;
    if (body.private === true)            return;
 
    // ── Extraer wa_id ────────────────────────────────────────────────────────
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
 
    const wa_id = rawPhone.replace(/\D/g, "");
    console.log(`📩 Mensaje de ${wa_id}`);
 
    // ── Rate limiting ────────────────────────────────────────────────────────
    const rl = isRateLimited(wa_id);
    if (rl.limited) {
      if (rl.reason === "too_many") {
        await sendText(wa_id, "⚠️ Demasiados mensajes seguidos. Intenta en unos minutos.");
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
 
    // ── Detectar botón ───────────────────────────────────────────────────────
    const buttonId = extractButtonId(body);
    if (buttonId) {
      console.log("🔘 Botón detectado:", buttonId);
      // Los botones siempre los procesa el bot, incluso en modo asesor
      // (el usuario eligió explícitamente una opción del menú)
      clearAdvisorMode(wa_id); // si estaba con asesor, sale del modo
      return await handleButton(wa_id, buttonId);
    }
 
    // ── Si está en modo asesor → silenciar bot ───────────────────────────────
    if (isInAdvisorMode(wa_id)) {
      console.log(`🤐 ${wa_id} en modo asesor — bot silenciado`);
      // Solo reiniciamos el timer para que los 5 min cuenten desde el último mensaje
      setAdvisorMode(wa_id);
      return;
    }
 
    // ── Texto libre ──────────────────────────────────────────────────────────
    const rawText = (body.content || "").trim();
    if (!rawText) return;
 
    if (rawText.length > TEXT_MAX_LEN) {
      await sendText(wa_id, `⚠️ Mensaje muy largo. Máximo ${TEXT_MAX_LEN} caracteres.`);
      return;
    }
 
    const t = rawText.toLowerCase();
 
    // Saludos → menú
    const saludos = ["hola", "buenas", "buenos días", "buen día", "buenas tardes", "buenas noches",
                     "inicio", "menu", "menú", "start", "hi", "hello", "👋"];
    if (saludos.includes(t)) {
      return await sendMainMenu(wa_id);
    }
 
    // Palabras clave de curso → instructivo directo
    const cursoKw = ["instructivo", "link", "enlace", "curso", "acceso", "contraseña", "clave"];
    if (cursoKw.some(k => t.includes(k))) {
      return await sendCourseInfo(wa_id);
    }
 
    // Cualquier otra cosa → aviso de asesor + modo silencio
    console.log(`🤷 Mensaje no reconocido de ${wa_id}: "${rawText}"`);
    setAdvisorMode(wa_id);
    await sendText(
      wa_id,
      "👋 Gracias por escribirnos.\n\n" +
      "Un asesor revisará tu mensaje y te responderá en breve. 🙌\n\n" +
      "Si deseas atención más rápida, comunícate directamente al:\n" +
      "📱 *313 401 0901*"
    );
 
  } catch (error) {
    console.error("❌ Error en /chatwoot/webhook:", error);
  }
});
 
// ─────────────────────────────────────────────────────────────────────────────
// Manejo de botones
// ─────────────────────────────────────────────────────────────────────────────
async function handleButton(wa_id, buttonId) {
  if (buttonId === "ver_instructivo") {
    return await sendCourseInfo(wa_id);
  }
 
  if (buttonId === "hablar_asesor") {
    setAdvisorMode(wa_id);
    await sendText(
      wa_id,
      "👤 *Atención personalizada*\n\n" +
      "¡Listo! Un asesor se unirá a la conversación en breve. 🙌\n\n" +
      "Si deseas atención más rápida, escríbenos al:\n" +
      "📱 *313 401 0901*\n\n" +
      "_Si no recibes respuesta en 5 minutos, el asistente automático retomará la conversación._"
    );
    return;
  }
 
  // Botón no reconocido → menú
  return await sendMainMenu(wa_id);
}
 
// ─────────────────────────────────────────────────────────────────────────────
// Menú principal
// ─────────────────────────────────────────────────────────────────────────────
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
          { type: "reply", reply: { id: "hablar_asesor",   title: "❓ Hablar con asesor"  } },
        ],
      },
    },
  });
}
 
// ─────────────────────────────────────────────────────────────────────────────
// Instructivo y link del curso
// ─────────────────────────────────────────────────────────────────────────────
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
