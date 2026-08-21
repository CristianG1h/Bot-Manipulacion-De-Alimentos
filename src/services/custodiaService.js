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

// Plantilla basada directamente en CERTIFICADO_CUSTODIA_EDITABLE.html.
// En producción se omite el panel de edición y se insertan los datos antes
// de imprimir, para que el PDF salga con el mismo diseño y sin pasos manuales.
function buildCustodyHtml(company, date = new Date()) {
  if (!company?.nombre || !company?.nit) {
    throw new Error("Empresa de custodia inválida");
  }

  const { day, month, year } = bogotaDateParts(date);
  const { memberteDataUrl: bg, firmaDataUrl: signature } = getAssets();
  const dv = companyDv(company);
  const companyName = escapeHtml(company.nombre).toUpperCase();
  const nit = escapeHtml(company.nit);
  const dvText = escapeHtml(dv || "?");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Certificado de Custodia - VIP Salud Ocupacional</title>
<style>
  @page { size: Letter portrait; margin: 0; }
  * {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  html, body {
    margin: 0;
    padding: 0;
    width: 8.5in;
    height: 11in;
    background: #fff;
  }
  body {
    font-family: Arial, Helvetica, sans-serif;
    color: #111;
  }
  .certificate {
    position: relative;
    width: 8.5in;
    height: 11in;
    overflow: hidden;
    background: #fff;
  }
  .background {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: fill;
    display: block;
    z-index: 0;
  }
  .cert-text {
    position: absolute;
    z-index: 2;
    color: #111;
  }
  .top-date {
    left: 5.1%;
    top: 11.8%;
    font-size: 11pt;
    font-weight: 700;
    text-transform: uppercase;
  }
  .company-heading {
    left: 0;
    right: 0;
    top: 18.6%;
    text-align: center;
    font-size: 12.4pt;
    font-weight: 700;
  }
  .certifica {
    left: 0;
    right: 0;
    top: 23%;
    text-align: center;
    font-size: 12.4pt;
    font-weight: 700;
  }
  .body-copy {
    left: 5.1%;
    right: 10.7%;
    top: 28.4%;
    font-size: 10.2pt;
    line-height: 1.38;
    text-align: left;
  }
  .body-copy p {
    margin: 0 0 10px;
  }
  .dynamic {
    font-weight: 700;
  }
  .closing {
    left: 5.1%;
    top: 54%;
    font-size: 10.6pt;
  }
  .signature {
    position: absolute;
    z-index: 2;
    left: 5.5%;
    top: 59%;
    width: 28.5%;
    height: auto;
    display: block;
  }
  .signatory {
    left: 5.1%;
    top: 64%;
    font-size: 10.2pt;
    line-height: 1.38;
  }
  .signatory .name {
    font-weight: 700;
  }
  .signatory .email {
    color: #174ea6;
    text-decoration: underline;
  }
  .motto {
    left: 0;
    right: 0;
    top: 75.4%;
    text-align: center;
    font-size: 13pt;
    font-weight: 700;
  }
</style>
</head>
<body>
<section class="certificate" aria-label="Certificado de custodia clínica">
  <img class="background" src="${bg}" alt="">

  <div class="cert-text top-date">BOGOTÁ, ${day} DE ${escapeHtml(month)} DEL ${year}</div>
  <div class="cert-text company-heading">VIP SALUD OCUPACIONAL S.A.S.</div>
  <div class="cert-text certifica">CERTIFICA:</div>

  <div class="cert-text body-copy">
    <p>
      Que viene realizando los exámenes médicos ocupacionales, acompañamiento en los sistemas de gestión
      de seguridad y salud en el trabajo y la custodia de las evaluaciones médicas ocupacionales de la empresa:
      <span class="dynamic">${companyName}</span> Con número de identificación tributaria No.
      <span class="dynamic">${nit}</span> – <span class="dynamic">${dvText}</span>
      se encuentra bajo nuestra responsabilidad y confidencialidad, siguiendo la RE: 1995 de 1999; ya que
      somos el prestador de servicios de salud ocupacional que las generó en el curso de la atención.
      Cumpliendo los requisitos y procedimientos de archivo conforme a las normas legales vigentes para el
      manejo de historias clínicas.
    </p>
    <p>
      En constancia se expide en la ciudad de Bogotá D.C. a los ${day} días del mes de
      <span class="dynamic">${escapeHtml(month)}</span> del ${year} con destino al interesado.
    </p>
  </div>

  <div class="cert-text closing">Cordialmente,</div>
  <img class="signature" src="${signature}" alt="Firma">
  <div class="cert-text signatory">
    <div class="name">Diego Mauricio Barragán Rocha</div>
    <div>Representante legal Vip Salud Ocupacional</div>
    <div>Tel. 3134010901</div>
    <div class="email">vipsaludocupacional@gmail.com</div>
  </div>

  <div class="cert-text motto">“BRINDAMOS PROTECCIÓN Y BIENESTAR”</div>
</section>
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
  const startedAt = Date.now();

  try {
    const pdf = await renderHtmlToPdf(html);
    if (!validPdf(pdf)) {
      throw new Error("Chrome devolvió un archivo que no es PDF");
    }

    console.log(`✅ PDF Custodia generado en ${Date.now() - startedAt} ms`);
    return pdf;
  } catch (error) {
    console.error(
      `❌ Render PDF Custodia falló después de ${Date.now() - startedAt} ms:`,
      error.message
    );
    throw error;
  }
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
