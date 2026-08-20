"use strict";

const express = require("express");
const router = express.Router();

const { sendPayload, sendText, sendDocumentBuffer } = require("../services/whatsapp");
const { isRateLimited } = require("../utils/rateLimit");
const { TEXT_MAX_LEN, COURSE_LINK, COURSE_PASSWORD } = require("../config");
const Stats = require("../services/stats");
const { buildManipulationCertificate } = require("../services/manipulacionCertificateService");
const { normalizeDigits, findByNit, findByName, buildCustodyCertificate } = require("../services/custodiaService");

const WEBHOOK_TOKEN = process.env.CHATWOOT_WEBHOOK_TOKEN;
const FLOW_TIMEOUT_MS = 30 * 60 * 1000;
const ADVISOR_TIMEOUT_MS = 5 * 60 * 1000;

const processedIds = new Set();
setInterval(() => processedIds.clear(), 24 * 60 * 60 * 1000).unref?.();

const advisorMode = new Map();
const userFlows = new Map();

function clearFlow(waId, log = true) {
  const state = userFlows.get(waId);
  if (state?.timer) clearTimeout(state.timer);
  userFlows.delete(waId);
  if (log && state) console.log(`🧹 Flujo ${state.type} cerrado para ${waId}`);
}

function scheduleFlowTimeout(waId, state) {
  if (state?.timer) clearTimeout(state.timer);
  const timer = setTimeout(async () => {
    const current = userFlows.get(waId);
    if (!current) return;
    userFlows.delete(waId);
    try {
      await sendText(waId, "⏱️ *El proceso se cerró por inactividad.*\n\nHan pasado más de 30 minutos sin respuesta. Por seguridad, iniciemos nuevamente.");
      await sendRootMenu(waId);
    } catch (error) {
      console.error("❌ Error enviando timeout de flujo:", error.message);
    }
  }, FLOW_TIMEOUT_MS);
  timer.unref?.();
  return timer;
}

function setFlow(waId, patch) {
  const previous = userFlows.get(waId) || {};
  const next = { ...previous, ...patch, updatedAt: Date.now() };
  next.timer = scheduleFlowTimeout(waId, next);
  userFlows.set(waId, next);
  return next;
}

function touchFlow(waId) {
  const current = userFlows.get(waId);
  if (!current) return null;
  return setFlow(waId, current);
}

function programarTimeoutAsesor(waId, humanResponded = false) {
  const previous = advisorMode.get(waId);
  if (previous?.timer) clearTimeout(previous.timer);

  const timer = setTimeout(async () => {
    const current = advisorMode.get(waId);
    advisorMode.delete(waId);
    if (!current?.humanResponded) {
      const result = await sendText(waId, "⏱️ Han pasado 5 minutos sin respuesta de nuestro equipo.\n\nSi aún necesitas ayuda puedes escribir *menu* para volver a las opciones principales o comunicarte al *313 401 0901*.");
      if (result) Stats.mensajeEnviado("mensaje", "Aviso de timeout del asesor enviado");
      else Stats.metaError("No se pudo enviar mensaje de timeout del asesor");
    }
  }, ADVISOR_TIMEOUT_MS);
  timer.unref?.();
  advisorMode.set(waId, { timer, humanResponded });
}

function setAdvisorMode(waId) {
  clearFlow(waId, false);
  programarTimeoutAsesor(waId, false);
}

function registrarActividadUsuarioModoAsesor(waId) {
  const state = advisorMode.get(waId);
  if (state) programarTimeoutAsesor(waId, state.humanResponded === true);
}

function registrarRespuestaAsesor(waId) {
  const state = advisorMode.get(waId);
  if (state) programarTimeoutAsesor(waId, true);
}

function clearAdvisorMode(waId, log = true) {
  const state = advisorMode.get(waId);
  if (state?.timer) clearTimeout(state.timer);
  advisorMode.delete(waId);
  if (log && state) console.log(`✅ Modo asesor desactivado para ${waId}`);
}

