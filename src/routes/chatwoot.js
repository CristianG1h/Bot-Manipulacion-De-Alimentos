"use strict";

const express = require("express");
const router = express.Router();

const { sendPayload, sendText } = require("../services/whatsapp");
const { isRateLimited } = require("../utils/rateLimit");
const { TEXT_MAX_LEN, COURSE_LINK, COURSE_PASSWORD } = require("../config");
const redis = require("../services/redis");

// ─── Protección webhook ───────────────────────────────────────────────────────
const WEBHOOK_TOKEN = process.env.CHATWOOT_WEBHOOK_TOKEN;

// ─── Deduplicación en memoria ─────────────────────────────────────────────────
const processedIds = new Set();
setInterval(() => processedIds.clear(), 24 * 60 * 60 * 1000);

// ─── Modo asesor (Redis) ──────────────────────────────────────────────────────
const ADVISOR_TTL = 5 * 60; // 5 minutos en segundos
const advisorKey  = (wa_id) => `advisor:${wa_id}`;

async function isAdvisorMode(wa_id) {
  try {
    const val = await redis.get(advisorKey(wa_id));
    return val === "1";
  } catch (e) {
    console.error("❌ Redis error:", e.message);
    return false;
  }
}

async function setAdvisorMode(wa_id) {
  try {
    await redis.set(advisorKey(wa_id), "1", { ex: ADVISOR_TTL });
    console.log(`👤 Modo asesor activado para ${wa_id}`);
  } catch (e) {
    console.error("❌ Redis error en setAdvisorMode:", e.message);
  }
}

async function clearAdvisorMode(wa_id) {
  try {
    await redis.del(advisorKey(wa_id));
    console.log(`✅ Modo asesor desactivado para ${wa_id}`);
  } catch (e) {
    console.error("❌ Redis error en clearAdvisorMode:", e.message);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function extractButtonId(body) {
  const id = body.content_attributes?.items?.[0]?.reply?.id;
  if (id) return id;

  const text = (body.content || "").trim().toLowerCase();
  if (text === "📄 instructivo y link" || text === "instructivo y link") return "ver_instructivo";
  if (text === "💬 hablar con asesor"  || text === "hablar con asesor")  return "hablar_asesor";

  return null;
}

// ─── Rutas ────────────────────────────────────────────────────────────────────
router.get("/webhook", (req, res) => res.status(200).send("OK"));

router.post("/webhook", async (req, res) => {

  // Verificación del token
  if (WEBHOOK_TOKEN && req.query.token !== WEBHOOK_TOKEN) {
    console.warn("⚠️ Webhook rechazado — token inválido o ausente");
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  res.status(200).json({ ok: true });

  try {
    const body = req.body;

    if (body.event !== "message_created") return;
    if (body.message_type !== "incoming") return;
    if (body.private === true)            return;

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

    // Rate limiting
    const rl = await isRateLimited(wa_id);
    if (rl.limited) {
      if (rl.reason === "too_many") {
        await sendText(wa_id, "⚠️ Demasiados mensajes seguidos. Intenta en unos minutos.");
      }
      return;
    }

    // Deduplicación
    const messageId = body.id ? String(body.id) : null;
    if (messageId) {
      if (processedIds.has(messageId)) {
        console.log("⏭️ Duplicado ignorado:", messageId);
        return;
      }
      processedIds.add(messageId);
    }

    // Botones
    const buttonId = extractButtonId(body);
    if (buttonId) {
      console.log("🔘 Botón:", buttonId);
      await clearAdvisorMode(wa_id);
      return await handleButton(wa_id, buttonId);
    }

    // Modo asesor
    if (await isAdvisorMode(wa_id)) {
      console.log(`🤐 ${wa_id} en modo asesor — bot silenciado`);
      // Renueva el TTL cada vez que el usuario escribe
      await setAdvisorMode(wa_id);
      return;
    }

    // Texto vacío
    const rawText = (body.content || "").trim();
    if (!rawText) return;

    // Texto muy largo
    if (rawText.length > TEXT_MAX_LEN) {
      await sendText(wa_id, `⚠️ Mensaje muy largo. Máximo ${TEXT_MAX_LEN} caracteres.`);
      return;
    }

    const t = rawText.toLowerCase();

    // Saludos → menú principal
    const saludos = ["hola", "buenas", "buenos días", "buen día", "buenas tardes",
                     "buenas noches", "inicio", "menu", "menú", "start", "hi", "hello", "👋"];
    if (saludos.includes(t)) return await sendMainMenu(wa_id);

    // Palabras clave del curso
    const cursoKw = ["instructivo", "link", "enlace", "curso", "acceso", "contraseña", "clave"];
    if (cursoKw.some(k => t.includes(k))) return await sendCourseInfo(wa_id);

    // Mensaje no reconocido → asesor
    console.log(`🤷 Mensaje no reconocido de ${wa_id}: "${rawText}"`);
    await setAdvisorMode(wa_id);
    await sendText(
      wa_id,
      "👋 Gracias por escribirnos.\n\n" +
      "Un asesor revisará tu mensaje y te responderá en breve. 🙌\n\n" +
      "Si deseas atención más rápida, comunícate al:\n" +
      "📱 *313 401 0901*"
    );

  } catch (error) {
    console.error("❌ Error en /chatwoot/webhook:", error);
  }
});

// ─── Handlers ─────────────────────────────────────────────────────────────────
async function handleButton(wa_id, buttonId) {
  if (buttonId === "ver_instructivo") return await sendCourseInfo(wa_id);

  if (buttonId === "hablar_asesor") {
    await setAdvisorMode(wa_id);
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

  return await sendMainMenu(wa_id);
}

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

async function sendCourseInfo(to) {
  const msg =
    "🎓 *Curso de Manipulación de Alimentos*\n\n" +
    "Aquí tienes el acceso para iniciar tu capacitación:\n\n" +
    `1️⃣ Ingresa al enlace:\n${COURSE_LINK}\n\n` +
    "2️⃣ Usuario: CEDULA\n" +
    `🔐 Contraseña: ${COURSE_PASSWORD}\n\n` +
    "3️⃣ Haz clic en *INICIAR*.\n\n" +
    "4️⃣ Selecciona *Iniciar lección* y completa toda la capacitación.\n\n" +
    "5️⃣ Al finalizar podrás descargar tu *certificado* y demás documentos.\n\n" +
    "Si tienes alguna dificultad, escríbenos y te ayudamos. 🙌";

  await sendText(to, msg);
}

module.exports = router;
