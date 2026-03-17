"use strict";
 
/**
 * src/routes/chatwoot.js — VERSIÓN CORREGIDA
 *
 * Flujo:
 *   Chatwoot (webhook) → este archivo extrae wa_id + texto/botón
 *   → ejecuta la lógica completa del bot
 *   → responde DIRECTO a la API de Meta (Graph API)
 *
 * Chatwoot es solo el puente de entrada. Las respuestas van
 * directo a WhatsApp vía WHATSAPP_TOKEN, igual que antes.
 */
 
const express = require("express");
const router = express.Router();
 
const { sendPayload, sendText, sendMainMenu } = require("../services/whatsapp");
const { isRateLimited } = require("../utils/rateLimit");
const { isValidEmail, normalizeCOCell } = require("../utils/validation");
const { TEXT_MAX_LEN, DATABASE_URL } = require("../config");
 
const {
  getSession,
  touchSessionInbound,
  upsertSessionReset,
  updateSession,
  deleteSession,
  upsertRegistration,
  cedulaExistsForOtherWa,
  isProcessedMessage,
  markMessageProcessed,
  cleanupProcessedMessages,
} = require("../db/queries");
 
const { dbQuery } = require("../db");
 
let lastCleanupAt = 0;
const CLEANUP_EVERY_MS = 30 * 60 * 1000;
 
// ─────────────────────────────────────────────
// GET  /chatwoot/webhook  (healthcheck)
// ─────────────────────────────────────────────
router.get("/webhook", (req, res) => {
  res.status(200).send("OK CHATWOOT WEBHOOK");
});
 
// ─────────────────────────────────────────────
// POST /chatwoot/webhook  (entrada principal)
// ─────────────────────────────────────────────
router.post("/webhook", async (req, res) => {
  // Responder inmediato a Chatwoot para que no reintente
  res.status(200).json({ ok: true });
 
  try {
    const body = req.body;
 
    // ── Solo procesar mensajes entrantes del usuario ──
    if (body.event !== "message_created") return;
    if (body.message_type !== "incoming") return;
    if (body.private === true) return;
 
    // ── Extraer el número de teléfono del usuario (wa_id) ──
    // Chatwoot lo manda en diferentes lugares según la versión
    const wa_id =
      body.meta?.sender?.phone_number?.replace(/\D/g, "") ||   // ej: "+573001234567" → "573001234567"
      body.conversation?.meta?.sender?.phone_number?.replace(/\D/g, "") ||
      body.contact?.phone_number?.replace(/\D/g, "") ||
      null;
 
    if (!wa_id) {
      console.log("❌ No se pudo extraer wa_id del payload de Chatwoot");
      console.log("📩 Payload recibido:", JSON.stringify(body, null, 2));
      return;
    }
 
    console.log(`📩 Mensaje entrante de wa_id: ${wa_id}`);
 
    // ── Rate limiting ──
    const rl = isRateLimited(wa_id);
    if (rl.limited) {
      if (rl.reason === "too_many") {
        await sendText(wa_id, "⚠️ Estás enviando muchos mensajes muy rápido. Intenta de nuevo en unos minutos.");
      }
      return;
    }
 
    // ── Deduplicación por message_id ──
    const messageId = body.id ? String(body.id) : null;
    if (messageId && DATABASE_URL) {
      const already = await isProcessedMessage(messageId);
      if (already) {
        console.log("⏭️ Mensaje duplicado ignorado:", messageId);
        return;
      }
      await markMessageProcessed(messageId);
 
      const now = Date.now();
      if (now - lastCleanupAt > CLEANUP_EVERY_MS) {
        lastCleanupAt = now;
        cleanupProcessedMessages().catch((e) => console.error("❌ Cleanup error:", e));
      }
    }
 
    // ── Actualizar last_inbound_at si tiene sesión activa ──
    await touchSessionInbound(wa_id);
 
    // ── Detectar si es botón interactivo ──
    // Chatwoot reenvía el contenido del mensaje en body.content
    // Los botones de WhatsApp llegan como texto con el title del botón
    // o a veces en body.content_attributes
    const buttonId = body.content_attributes?.items?.[0]?.reply?.id || null;
    const rawText = (body.content || "").trim();
 
    if (buttonId) {
      console.log("🔘 Botón recibido:", buttonId);
      return await handleButton(wa_id, buttonId);
    }
 
    // ── Validar longitud de texto ──
    if (rawText && rawText.length > TEXT_MAX_LEN) {
      await sendText(wa_id, `⚠️ El mensaje es muy largo. Envíalo en menos de ${TEXT_MAX_LEN} caracteres.`);
      return;
    }
 
    // ── Comandos por texto ──
    const t = rawText.toLowerCase();
 
    if (!t) return; // mensaje vacío, ignorar
 
    if (t === "menu" || t === "menú")          return await sendMainMenu(wa_id);
    if (t === "registrarme" || t === "registro") return await startRegistration(wa_id);
    if (t === "enlace" || t === "link")        return await sendCourseInfo(wa_id);
    if (t === "cancelar" || t === "cancel") {
      await deleteSession(wa_id);
      await sendText(wa_id, "✅ Proceso cancelado. Si deseas iniciar de nuevo presiona *📋 Registrarme*.");
      return await sendMainMenu(wa_id);
    }
    if (t === "ayuda" || t === "asesor") {
      return await sendText(
        wa_id,
        "📞 *Atención personalizada*\n\nPara hablar con un asesor, comunícate directamente al:\n\n📱 *313 401 0901*"
      );
    }
    if (t === "corregir" || t === "editar" || t === "me equivoqué" || t === "me equivoque") {
      const session = await getSession(wa_id);
      if (!session) {
        await sendText(wa_id, "No veo un registro en curso. Presiona *📋 Registrarme* para iniciar.");
        return;
      }
      return await sendEditMenu(wa_id);
    }
 
    // ── Si está en un paso de registro ──
    const session = await getSession(wa_id);
    if (session) {
      return await handleRegistrationStep(wa_id, session.step, rawText);
    }
 
    // ── Por defecto: menú principal ──
    return await sendMainMenu(wa_id);
 
  } catch (error) {
    console.error("❌ ERROR en /chatwoot/webhook:", error);
  }
});
 