function extractButtonId(body) {
  const id = body?.content_attributes?.items?.[0]?.reply?.id;
  if (id) return id;
  const text = String(body.content || "").trim().toLowerCase();
  const mapping = new Map([
    ["🎓 manipulación", "menu_manipulacion"], ["manipulación", "menu_manipulacion"], ["manipulacion", "menu_manipulacion"],
    ["📄 custodia clínica", "menu_custodia"], ["custodia clínica", "menu_custodia"], ["custodia clinica", "menu_custodia"],
    ["📘 instructivo", "ver_instructivo"], ["📄 instructivo y link", "ver_instructivo"], ["instructivo y link", "ver_instructivo"],
    ["🎓 descargar cert.", "descargar_certificado"], ["descargar certificado", "descargar_certificado"],
    ["💬 hablar asesor", "hablar_asesor"], ["💬 hablar con asesor", "hablar_asesor"], ["hablar con asesor", "hablar_asesor"],
    ["✅ sí", "custodia_confirm_si"], ["si", "custodia_confirm_si"], ["sí", "custodia_confirm_si"],
    ["🔎 buscar nombre", "custodia_buscar_nombre"], ["🔄 otro nit", "custodia_otro_nit"], ["⬅️ salir", "cancelar_flujo"],
  ]);
  return mapping.get(text) || null;
}

function obtenerInboxIdDesdePayload(body) {
  return body.inbox?.id || body.inbox_id || body.conversation?.inbox_id || body.conversation?.inbox?.id || body.message?.inbox_id || body.message?.inbox?.id || body.conversation?.meta?.inbox?.id || body.conversation?.contact_inbox?.inbox_id || body.contact_inbox?.inbox_id || null;
}

