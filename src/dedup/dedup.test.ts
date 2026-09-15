import { describe, expect, it } from 'vitest';

import type { Notice } from '../domain/notice.js';
import { findMatchingTender, type TenderCandidate } from './match.js';
import { mergeNotices } from './merge.js';

function makeNotice(overrides: Partial<Notice> = {}): Notice {
  return {
    source: 'BOAMP',
    sourceId: '24-73088',
    url: null,
    fetchedAt: null,
    buyerReference: '2024DPL0030',
    linkedBoampId: null,
    title: 'FOURNITURE DE CAPTEURS CO2 POUR LES COLLEGES PUBLICS',
    description: null,
    buyer: {
      name: 'Département du Doubs',
      siret: null,
      street: null,
      postcode: '25031',
      city: 'BESANCON',
      email: null,
      phone: null,
      profileUrl: null,
    },
    publicationDate: '2024-06-24',
    responseDeadline: new Date('2024-07-15T10:00:00.000Z'),
    procedureType: 'adapted',
    marketNature: 'supplies',
    nutsCode: null,
    cpvCodes: [],
    lots: [],
    ...overrides,
  };
}

function candidateFrom(id: number, notice: Notice): TenderCandidate {
  return {
    id,
    sourceKeys: [`${notice.source}:${notice.sourceId}`],
    boampId: notice.source === 'BOAMP' ? notice.sourceId : notice.linkedBoampId,
    buyerPostcode: notice.buyer.postcode,
    buyerReference: notice.buyerReference,
    title: notice.title,
    publicationDate: notice.publicationDate,
    responseDeadline: notice.responseDeadline,
  };
}

const boampNotice = makeNotice();
const platformPage = makeNotice({
  source: 'marches-publics.info',
  sourceId: '2024176095',
  linkedBoampId: '24-73088',
});

describe('findMatchingTender', () => {
  it('finds the tender already holding the same source record', () => {
    const otherTender = makeNotice({ sourceId: '24-00001', buyerReference: 'OTHER' });

    const match = findMatchingTender(boampNotice, [candidateFrom(1, otherTender), candidateFrom(2, boampNotice)]);

    expect(match?.id).toBe(2);
  });

  it('matches a platform page to the BOAMP notice it links to', () => {
    const page = { ...platformPage, buyerReference: null, title: 'Unrelated wording' };

    expect(findMatchingTender(page, [candidateFrom(1, boampNotice)])?.id).toBe(1);
  });

  it('matches on buyer reference and deadline when the link is missing', () => {
    const page = { ...platformPage, linkedBoampId: null, title: 'Unrelated wording' };

    expect(findMatchingTender(page, [candidateFrom(1, boampNotice)])?.id).toBe(1);
  });

  it('matches a page without link nor reference on a near-identical title', () => {
    const page = {
      ...platformPage,
      linkedBoampId: null,
      buyerReference: null,
      title: 'Fourniture de capteurs CO2 pour les collèges publics',
    };

    expect(findMatchingTender(page, [candidateFrom(1, boampNotice)])?.id).toBe(1);
  });

  it('keeps apart two tenders of the same buyer', () => {
    const otherTender = makeNotice({
      sourceId: '24-75120',
      buyerReference: '2023DPL0029',
      title: "Mission de maîtrise d'oeuvre pour des travaux de rénovation",
      publicationDate: '2024-06-27',
      responseDeadline: new Date('2024-07-23T10:00:00.000Z'),
    });
    const page = { ...platformPage, linkedBoampId: null };

    expect(findMatchingTender(page, [candidateFrom(1, otherTender)])).toBeNull();
  });

  it('never merges two distinct BOAMP notices', () => {
    const lookAlike = makeNotice({ sourceId: '24-99999' });

    expect(findMatchingTender(lookAlike, [candidateFrom(1, boampNotice)])).toBeNull();
  });

  it('moves a page to the BOAMP tender once the page links to it', () => {
    const pageBeforeLink = { ...platformPage, linkedBoampId: null, buyerReference: null, title: 'Unrelated wording' };
    const candidates = [candidateFrom(1, pageBeforeLink), candidateFrom(2, boampNotice)];

    expect(findMatchingTender(platformPage, candidates)?.id).toBe(2);
  });
});

describe('mergeNotices', () => {
  const detailedPage = makeNotice({
    ...platformPage,
    title: 'Fourniture de capteurs CO2',
    buyer: { ...boampNotice.buyer, name: 'DÉPARTEMENT DU DOUBS', siret: '12345678900011' },
    cpvCodes: ['38000000', '38500000'],
    lots: [{ number: 1, title: 'Capteurs', description: null, cpvCodes: ['38000000'] }],
  });

  it('prefers BOAMP for shared fields and keeps platform-only details', () => {
    const merged = mergeNotices([detailedPage, boampNotice]);

    expect(merged).toMatchObject({
      boampId: '24-73088',
      title: boampNotice.title,
      cpvCodes: ['38000000', '38500000'],
      lots: detailedPage.lots,
    });
    expect(merged.buyer).toMatchObject({ name: 'Département du Doubs', siret: '12345678900011' });
  });

  it('keeps the BOAMP id a platform page links to before the BOAMP notice is ingested', () => {
    expect(mergeNotices([detailedPage]).boampId).toBe('24-73088');
  });

  it('keeps the most complete description whatever its source', () => {
    const merged = mergeNotices([
      { ...detailedPage, description: 'Fourniture et installation de capteurs de CO2 dans les collèges' },
      makeNotice({ description: 'Prix forfaitaires.' }),
    ]);

    expect(merged.description).toBe('Fourniture et installation de capteurs de CO2 dans les collèges');
  });
});
