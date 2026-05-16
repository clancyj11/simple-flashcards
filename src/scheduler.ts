import { Card, CardSchedule, Rating, Settings } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_EASE = 1.3;

/** A fresh, never-reviewed schedule for a newly discovered card. */
export function newSchedule(settings: Settings, card: Card): CardSchedule {
  return {
    due: Date.now(),
    interval: 0,
    ease: settings.startingEase,
    reps: 0,
    lapses: 0,
    lastReviewed: null,
    suspended: false,
    file: card.file,
    text: card.raw,
  };
}

export function isDue(schedule: CardSchedule, now = Date.now()): boolean {
  return !schedule.suspended && schedule.due <= now;
}

export function isNew(schedule: CardSchedule): boolean {
  return schedule.reps === 0 && schedule.lastReviewed === null;
}

/**
 * Apply an SM-2 rating and return the next schedule. Pure — does not mutate.
 */
export function applyRating(
  schedule: CardSchedule,
  rating: Rating,
  settings: Settings,
  now = Date.now(),
): CardSchedule {
  let { ease, reps, lapses } = schedule;
  let interval: number;

  if (rating === "again") {
    lapses += 1;
    reps = 0;
    ease = Math.max(MIN_EASE, ease - 0.2);
    interval = 0; // due again immediately within this session
  } else {
    reps += 1;
    if (rating === "hard") {
      ease = Math.max(MIN_EASE, ease - 0.15);
      interval = reps === 1 ? 1 : schedule.interval * settings.hardFactor;
    } else if (rating === "good") {
      interval = reps === 1 ? 1 : reps === 2 ? 4 : schedule.interval * ease;
    } else {
      // easy
      ease = ease + 0.15;
      interval =
        reps === 1 ? 4 : (reps === 2 ? 4 : schedule.interval * ease) * settings.easyBonus;
    }
  }

  interval = Math.round(interval * 100) / 100;

  return {
    ...schedule,
    ease: Math.round(ease * 100) / 100,
    reps,
    lapses,
    interval,
    lastReviewed: now,
    due: now + Math.max(0, interval) * DAY_MS,
  };
}
