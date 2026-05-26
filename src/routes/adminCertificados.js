const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const { CookieJar } = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");

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
      usuarios,
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

module.exports = router;