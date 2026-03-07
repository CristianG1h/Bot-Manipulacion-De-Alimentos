"use strict";

const express = require("express");
const {
  TOKEN,
  DATABASE_URL,
  VERIFY_TOKEN,
  TEXT_MAX_LEN,
  CLEANUP_EVERY_MS,
} = require("../config");

const { isRateLimited } = require("../utils/rateLimit");
const { isValidEmail, normalizeCOCell } = require("../utils/validation");
const { sendText, sendMainMenu, sendPayload } = require("../services/whatsapp");
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

const router = express.Router();

let lastCleanupAt = 0;

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

// Helpers UI
async function resendStepPrompt(wa_id, step) {
  if (step === "FULL_NAME") return sendText(wa_id, "📝 Escribe tu *Nombre y Apellido completo*.");
  if (step === "CEDULA") return sendText(wa_id, "Escribe tu *número de cédula* (solo números).");
  if (step === "CELULAR") return sendText(wa_id, "Escribe tu *celular* (10 dígitos, ej: 3001234567).");
  if (step === "CORREO") return sendText(wa_id, "Escribe tu *correo electrónico*.");
  if (step === "CONFIRM") return sendConfirmPrompt(wa_id);
  return startRegistration(wa_id);
}

async function sendConfirmPrompt(to) {
  const session = await getSession(to);
  if (!session) return sendText(to, "Se reinició el proceso. Por favor presiona *📋 Registrarme* nuevamente.");

  const summary =
    "✅ *Confirma tus datos*\n\n" +
    `👤 Nombre: *${session.temp_full_name || "-"}*\n` +
    `🪪 Cédula: *${session.temp_cedula || "-"}*\n` +
    `📱 Celular: *${session.temp_celular || "-"}*\n` +
    `📧 Correo: *${session.temp_correo || "-"}*\n\n` +
    "Si todo está correcto, presiona *✅ Confirmar*.\n" +
    "Si necesitas cambiar algo, presiona *✏️ Corregir*.";

  return sendPayload({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: summary },
      action: {
        buttons: [
          { type: "reply", reply: { id: "confirm_reg", title: "✅ Confirmar" } },
          { type: "reply", reply: { id: "edit_reg", title: "✏️ Corregir" } },
        ],
      },
    },
  });
}

async function sendEditMenu(to) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "✏️ *¿Qué dato deseas corregir?*\n\nSelecciona una opción:" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "edit_name", title: "👤 Nombre" } },
          { type: "reply", reply: { id: "edit_cedula", title: "🪪 Cédula" } },
          { type: "reply", reply: { id: "edit_cell", title: "📱 Celular" } },
        ],
      },
    },
  };

  await sendPayload(payload);

  // 2do mensaje para email + back (por límite típico de botones)
  return sendPayload({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Opciones adicionales:" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "edit_email", title: "📧 Correo" } },
          { type: "reply", reply: { id: "back_menu", title: "⬅️ Volver al menú" } },
        ],
      },
    },
  });
}

async function startRegistration(wa_id) {
  if (!DATABASE_URL) {
    await sendText(wa_id, "⚠️ En este momento el sistema de registro está en mantenimiento. Escríbenos y te ayudamos.");
    return;
  }
  await upsertSessionReset(wa_id);
  return sendText(wa_id, "📝 *Registro – Curso de Manipulación de Alimentos*\n\nPor favor escribe tu *Nombre y Apellido completo*.");
}

async function handleRegistrationStep(wa_id, step, text) {
  if (!DATABASE_URL) return;

  if (step === "FULL_NAME") {
    if ((text || "").length < 5) return sendText(wa_id, "Por favor escribe tu *nombre completo* (Nombre y Apellido).");
    await updateSession(wa_id, { temp_full_name: text, step: "CEDULA" });
    return sendText(wa_id, "Perfecto ✅ Ahora escribe tu *número de cédula* (solo números).");
  }

  if (step === "CEDULA") {
    const ced = (text || "").replace(/\D/g, "");
    if (ced.length < 5) return sendText(wa_id, "La cédula debe tener solo números. Escríbela nuevamente, por favor.");

    if (await cedulaExistsForOtherWa(ced, wa_id)) {
      await deleteSession(wa_id);
      return sendText(wa_id, "⚠️ Esta cédula ya aparece registrada en nuestro sistema.\n\nSi necesitas actualizar tus datos, escribe *Ayuda*.");
    }

    await updateSession(wa_id, { temp_cedula: ced, step: "CELULAR" });
    return sendText(wa_id, "Gracias ✅ Ahora escribe tu *número de celular* (ej: 3001234567).");
  }

  if (step === "CELULAR") {
    const norm = normalizeCOCell(text);
    if (!norm) return sendText(wa_id, "Celular inválido. Debe ser móvil colombiano (10 dígitos y empezar por 3). Ej: 3001234567");
    await updateSession(wa_id, { temp_celular: norm.e164, step: "CORREO" });
    return sendText(wa_id, "Excelente ✅ Por último, escribe tu *correo electrónico*.");
  }

  if (step === "CORREO") {
    const correo = (text || "").trim().toLowerCase();
    if (!isValidEmail(correo)) return sendText(wa_id, "Ese correo no parece válido. Escríbelo nuevamente, por favor.");
    await updateSession(wa_id, { temp_correo: correo, step: "CONFIRM" });
    return sendConfirmPrompt(wa_id);
  }

  if (step === "CONFIRM") {
    return sendText(wa_id, "Por favor confirma tu registro usando los botones:\n✅ Confirmar o ✏️ Corregir\n\nTambién puedes escribir: *corregir*");
  }

  await deleteSession(wa_id);
  return sendText(wa_id, "Se reinició el proceso. Por favor presiona *📋 Registrarme* nuevamente.");
}

