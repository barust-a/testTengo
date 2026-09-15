import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Notice } from '../domain/notice.js';
import { loadFixtureNotices } from '../sources/fixtures.js';
import { findMatchingTender, sourceKey, type TenderCandidate } from './match.js';
import { mergeNotices } from './merge.js';

const FIXTURES_DIR = path.resolve(import.meta.dirname, '..', '..', 'fixtures');

// Platform page id → BOAMP IDWEB, checked by hand against both files.
const SAME_TENDER = [
  ['2024110345', '24-47259'],
  ['2024113207', '24-47580'],
  ['2024137323', '24-57353'],
  ['2024142269', '24-58591'],
  ['2024151271', '24-62726'],
  ['2024159367', '24-66836'],
  ['2024170259', '24-70822'],
  ['2024172167', '24-71872'],
  ['2024176095', '24-73088'],
];

const EXPECTED_TENDERS = [
  ...SAME_TENDER.map(([page, idweb]) => `BOAMP:${idweb} + marches-publics.info:${page}`),
  'BOAMP:24-64518',
  'BOAMP:24-75120',
  // Their BOAMP notices are not part of the fixtures.
  'marches-publics.info:2024110308',
  'marches-publics.info:2024121338',
].sort();

/** Replays the ingestion in memory, with the matching and merging used by the database store. */
function deduplicate(notices: Notice[]): string[] {
  const tenders: Notice[][] = [];
  const candidates: TenderCandidate[] = [];

  for (const notice of notices) {
    const id = findMatchingTender(notice, candidates)?.id ?? tenders.push([]) - 1;
    tenders[id].push(notice);
    const merged = mergeNotices(tenders[id]);
    candidates[id] = {
      id,
      sourceKeys: tenders[id].map(sourceKey),
      boampId: merged.boampId,
      buyerPostcode: merged.buyer.postcode,
      buyerReference: merged.buyerReference,
      title: merged.title,
      publicationDate: merged.publicationDate,
      responseDeadline: merged.responseDeadline,
    };
  }

  return tenders.map((group) => group.map(sourceKey).sort().join(' + ')).sort();
}

describe('fixtures', () => {
  it('parses every notice of both sources', async () => {
    const { notices, failures } = await loadFixtureNotices(FIXTURES_DIR);

    expect(failures).toEqual([]);
    expect(notices).toHaveLength(22);
    for (const notice of notices) {
      expect(notice.buyer.postcode, sourceKey(notice)).toMatch(/^\d{5}$/);
      expect(notice.publicationDate, sourceKey(notice)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(notice.responseDeadline, sourceKey(notice)).toBeInstanceOf(Date);
    }
  });

  it('deduplicates the 22 notices into 13 tenders', async () => {
    const { notices } = await loadFixtureNotices(FIXTURES_DIR);

    expect(deduplicate(notices)).toEqual(EXPECTED_TENDERS);
  });

  it('finds the same tenders whatever the ingestion order', async () => {
    const { notices } = await loadFixtureNotices(FIXTURES_DIR);

    expect(deduplicate([...notices].reverse())).toEqual(EXPECTED_TENDERS);
  });
});