// ─────────────────────────────────────────────
// Manejo de botones interactivos
// ─────────────────────────────────────────────
async function handleButton(wa_id, buttonId) {
  if (buttonId === "registrarme")  return await startRegistration(wa_id);
  if (buttonId === "enlace")       return await sendCourseInfo(wa_id);
  if (buttonId === "asesor") {
    return await sendText(
      wa_id,
      "📞 *Atención personalizada*\n\nEste canal funciona únicamente con sistema automático.\n\n" +
      "Para hablar con un asesor, comunícate directamente al:\n\n📱 *313 401 0901*\n\nCon gusto te ayudaremos."
    );
  }
  if (buttonId === "continue_reg") {
    const session = await getSession(wa_id);
    if (!session) return await startRegistration(wa_id);
    return await resendStepPrompt(wa_id, session.step);
  }
  if (buttonId === "cancel_reg") {
    await deleteSession(wa_id);
    await sendText(wa_id, "✅ Listo. Cancelamos el registro. Si deseas empezar de nuevo presiona *📋 Registrarme*.");
    return await sendMainMenu(wa_id);
  }
  if (buttonId === "confirm_reg")  return await finalizeRegistration(wa_id);
  if (buttonId === "edit_reg")     return await sendEditMenu(wa_id);
  if (buttonId === "edit_name") {
    await updateSession(wa_id, { step: "FULL_NAME" });
    return await sendText(wa_id, "✏️ Escribe nuevamente tu *Nombre y Apellido completo*.");
  }
  if (buttonId === "edit_cedula") {
    await updateSession(wa_id, { step: "CEDULA" });
    return await sendText(wa_id, "✏️ Escribe nuevamente tu *número de cédula* (solo números).");
  }
  if (buttonId === "edit_cell") {
    await updateSession(wa_id, { step: "CELULAR" });
    return await sendText(wa_id, "✏️ Escribe nuevamente tu *celular* (10 dígitos, ej: 3001234567).");
  }
  if (buttonId === "edit_email") {
    await updateSession(wa_id, { step: "CORREO" });
    return await sendText(wa_id, "✏️ Escribe nuevamente tu *correo electrónico*.");
  }
  if (buttonId === "back_menu") return await sendMainMenu(wa_id);
 
  // Botón desconocido → menú
  return await sendMainMenu(wa_id);
}
 
