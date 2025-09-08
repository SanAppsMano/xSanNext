import { redis } from "./utils/redis.js";
import { KEY_SEQ, KEY_TICKET, KEY_ZSET, parseTipoFromRow, cleanNome } from "./utils/tickets.js";

export async function handler(event) {
  try {
    let payload = {};
    try {
      payload = JSON.parse(event.body || "{}");
    } catch {}
    const { empresa, clientes } = payload;
    if (!empresa || !Array.isArray(clientes) || clientes.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, msg: "Payload inválido" }),
      };
    }

    // 1) alocar números sequenciais atômicos para o LOTE
    const n = clientes.length;
    const fim = await redis.incrby(KEY_SEQ(empresa), n);
    const inicio = fim - n + 1;

    // 2) montar operações (pipeline) preservando a ORDEM da lista
    const ops = [];
    for (let i = 0; i < n; i++) {
      const numero = inicio + i; // numeração na ordem da importação
      const tipo = parseTipoFromRow(clientes[i]); // 'preferencial' | 'normal'
      const nome = cleanNome(clientes[i]);

      // HSET metadados do ticket (ajuste campos conforme seu modelo)
      ops.push(["hset", KEY_TICKET(empresa, numero), {
        numero,
        tipo,
        nome,
        status: "pendente",
        source: "import",
      }]);

      // ZADD no ZSET do tipo (score = número)
      ops.push(["zadd", KEY_ZSET(empresa, tipo), { score: numero, member: String(numero) }]);
    }

    await redis.pipeline(ops).exec();

    // 3) retorno — contagens úteis pro front recarregar
    const [prefCount, normCount] = await Promise.all([
      redis.zcard(KEY_ZSET(empresa, "preferencial")),
      redis.zcard(KEY_ZSET(empresa, "normal")),
    ]);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, inicio, fim, prefCount, normCount }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, msg: "Falha na importação", err: String(e) }),
    };
  }
}
