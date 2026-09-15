import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseBoampNotice } from './boamp.js';

const BOAMP_DIR = path.resolve(import.meta.dirname, '..', '..', 'fixtures', 'boamp');

const readFixture = (name: string) => readFile(path.join(BOAMP_DIR, name), 'utf8');

describe('parseBoampNotice', () => {
  it('extracts identifiers, buyer and dates', async () => {
    const notice = parseBoampNotice(await readFixture('24-73088.xml'));

    expect(notice).toMatchObject({
      source: 'BOAMP',
      sourceId: '24-73088',
      buyerReference: '2024DPL0030',
      publicationDate: '2024-06-24',
      procedureType: 'adapted',
      lots: [],
    });
    expect(notice.title).toMatch(/^FOURNITURE DE CAPTEURS CO2/);
    expect(notice.buyer.name).toBe('Département du Doubs');
    expect(notice.responseDeadline?.toISOString()).toBe('2024-07-15T10:00:00.000Z');
  });

  it('extracts lots with a title taken from their description', async () => {
    const notice = parseBoampNotice(await readFixture('24-47259.xml'));

    expect(notice.lots.map((lot) => lot.number)).toEqual([1, 2]);
    expect(notice.lots.every((lot) => lot.title && lot.description)).toBe(true);
  });

  it('parses every fixture into a notice with the mandatory fields', async () => {
    const files = (await readdir(BOAMP_DIR)).filter((file) => file.endsWith('.xml'));

    for (const file of files) {
      const notice = parseBoampNotice(await readFixture(file));
      expect(notice.sourceId).toBe(path.basename(file, '.xml'));
      expect(notice.buyerReference).toBeTruthy();
      expect(notice.publicationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(notice.responseDeadline).toBeInstanceOf(Date);
      expect(notice.marketNature).not.toBeNull();
    }
  });
});
