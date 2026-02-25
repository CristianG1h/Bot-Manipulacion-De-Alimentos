"use strict";

function isValidEmail(email) {
  const e = (email || "").trim().toLowerCase();
  if (e.length > 254) return false;
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(e);
}

function normalizeCOCell(input) {
  const digits = (input || "").replace(/\D/g, "");
  const d = digits.startsWith("57") ? digits.slice(2) : digits;
  if (!/^3\d{9}$/.test(d)) return null;
  return { national: d, e164: `+57${d}` };
}

module.exports = { isValidEmail, normalizeCOCell };