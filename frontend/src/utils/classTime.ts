/**
 * Pure time helpers that compare the current time against a class's
 * `start_time` / `end_time` (ISO 8601 strings from the ClassSession model).
 *
 * Everything takes `now` as a parameter (defaulting to `Date.now()`) so the
 * functions stay deterministic and easy to test.
 */

export type ClassPhase = 'Waiting' | 'Tracking Active' | 'Ended'

export type ClassWindow = {
  start_time: string
  end_time: string
}

/**
 * Where `now` sits relative to the class window. The start is inclusive and
 * the end is exclusive, so a class is never "active" and "ended" at once.
 * A window with an unparseable date is treated as 'Ended' so it can never
 * trigger GPS tracking.
 */
export function getClassPhase(
  classWindow: ClassWindow,
  now: number = Date.now(),
): ClassPhase {
  const start = Date.parse(classWindow.start_time)
  const end = Date.parse(classWindow.end_time)

  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 'Ended'
  if (now < start) return 'Waiting'
  if (now < end) return 'Tracking Active'
  return 'Ended'
}

export function isClassActive(
  classWindow: ClassWindow,
  now: number = Date.now(),
): boolean {
  return getClassPhase(classWindow, now) === 'Tracking Active'
}

/** Every class whose window contains `now`. */
export function getActiveClasses<T extends ClassWindow>(
  classes: readonly T[],
  now: number = Date.now(),
): T[] {
  return classes.filter((item) => isClassActive(item, now))
}

/** Classes that start on the same local calendar day as `now`. */
export function getTodaysClasses<T extends ClassWindow>(
  classes: readonly T[],
  now: number = Date.now(),
): T[] {
  const today = new Date(now)

  return classes.filter((item) => {
    const start = new Date(item.start_time)
    return (
      start.getFullYear() === today.getFullYear() &&
      start.getMonth() === today.getMonth() &&
      start.getDate() === today.getDate()
    )
  })
}
