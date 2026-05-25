"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DATA_FILE = path.join(DATA_DIR, "stats.json");

const DEFAULT_STATS = {
  conversaciones: 0,
  mensajesRecibidos: 0,
  mensajesEnviados: 0,
  accesosEnviados: 0,
  certificadosEnviados: 0,
  asesoresActivados: 0,
  mensajesNoReconocidos: 0,
  duplicadosIgnorados: 0,
  rateLimitados: 0,
  erroresMeta: 0,

  ultimasInteracciones: [],

  keywords: {
    instructivo: 0,
    link: 0,
    hola: 0,
    certificado: 0,
    contraseña: 0,
    asesor: 0,
    recibido: 0,
    acceso: 0,
  },

  porHora: Array(24).fill(0),
  porDia: {},

  iniciadoEn: new Date().toISOString(),
};

function getDefaultStats() {
  return JSON.parse(JSON.stringify(DEFAULT_STATS));
}

function cargarStats() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return getDefaultStats();
    }

    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const saved = raw ? JSON.parse(raw) : {};

    const base = getDefaultStats();

    return {
      ...base,
      ...saved,
      keywords: {
        ...base.keywords,
        ...(saved.keywords || {}),
      },
      porHora:
        Array.isArray(saved.porHora) && saved.porHora.length === 24
          ? saved.porHora
          : Array(24).fill(0),
      porDia: saved.porDia || {},
      ultimasInteracciones: Array.isArray(saved.ultimasInteracciones)
        ? saved.ultimasInteracciones
        : [],
      iniciadoEn: saved.iniciadoEn || new Date().toISOString(),
    };
  } catch (error) {
    console.error("⚠️ No se pudieron cargar las estadísticas:", error.message);
    return getDefaultStats();
  }
}

const stats = cargarStats();

let saveTimer = null;

function guardarStatsSoon() {
  clearTimeout(saveTimer);

  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(stats, null, 2), "utf8");
    } catch (error) {
      console.error("⚠️ No se pudieron guardar las estadísticas:", error.message);
    }
  }, 300);
}

function hoyKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function maskPhone(value = "") {
  const s = String(value || "").replace(/\D/g, "");

  if (!s) return "sin número";

  return `${s.slice(0, 6)}***${s.slice(-2)}`;
}

function sumarDiaYHora(ahora = new Date()) {
  const hora = ahora.getHours();

  stats.porHora[hora] = (stats.porHora[hora] || 0) + 1;

  const key = hoyKey(ahora);
  stats.porDia[key] = (stats.porDia[key] || 0) + 1;

  const hace14 = Date.now() - 14 * 24 * 60 * 60 * 1000;

  for (const k of Object.keys(stats.porDia)) {
    if (new Date(k).getTime() < hace14) {
      delete stats.porDia[k];
    }
  }
}

function registrarInteraccion(tipo, detalle, estado = "ok") {
  const ahora = new Date();

  stats.ultimasInteracciones.unshift({
    hora: ahora.toLocaleTimeString("es-CO", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    tipo,
    detalle: String(detalle || "").slice(0, 160),
    estado,
    ts: ahora.getTime(),
  });

  if (stats.ultimasInteracciones.length > 50) {
    stats.ultimasInteracciones = stats.ultimasInteracciones.slice(0, 50);
  }

  sumarDiaYHora(ahora);
  guardarStatsSoon();
}

function sumarKeyword(key) {
  if (!key) return;

  stats.keywords[key] = (stats.keywords[key] || 0) + 1;
}

function actividadUltimos14Dias() {
  const dias = [];

  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);

    const key = hoyKey(d);

    dias.push({
      fecha: key,
      label: d.toLocaleDateString("es-CO", {
        day: "2-digit",
        month: "short",
      }),
      total: stats.porDia[key] || 0,
    });
  }

  return dias;
}

const Stats = {
  mensajeRecibido(waId) {
    stats.mensajesRecibidos++;
    registrarInteraccion("mensaje_recibido", `Nuevo mensaje de ${maskPhone(waId)}`, "ok");
  },

  mensajeEnviado(tipo = "mensaje", detalle = "Mensaje enviado por WhatsApp") {
    stats.mensajesEnviados++;
    registrarInteraccion(tipo, detalle, "ok");
  },

  metaError(detalle = "Error enviando mensaje a Meta") {
    stats.erroresMeta++;
    registrarInteraccion("meta_error", detalle, "error");
  },

  menuEnviado(waId) {
    stats.conversaciones++;
    stats.mensajesEnviados++;
    sumarKeyword("hola");
    registrarInteraccion("menu", `Menú principal enviado a ${maskPhone(waId)}`, "ok");
  },

  instructivoEnviado(waId) {
    stats.mensajesEnviados++;
    sumarKeyword("instructivo");
    sumarKeyword("link");
    registrarInteraccion("instructivo", `Instructivo y link enviado a ${maskPhone(waId)}`, "ok");
  },

  recibidoEnviado(waId) {
    stats.mensajesEnviados++;
    sumarKeyword("recibido");
    registrarInteraccion("recibido", `Confirmación enviada a ${maskPhone(waId)}`, "ok");
  },

  asesorActivado(waId) {
    stats.mensajesEnviados++;
    stats.asesoresActivados++;
    sumarKeyword("asesor");
    registrarInteraccion("asesor", `Asesor activado para ${maskPhone(waId)}`, "asesor");
  },

  mensajeNoReconocido(waId, texto) {
    stats.mensajesNoReconocidos++;

    registrarInteraccion(
      "no_reconocido",
      `No reconocido de ${maskPhone(waId)}: "${String(texto || "").slice(0, 50)}"`,
      "warn"
    );
  },

  accesoEnviado(nombre = "usuario") {
    stats.mensajesEnviados++;
    stats.accesosEnviados++;
    sumarKeyword("acceso");
    registrarInteraccion("acceso", `Acceso enviado a ${nombre}`, "ok");
  },

  certificadoEnviado(nombre = "usuario") {
    stats.mensajesEnviados++;
    stats.certificadosEnviados++;
    sumarKeyword("certificado");
    registrarInteraccion("certificado", `Certificado enviado a ${nombre}`, "ok");
  },

  duplicadoIgnorado(id = "") {
    stats.duplicadosIgnorados++;
    registrarInteraccion("duplicado", `Duplicado ignorado ${id}`.trim(), "warn");
  },

  rateLimitado(waId) {
    stats.rateLimitados++;
    registrarInteraccion("rate_limit", `Rate limit para ${maskPhone(waId)}`, "warn");
  },

  getSnapshot() {
    return {
      totales: {
        conversaciones: stats.conversaciones,
        mensajesRecibidos: stats.mensajesRecibidos,
        mensajesEnviados: stats.mensajesEnviados,
        accesosEnviados: stats.accesosEnviados,
        certificadosEnviados: stats.certificadosEnviados,
        asesoresActivados: stats.asesoresActivados,
        mensajesNoReconocidos: stats.mensajesNoReconocidos,
        duplicadosIgnorados: stats.duplicadosIgnorados,
        rateLimitados: stats.rateLimitados,
        erroresMeta: stats.erroresMeta,
      },
      ultimasInteracciones: stats.ultimasInteracciones.slice(0, 20),
      keywords: stats.keywords,
      actividadPorDia: actividadUltimos14Dias(),
      actividadPorHora: stats.porHora,
      iniciadoEn: stats.iniciadoEn,
      uptime: Math.floor(process.uptime()),
    };
  },
};

module.exports = Stats;
module.exports = Stats;
