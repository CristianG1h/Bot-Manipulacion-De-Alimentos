"use strict";

const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const { CookieJar } = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");

const {
  getCachedName,
  saveCachedName,
} = require("../services/certificadosNameCache");

const router = express.Router();

const ADMIN_BASE_URL = String(process.env.ADMIN_BASE_URL || "").replace(/\/+$/, "");
const ADMIN_LOGIN_PATH = process.env.ADMIN_LOGIN_PATH || "/login";
const ADMIN_PANEL_PATH = process.env.ADMIN_PANEL_PATH || "/admin";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_USER_FIELD = process.env.ADMIN_USER_FIELD || "username";
const ADMIN_PASS_FIELD = process.env.ADMIN_PASS_FIELD || "password";

const PANEL_CACHE_TTL_MS = 5 * 60 * 1000;
const NOMBRE_CONCURRENCIA = 4;

let panelCache = {
  usuarios: [],
  actualizadoEn: 0,
};

let sincronizacionEnCurso = null;

function normalizarTexto(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function limpiarTexto(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[✅⚠️🔗]/g, "")
    .trim();
}

function convertirSiNo(value) {
  const texto = normalizarTexto(limpiarTexto(value));

  if (["si", "yes", "true", "1"].includes(texto)) return true;
  if (["no", "false", "0"].includes(texto)) return false;

  if (/^si\b/.test(texto)) return true;
  if (/^no\b/.test(texto)) return false;

  return null;
}

function crearCliente() {
  const jar = new CookieJar();

  return wrapper(
    axios.create({
      baseURL: ADMIN_BASE_URL,
      jar,
      withCredentials: true,
      timeout: 25000,
      maxRedirects: 5,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      },
    })
  );
}

