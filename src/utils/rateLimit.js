"use strict";

const redis = require("../services/redis");
const { RATE_MAX_PER_MIN, RATE_BLOCK_MIN } = require("../config");

async function isRateLimited(wa_id) {
  const blockedKey = `blocked:${wa_id}`;
  const countKey   = `rate:${wa_id}`;

  // ¿Está bloqueado?
  const blocked = await redis.get(blockedKey);
  if (blocked) return { limited: true, reason: "blocked" };

  // Contar mensajes en el último minuto
  const count = await redis.incr(countKey);
  if (count === 1) {
    await redis.expire(countKey, 60); // expira en 60 segundos
  }

  if (count > RATE_MAX_PER_MIN) {
    await redis.set(blockedKey, "1", { ex: RATE_BLOCK_MIN * 60 });
    return { limited: true, reason: "too_many" };
  }

  return { limited: false };
}

module.exports = { isRateLimited };
