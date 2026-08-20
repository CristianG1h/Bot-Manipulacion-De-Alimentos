"use strict";

const zlib = require("zlib");
const compressedBase64 = [
  require("./clientes.parts/01"),
  require("./clientes.parts/02"),
].join("");

const rawData = JSON.parse(
  zlib.gunzipSync(Buffer.from(compressedBase64, "base64")).toString("utf8")
);

const rawCompanies = Array.isArray(rawData)
  ? rawData
  : Array.isArray(rawData?.empresas)
    ? rawData.empresas
    : [];

if (!rawCompanies.length) {
  throw new Error("Catálogo de empresas de custodia vacío o con formato inválido");
}

const empresas = rawCompanies.map((empresa) => ({
  ...empresa,
  nit: String(empresa?.nit ?? "").replace(/\D/g, ""),
  // Conservar correctamente DV = 0.
  dv:
    empresa?.dv === 0 || empresa?.dv === "0"
      ? "0"
      : String(empresa?.dv ?? "").trim(),
}));

module.exports = {
  ...(Array.isArray(rawData) ? {} : rawData),
  empresas,
};
