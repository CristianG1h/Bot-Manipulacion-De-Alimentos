"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const custodiaData = require("../src/data/custodia/clientes");
const {
  extractRowsFromResponse,
  mapBiofileRows,
  bogotaDateString,
  applyCompanies,
} = require("../src/services/biofileCustodiaSync");

test("extrae Datos de una respuesta ASP.NET anidada en d", () => {
  const payload = {
    d: JSON.stringify({
      Datos: [
        {
          "Nombre del Acuerdo Comercial, Contrato o Convenio": "EMPRESA PRUEBA SAS",
          Tipo: "NIT",
          "N° de Identificación del Cliente": "901 999 888",
          Dv: "4",
        },
      ],
    }),
  };

  const rows = extractRowsFromResponse(payload);
  assert.equal(rows.length, 1);
  assert.equal(
    rows[0]["Nombre del Acuerdo Comercial, Contrato o Convenio"],
    "EMPRESA PRUEBA SAS"
  );
});

test("normaliza filas BIOFILE y elimina duplicados exactos", () => {
  const rows = [
    {
      "Nombre del Acuerdo Comercial, Contrato o Convenio": "EMPRESA PRUEBA S.A.S.",
      Tipo: "NIT",
      "N° de Identificación del Cliente": "901.999.888",
      Dv: 0,
      "Fecha de Creación": "21/08/2026 08:00:00 a. m.",
    },
    {
      "Nombre del Acuerdo Comercial, Contrato o Convenio": "EMPRESA PRUEBA S.A.S.",
      Tipo: "NIT",
      "N° de Identificación del Cliente": "901999888",
      Dv: "0",
      "Fecha de Creación": "21/08/2026 08:05:00 a. m.",
    },
  ];

  const companies = mapBiofileRows(rows);
  assert.equal(companies.length, 1);
  assert.equal(companies[0].nit, "901999888");
  assert.equal(companies[0].dv, "0");
});

test("fecha de consulta se calcula en zona horaria de Bogotá", () => {
  assert.equal(
    bogotaDateString(new Date("2026-08-22T03:30:00Z")),
    "21/08/2026"
  );
});

test("aplica una empresa nueva al arreglo compartido de custodia", () => {
  const original = custodiaData.empresas.map((item) => ({ ...item }));
  const before = custodiaData.empresas.length;

  try {
    const result = applyCompanies([
      {
        nombre: "EMPRESA SINTETICA SIN DATOS REALES SAS",
        nit: "999888777",
        dv: "1",
        fuente: "BIOFILE",
      },
    ]);

    assert.ok(result.afterCount >= before);
    assert.equal(
      custodiaData.empresas.some(
        (item) =>
          item.nit === "999888777" &&
          item.nombre === "EMPRESA SINTETICA SIN DATOS REALES SAS"
      ),
      true
    );
  } finally {
    custodiaData.empresas.splice(0, custodiaData.empresas.length, ...original);
  }
});