async function finalizeRegistration(wa_id) {
  const session = await getSession(wa_id);
  if (!session) return sendText(wa_id, "Se reinició el proceso. Por favor presiona *📋 Registrarme* nuevamente.");

  if (!session.temp_full_name || !session.temp_cedula || !session.temp_celular || !session.temp_correo) {
    return sendText(wa_id, "⚠️ Faltan datos por completar. Escribe *corregir* o presiona *📋 Registrarme*.");
  }

  if (await cedulaExistsForOtherWa(session.temp_cedula, wa_id)) {
    await deleteSession(wa_id);
    return sendText(wa_id, "⚠️ Esta cédula ya aparece registrada en nuestro sistema.\n\nSi necesitas actualizar tus datos, escribe *Ayuda*.");
  }

  await upsertRegistration(wa_id, session.temp_full_name, session.temp_cedula, session.temp_celular, session.temp_correo);
  await deleteSession(wa_id);

  await sendText(wa_id, "✅ *Registro completado*\n\n¡Gracias! Tu información quedó registrada correctamente.\n\nAhora puedes ver el instructivo y el enlace del curso en el botón:\n🔗 *Instructivo y link*");
  return sendMainMenu(wa_id);
}

async function sendCourseInfo(to) {
  const link = "FABIAN ESTEBAN JOYA CARRERO"; // CAMBIA por tu link real
  const password = "Hola123";

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

  return sendText(to, msg);
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
        if (TOKEN && rl.reason === "too_many") await sendText(from, "⚠️ Estás enviando muchos mensajes muy rápido. Intenta de nuevo en unos minutos.");
        return;
      }

      // Dedup
      const messageId = msg.id;
      if (messageId && DATABASE_URL) {
        const already = await isProcessedMessage(messageId);
        if (already) return;

        await markMessageProcessed(messageId);

        const now = Date.now();
        if (now - lastCleanupAt > CLEANUP_EVERY_MS) {
          lastCleanupAt = now;
          cleanupProcessedMessages().catch((e) => console.error("❌ Cleanup error:", e));
        }
      }

      await touchSessionInbound(from);

      // Botón
      const buttonId = msg?.interactive?.button_reply?.id;
      if (buttonId) {
        if (buttonId === "registrarme") return startRegistration(from);
        if (buttonId === "enlace") return sendCourseInfo(from);
        if (buttonId === "asesor") {
          return sendText(from,
            "📞 *Atención personalizada*\n\n" +
            "Este canal funciona únicamente con sistema automático.\n\n" +
            "Para hablar con un asesor, comunícate directamente al:\n\n" +
            "📱 *313 401 0901*\n\n" +
            "Con gusto te ayudaremos."
          );
        }

        if (buttonId === "continue_reg") {
          const session = await getSession(from);
          if (!session) return startRegistration(from);
          return resendStepPrompt(from, session.step);
        }

        if (buttonId === "cancel_reg") {
          await deleteSession(from);
          await sendText(from, "✅ Listo. Cancelamos el registro. Si deseas empezar de nuevo presiona *📋 Registrarme*.");
          return sendMainMenu(from);
        }

        if (buttonId === "confirm_reg") return finalizeRegistration(from);
        if (buttonId === "edit_reg") return sendEditMenu(from);

        if (buttonId === "edit_name") { await updateSession(from, { step: "FULL_NAME" }); return sendText(from, "✏️ Escribe nuevamente tu *Nombre y Apellido completo*."); }
        if (buttonId === "edit_cedula") { await updateSession(from, { step: "CEDULA" }); return sendText(from, "✏️ Escribe nuevamente tu *número de cédula* (solo números)."); }
        if (buttonId === "edit_cell") { await updateSession(from, { step: "CELULAR" }); return sendText(from, "✏️ Escribe nuevamente tu *celular* (10 dígitos, ej: 3001234567)."); }
        if (buttonId === "edit_email") { await updateSession(from, { step: "CORREO" }); return sendText(from, "✏️ Escribe nuevamente tu *correo electrónico*."); }
        if (buttonId === "back_menu") return sendMainMenu(from);

        return sendMainMenu(from);
      }

      // Texto
      const text = (msg.text?.body || "").trim();
      if (text && text.length > TEXT_MAX_LEN) return sendText(from, `⚠️ El mensaje es muy largo. Envíalo en menos de ${TEXT_MAX_LEN} caracteres.`);

      const t = text.toLowerCase();
      if (t === "menu" || t === "menú") return sendMainMenu(from);
      if (t === "registrarme" || t === "registro") return startRegistration(from);
      if (t === "enlace" || t === "link") return sendCourseInfo(from);

      if (t === "ayuda" || t === "asesor") return sendText(from, "📞 *Atención personalizada*\n\nPara hablar con un asesor, comunícate directamente al:\n\n📱 *313 401 0901*");

      if (t === "cancelar" || t === "cancel") {
        await deleteSession(from);
        await sendText(from, "✅ Proceso cancelado. Si deseas iniciar de nuevo presiona *📋 Registrarme*.");
        return sendMainMenu(from);
      }

      if (t === "corregir" || t === "editar" || t === "me equivoqué" || t === "me equivoque") {
        const session = await getSession(from);
        if (!session) return sendText(from, "No veo un registro en curso. Presiona *📋 Registrarme* para iniciar.");
        return sendEditMenu(from);
      }

      const session = await getSession(from);
      if (session) return handleRegistrationStep(from, session.step, text);

      return sendMainMenu(from);
    } catch (e) {
      console.error("❌ Error procesando webhook:", e);
    }
  })();
});


module.exports = router;
