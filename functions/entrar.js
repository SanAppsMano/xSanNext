import { Redis } from "@upstash/redis";
import { v4 as uuidv4 } from "uuid";
import errorHandler from "./utils/errorHandler.js";

const LOG_TTL = 60 * 60 * 24 * 30; // 30 days

export async function handler(event) {
  try {
    const url      = new URL(event.rawUrl);
    const tenantId = url.searchParams.get("t");
    if (!tenantId) {
      return { statusCode: 400, body: "Missing tenantId" };
    }

    const redis  = Redis.fromEnv();
    const [pwHash, monitor, schedRaw] = await redis.mget(
      `tenant:${tenantId}:pwHash`,
      `monitor:${tenantId}`,
      `tenant:${tenantId}:schedule`
    );
    if (!pwHash && !monitor) {
      return { statusCode: 404, body: "Invalid link" };
    }
    const prefix = `tenant:${tenantId}:`;

    let schedule = null;
    if (schedRaw) {
      try {
        schedule = typeof schedRaw === "string" ? JSON.parse(schedRaw) : schedRaw;
      } catch {}
    } else if (monitor) {
      try {
        const parsed = JSON.parse(monitor);
        schedule = parsed.schedule || null;
      } catch {}
    }

    const withinSchedule = (sched) => {
      if (!sched) return true;
      const tz   = sched.tz || "America/Sao_Paulo";
      const now  = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
      const day  = now.getDay();
      const days = (sched.days || []).map(Number);
      if (!days.includes(day)) return false;
      if (!sched.intervals || sched.intervals.length === 0) return true;
      const mins = now.getHours() * 60 + now.getMinutes();
      const toMins = (t) => {
        const [h, m] = t.split(":").map(Number);
        return h * 60 + m;
      };
      return sched.intervals.some(({ start, end }) => start && end && mins >= toMins(start) && mins < toMins(end));
    };

    // Cria clientId e incrementa contador de tickets
    const clientId     = uuidv4();
    const ticketNumber = await redis.incr(prefix + "ticketCounter");
    // registra ticket e horário de entrada em um único comando
    await redis.mset({
      [prefix + `ticket:${clientId}`]: ticketNumber,
      [prefix + `ticketTime:${ticketNumber}`]: Date.now(),
    });

    const isOffHours = !withinSchedule(schedule);
    if (isOffHours) {
      await redis.sadd(prefix + "offHoursSet", String(ticketNumber));
    }

    // Log de entrada
    const ts = Date.now();
    await redis.lpush(prefix + "log:entered", JSON.stringify({ ticket: ticketNumber, ts }));
    await redis.ltrim(prefix + "log:entered", 0, 999);
    await redis.expire(prefix + "log:entered", LOG_TTL);

    return {
      statusCode: 200,
      body: JSON.stringify({ clientId, ticketNumber, ts }),
    };
  } catch (error) {
    return errorHandler(error);
  }
}
