export function withinSchedule(schedule, tz) {
  if (!schedule) return true;
  const timezone = schedule.tz || tz || "America/Sao_Paulo";
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: timezone }));
  const day = now.getDay();
  const days = (schedule.days || []).map(Number);
  if (!days.includes(day)) return false;
  if (!schedule.intervals || schedule.intervals.length === 0) return true;
  const mins = now.getHours() * 60 + now.getMinutes();
  const toMins = (t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  return schedule.intervals.some(({ start, end }) =>
    start && end && mins >= toMins(start) && mins < toMins(end)
  );
}

export function msUntilNextInterval(schedule, tz) {
  if (!schedule) return null;
  const timezone = schedule.tz || tz ||
    (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "America/Sao_Paulo");
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: timezone }));
  const baseIntervals = schedule.intervals && schedule.intervals.length
    ? schedule.intervals.slice().sort((a, b) => a.start.localeCompare(b.start))
    : [{ start: "00:00" }];
  for (let offset = 0; offset < 7; offset++) {
    const day = (now.getDay() + offset) % 7;
    if (schedule.days && !schedule.days.includes(day)) continue;
    for (const { start } of baseIntervals) {
      if (!start) continue;
      const [h, m] = start.split(":").map(Number);
      const startDate = new Date(now);
      startDate.setDate(now.getDate() + offset);
      startDate.setHours(h, m, 0, 0);
      if (startDate > now) return startDate - now;
    }
  }
  return null;
}
