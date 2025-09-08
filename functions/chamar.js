import { redis } from "./utils/redis.js";
import { KEY_ZSET } from "./utils/tickets.js";

function parseEmpresaFromHost(host) {
  if (!host) return null;
  const [sub] = host.split('.');
  if (!sub || sub === 'www') return null;
  return sub;
}

function getCookie(name, cookieHeader) {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function pickEmpresa(event) {
  let empresa = null;

  if (event.body) {
    try {
      const b = JSON.parse(event.body);
      if (b && b.empresa) empresa = b.empresa;
    } catch {}
  }

  if (!empresa) {
    empresa = event.headers?.['x-empresa'] || event.headers?.['X-Empresa'];
  }

  if (!empresa) {
    empresa = getCookie('empresa', event.headers?.cookie || event.headers?.Cookie);
  }

  if (!empresa) {
    empresa = parseEmpresaFromHost(event.headers?.host);
  }

  return empresa;
}

async function popMin(key) {
  const arr = await redis.zrange(key, 0, 0);
  const member = arr?.[0];
  if (!member) return null;
  await redis.zrem(key, member);
  const numero = parseInt(member, 10);
  return Number.isFinite(numero) ? numero : null;
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ ok: false, msg: 'Método não permitido' })
    };
  }

  const empresa = pickEmpresa(event);

  if (!empresa) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        ok: false,
        msg: 'empresa obrigatória (envie no body {empresa}, no header X-Empresa, cookie "empresa" ou via subdomínio)'
      })
    };
  }

  try {
    let numero = await popMin(KEY_ZSET(empresa, 'preferencial'));
    let tipo = 'preferencial';

    if (numero == null) {
      numero = await popMin(KEY_ZSET(empresa, 'normal'));
      tipo = 'normal';
    }

    if (numero == null) {
      return { statusCode: 200, body: JSON.stringify({ ok: false, msg: 'Sem tickets para chamar' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, numero, tipo }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, msg: 'Falha ao chamar', err: String(err) }) };
  }
}

