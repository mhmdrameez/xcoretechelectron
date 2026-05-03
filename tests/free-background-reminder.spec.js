const { test, expect } = require('@playwright/test');
const {
  localDateKey,
  shouldShowFreeProReminder,
  markFreeProReminderShown,
} = require('../engagement');

test.describe('Free Background Pro Reminder Cadence', () => {
  test('allows a reminder when no previous reminder was shown', () => {
    const now = new Date('2026-05-03T09:30:00').getTime();
    expect(shouldShowFreeProReminder({}, now)).toBe(true);
  });

  test('blocks repeated reminders on the same local day', () => {
    const morning = new Date('2026-05-03T09:30:00').getTime();
    const afternoon = new Date('2026-05-03T17:30:00').getTime();
    const state = markFreeProReminderShown({}, morning);

    expect(state.lastFreeProReminderDate).toBe(localDateKey(morning));
    expect(shouldShowFreeProReminder(state, afternoon)).toBe(false);
  });

  test('blocks next-day reminders until enough time has passed', () => {
    const lateNight = new Date('2026-05-03T23:30:00').getTime();
    const earlyMorning = new Date('2026-05-04T06:30:00').getTime();
    const state = markFreeProReminderShown({}, lateNight);

    expect(shouldShowFreeProReminder(state, earlyMorning)).toBe(false);
  });

  test('allows the next daily reminder after the cooldown', () => {
    const first = new Date('2026-05-03T09:30:00').getTime();
    const nextDay = new Date('2026-05-04T10:00:00').getTime();
    const state = markFreeProReminderShown({}, first);

    expect(shouldShowFreeProReminder(state, nextDay)).toBe(true);
  });
});
