"use strict";

function normalizeCOCell(input) {
  const digits = (input || "").replace(/\D/g, "");
  const d = digits.startsWith("57") ? digits.slice(2) : digits;
  if (!/^3\d{9}$/.test(d)) return null;
  return { national: d, e164: `+57${d}` };
}

module.exports = { normalizeCOCell };