async function crearNotaPrivadaChatwoot(conversationId, contenido) {
  try {
    if (!conversationId || !contenido) return;
    const baseUrl = String(process.env.CHATWOOT_BASE_URL || "").replace(/\/+$/, "");
    const accountId = process.env.CHATWOOT_ACCOUNT_ID;
    const apiToken = String(process.env.CHATWOOT_API_TOKEN || "").trim();
    if (!baseUrl || !accountId || !apiToken) return;
    const response = await fetch(`${baseUrl}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", api_access_token: apiToken, "api-access-token": apiToken },
      body: JSON.stringify({ content: `🤖 *Respuesta del bot:*\n\n${contenido}`, message_type: "outgoing", private: true }),
    });
    if (!response.ok) console.log("⚠️ No se pudo crear nota privada en Chatwoot:", response.status);
  } catch (error) {
    console.error("❌ Error creando nota privada:", error.message);
  }
}

function maskDocument(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `${digits.slice(0, 2)}***${digits.slice(-2)}`;
}

async function sendRootMenu(to, conversationId = null) {
  clearFlow(to, false);
  clearAdvisorMode(to, false);
  const menuText = "✨ *VIP Salud Ocupacional*\n\n¡Hola! 👋 Bienvenido(a).\n\n¿Qué proceso deseas realizar?";
  const result = await sendPayload({
    messaging_product: "whatsapp", to, type: "interactive",
    interactive: { type: "button", body: { text: menuText }, action: { buttons: [
      { type: "reply", reply: { id: "menu_manipulacion", title: "🎓 Manipulación" } },
      { type: "reply", reply: { id: "menu_custodia", title: "📄 Custodia clínica" } },
    ] } },
  });
  if (result) {
    Stats.menuEnviado(to);
    await crearNotaPrivadaChatwoot(conversationId, `${menuText}\n\nOpciones: Manipulación de alimentos / Custodia clínica`);
  } else Stats.metaError("No se pudo enviar el menú principal");
  return result;
}

async function sendCourseMenu(to, conversationId = null) {
  clearFlow(to, false);
  const menuText = "🎓 *Manipulación de Alimentos*\n\n¿En qué te podemos ayudar?";
  const result = await sendPayload({
    messaging_product: "whatsapp", to, type: "interactive",
    interactive: { type: "button", body: { text: menuText }, action: { buttons: [
      { type: "reply", reply: { id: "ver_instructivo", title: "📘 Instructivo" } },
      { type: "reply", reply: { id: "descargar_certificado", title: "🎓 Descargar cert." } },
      { type: "reply", reply: { id: "hablar_asesor", title: "💬 Hablar asesor" } },
    ] } },
  });
  if (result) {
    Stats.mensajeEnviado("menu_manipulacion", "Menú de Manipulación enviado");
    await crearNotaPrivadaChatwoot(conversationId, `${menuText}\n\nOpciones: Instructivo / Descargar certificado / Hablar con asesor`);
  }
  return result;
}

async function sendCourseInfo(to, conversationId = null) {
  const msg = "🎓 *Curso de Manipulación de Alimentos*\n\n" +
    `Aquí tienes el acceso para iniciar tu capacitación:\n\n1️⃣ Ingresa al enlace:\n${COURSE_LINK}\n\n` +
    `2️⃣ Usuario: CEDULA\n🔐 Contraseña: ${COURSE_PASSWORD}\n\n3️⃣ Haz clic en *INICIAR*.\n\n` +
    "4️⃣ Selecciona *Iniciar lección* y completa toda la capacitación.\n\n5️⃣ Al finalizar podrás descargar tu *certificado* y demás documentos.\n\nSi tienes alguna dificultad, escríbenos y te ayudamos. 🙌";
  const result = await sendText(to, msg);
  if (!result) { Stats.metaError("No se pudo enviar el instructivo del curso"); return null; }
  Stats.instructivoEnviado(to);
  await crearNotaPrivadaChatwoot(conversationId, "🎓 Información del curso enviada automáticamente. El enlace y las credenciales se enviaron directamente por WhatsApp.");
  return result;
}

async function sendRecibidoConfirmacion(to, conversationId = null) {
  const msg = "✨ *Perfecto, muchas gracias por confirmar* ✅\n\n🎓 Ya puedes iniciar tu curso de *Manipulación de Alimentos*.\n\n⏳ Te recomendamos realizarlo dentro de las próximas *24 horas* para que puedas avanzar sin demoras y descargar tu certificado a tiempo.\n\n🙌 Estamos pendientes para apoyarte.";
  const result = await sendText(to, msg);
  if (result) { Stats.recibidoEnviado(to); await crearNotaPrivadaChatwoot(conversationId, msg); }
  return result;
}

async function askManipulationDocument(to) {
  setFlow(to, { type: "manip_cert", step: "await_document", data: {} });
  return sendText(to, "📄 *Descargar certificado de Manipulación de Alimentos*\n\nPor favor escribe el número de cédula del estudiante.\n\nEjemplo: *1054538952*\n\nPuedes enviarlo con puntos, espacios o guiones; lo normalizaremos automáticamente.\n\nSi deseas cancelar, escribe *SALIR*.");
}

async function askCustodyNit(to) {
  setFlow(to, { type: "custodia", step: "await_nit", data: {} });
  return sendText(to, "📄 *Certificado de Custodia Clínica*\n\nPara identificar la empresa con precisión, escribe el *NIT sin dígito de verificación (DV)*.\n\nEjemplo: *900767372*\n\nPuedes enviarlo con puntos, espacios o guiones.\n\nSi deseas cancelar, escribe *SALIR*.");
}

async function sendCustodyConfirmation(to, company) {
  setFlow(to, { type: "custodia", step: "confirm_company", data: { company } });
  return sendPayload({ messaging_product: "whatsapp", to, type: "interactive", interactive: {
    type: "button",
    body: { text: `Encontré la siguiente empresa:\n\n🏢 *${company.nombre}*\nNIT: *${company.nit}-${company.dv || "?"}*\n\n¿Esta es tu empresa?` },
    action: { buttons: [
      { type: "reply", reply: { id: "custodia_confirm_si", title: "✅ Sí" } },
      { type: "reply", reply: { id: "custodia_buscar_nombre", title: "🔎 Buscar nombre" } },
      { type: "reply", reply: { id: "cancelar_flujo", title: "⬅️ Salir" } },
    ] },
  } });
}

async function sendCustodyNotFoundMenu(to) {
  setFlow(to, { type: "custodia", step: "nit_not_found", data: {} });
  return sendPayload({ messaging_product: "whatsapp", to, type: "interactive", interactive: {
    type: "button",
    body: { text: "❌ No encontré ese NIT dentro de los convenios registrados.\n\nPuedes intentar nuevamente o buscar la empresa por su razón social." },
    action: { buttons: [
      { type: "reply", reply: { id: "custodia_otro_nit", title: "🔄 Otro NIT" } },
      { type: "reply", reply: { id: "custodia_buscar_nombre", title: "🔎 Buscar nombre" } },
      { type: "reply", reply: { id: "cancelar_flujo", title: "⬅️ Salir" } },
    ] },
  } });
}

async function processManipulationDocument(waId, rawText, conversationId) {
  const documento = String(rawText || "").replace(/\D/g, "");
  if (documento.length < 5 || documento.length > 15) {
    touchFlow(waId);
    return sendText(waId, "⚠️ El número de cédula no parece válido.\n\nEnvíalo nuevamente; puedes usar puntos, espacios o guiones.\n\nEjemplo: *1054538952*");
  }
  try {
    const result = await buildManipulationCertificate(documento);
    if (!result.found) {
      touchFlow(waId);
      return sendText(waId, "❌ *No encontré el estudiante.*\n\nPor favor indícame nuevamente el número de cédula.\n\nSi deseas salir, escribe *SALIR*.");
    }
    const student = result.student;
    if (!result.available) {
      touchFlow(waId);
      return sendText(waId, `✅ Estudiante encontrado:\n👤 *${student.nombre}*\n🏢 Empresa: *${student.empresa || "No registrada"}*\n\n⚠️ Aún no aparece un certificado disponible para descargar. Verifica que el curso esté completado o intenta nuevamente más tarde.`);
    }
    await sendText(waId, `✅ *Estudiante encontrado*\n\n👤 ${student.nombre}\n🏢 Empresa: ${student.empresa || "No registrada"}\n\n⏳ Descargando el certificado para enviártelo...`);
    const caption = `Hola, ${student.nombre}. 👋\n\nTu certificado de *Manipulación de Alimentos* está listo.\n\n🏢 Empresa: ${student.empresa || "No registrada"}\n\n🔎 Si deseas verificarlo en línea:\n${student.verification_url}`;
    const sent = await sendDocumentBuffer(waId, result.pdfBuffer, { fileName: result.fileName, caption, mimeType: "application/pdf" });
    if (!sent) throw new Error("Meta no aceptó el documento PDF");
    clearFlow(waId);
    Stats.certificadoEnviado(student.nombre || "estudiante");
    await crearNotaPrivadaChatwoot(conversationId, `📄 Certificado de Manipulación enviado automáticamente. Documento: ${maskDocument(documento)}. Empresa: ${student.empresa || "No registrada"}.`);
    return sent;
  } catch (error) {
    console.error("❌ Error descargando certificado de Manipulación:", error);
    Stats.metaError(`Error certificado manipulación: ${error.message}`);
    touchFlow(waId);
    return sendText(waId, "⚠️ Encontré el proceso, pero en este momento no pude generar o adjuntar el PDF.\n\nIntenta nuevamente en unos minutos o escribe *SALIR* para volver al menú.");
  }
}

async function generateAndSendCustody(waId, company, conversationId) {
  try {
    await sendText(waId, `✅ Empresa confirmada:\n*${company.nombre}*\n\n⏳ Generando el certificado de custodia clínica...`);
    const result = await buildCustodyCertificate(company);
    const caption = `📄 *Certificado de Custodia Clínica*\n\n🏢 ${company.nombre}\nNIT: ${company.nit}-${company.dv || "?"}\n\nEl documento fue generado con la fecha actual y se adjunta en PDF.`;
    const sent = await sendDocumentBuffer(waId, result.pdfBuffer, { fileName: result.fileName, caption, mimeType: "application/pdf" });
    if (!sent) throw new Error("Meta no aceptó el PDF de custodia");
    clearFlow(waId);
    Stats.certificadoEnviado(company.nombre);
    await crearNotaPrivadaChatwoot(conversationId, `📄 Certificado de Custodia Clínica generado y enviado automáticamente para ${company.nombre} — NIT ${company.nit}-${company.dv || "?"}.`);
    return sent;
  } catch (error) {
    console.error("❌ Error generando certificado de custodia:", error);
    Stats.metaError(`Error certificado custodia: ${error.message}`);
    touchFlow(waId);
    return sendText(waId, "⚠️ La empresa está identificada, pero en este momento no pude generar el PDF.\n\nIntenta nuevamente o escribe *SALIR* para volver al menú principal.");
  }
}

async function processCustodyText(waId, rawText, conversationId) {
  const state = userFlows.get(waId);
  if (!state || state.type !== "custodia") return false;
  touchFlow(waId);

  if (state.step === "await_nit") {
    const nit = normalizeDigits(rawText);
    if (nit.length < 6 || nit.length > 12) {
      await sendText(waId, "⚠️ El NIT no parece válido. Envíalo *sin DV*. Ejemplo: *900767372*.");
      return true;
    }
    const matches = findByNit(nit);
    if (!matches.length) { await sendCustodyNotFoundMenu(waId); return true; }
    if (matches.length === 1) { await sendCustodyConfirmation(waId, matches[0]); return true; }
    setFlow(waId, { type: "custodia", step: "choose_nit_company", data: { candidates: matches } });
    const lines = matches.slice(0, 8).map((item, index) => `${index + 1}. ${item.nombre} — NIT ${item.nit}-${item.dv || "?"}`);
    await sendText(waId, "Encontré más de una razón social asociada a ese NIT.\n\n" + lines.join("\n") + "\n\nResponde con el número de la empresa correcta.");
    return true;
  }

  if (state.step === "choose_nit_company" || state.step === "choose_name_company") {
    const option = Number(String(rawText || "").trim());
    const candidates = state.data?.candidates || [];
    if (!Number.isInteger(option) || option < 1 || option > candidates.length) {
      await sendText(waId, `⚠️ Responde con un número entre 1 y ${candidates.length}.`);
      return true;
    }
    await sendCustodyConfirmation(waId, candidates[option - 1]);
    return true;
  }

  if (state.step === "await_company_name") {
    const matches = findByName(rawText, 5);
    if (!matches.length) {
      await sendText(waId, "❌ No encontré una empresa suficientemente parecida.\n\nEscribe nuevamente la razón social como aparece en el RUT o escribe *SALIR*.");
      return true;
    }
    const top = matches[0];
    const second = matches[1];
    if (matches.length === 1 || (top.score >= 0.94 && (!second || top.score - second.score >= 0.12))) {
      await sendCustodyConfirmation(waId, top);
      return true;
    }
    setFlow(waId, { type: "custodia", step: "choose_name_company", data: { candidates: matches } });
    const lines = matches.map((item, index) => `${index + 1}. ${item.nombre} — NIT ${item.nit}-${item.dv || "?"}`);
    await sendText(waId, "Encontré varias empresas similares:\n\n" + lines.join("\n") + "\n\nResponde con el número de la empresa correcta.");
    return true;
  }

  if (state.step === "confirm_company") {
    const t = String(rawText || "").trim().toLowerCase();
    if (["si", "sí", "s", "correcto"].includes(t)) { await generateAndSendCustody(waId, state.data.company, conversationId); return true; }
    if (["no", "n"].includes(t)) {
      setFlow(waId, { type: "custodia", step: "await_company_name", data: {} });
      await sendText(waId, "Entendido. Escribe el *nombre de la empresa tal como aparece en el RUT*, o lo más parecido posible.");
      return true;
    }
    await sendText(waId, "Por favor confirma con *Sí* o elige *Buscar nombre*.");
    return true;
  }

  if (state.step === "nit_not_found") {
    await sendText(waId, "Selecciona *Otro NIT*, *Buscar nombre* o *Salir*.");
    return true;
  }
  return false;
}

async function handleActiveFlow(waId, rawText, conversationId) {
  const state = userFlows.get(waId);
  if (!state) return false;
  const t = String(rawText || "").trim().toLowerCase();
  if (["salir", "cancelar", "menu", "menú", "inicio"].includes(t)) {
    clearFlow(waId);
    await sendRootMenu(waId, conversationId);
    return true;
  }
  if (state.type === "manip_cert" && state.step === "await_document") {
    await processManipulationDocument(waId, rawText, conversationId);
    return true;
  }
  if (state.type === "custodia") return processCustodyText(waId, rawText, conversationId);
  return false;
}

async function handleButton(waId, buttonId, conversationId = null) {
  clearAdvisorMode(waId, false);
  if (buttonId === "menu_manipulacion") return sendCourseMenu(waId, conversationId);
  if (buttonId === "menu_custodia") return askCustodyNit(waId);
  if (buttonId === "ver_instructivo") return sendCourseInfo(waId, conversationId);
  if (buttonId === "descargar_certificado") return askManipulationDocument(waId);

  if (buttonId === "hablar_asesor") {
    setAdvisorMode(waId);
    Stats.asesorActivado(waId);
    const msg = "👤 *Atención personalizada*\n\n¡Listo! Un asesor se unirá a la conversación en breve. 🙌\n\nSi deseas atención más rápida, escríbenos al *313 401 0901*.\n\n_Si no recibes respuesta en 5 minutos, el asistente automático retomará la conversación._";
    const result = await sendText(waId, msg);
    if (result) { Stats.mensajeEnviado("mensaje", "Aviso de atención personalizada enviado"); await crearNotaPrivadaChatwoot(conversationId, msg); }
    return result;
  }

  if (buttonId === "cancelar_flujo") { clearFlow(waId); return sendRootMenu(waId, conversationId); }
  if (buttonId === "custodia_otro_nit") return askCustodyNit(waId);
  if (buttonId === "custodia_buscar_nombre") {
    setFlow(waId, { type: "custodia", step: "await_company_name", data: {} });
    return sendText(waId, "Escribe el *nombre de la empresa tal como aparece en el RUT*, o lo más parecido posible.\n\nEjemplo: *TEMPORALES AVANZADOS SAS*");
  }
  if (buttonId === "custodia_confirm_si") {
    const state = userFlows.get(waId);
    if (state?.type === "custodia" && state?.data?.company) return generateAndSendCustody(waId, state.data.company, conversationId);
    return askCustodyNit(waId);
  }
  return sendRootMenu(waId, conversationId);
}

router.get("/webhook", (_req, res) => res.status(200).send("OK"));

router.post("/webhook", async (req, res) => {
  if (!WEBHOOK_TOKEN) return res.status(503).json({ ok: false, error: "Webhook no configurado" });
  if (String(req.query.token || "") !== WEBHOOK_TOKEN) return res.status(401).json({ ok: false, error: "Unauthorized" });
  res.status(200).json({ ok: true });

  try {
    const body = req.body || {};
    if (body.event !== "message_created" || body.private === true) return;

    const messageType = String(body.message_type ?? "").toLowerCase();
    const esIncoming = messageType === "incoming" || messageType === "0";
    const esOutgoing = messageType === "outgoing" || messageType === "1";
    const expectedInboxId = Number(process.env.CHATWOOT_INBOX_ID || 0);
    const payloadInboxId = obtenerInboxIdDesdePayload(body);
    if (!expectedInboxId || !payloadInboxId || Number(payloadInboxId) !== expectedInboxId) return;

    const rawPhone = body.meta?.sender?.phone_number || body.conversation?.meta?.sender?.phone_number || body.contact?.phone_number || null;
    if (!rawPhone) return;
    const waId = String(rawPhone).replace(/\D/g, "");
    const conversationId = body.conversation?.id || body.conversation_id || null;
    const messageId = body.id ? String(body.id) : null;

    if (messageId) {
      if (processedIds.has(messageId)) { Stats.duplicadoIgnorado(messageId, waId); return; }
      processedIds.add(messageId);
    }

    if (esOutgoing) {
      const senderType = String(body.sender?.type || "").toLowerCase();
      if (senderType === "user" && advisorMode.has(waId)) registrarRespuestaAsesor(waId);
      return;
    }
    if (!esIncoming) return;

    const rl = isRateLimited(waId);
    if (rl.limited) {
      Stats.rateLimitado(waId);
      if (rl.reason === "too_many") await sendText(waId, "⚠️ Demasiados mensajes seguidos. Intenta en unos minutos.");
      return;
    }

    Stats.mensajeRecibido(waId);
    const buttonId = extractButtonId(body);
    if (buttonId) return handleButton(waId, buttonId, conversationId);

    if (advisorMode.has(waId)) { registrarActividadUsuarioModoAsesor(waId); return; }

    const rawText = String(body.content || "").trim();
    if (!rawText) return;
    if (rawText.length > TEXT_MAX_LEN) { Stats.mensajeNoReconocido(waId, "Mensaje muy largo"); await sendText(waId, `⚠️ Mensaje muy largo. Máximo ${TEXT_MAX_LEN} caracteres.`); return; }
    if (await handleActiveFlow(waId, rawText, conversationId)) return;

    const t = rawText.toLowerCase();
    const greetings = ["hola", "buenas", "buenos días", "buen día", "buenas tardes", "buenas noches", "inicio", "menu", "menú", "start", "hi", "hello", "👋"];
    if (greetings.includes(t)) return sendRootMenu(waId, conversationId);
    if (["ok, recibido", "ok recibido", "recibido", "ok recivido", "recivido"].some((k) => t.includes(k))) return sendRecibidoConfirmacion(waId, conversationId);
    if (t.includes("custodia")) return askCustodyNit(waId);
    if (t.includes("manipulacion") || t.includes("manipulación") || t === "curso") return sendCourseMenu(waId, conversationId);
    if (t.includes("instructivo") || t.includes("contraseña") || t.includes("clave") || t.includes("acceso")) return sendCourseInfo(waId, conversationId);
    if (t.includes("certificado")) return sendRootMenu(waId, conversationId);

    Stats.mensajeNoReconocido(waId, rawText);
    Stats.asesorActivado(waId);
    setAdvisorMode(waId);
    const msgAsesor = "👋 Gracias por escribirnos.\n\nUn asesor revisará tu mensaje y te responderá en breve. 🙌\n\nSi deseas atención más rápida, comunícate al *313 401 0901*.";
    const result = await sendText(waId, msgAsesor);
    if (result) { Stats.mensajeEnviado("mensaje", "Aviso de derivación a asesor enviado"); await crearNotaPrivadaChatwoot(conversationId, msgAsesor); }
  } catch (error) {
    console.error("❌ Error en /chatwoot/webhook:", error);
    Stats.metaError(`Error en /chatwoot/webhook: ${error.message}`);
  }
});

module.exports = router;
