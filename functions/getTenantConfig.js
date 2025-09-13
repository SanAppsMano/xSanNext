import faunadb from 'faunadb';
import { error, json } from './utils/response.js';

const q = faunadb.query;
const client = new faunadb.Client({ secret: process.env.FAUNA_SECRET });

export async function handler(event) {
  try {
    const token = event.queryStringParameters.t;
    const result = await client.query(
      q.Get(q.Match(q.Index('tenant_by_token'), token))
    );
    const tenant = result.data;

    const config = {
      name: tenant.name,
      slug: tenant.slug,
      themeColor: tenant.themeColor,
      companyName: tenant.companyName || tenant.name,
    };

    return json(200, config, { 'Content-Type': 'application/json' });
  } catch (err) {
    console.error('Erro em getTenantConfig:', err);
    return error(err.status || 500, err.message);
  }
}
