export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }
    const body = JSON.parse(event.body || '{}');
    const {
      tenant,
      numero,
      preferencial,
      guicheLabel,
      name
    } = body;
    if (!tenant || !numero) {
      return { statusCode: 400, body: 'tenant e numero são obrigatórios' };
    }

    const payload = {
      tipo: 'repeat',
      repeat: true,
      nonce: `${Date.now()}-${Math.random().toString(36).slice(2,10)}`,
      ts: Date.now(),
      tenant,
      numero,
      preferencial: !!preferencial,
      guicheLabel: (guicheLabel || '').toString(),
      name: (name || '').toString()
    };

    // Publique para o canal dos monitores do tenant.
    // >>> TROQUE pelo seu bus (Ably/PubSub/Redis/WS). Exemplo genérico:
    // await publish(`tenant:${tenant}:monitor:events`, payload)

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: 'repeat error' };
  }
}
