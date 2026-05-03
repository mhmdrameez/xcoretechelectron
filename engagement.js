"use strict";

function localDateKey(ts) {
  const d = ts ? new Date(ts) : new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function shouldShowFreeProReminder(state, nowMs = Date.now()) {
  const s = (state && typeof state === "object") ? state : {};
  const today = localDateKey(nowMs);
  if (s.lastFreeProReminderDate === today) return false;

  const lastAt = Number(s.lastFreeProReminderAt || 0);
  const twentyHoursMs = 20 * 60 * 60 * 1000;
  if (lastAt > 0 && nowMs - lastAt < twentyHoursMs) return false;

  return true;
}

function markFreeProReminderShown(state, nowMs = Date.now()) {
  const next = { ...((state && typeof state === "object") ? state : {}) };
  next.lastFreeProReminderDate = localDateKey(nowMs);
  next.lastFreeProReminderAt = nowMs;
  return next;
}

module.exports = {
  localDateKey,
  shouldShowFreeProReminder,
  markFreeProReminderShown,
};
