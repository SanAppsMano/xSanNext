import { redis } from "./utils/redis.js";
import { KEY_ZSET } from "./utils/tickets.js";

async function popMin(key) {
  // zrange 0,0 -> menor; depois zrem (pop manual)
  const arr = await redis.zrange(key, 0, 0);
  const member = arr?.[0];
  if (!member) return null;
  await redis.zrem(key, member);
  const numero = parseInt(member, 10);
  return Number.isFinite(numero) ? numero : null;
}

export async function handler(event) {
  try {
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {}
    const { empresa } = body;
    if (!empresa) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, msg: "empresa obrigatória" }),
      };
    }

    // tenta preferencial primeiro
    let numero = await popMin(KEY_ZSET(empresa, "preferencial"));
    let tipo = "preferencial";

    if (numero == null) {
      numero = await popMin(KEY_ZSET(empresa, "normal"));
      tipo = "normal";
    }
    if (numero == null) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: false, msg: "Sem tickets para chamar" }),
      };
    }

    // TODO: atualizar status do ticket, logs, broadcast para monitor/cliente…
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, numero, tipo }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, msg: "Falha ao chamar", err: String(e) }),
    };
  }
}
