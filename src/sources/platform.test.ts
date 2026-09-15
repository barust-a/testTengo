import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parsePlatformNotice, type PlatformPage } from './platform.js';

const PLATFORM_DIR = path.resolve(import.meta.dirname, '..', '..', 'fixtures', 'platform');

async function parseFixture(id: string) {
  const manifest = JSON.parse(await readFile(path.join(PLATFORM_DIR, 'pages.json'), 'utf8')) as {
    pages: PlatformPage[];
  };
  const page = manifest.pages.find((entry) => entry.file === `MPI-pub-${id}.html`);
  if (!page) throw new Error(`pages.json has no entry for ${id}`);
  return parsePlatformNotice(await readFile(path.join(PLATFORM_DIR, page.file), 'utf8'), page);
}

describe('parsePlatformNotice', () => {
  it('extracts identifiers, buyer, dates and classification', async () => {
    const notice = await parseFixture('2024110345');

    expect(notice).toMatchObject({
      source: 'marches-publics.info',
      sourceId: '2024110345',
      url: 'https://www.marches-publics.info/Annonces/MPI-pub-2024110345.htm',
      buyerReference: '202401',
      linkedBoampId: '24-47259',
      publicationDate: '2024-04-19',
      procedureType: 'adapted',
      marketNature: 'supplies',
      nutsCode: 'FR103',
    });
    expect(notice.title).toMatch(/^Accord-cadre relatif à la fourniture de produits d'entretien/);
    expect(notice.buyer).toMatchObject({
      name: 'COMMUNE DE CHAVENAY',
      street: "Place de l'église",
      postcode: '78450',
      city: 'CHAVENAY',
      phone: '0130543170',
    });
    expect(notice.buyer.siret).toMatch(/^\d{14}$/);
    expect(notice.responseDeadline?.toISOString()).toBe('2024-05-17T10:00:00.000Z');
    expect(notice.cpvCodes.slice(0, 2)).toEqual(['39224300', '33761000']);
  });

  it('extracts lots with their CPV codes', async () => {
    const notice = await parseFixture('2024110345');

    expect(notice.lots.map((lot) => lot.number)).toEqual([1, 2]);
    expect(notice.lots[0]).toMatchObject({ title: "Produits d'entretien, d'hygiène", cpvCodes: ['39830000'] });
  });

  it('reads the deadline, not the opening date given in the same cell', async () => {
    const notice = await parseFixture('2024113207');

    expect(notice.responseDeadline?.toISOString()).toBe('2024-05-27T10:00:00.000Z');
  });

  it('tolerates a trimmed page without reference nor BOAMP link', async () => {
    const notice = await parseFixture('2024142269');

    expect(notice).toMatchObject({ buyerReference: null, linkedBoampId: null, publicationDate: '2024-05-21' });
    expect(notice.responseDeadline?.toISOString()).toBe('2024-06-18T10:00:00.000Z');
  });
});
