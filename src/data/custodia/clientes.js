"use strict";

const zlib = require("zlib");
const compressedBase64 = [
  require("./clientes.parts/01"),
  require("./clientes.parts/02"),
].join("");

const clientes = JSON.parse(
  zlib.gunzipSync(Buffer.from(compressedBase64, "base64")).toString("utf8")
);

// Normalizamos NIT y DV a texto para conservar correctamente valores como DV = 0.
module.exports = clientes.map((empresa) => ({
  ...empresa,
  nit: String(empresa?.nit ?? "").replace(/\D/g, ""),
  dv:
    empresa?.dv === 0 || empresa?.dv === "0"
      ? "0"
      : String(empresa?.dv ?? "").trim(),
}));
