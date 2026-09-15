// French sources publish wall-clock times without an offset; they are always Europe/Paris.
const parisClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Paris',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function parisOffsetMs(instant: number): number {
  const parts = Object.fromEntries(parisClock.formatToParts(instant).map((part) => [part.type, part.value]));
  const wallClock = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return wallClock - instant;
}

// Wall-clock times inside the daylight saving change hour (02:00–03:00), which do not exist or occur twice,
// resolve to a nearby instant without error. Tender deadlines are never set at that time.
export function parisLocalToDate(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  // The offset depends on the instant itself (CET vs CEST), so refine the first guess once.
  const firstGuess = wallClock - parisOffsetMs(wallClock);
  return new Date(wallClock - parisOffsetMs(firstGuess));
}

/** Parses "2024-07-15T12:00:00" (or a bare "2024-07-15") as Paris local time. */
export function parseParisIso(value: string | null): Date | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!match) return null;
  const [, year, month, day, hour = '0', minute = '0'] = match;
  return parisLocalToDate(+year, +month, +day, +hour, +minute);
}