async function loginAdmin(client) {
  const loginPage = await client.get(ADMIN_LOGIN_PATH);
  const $ = cheerio.load(loginPage.data);
  const payload = {};

  $("form input").each((_, input) => {
    const name = $(input).attr("name");
    if (name) payload[name] = $(input).attr("value") || "";
  });

  payload[ADMIN_USER_FIELD] = ADMIN_USERNAME;
  payload[ADMIN_PASS_FIELD] = ADMIN_PASSWORD;

  const form = $("form").first();
  const action = form.attr("action") || ADMIN_LOGIN_PATH;

  await client.post(action, new URLSearchParams(payload).toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${ADMIN_BASE_URL}${ADMIN_LOGIN_PATH}`,
    },
  });
}

function normalizarUrlCertificado(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw, ADMIN_BASE_URL);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.href;
  } catch {
    return "";
  }
}

function crearMapaEncabezados($) {
  const mapa = new Map();

  $("#usersTable thead th").each((index, th) => {
    mapa.set(normalizarTexto($(th).text()), index);
  });

  return mapa;
}

function buscarIndiceEncabezado(mapa, candidatos, fallback = -1) {
  for (const [encabezado, index] of mapa.entries()) {
    if (candidatos.some((candidato) => encabezado.includes(candidato))) {
      return index;
    }
  }

  return fallback;
}

function extraerUsuariosDesdeHtml(html) {
  const $ = cheerio.load(html);
  const mapa = crearMapaEncabezados($);

  // Los fallback corresponden al panel actual mostrado en /admin.
  // El mapeo por encabezado permite que siga funcionando si el orden cambia.
  const idx = {
    id: buscarIndiceEncabezado(mapa, ["id"], 0),
    usuario: buscarIndiceEncabezado(mapa, ["usuario"], 1),
    documento: buscarIndiceEncabezado(mapa, ["documento"], 2),
    tipoDoc: buscarIndiceEncabezado(mapa, ["tipo doc", "tipo documento"], 3),
    empresa: buscarIndiceEncabezado(mapa, ["empresa"], 4),
    facturado: buscarIndiceEncabezado(mapa, ["facturado"], 5),
    primerIngreso: buscarIndiceEncabezado(mapa, ["primer ingreso"], 6),
    ultimoIngreso: buscarIndiceEncabezado(mapa, ["ultimo ingreso"], 7),
    certificado: buscarIndiceEncabezado(mapa, ["certificado"], 8),
    completado: buscarIndiceEncabezado(mapa, ["completado"], 9),
  };

  const usuarios = [];

  $("#usersTable tbody tr").each((_, row) => {
    const cells = $(row).find("td");
    if (!cells.length) return;

    const textAt = (index) => {
      if (index < 0 || index >= cells.length) return "";
      return limpiarTexto($(cells[index]).text());
    };

    const linkAt = (index) => {
      if (index < 0 || index >= cells.length) return "";
      return $(cells[index]).find("a").first().attr("href") || "";
    };

    const usuario = {
      id: textAt(idx.id),
      usuario: textAt(idx.usuario),
      documento: textAt(idx.documento),
      tipo_doc: textAt(idx.tipoDoc),
      empresa: textAt(idx.empresa),
      facturado: convertirSiNo(textAt(idx.facturado)),
      primer_ingreso: textAt(idx.primerIngreso),
      ultimo_ingreso: textAt(idx.ultimoIngreso),
      certificado_url: normalizarUrlCertificado(linkAt(idx.certificado)),
      completado: convertirSiNo(textAt(idx.completado)),
    };

    if (!usuario.documento && !usuario.usuario) return;

    usuarios.push(usuario);
  });

  return usuarios;
}

async function sincronizarPanel() {
  if (sincronizacionEnCurso) return sincronizacionEnCurso;

  sincronizacionEnCurso = (async () => {
    const client = crearCliente();
    await loginAdmin(client);

    const response = await client.get(ADMIN_PANEL_PATH);
    const usuarios = extraerUsuariosDesdeHtml(response.data);

    panelCache = {
      usuarios,
      actualizadoEn: Date.now(),
    };

    console.log(
      `✅ Panel facturación sincronizado: ${usuarios.length} usuarios leídos desde ${ADMIN_PANEL_PATH}`
    );

    return {
      usuarios,
      actualizadoEn: panelCache.actualizadoEn,
      stale: false,
    };
  })();

  try {
    return await sincronizacionEnCurso;
  } finally {
    sincronizacionEnCurso = null;
  }
}

async function obtenerPanelCacheado() {
  const ahora = Date.now();
  const tieneCache = panelCache.actualizadoEn > 0;
  const cacheVigente =
    tieneCache && ahora - panelCache.actualizadoEn < PANEL_CACHE_TTL_MS;

  if (cacheVigente) {
    return {
      usuarios: panelCache.usuarios,
      actualizadoEn: panelCache.actualizadoEn,
      stale: false,
    };
  }

  try {
    return await sincronizarPanel();
  } catch (error) {
    if (tieneCache) {
      console.warn(
        "⚠️ Falló actualización del panel de facturación; usando caché anterior:",
        error.message
      );

      return {
        usuarios: panelCache.usuarios,
        actualizadoEn: panelCache.actualizadoEn,
        stale: true,
      };
    }

    throw error;
  }
}

function extraerEmpresasSolicitadas(value) {
  const valores = Array.isArray(value) ? value : [value];
  const empresas = [];

  valores.forEach((item) => {
    String(item || "")
      .split(/[\n,;|]+/)
      .map((parte) => normalizarTexto(parte))
      .filter((parte) => parte.length >= 2)
      .forEach((parte) => empresas.push(parte));
  });

  return [...new Set(empresas)].slice(0, 50);
}

function obtenerFiltroFacturado(value) {
  const texto = normalizarTexto(value);

  if (["si", "yes", "true", "1"].includes(texto)) return true;
  if (["no", "false", "0"].includes(texto)) return false;

  return null;
}

function parseFechaPanel(value) {
  if (!value || value === "—") return null;

  const texto = String(value).trim();
  const match = texto.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/
  );

  if (!match) return null;

  const date = new Date(
    Number(match[3]),
    Number(match[2]) - 1,
    Number(match[1]),
    Number(match[4] || 0),
    Number(match[5] || 0),
    0
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

function inicioDia(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function finDia(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function obtenerRangoFecha(query) {
  const range = String(query.range || "all");
  const hoy = new Date();
  const hoyFin = finDia(hoy);

  if (range === "all") return null;

  if (range === "today") {
    return { desde: inicioDia(hoy), hasta: hoyFin };
  }

  if (range === "7d" || range === "30d") {
    const dias = range === "7d" ? 6 : 29;
    const desde = inicioDia(hoy);
    desde.setDate(desde.getDate() - dias);
    return { desde, hasta: hoyFin };
  }

  if (range === "custom") {
    let desde = null;
    let hasta = null;

    if (query.from) {
      const [year, month, day] = String(query.from).split("-").map(Number);
      desde = inicioDia(new Date(year, month - 1, day));
    }

    if (query.to) {
      const [year, month, day] = String(query.to).split("-").map(Number);
      hasta = finDia(new Date(year, month - 1, day));
    }

    return { desde, hasta };
  }

  return null;
}

function cumpleRangoFecha(usuario, rango) {
  if (!rango) return true;

  const fecha =
    parseFechaPanel(usuario.ultimo_ingreso) ||
    parseFechaPanel(usuario.primer_ingreso);

  if (!fecha) return false;
  if (rango.desde && fecha < rango.desde) return false;
  if (rango.hasta && fecha > rango.hasta) return false;

  return true;
}

function esAdministradorEmpresa(usuario) {
  return String(usuario.tipo_doc || "").toUpperCase().trim() === "NIT";
}

function filtrarUsuarios(usuarios, query) {
  const empresasSolicitadas = extraerEmpresasSolicitadas(query.q || query.empresas || "");
  const filtroFacturado = obtenerFiltroFacturado(query.facturado);
  const rango = obtenerRangoFecha(query);

  if (!empresasSolicitadas.length) return [];

  return usuarios.filter((usuario) => {
    if (esAdministradorEmpresa(usuario)) return false;

    const empresa = normalizarTexto(usuario.empresa);
    const coincideEmpresa = empresasSolicitadas.some((busqueda) =>
      empresa.includes(busqueda)
    );

    if (!coincideEmpresa) return false;
    if (!cumpleRangoFecha(usuario, rango)) return false;

    if (filtroFacturado === true && usuario.facturado !== true) return false;
    if (filtroFacturado === false && usuario.facturado !== false) return false;

    return true;
  });
}

function extraerValorInputPorLabel($, labelTexto) {
  let valor = "";
  const buscado = normalizarTexto(labelTexto);

  $("label").each((_, label) => {
    if (valor) return;

    const texto = normalizarTexto($(label).text());
    if (!texto.includes(buscado)) return;

    const forId = $(label).attr("for");
    let input = forId ? $(`#${forId}`) : null;

    if (!input || !input.length) {
      input = $(label).closest("div").find("input, select, textarea").first();
    }

    if (input && input.length) valor = input.val() || "";
  });

  return String(valor || "").trim();
}