// ─────────────────────────────────────────────
// Flujo de registro paso a paso
// ─────────────────────────────────────────────
async function startRegistration(wa_id) {
  if (!DATABASE_URL) {
    await sendText(wa_id, "⚠️ En este momento el sistema de registro está en mantenimiento. Escríbenos y te ayudamos.");
    return;
  }
  await upsertSessionReset(wa_id);
  await sendText(wa_id, "📝 *Registro – Curso de Manipulación de Alimentos*\n\nPor favor escribe tu *Nombre y Apellido completo*.");
}
 
async function resendStepPrompt(wa_id, step) {
  if (step === "FULL_NAME") return sendText(wa_id, "📝 Escribe tu *Nombre y Apellido completo*.");
  if (step === "CEDULA")    return sendText(wa_id, "Escribe tu *número de cédula* (solo números).");
  if (step === "CELULAR")   return sendText(wa_id, "Escribe tu *celular* (10 dígitos, ej: 3001234567).");
  if (step === "CORREO")    return sendText(wa_id, "Escribe tu *correo electrónico*.");
  if (step === "CONFIRM")   return sendConfirmPrompt(wa_id);
  return startRegistration(wa_id);
}
 
async function handleRegistrationStep(wa_id, step, text) {
  if (!DATABASE_URL) return;
 
  if (step === "FULL_NAME") {
    if ((text || "").length < 5) {
      return await sendText(wa_id, "Por favor escribe tu *nombre completo* (Nombre y Apellido).");
    }
    await updateSession(wa_id, { temp_full_name: text, step: "CEDULA" });
    return await sendText(wa_id, "Perfecto ✅ Ahora escribe tu *número de cédula* (solo números).");
  }
 
  if (step === "CEDULA") {
    const ced = (text || "").replace(/\D/g, "");
    if (ced.length < 5) {
      return await sendText(wa_id, "La cédula debe tener solo números. Escríbela nuevamente, por favor.");
    }
    const exists = await cedulaExistsForOtherWa(ced, wa_id);
    if (exists) {
      await deleteSession(wa_id);
      return await sendText(
        wa_id,
        "⚠️ Esta cédula ya aparece registrada en nuestro sistema.\n\nSi necesitas actualizar tus datos, escribe *Ayuda*."
      );
    }
    await updateSession(wa_id, { temp_cedula: ced, step: "CELULAR" });
    return await sendText(wa_id, "Gracias ✅ Ahora escribe tu *número de celular* (ej: 3001234567).");
  }
 
  if (step === "CELULAR") {
    const norm = normalizeCOCell(text);
    if (!norm) {
      return await sendText(
        wa_id,
        "Celular inválido. Debe ser móvil colombiano (10 dígitos y empezar por 3). Ej: 3001234567"
      );
    }
    await updateSession(wa_id, { temp_celular: norm.e164, step: "CORREO" });
    return await sendText(wa_id, "Excelente ✅ Por último, escribe tu *correo electrónico*.");
  }
 
  if (step === "CORREO") {
    const correo = (text || "").trim().toLowerCase();
    if (!isValidEmail(correo)) {
      return await sendText(wa_id, "Ese correo no parece válido. Escríbelo nuevamente, por favor.");
    }
    await updateSession(wa_id, { temp_correo: correo, step: "CONFIRM" });
    return await sendConfirmPrompt(wa_id);
  }
 
  if (step === "CONFIRM") {
    return await sendText(
      wa_id,
      "Por favor confirma tu registro usando los botones:\n✅ Confirmar o ✏️ Corregir\n\nTambién puedes escribir: *corregir*"
    );
  }
 
  await deleteSession(wa_id);
  return await sendText(wa_id, "Se reinició el proceso. Por favor presiona *📋 Registrarme* nuevamente.");
}
 
