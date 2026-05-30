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

const ADMIN_BASE_URL = process.env.ADMIN_BASE_URL;
const ADMIN_LOGIN_PATH = process.env.ADMIN_LOGIN_PATH || "/login";
const ADMIN_PANEL_PATH = process.env.ADMIN_PANEL_PATH || "/admin";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const ADMIN_USER_FIELD = process.env.ADMIN_USER_FIELD || "username";
const ADMIN_PASS_FIELD = process.env.ADMIN_PASS_FIELD || "password";

function crearCliente() {
  const jar = new CookieJar();

  return wrapper(
    axios.create({
      baseURL: ADMIN_BASE_URL,
      jar,
      withCredentials: true,
      timeout: 25000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      },
    })
  );
}

function limpiarTexto(valor) {
  return String(valor || "")
    .replace(/\s+/g, " ")
    .replace("✅", "")
    .replace("⚠️", "")
    .replace("🔗", "")
    .trim();
}

function convertirSiNo(valor) {
  const texto = limpiarTexto(valor).toLowerCase();

  if (texto.includes("sí") || texto.includes("si")) return true;
  if (texto.includes("no")) return false;

  return null;
}

function detectarRol(usuario) {
  const tipoDoc = String(usuario.tipo_doc || "").toUpperCase();
  const paso = String(usuario.paso || "").trim();
  const tieneCertificado = Boolean(usuario.certificado_url);
  const completado = usuario.completado === true;

  /*
    Regla inicial:
    - Si el tipo documento es NIT, lo contamos como usuario administrador / empresa.
    - Si NO es NIT, lo contamos como usuario de empresa / estudiante.
  */

  if (tipoDoc === "NIT") {
    return "administrador";
  }

  return "empresa";
}

async function loginAdmin(client) {
  const loginPage = await client.get(ADMIN_LOGIN_PATH);
  const $ = cheerio.load(loginPage.data);

  const payload = {};

  $("form input").each((_, input) => {
    const name = $(input).attr("name");
    const value = $(input).attr("value") || "";

    if (name) {
      payload[name] = value;
    }
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
    maxRedirects: 5,
  });
}

function extraerUsuariosDesdeHtml(html) {
  const $ = cheerio.load(html);
  const usuarios = [];

  $("#usersTable tbody tr").each((_, row) => {
    const cells = $(row).find("td");

    if (!cells || cells.length < 12) return;

    const certificadoUrl = $(cells[10]).find("a").attr("href") || null;

    const usuario = {
      id: limpiarTexto($(cells[0]).text()),
      usuario: limpiarTexto($(cells[1]).text()),
      documento: limpiarTexto($(cells[2]).text()),
      tipo_doc: limpiarTexto($(cells[3]).text()),
      empresa: limpiarTexto($(cells[4]).text()),
      facturado: convertirSiNo($(cells[5]).text()),
      primer_ingreso: limpiarTexto($(cells[6]).text()),
      ultimo_ingreso: limpiarTexto($(cells[7]).text()),
      celular: limpiarTexto($(cells[8]).text()),
      paso: limpiarTexto($(cells[9]).text()),
      certificado_url: certificadoUrl,
      completado: convertirSiNo($(cells[11]).text()),
      habilitado: limpiarTexto($(cells[12]).text()).toLowerCase().includes("activo"),
    };

    usuario.rol_detectado = detectarRol(usuario);

    usuarios.push(usuario);
  });

  return usuarios;
}

