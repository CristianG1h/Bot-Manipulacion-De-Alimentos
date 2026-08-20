"use strict";

const axios = require("axios");
const cheerio = require("cheerio");
const { CookieJar } = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");
const { getCachedName, saveCachedName } = require("./certificadosNameCache");

const ADMIN_BASE_URL = String(process.env.ADMIN_BASE_URL || "").replace(/\/+$/, "");
const ADMIN_LOGIN_PATH = process.env.ADMIN_LOGIN_PATH || "/login";
const ADMIN_PANEL_PATH = process.env.ADMIN_PANEL_PATH || "/admin";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_USER_FIELD = process.env.ADMIN_USER_FIELD || "username";
const ADMIN_PASS_FIELD = process.env.ADMIN_PASS_FIELD || "password";
const PUBLIC_CERT_BASE = String(
  process.env.CERTIFICADOS_PUBLIC_BASE_URL ||
  "https://vip-alimentos-qexynvtf7q-uc.a.run.app/certificado"
).replace(/\/+$/, "");

const CACHE_TTL_MS = Number(process.env.CERTIFICADOS_BOT_CACHE_TTL_MS || 5 * 60 * 1000);
let cache = { users: [], updatedAt: 0 };
let refreshPromise = null;

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDocument(value) {
  return String(value || "").replace(/\D/g, "");
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[✅⚠️🔗]/g, "")
    .trim();
}

function absoluteUrl(href) {
  const raw = String(href || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, ADMIN_BASE_URL || PUBLIC_CERT_BASE);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.href;
  } catch (_) {
    return "";
  }
}

function createClient() {
  if (!ADMIN_BASE_URL || !ADMIN_USERNAME || !ADMIN_PASSWORD) {
    throw new Error("Faltan ADMIN_BASE_URL, ADMIN_USERNAME o ADMIN_PASSWORD");
  }
  const jar = new CookieJar();
  return wrapper(axios.create({
    baseURL: ADMIN_BASE_URL,
    jar,
    withCredentials: true,
    timeout: 25000,
    maxRedirects: 5,
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    },
  }));
}

