// Sleeping in a camp tent.
//
// At night (from night_from_hour to wake_hour) you sleep through to the morning;
// in the day you take a nap of nap_hours. The clock jumps ahead by the time
// slept. Recovery scales with it: a full night (full_rest_hours or more) tops up
// stamina to what the altitude allows and clears exhaustion, and every hour asleep
// heals sleep_health_per_hour. Permanent injuries never heal, so health only
// comes back up to the climber's maxHealth.

import { tuning } from './paceModel.js';

/** How long you would sleep if you lay down at this hour (0..24). */
export function sleepPlan(hour) {
  const t = tuning;
  const night = hour >= t.night_from_hour || hour < t.wake_hour;
  const hours = night ? (t.wake_hour - hour + 24) % 24 : t.nap_hours;
  return { night, hours };
}

/** What a sleep of this many hours does to health and stamina. */
export function sleepRecovery(hours, { health, maxHealth, stamina, staminaCap }) {
  const rest = Math.min(hours / tuning.full_rest_hours, 1);
  return {
    health: Math.min(maxHealth, Math.max(health, health + hours * tuning.sleep_health_per_hour)),
    stamina: Math.max(stamina, stamina + (staminaCap - stamina) * rest),
    rested: rest >= 1,
  };
}