function calcularMetricas(usuarios) {
  const empresasSet = new Set();

  usuarios.forEach((u) => {
    if (u.empresa) {
      empresasSet.add(u.empresa.trim().toUpperCase());
    }
  });

  const certificadosEmitidos = usuarios.filter((u) => {
    return u.certificado_url || u.completado === true;
  }).length;

  const totalFacturados = usuarios.filter((u) => u.facturado === true).length;
  const totalNoFacturados = usuarios.filter((u) => u.facturado === false).length;

  const totalUsuarios = usuarios.length;

  const totalUsuariosEmpresa = usuarios.filter((u) => {
    return u.rol_detectado === "empresa";
  }).length;

  const totalUsuariosAdministradores = usuarios.filter((u) => {
    return u.rol_detectado === "administrador";
  }).length;

  const empresasActivas = empresasSet.size;

  return {
    certificados_emitidos: certificadosEmitidos,
    empresas_activas: empresasActivas,
    total_facturados: totalFacturados,
    total_no_facturados: totalNoFacturados,
    total_usuarios: totalUsuarios,
    total_usuarios_empresa: totalUsuariosEmpresa,
    total_usuarios_administradores: totalUsuariosAdministradores,
  };
}

function normalizarTexto(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function esAdminEmpresa(usuario) {
  const tipoDoc = String(usuario.tipo_doc || "").toUpperCase().trim();
  const rol = String(usuario.rol_detectado || "").toLowerCase().trim();

  return tipoDoc === "NIT" || rol === "administrador";
}

function parseFechaPanel(value) {
  if (!value || value === "—") return null;

  const texto = String(value).trim();

  const match = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);

  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const year = Number(match[3]);
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);

  const date = new Date(year, month, day, hour, minute, 0);

  if (Number.isNaN(date.getTime())) return null;

  return date;
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
  const range = query.range || "all";

  const hoy = new Date();
  const hoyInicio = inicioDia(hoy);
  const hoyFin = finDia(hoy);

  if (range === "all") return null;

  if (range === "today") {
    return {
      desde: hoyInicio,
      hasta: hoyFin,
    };
  }

  if (range === "7d") {
    const desde = inicioDia(hoy);
    desde.setDate(desde.getDate() - 6);

    return {
      desde,
      hasta: hoyFin,
    };
  }

  if (range === "30d") {
    const desde = inicioDia(hoy);
    desde.setDate(desde.getDate() - 29);

    return {
      desde,
      hasta: hoyFin,
    };
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

    return {
      desde,
      hasta,
    };
  }

  return null;
}

function cumpleRangoFecha(usuario, rango) {
  if (!rango) return true;

  const fechaUltimo = parseFechaPanel(usuario.ultimo_ingreso);
  const fechaPrimer = parseFechaPanel(usuario.primer_ingreso);

  const fecha = fechaUltimo || fechaPrimer;

  if (!fecha) return false;

  if (rango.desde && fecha < rango.desde) return false;
  if (rango.hasta && fecha > rango.hasta) return false;

  return true;
}

function limpiarUsuarioParaFrontend(usuario) {
  return {
    id: usuario.id || "",
    nombre: usuario.nombre || usuario.usuario || "",
    usuario: usuario.usuario || "",
    documento: usuario.documento || "",
    empresa: usuario.empresa || "",
    primer_ingreso: usuario.primer_ingreso === "—" ? "" : usuario.primer_ingreso || "",
    ultimo_ingreso: usuario.ultimo_ingreso === "—" ? "" : usuario.ultimo_ingreso || "",
    completado: usuario.completado === true,
    certificado_url: usuario.certificado_url || "",
    facturado: usuario.facturado === true,
  };
}

router.get("/", async (req, res) => {
  try {
    if (!ADMIN_BASE_URL || !ADMIN_USERNAME || !ADMIN_PASSWORD) {
      return res.status(500).json({
        ok: false,
        error:
          "Faltan variables ADMIN_BASE_URL, ADMIN_USERNAME o ADMIN_PASSWORD en Render.",
      });
    }

    const client = crearCliente();

    await loginAdmin(client);

    const response = await client.get(ADMIN_PANEL_PATH);

    const usuarios = extraerUsuariosDesdeHtml(response.data);
    const metricas = calcularMetricas(usuarios);

    return res.json({
  ok: true,
  total: usuarios.length,
  metricas,
});
  } catch (error) {
    console.error("❌ Error leyendo panel admin certificados:", error.message);

    return res.status(500).json({
      ok: false,
      error: "No se pudo leer la información del panel admin.",
      detail: error.message,
    });
  }
});

