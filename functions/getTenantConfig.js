// functions/getTenantConfig.js

const faunadb = require('faunadb')  // exemplo de banco; mantenha o que você já usa
const q = faunadb.query
const client = new faunadb.Client({ secret: process.env.FAUNA_SECRET })

exports.handler = async (event) => {
  try {
    const token = event.queryStringParameters.t
    // --- seu código existente para buscar o tenant ---
    const result = await client.query(
      q.Get(q.Match(q.Index('tenant_by_token'), token))
    )
    const tenant = result.data

    // Monta o JSON de configuração, agora com companyName
    const config = {
      // campos existentes
      name:           tenant.name,
      slug:           tenant.slug,
      themeColor:     tenant.themeColor,
      // ------------- NOVO CAMPO -------------
      companyName:    tenant.companyName || tenant.name,
      // ... quaisquer outros campos que você já retornava
    }

    return {
      statusCode: 200,
      body: JSON.stringify(config),
      headers: { 'Content-Type': 'application/json' }
    }
  } catch (err) {
    console.error('Erro em getTenantConfig:', err)
    return {
      statusCode: err.status || 500,
      body: JSON.stringify({ error: err.message })
    }
  }
}