function extraerNombreCompletoDesdeEditHtml(html) {
  const $ = cheerio.load(html);
  const porLabel = extraerValorInputPorLabel($, "Nombre Completo");

  if (porLabel) return porLabel;

  const selectores = [
    'input[name="nombre_completo"]',
    'input[name="nombre"]',
    'input[name="full_name"]',
    '#nombre_completo',
    '#nombre',
    '#full_name',
  ];

  for (const selector of selectores) {
    const value = $(selector).val();
    if (value) return String(value).trim();
  }

  return "";
}

async function enriquecerUsuariosConNombre(usuarios) {
  const resultado = new Array(usuarios.length);
  const faltantes = [];

  for (let index = 0; index < usuarios.length; index += 1) {
    const usuario = usuarios[index];
    const id = String(usuario.id || "").trim();
    const cache = id ? await getCachedName(id) : null;

    if (cache) {
      resultado[index] = { ...usuario, nombre: cache };
    } else {
      faltantes.push({ index, usuario });
    }
  }

  if (!faltantes.length) return resultado;

  const client = crearCliente();
  await loginAdmin(client);

  let cursor = 0;

  async function worker() {
    while (cursor < faltantes.length) {
      const posicion = cursor;
      cursor += 1;

      const { index, usuario } = faltantes[posicion];
      const id = String(usuario.id || "").trim();
      let nombre = usuario.usuario || usuario.documento || "";

      if (id) {
        try {
          const response = await client.get(`/admin/edit/${encodeURIComponent(id)}`);
          nombre = extraerNombreCompletoDesdeEditHtml(response.data) || nombre;

          if (nombre) {
            await saveCachedName({
              id,
              documento: usuario.documento,
              nombre,
              empresa: usuario.empresa,
            });
          }
        } catch (error) {
          console.warn(
            `⚠️ No se pudo enriquecer nombre del usuario ID ${id}:`,
            error.message
          );
        }
      }

      resultado[index] = { ...usuario, nombre };
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(NOMBRE_CONCURRENCIA, faltantes.length) },
      () => worker()
    )
  );

  return resultado;
}

