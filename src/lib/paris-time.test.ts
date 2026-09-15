import { describe, expect, it } from 'vitest';

import { parseParisIso } from './paris-time.js';

describe('parseParisIso', () => {
  it('applies the summer offset (CEST, UTC+2)', () => {
    expect(parseParisIso('2024-07-15T12:00:00')?.toISOString()).toBe('2024-07-15T10:00:00.000Z');
  });

  it('applies the winter offset (CET, UTC+1)', () => {
    expect(parseParisIso('2024-01-15T12:00:00')?.toISOString()).toBe('2024-01-15T11:00:00.000Z');
  });

  it('reads a bare date as midnight in Paris', () => {
    expect(parseParisIso('2024-06-24')?.toISOString()).toBe('2024-06-23T22:00:00.000Z');
  });

  it('returns null for missing or malformed values', () => {
    expect(parseParisIso(null)).toBeNull();
    expect(parseParisIso('15/07/2024')).toBeNull();
  });
});
