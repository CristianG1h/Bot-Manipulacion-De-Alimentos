"use strict";

const { RATE_MAX_PER_MIN, RATE_BLOCK_MIN } = require("../config");

const rateState = new Map();

function isRateLimited(wa_id) {
  const now = Date.now();
  const s = rateState.get(wa_id) || { ts: [], blockedUntil: 0 };

  if (s.blockedUntil && now < s.blockedUntil) {
    rateState.set(wa_id, s);
    return { limited: true, reason: "blocked" };
  }

  s.ts = s.ts.filter((t) => now - t < 60_000);
  s.ts.push(now);

  if (s.ts.length > RATE_MAX_PER_MIN) {
    s.blockedUntil = now + RATE_BLOCK_MIN * 60_000;
    rateState.set(wa_id, s);
    return { limited: true, reason: "too_many" };
  }

  rateState.set(wa_id, s);
  return { limited: false };
}

module.exports = { isRateLimited };