function limpiarUsuarioParaFrontend(usuario) {
  return {
    id: usuario.id || "",
    nombre: usuario.nombre || usuario.usuario || "",
    usuario: usuario.usuario || "",
    documento: usuario.documento || "",
    empresa: usuario.empresa || "",
    facturado:
      usuario.facturado === true
        ? true
        : usuario.facturado === false
          ? false
          : null,
    primer_ingreso:
      usuario.primer_ingreso === "—" ? "" : usuario.primer_ingreso || "",
    ultimo_ingreso:
      usuario.ultimo_ingreso === "—" ? "" : usuario.ultimo_ingreso || "",
    completado: usuario.completado === true,
    certificado_url: usuario.certificado_url || "",
  };
}

router.get("/empresas", async (req, res) => {
  try {
    if (!ADMIN_BASE_URL || !ADMIN_USERNAME || !ADMIN_PASSWORD) {
      return res.status(500).json({
        ok: false,
        error:
          "Faltan variables ADMIN_BASE_URL, ADMIN_USERNAME o ADMIN_PASSWORD en Render.",
      });
    }

    const empresasSolicitadas = extraerEmpresasSolicitadas(req.query.q || "");

    if (!empresasSolicitadas.length) {
      return res.json({
        ok: true,
        total: 0,
        usuarios: [],
        empresas_consultadas: [],
      });
    }

    const resultadoCache = await obtenerPanelCacheado();
    const filtradosBase = filtrarUsuarios(resultadoCache.usuarios, req.query || {});
    const filtradosConNombre = await enriquecerUsuariosConNombre(filtradosBase);
    const usuarios = filtradosConNombre.map(limpiarUsuarioParaFrontend);

    return res.json({
      ok: true,
      total: usuarios.length,
      usuarios,
      empresas_consultadas: empresasSolicitadas,
      facturado_filtro: normalizarTexto(req.query.facturado || "all"),
      actualizado_en: new Date(resultadoCache.actualizadoEn).toISOString(),
      cache_desactualizada: resultadoCache.stale,
    });
  } catch (error) {
    console.error("❌ Error en filtro de facturación por empresas:", error.message);

    return res.status(500).json({
      ok: false,
      error: "No se pudo consultar la facturación de las empresas.",
      detail: error.message,
    });
  }
});

module.exports = router;
module.exports._test = {
  convertirSiNo,
  extraerUsuariosDesdeHtml,
  extraerEmpresasSolicitadas,
  obtenerFiltroFacturado,
  filtrarUsuarios,
};
