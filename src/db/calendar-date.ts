/** A `date` column comes back as UTC midnight; the domain keeps calendar dates as YYYY-MM-DD. */
export function toCalendarDate(date: Date | null): string | null {
  return date === null ? null : date.toISOString().slice(0, 10);
}

export function fromCalendarDate(date: string | null): Date | null {
  return date === null ? null : new Date(`${date}T00:00:00Z`);
}
