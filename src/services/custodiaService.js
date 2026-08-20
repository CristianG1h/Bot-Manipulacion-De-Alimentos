"use strict";

const data = require("../data/custodia/clientes");
const assets = require("../data/custodia/assets");
const { renderHtmlToPdf } = require("./browserPdf");

const companies = Array.isArray(data.empresas) ? data.empresas : [];

const LETTER_REPLACEMENTS = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => LETTER_REPLACEMENTS[char]);
}

function normalizeDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeName(value) {
  return String(value || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\bS\s*A\s*S\b/g, "SAS")
    .replace(/\bS\s*A\b/g, "SA")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenScore(query, candidate) {
  const q = normalizeName(query);
  const c = normalizeName(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;
  if (c.includes(q) || q.includes(c)) return 0.97;

  const qTokens = new Set(q.split(" ").filter(Boolean));
  const cTokens = new Set(c.split(" ").filter(Boolean));
  const intersection = [...qTokens].filter((t) => cTokens.has(t)).length;
  const union = new Set([...qTokens, ...cTokens]).size || 1;
  const coverage = intersection / Math.max(1, qTokens.size);
  const jaccard = intersection / union;

  function bigrams(text) {
    const compact = text.replace(/\s+/g, " ");
    const set = new Set();
    for (let i = 0; i < compact.length - 1; i += 1) {
      set.add(compact.slice(i, i + 2));
    }
    return set;
  }

  const qa = bigrams(q);
  const ca = bigrams(c);
  const biIntersection = [...qa].filter((x) => ca.has(x)).length;
  const dice = qa.size + ca.size
    ? (2 * biIntersection) / (qa.size + ca.size)
    : 0;

  return Math.max(dice, 0.68 * coverage + 0.32 * jaccard);
}

function dedupeCompanies(list) {
  const seen = new Set();
  const result = [];

  for (const item of list) {
    const key = `${item.nit}|${item.dv}|${normalizeName(item.nombre)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function findByNit(value) {
  const nit = normalizeDigits(value);
  if (!nit) return [];
  return dedupeCompanies(
    companies.filter((item) => String(item.nit) === nit)
  );
}

function findByName(value, limit = 5) {
  const query = normalizeName(value);
  if (query.length < 3) return [];

  return dedupeCompanies(companies)
    .map((item) => ({
      ...item,
      score: tokenScore(query, item.nombre),
    }))
    .filter((item) => item.score >= 0.46)
    .sort((a, b) => b.score - a.score || a.nombre.localeCompare(b.nombre, "es"))
    .slice(0, Math.max(1, Math.min(Number(limit) || 5, 8)));
}

function bogotaDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((p) => [p.type, p.value])
  );

  return {
    day: Number(parts.day),
    month: String(parts.month || "").toUpperCase(),
    year: Number(parts.year),
  };
}

function companyDv(company) {
  if (company?.dv === 0 || company?.dv === "0") return "0";
  return String(company?.dv ?? "").trim();
}

function getAssets() {
  return {
    memberteDataUrl: assets.membrete,
    firmaDataUrl: assets.firma,
  };
}

function buildCustodyHtml(company, date = new Date()) {
  if (!company?.nombre || !company?.nit) {
    throw new Error("Empresa de custodia inválida");
  }

  const { day, month, year } = bogotaDateParts(date);
  const { memberteDataUrl: bg, firmaDataUrl: signature } = getAssets();
  const dv = companyDv(company);
  const nitWithDv = `${escapeHtml(company.nit)} - ${escapeHtml(dv || "?")}`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; width: 210mm; height: 297mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; }
  .page { position: relative; width: 210mm; height: 297mm; overflow: hidden; background: url("${bg}") center/100% 100% no-repeat; }
  .date { position: absolute; left: 13.4mm; top: 41.2mm; font-size: 9pt; font-weight: 700; }
  .company-title { position: absolute; top: 61.2mm; left: 15mm; right: 15mm; text-align: center; font-size: 11.5pt; font-weight: 700; }
  .certifica { position: absolute; top: 75.4mm; left: 15mm; right: 15mm; text-align: center; font-size: 10.5pt; font-weight: 700; }
  .content { position: absolute; left: 13.4mm; right: 19.5mm; top: 87.5mm; font-size: 9.1pt; line-height: 1.42; text-align: left; }
  .content p { margin: 0 0 4.1mm 0; }
  .signature-block { position: absolute; left: 13.4mm; top: 155.7mm; font-size: 9pt; line-height: 1.35; }
  .cordial { margin-bottom: 6.4mm; }
  .signature { width: 54mm; height: 13mm; object-fit: contain; object-position: left bottom; display: block; margin: 0 0 1.5mm 0; }
  .signer-name { font-weight: 700; }
  .email { color: #00e; text-decoration: underline; }
  .motto { position: absolute; left: 15mm; right: 15mm; top: 216mm; text-align: center; font-size: 10.6pt; font-weight: 700; }
</style>
</head>
<body>
<div class="page">
  <div class="date">BOGOTÁ, ${day} DE ${escapeHtml(month)} DEL ${year}</div>
  <div class="company-title">VIP SALUD OCUPACIONAL S.A.S.</div>
  <div class="certifica">CERTIFICA:</div>
  <div class="content">
    <p>Que viene realizando los exámenes médicos ocupacionales, acompañamiento en los sistemas de gestión de seguridad y salud en el trabajo y la custodia de las evaluaciones médicas ocupacionales de la empresa: <strong>${escapeHtml(company.nombre)}</strong> Con número de identificación tributaria <strong>No. ${nitWithDv}</strong> se encuentra bajo nuestra responsabilidad y confidencialidad, siguiendo la RE: 1995 de 1999; ya que somos el prestador de servicios de salud ocupacional que las generó en el curso de la atención. Cumpliendo los requisitos y procedimientos de archivo conforme a las normas legales vigentes para el manejo de historias clínicas.</p>
    <p>En constancia se expide en la ciudad de Bogotá D.C. a los ${day} días del mes de ${escapeHtml(month)} del ${year} con destino al interesado.</p>
  </div>
  <div class="signature-block">
    <div class="cordial">Cordialmente,</div>
    <img class="signature" src="${signature}" alt="Firma">
    <div class="signer-name">Diego Mauricio Barragán Rocha</div>
    <div>Representante legal Vip Salud Ocupacional</div>
    <div>Tel. 3134010901</div>
    <div class="email">vipsaludocupacional@gmail.com</div>
  </div>
  <div class="motto">“BRINDAMOS PROTECCIÓN Y BIENESTAR”</div>
</div>
</body>
</html>`;
}

function validPdf(buffer) {
  return Buffer.isBuffer(buffer) &&
    buffer.length > 5 &&
    buffer.subarray(0, 5).toString() === "%PDF-";
}

async function renderCustodyPdf(company, date = new Date()) {
  if (!company?.nombre || !company?.nit) {
    throw new Error("Empresa de custodia inválida");
  }

  const html = buildCustodyHtml(company, date);
  let lastError = null;

  // Custodia usa el mismo motor Chrome que ya genera correctamente los
  // certificados de Manipulación. Así evitamos el parser JPEG de PDFKit,
  // que rechazaba el membrete en Render con `Invalid JPEG`.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const pdf = await renderHtmlToPdf(html);
      if (validPdf(pdf)) return pdf;
      lastError = new Error("Chrome devolvió un archivo que no es PDF");
    } catch (error) {
      lastError = error;
      console.warn(
        `⚠️ Render PDF Custodia intento ${attempt}/2:`,
        error.message
      );
    }
  }

  throw lastError || new Error("No se pudo generar el PDF de custodia");
}

function safeFileName(name) {
  const base = normalizeName(name)
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 70) || "EMPRESA";

  const { day, year } = bogotaDateParts();
  const month = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    month: "2-digit",
  }).format(new Date());

  return `CERTIFICADO_CUSTODIA_${base}_${year}-${month}-${String(day).padStart(2, "0")}.pdf`;
}

async function buildCustodyCertificate(company) {
  const pdfBuffer = await renderCustodyPdf(company, new Date());

  if (!validPdf(pdfBuffer)) {
    throw new Error("No se pudo generar un PDF válido de custodia");
  }

  return {
    pdfBuffer,
    fileName: safeFileName(company.nombre),
  };
}

module.exports = {
  normalizeDigits,
  normalizeName,
  tokenScore,
  findByNit,
  findByName,
  bogotaDateParts,
  buildCustodyHtml,
  renderCustodyPdf,
  buildCustodyCertificate,
};