function extraerValorInputPorLabel($, labelTexto) {
  let valor = "";

  $("label").each((_, label) => {
    const texto = normalizarTexto($(label).text());

    if (texto.includes(normalizarTexto(labelTexto))) {
      const contenedor = $(label).closest("div");
      const input = contenedor.find("input, select, textarea").first();

      if (input && input.length) {
        valor = input.val() || "";
      }
    }
  });

  return String(valor || "").trim();
}

function extraerNombreCompletoDesdeEditHtml(html) {
  const $ = cheerio.load(html);

  let nombre = extraerValorInputPorLabel($, "Nombre Completo");

  if (nombre) return nombre;

  const posiblesSelectores = [
    'input[name="nombre_completo"]',
    'input[name="nombre"]',
    'input[name="full_name"]',
    'input[id="nombre_completo"]',
    'input[id="nombre"]',
    'input[id="full_name"]',
  ];

  for (const selector of posiblesSelectores) {
    const value = $(selector).val();

    if (value) {
      return String(value).trim();
    }
  }

  return "";
}

const nombresCache = new Map();

async function obtenerNombreCompletoUsuario(client, usuario) {
  const id = String(usuario.id || "").trim();

  if (!id) {
    return usuario.usuario || "";
  }

  const nombreCache = await getCachedName(id);

  if (nombreCache) {
    return nombreCache;
  }

  try {
    const response = await client.get(`/admin/edit/${id}`);
    const nombre = extraerNombreCompletoDesdeEditHtml(response.data);

    const nombreFinal = nombre || usuario.usuario || "";

    if (nombreFinal) {
      await saveCachedName({
        id,
        documento: usuario.documento,
        nombre: nombreFinal,
        empresa: usuario.empresa,
      });
    }

    return nombreFinal;
  } catch (error) {
    console.warn(
      `⚠️ No se pudo leer nombre completo del usuario ID ${id}:`,
      error.message
    );

    return usuario.usuario || "";
  }
}

async function enriquecerUsuariosConNombre(client, usuarios) {
  const resultado = [];

  for (const usuario of usuarios) {
    const nombreCompleto = await obtenerNombreCompletoUsuario(client, usuario);

    resultado.push({
      ...usuario,
      nombre: nombreCompleto,
    });
  }

  return resultado;
}

router.get("/empresa", async (req, res) => {
  try {
    if (!ADMIN_BASE_URL || !ADMIN_USERNAME || !ADMIN_PASSWORD) {
      return res.status(500).json({
        ok: false,
        error:
          "Faltan variables ADMIN_BASE_URL, ADMIN_USERNAME o ADMIN_PASSWORD en Render.",
      });
    }

    const q = normalizarTexto(req.query.q || "");

    if (!q || q.length < 3) {
      return res.json({
        ok: true,
        total: 0,
        usuarios: [],
      });
    }

    const client = crearCliente();

    await loginAdmin(client);

    const response = await client.get(ADMIN_PANEL_PATH);

    const usuarios = extraerUsuariosDesdeHtml(response.data);
    const rango = obtenerRangoFecha(req.query);

    const filtradosBase = usuarios.filter((u) => {
  if (esAdminEmpresa(u)) return false;

  const empresa = normalizarTexto(u.empresa);
  const coincideEmpresa = empresa.includes(q);
  const cumpleFecha = cumpleRangoFecha(u, rango);

  return coincideEmpresa && cumpleFecha;
});

const filtradosConNombre = await enriquecerUsuariosConNombre(client, filtradosBase);

const filtrados = filtradosConNombre.map(limpiarUsuarioParaFrontend);

return res.json({
  ok: true,
  total: filtrados.length,
  usuarios: filtrados,
});
  } catch (error) {
    console.error("❌ Error buscando usuarios por empresa:", error.message);

    return res.status(500).json({
      ok: false,
      error: "No se pudo buscar la empresa.",
      detail: error.message,
    });
  }
});

module.exports = router;