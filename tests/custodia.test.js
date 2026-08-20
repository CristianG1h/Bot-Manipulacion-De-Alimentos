"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeDigits,
  findByNit,
  findByName,
  bogotaDateParts,
  buildCustodyHtml,
} = require("../src/services/custodiaService");

test("normaliza NIT con puntos, espacios y guiones", () => {
  assert.equal(normalizeDigits("860.501.595 - 0"), "8605015950");
});

test("encuentra BIOQUIMICOS y conserva DV 0", () => {
  const matches = findByNit("860.501.595");
  assert.equal(matches.length, 1);
  assert.match(matches[0].nombre, /BIOQUIMICOS COLOMBIANOS/i);
  assert.equal(matches[0].dv, "0");
});

test("búsqueda aproximada encuentra TEMPORALES AVANZADOS", () => {
  const matches = findByName("avanzados", 5);
  assert.ok(matches.length > 0);
  assert.match(matches[0].nombre, /TEMPORALES AVANZADOS/i);
});

test("fecha se calcula en America/Bogota", () => {
  const parts = bogotaDateParts(new Date("2026-08-20T16:30:00Z"));
  assert.deepEqual(parts, { day: 20, month: "AGOSTO", year: 2026 });
});

test("HTML de custodia contiene razón social, NIT-DV y ambas fechas", () => {
  const company = findByNit("860501595")[0];
  const html = buildCustodyHtml(company, new Date("2026-08-20T16:30:00Z"));
  assert.match(html, /BOGOTÁ, 20 DE AGOSTO DEL 2026/);
  assert.match(html, /BIOQUIMICOS COLOMBIANOS LTDA BIOCOL LTDA/);
  assert.match(html, /No\. 860501595 - 0/);
  assert.match(html, /a los 20 días del mes de AGOSTO del 2026/);
});