async function sendConfirmPrompt(to) {
  if (!DATABASE_URL) return;
  const session = await getSession(to);
  if (!session) {
    return await sendText(to, "Se reinició el proceso. Por favor presiona *📋 Registrarme* nuevamente.");
  }
 
  const summary =
    "✅ *Confirma tus datos*\n\n" +
    `👤 Nombre: *${session.temp_full_name || "-"}*\n` +
    `🪪 Cédula: *${session.temp_cedula || "-"}*\n` +
    `📱 Celular: *${session.temp_celular || "-"}*\n` +
    `📧 Correo: *${session.temp_correo || "-"}*\n\n` +
    "Si todo está correcto, presiona *✅ Confirmar*.\n" +
    "Si necesitas cambiar algo, presiona *✏️ Corregir*.";
 
  return await sendPayload({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: summary },
      action: {
        buttons: [
          { type: "reply", reply: { id: "confirm_reg", title: "✅ Confirmar" } },
          { type: "reply", reply: { id: "edit_reg",    title: "✏️ Corregir" } },
        ],
      },
    },
  });
}
 
async function sendEditMenu(to) {
  await sendPayload({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "✏️ *¿Qué dato deseas corregir?*\n\nSelecciona una opción:" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "edit_name",   title: "👤 Nombre" } },
          { type: "reply", reply: { id: "edit_cedula", title: "🪪 Cédula" } },
          { type: "reply", reply: { id: "edit_cell",   title: "📱 Celular" } },
        ],
      },
    },
  });
  // WhatsApp solo permite 3 botones por mensaje — segundo mensaje para las opciones restantes
  await sendPayload({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Otras opciones:" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "edit_email", title: "📧 Correo" } },
          { type: "reply", reply: { id: "back_menu",  title: "⬅️ Volver al menú" } },
        ],
      },
    },
  });
}
 
async function finalizeRegistration(wa_id) {
  if (!DATABASE_URL) return;
  const session = await getSession(wa_id);
  if (!session) {
    await sendText(wa_id, "Se reinició el proceso. Por favor presiona *📋 Registrarme* nuevamente.");
    return;
  }
  if (!session.temp_full_name || !session.temp_cedula || !session.temp_celular || !session.temp_correo) {
    await sendText(wa_id, "⚠️ Faltan datos por completar. Escribe *corregir* o presiona *📋 Registrarme*.");
    return;
  }
  const exists = await cedulaExistsForOtherWa(session.temp_cedula, wa_id);
  if (exists) {
    await deleteSession(wa_id);
    await sendText(
      wa_id,
      "⚠️ Esta cédula ya aparece registrada en nuestro sistema.\n\nSi necesitas actualizar tus datos, escribe *Ayuda*."
    );
    return;
  }
  await upsertRegistration(wa_id, session.temp_full_name, session.temp_cedula, session.temp_celular, session.temp_correo);
  await deleteSession(wa_id);
  await sendText(
    wa_id,
    "✅ *Registro completado*\n\n¡Gracias! Tu información quedó registrada correctamente.\n\n" +
    "Ahora puedes ver el instructivo y el enlace del curso en el botón:\n🔗 *Instructivo y link*"
  );
  return await sendMainMenu(wa_id);
}
 
async function sendCourseInfo(to) {
  const link     = "https://www.curso.com"; // ← tu link real
  const password = "curso234";              // ← si aplica
 
  const msg =
    "🎓 *Curso de Manipulación de Alimentos*\n\n" +
    "A continuación te compartimos el instructivo para iniciar tu capacitación:\n\n" +
    `1️⃣ Ingresa al siguiente enlace:\n${link}\n\n` +
    "2️⃣ Usuario: tu correo electrónico\n" +
    `🔐 Contraseña: ${password}\n\n` +
    "3️⃣ Una vez ingreses, haz clic en *INICIAR*.\n\n" +
    "4️⃣ Selecciona *Iniciar lección* y desarrolla toda la capacitación.\n\n" +
    "5️⃣ Al finalizar podrás descargar tu certificado, carnet y demás documentos.\n\n" +
    "Si presentas alguna dificultad durante el proceso, escríbenos y con gusto te ayudamos.\n" +
    "Quedamos atentos.";
 
  await sendText(to, msg);
}
 
module.exports = router;
 
