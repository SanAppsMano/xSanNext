import { Redis } from "@upstash/redis";
import webpush from "web-push";

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (PUBLIC_KEY && PRIVATE_KEY) {
  webpush.setVapidDetails('mailto:example@example.com', PUBLIC_KEY, PRIVATE_KEY);
}

export async function handler(event) {
  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      body: JSON.stringify({ publicKey: PUBLIC_KEY || '' }),
      headers: { 'Content-Type': 'application/json' }
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { tenantId, subscription, message } = body;
  if (!tenantId) return { statusCode: 400, body: 'Missing tenantId' };

  const redis = Redis.fromEnv();
  const key = `tenant:${tenantId}:pushSubs`;

  if (subscription) {
    await redis.sadd(key, JSON.stringify(subscription));
  }

  let subs = [];
  if (message) {
    if (subscription) {
      subs = [subscription];
    } else {
      const stored = await redis.smembers(key);
      subs = stored.map(s => {
        try { return JSON.parse(s); } catch { return null; }
      }).filter(Boolean);
    }
  }

  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, JSON.stringify({ title: 'É a sua vez!', body: message }));
      sent++;
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await redis.srem(key, JSON.stringify(sub));
      }
      console.error('push error', err);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ success: true, sent }) };
}