async function login(client) {
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
  const response = await client.post(action, new URLSearchParams(payload).toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${ADMIN_BASE_URL}${ADMIN_LOGIN_PATH}`,
    },
  });
  const finalUrl = String(response?.request?.res?.responseUrl || "");
  if (finalUrl && normalizeText(finalUrl).includes(normalizeText(ADMIN_LOGIN_PATH))) {
    throw new Error("El panel administrativo no aceptó las credenciales");
  }
}

function headerMap($) {
  const map = new Map();
  $("#usersTable thead th").each((index, th) => {
    map.set(normalizeText($(th).text()), index);
  });
  return map;
}

function findHeaderIndex(map, candidates, fallback = -1) {
  for (const [label, index] of map.entries()) {
    if (candidates.some((candidate) => label.includes(candidate))) return index;
  }
  return fallback;
}

function parseUsers(html) {
  const $ = cheerio.load(html);
  const h = headerMap($);
  const idx = {
    id: findHeaderIndex(h, ["id"], 0),
    usuario: findHeaderIndex(h, ["usuario"], 1),
    documento: findHeaderIndex(h, ["documento"], 2),
    tipo: findHeaderIndex(h, ["tipo doc", "tipo"], 3),
    empresa: findHeaderIndex(h, ["empresa"], 4),
    certificado: findHeaderIndex(h, ["certificado"], 8),
    completado: findHeaderIndex(h, ["completado"], 9),
    acciones: findHeaderIndex(h, ["acciones"], 10),
  };
  const users = [];
  $("#usersTable tbody tr").each((_, row) => {
    const cells = $(row).find("td");
    if (!cells.length) return;
    const textAt = (i) => i >= 0 && i < cells.length ? cleanText($(cells[i]).text()) : "";
    const linkAt = (i) => i >= 0 && i < cells.length ? $(cells[i]).find("a").first().attr("href") || "" : "";
    const documento = normalizeDocument(textAt(idx.documento));
    if (!documento) return;
    const certHref = linkAt(idx.certificado);
    const editHref = linkAt(idx.acciones) || $(row).find('a[href*="/edit/"]').first().attr("href") || "";
    const completedText = normalizeText(textAt(idx.completado));
    users.push({
      id: textAt(idx.id),
      usuario: textAt(idx.usuario),
      documento,
      tipo_doc: textAt(idx.tipo),
      empresa: textAt(idx.empresa),
      certificado_url: absoluteUrl(certHref),
      edit_url: absoluteUrl(editHref),
      completado: completedText.includes("si") || completedText.includes("sí"),
    });
  });
  return users;
}

async function refreshUsers() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const client = createClient();
    await login(client);
    const response = await client.get(ADMIN_PANEL_PATH);
    const users = parseUsers(response.data);
    cache = { users, updatedAt: Date.now() };
    return users;
  })();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function getUsers(force = false) {
  const fresh = cache.updatedAt && Date.now() - cache.updatedAt < CACHE_TTL_MS;
  if (!force && fresh) return cache.users;
  try {
    return await refreshUsers();
  } catch (error) {
    if (cache.users.length) {
      console.warn("⚠️ Panel certificados no disponible; usando caché anterior:", error.message);
      return cache.users;
    }
    throw error;
  }
}

function extractInputByLabel($, labelText) {
  let value = "";
  const wanted = normalizeText(labelText);
  $("label").each((_, label) => {
    if (value) return;
    const labelValue = normalizeText($(label).text());
    if (!labelValue.includes(wanted)) return;
    const forId = $(label).attr("for");
    let field = forId ? $(`#${forId}`) : null;
    if (!field || !field.length) field = $(label).closest("div").find("input,select,textarea").first();
    if (field && field.length) value = String(field.val() || "").trim();
  });
  return value;
}

function parseFullName(html) {
  const $ = cheerio.load(html);
  const byLabel = extractInputByLabel($, "nombre completo");
  if (byLabel) return byLabel;
  const selectors = [
    'input[name="nombre_completo"]',
    'input[name="nombre"]',
    'input[name="full_name"]',
    '#nombre_completo',
    '#nombre',
    '#full_name',
  ];
  for (const selector of selectors) {
    const value = $(selector).val();
    if (value) return String(value).trim();
  }
  return "";
}

async function getFullName(user) {
  const id = String(user.id || "").trim();
  if (id) {
    const cached = await getCachedName(id);
    if (cached) return cached;
  }
  const fallback = user.usuario || user.documento;
  if (!id && !user.edit_url) return fallback;
  try {
    const client = createClient();
    await login(client);
    const target = user.edit_url || `/admin/edit/${encodeURIComponent(id)}`;
    const response = await client.get(target);
    const name = parseFullName(response.data) || fallback;
    if (id && name) {
      await saveCachedName({ id, documento: user.documento, nombre: name, empresa: user.empresa });
    }
    return name;
  } catch (error) {
    console.warn(`⚠️ No se pudo enriquecer nombre del estudiante ${user.documento}:`, error.message);
    return fallback;
  }
}

async function findStudent(documentValue) {
  const documento = normalizeDocument(documentValue);
  if (documento.length < 5) return null;
  let users = await getUsers(false);
  let user = users.find((item) => item.documento === documento) || null;
  if (!user) {
    users = await getUsers(true);
    user = users.find((item) => item.documento === documento) || null;
  }
  if (!user) return null;
  const nombre = await getFullName(user);
  const verificationUrl = user.certificado_url || `${PUBLIC_CERT_BASE}/${encodeURIComponent(documento)}`;
  return { ...user, nombre, verification_url: verificationUrl };
}

module.exports = {
  normalizeDocument,
  normalizeText,
  parseUsers,
  parseFullName,
  findStudent,
  getUsers,
};
