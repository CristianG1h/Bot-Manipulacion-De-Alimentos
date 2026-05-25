"use strict";
 
// ─── Contadores en memoria ────────────────────────────────────────────────────
// Se reinician al reiniciar el servidor. Para persistencia permanente
// puedes guardar en un archivo JSON (ver comentario al final).
 
const stats = {
  // Totales históricos de esta sesión
  conversaciones: 0,
  mensajesEnviados: 0,
  accesosEnviados: 0,
  certificadosEnviados: 0,
  asesoresActivados: 0,
  mensajesNoReconocidos: 0,
  duplicadosIgnorados: 0,
  rateLimitados: 0,
 
  // Log de últimas interacciones (máx 50)
  ultimasInteracciones: [],
 
  // Conteo por keyword
  keywords: {
    instructivo: 0,
    link: 0,
    hola: 0,
    certificado: 0,
    contraseña: 0,
    asesor: 0,
    recibido: 0,
  },
 
  // Actividad por hora del día (0-23)
  porHora: Array(24).fill(0),
 
  // Actividad por día (últimos 14 días) — clave: "YYYY-MM-DD"
  porDia: {},
 
  // Timestamp de inicio del servidor
  iniciadoEn: new Date().toISOString(),
};
 
// ─── Helpers ─────────────────────────────────────────────────────────────────
 
function hoyKey() {
  return new Date().toISOString().slice(0, 10); // "2025-05-20"
}
 
function registrarInteraccion(tipo, detalle, estado = "ok") {
  const ahora = new Date();
  const entrada = {
    hora: ahora.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    tipo,
    detalle,
    estado, // "ok" | "warn" | "asesor" | "error"
    ts: ahora.getTime(),
  };
  stats.ultimasInteracciones.unshift(entrada);
  if (stats.ultimasInteracciones.length > 50) {
    stats.ultimasInteracciones.pop();
  }
 
  // Registrar actividad por hora y por día
  stats.porHora[ahora.getHours()]++;
  const key = hoyKey();
  stats.porDia[key] = (stats.porDia[key] || 0) + 1;
 
  // Limpiar días más viejos de 14 días
  const hace14 = Date.now() - 14 * 24 * 60 * 60 * 1000;
  for (const k of Object.keys(stats.porDia)) {
    if (new Date(k).getTime() < hace14) delete stats.porDia[k];
  }
}
 
// ─── API pública ──────────────────────────────────────────────────────────────
 
const Stats = {
  // Llamar cuando llega un mensaje nuevo (no duplicado)
  mensajeRecibido(wa_id) {
    registrarInteraccion("mensaje", `Nuevo mensaje de ${wa_id.slice(0,6)}***`, "ok");
  },
 
  // Llamar cuando se envía menú principal
  menuEnviado(wa_id) {
    stats.mensajesEnviados++;
    stats.conversaciones++;
    stats.keywords.hola++;
    registrarInteraccion("menu", "Menú principal enviado", "ok");
  },
 
  // Llamar cuando se envía instructivo/link del curso
  instructivoEnviado(wa_id) {
    stats.mensajesEnviados++;
    stats.keywords.instructivo++;
    stats.keywords.link++;
    registrarInteraccion("instructivo", "Instructivo y link enviado", "ok");
  },
 
  // Llamar cuando se envía confirmación de recibido
  recibidoEnviado(wa_id) {
    stats.mensajesEnviados++;
    stats.keywords.recibido++;
    registrarInteraccion("recibido", "Confirmación de recibido enviada", "ok");
  },
 
  // Llamar cuando se activa modo asesor
  asesorActivado(wa_id) {
    stats.mensajesEnviados++;
    stats.asesoresActivados++;
    stats.keywords.asesor++;
    registrarInteraccion("asesor", `Asesor activado para ${wa_id.slice(0,6)}***`, "asesor");
  },
 
  // Llamar cuando el mensaje no fue reconocido
  mensajeNoReconocido(wa_id, texto) {
    stats.mensajesNoReconocidos++;
    registrarInteraccion("no_reconocido", `Msg no reconocido: "${texto.slice(0, 30)}"`, "warn");
  },
 
  // Llamar cuando se envía acceso al curso (ruta /notify/access)
  accesoEnviado(nombre) {
    stats.mensajesEnviados++;
    stats.accesosEnviados++;
    registrarInteraccion("acceso", `Acceso enviado a ${nombre}`, "ok");
  },
 
  // Llamar cuando se envía certificado (ruta /certificate)
  certificadoEnviado(nombre) {
    stats.mensajesEnviados++;
    stats.certificadosEnviados++;
    stats.keywords.certificado++;
    registrarInteraccion("certificado", `Certificado enviado a ${nombre}`, "ok");
  },
 
  // Llamar cuando se ignora duplicado
  duplicadoIgnorado() {
    stats.duplicadosIgnorados++;
  },
 
  // Llamar cuando alguien es rate-limitado
  rateLimitado(wa_id) {
    stats.rateLimitados++;
    registrarInteraccion("rate_limit", `Rate limit: ${wa_id.slice(0,6)}***`, "warn");
  },
 
  // Devuelve el snapshot completo para el dashboard
  getSnapshot() {
    // Construir array de los últimos 14 días con sus valores
    const dias = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
      dias.push({ fecha: key, label, total: stats.porDia[key] || 0 });
    }
 
    return {
      totales: {
        conversaciones: stats.conversaciones,
        mensajesEnviados: stats.mensajesEnviados,
        accesosEnviados: stats.accesosEnviados,
        certificadosEnviados: stats.certificadosEnviados,
        asesoresActivados: stats.asesoresActivados,
        mensajesNoReconocidos: stats.mensajesNoReconocidos,
        rateLimitados: stats.rateLimitados,
      },
      ultimasInteracciones: stats.ultimasInteracciones.slice(0, 20),
      keywords: stats.keywords,
      actividadPorDia: dias,
      actividadPorHora: stats.porHora,
      iniciadoEn: stats.iniciadoEn,
      uptime: Math.floor(process.uptime()),
    };
  },
};
 
module.exports = Stats;