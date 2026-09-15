import { readFile } from 'node:fs/promises';

import type pg from 'pg';

import { boampIdOf, findMatchingTender, sourceKey, type TenderCandidate } from '../dedup/match.js';
import { mergeNotices, type MergedTender } from '../dedup/merge.js';
import type { Buyer, Notice } from '../domain/notice.js';
import { matchKey } from '../lib/text.js';

/** A notice read back from its jsonb column, where dates are ISO strings. */
type StoredNotice = Omit<Notice, 'fetchedAt' | 'responseDeadline'> & {
  fetchedAt: string | null;
  responseDeadline: string | null;
};

export interface SaveResult {
  tenderId: number;
  /** False when the notice joined an existing tender: a duplicate from another source, or a re-ingestion. */
  created: boolean;
}

export async function applySchema(client: pg.ClientBase): Promise<void> {
  await client.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
}

// Only tenders some match rule could accept, each branch served by an index: the same source record,
// the same BOAMP notice, or the same buyer postcode with the same deadline (required by the other rules).
async function findCandidates(client: pg.ClientBase, notice: Notice): Promise<TenderCandidate[]> {
  const { rows } = await client.query<TenderCandidate>(
    `WITH candidate_ids AS (
       SELECT tender_id AS id FROM tender_sources WHERE source = $1 AND source_id = $2
       UNION
       SELECT id FROM tenders WHERE boamp_id = $3
       UNION
       SELECT t.id FROM tenders t JOIN buyers b ON b.id = t.buyer_id
        WHERE t.response_deadline = $4 AND b.postcode = $5
     )
     SELECT t.id,
            array_agg(s.source || ':' || s.source_id) AS "sourceKeys",
            t.boamp_id AS "boampId",
            b.postcode AS "buyerPostcode",
            t.buyer_reference AS "buyerReference",
            t.title,
            t.publication_date AS "publicationDate",
            t.response_deadline AS "responseDeadline"
       FROM candidate_ids c
       JOIN tenders t ON t.id = c.id
       JOIN buyers b ON b.id = t.buyer_id
       JOIN tender_sources s ON s.tender_id = t.id
      GROUP BY t.id, b.postcode`,
    [notice.source, notice.sourceId, boampIdOf(notice), notice.responseDeadline, notice.buyer.postcode],
  );
  return rows;
}

async function loadNotices(client: pg.ClientBase, tenderId: number): Promise<Notice[]> {
  const { rows } = await client.query<{ notice: StoredNotice }>(
    'SELECT notice FROM tender_sources WHERE tender_id = $1',
    [tenderId],
  );
  return rows.map(({ notice: stored }) => ({
    ...stored,
    fetchedAt: stored.fetchedAt === null ? null : new Date(stored.fetchedAt),
    responseDeadline: stored.responseDeadline === null ? null : new Date(stored.responseDeadline),
  }));
}

async function upsertBuyer(client: pg.ClientBase, buyer: Buyer): Promise<number> {
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO buyers (match_key, name, siret, street, postcode, city, email, phone, profile_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (match_key) DO UPDATE
       SET name = EXCLUDED.name,
           siret = COALESCE(EXCLUDED.siret, buyers.siret),
           street = COALESCE(EXCLUDED.street, buyers.street),
           postcode = COALESCE(EXCLUDED.postcode, buyers.postcode),
           city = COALESCE(EXCLUDED.city, buyers.city),
           email = COALESCE(EXCLUDED.email, buyers.email),
           phone = COALESCE(EXCLUDED.phone, buyers.phone),
           profile_url = COALESCE(EXCLUDED.profile_url, buyers.profile_url),
           updated_at = now()
     RETURNING id`,
    [
      `${matchKey(buyer.name)}|${buyer.postcode ?? ''}`,
      buyer.name,
      buyer.siret,
      buyer.street,
      buyer.postcode,
      buyer.city,
      buyer.email,
      buyer.phone,
      buyer.profileUrl,
    ],
  );
  return rows[0].id;
}

function tenderValues(buyerId: number, tender: MergedTender): unknown[] {
  return [
    buyerId,
    tender.title,
    tender.description,
    tender.buyerReference,
    tender.boampId,
    tender.publicationDate,
    tender.responseDeadline,
    tender.procedureType,
    tender.marketNature,
    tender.nutsCode,
  ];
}

async function insertTender(client: pg.ClientBase, tender: MergedTender): Promise<number> {
  const buyerId = await upsertBuyer(client, tender.buyer);
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO tenders (buyer_id, title, description, buyer_reference, boamp_id, publication_date,
                          response_deadline, procedure_type, market_nature, nuts_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    tenderValues(buyerId, tender),
  );
  return rows[0].id;
}

async function updateTender(client: pg.ClientBase, tenderId: number, buyerId: number, tender: MergedTender) {
  await client.query(
    `UPDATE tenders
        SET buyer_id = $1, title = $2, description = $3, buyer_reference = $4, boamp_id = $5,
            publication_date = $6, response_deadline = $7, procedure_type = $8, market_nature = $9,
            nuts_code = $10, updated_at = now()
      WHERE id = $11`,
    [...tenderValues(buyerId, tender), tenderId],
  );
}

async function replaceLotsAndCpvCodes(client: pg.ClientBase, tenderId: number, tender: MergedTender) {
  await client.query('DELETE FROM lots WHERE tender_id = $1', [tenderId]);
  await client.query('DELETE FROM tender_cpv_codes WHERE tender_id = $1', [tenderId]);
  for (const lot of tender.lots) {
    await client.query(
      'INSERT INTO lots (tender_id, number, title, description, cpv_codes) VALUES ($1, $2, $3, $4, $5)',
      [tenderId, lot.number, lot.title, lot.description, lot.cpvCodes],
    );
  }
  await client.query(
    `INSERT INTO tender_cpv_codes (tender_id, code, position)
     SELECT $1::bigint, code, ordinality - 1
       FROM unnest($2::text[]) WITH ORDINALITY AS cpv (code, ordinality)`,
    [tenderId, tender.cpvCodes],
  );
}

async function upsertSource(client: pg.ClientBase, tenderId: number, notice: Notice) {
  await client.query(
    `INSERT INTO tender_sources (tender_id, source, source_id, url, fetched_at, notice)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (source, source_id) DO UPDATE
       SET tender_id = EXCLUDED.tender_id,
           url = EXCLUDED.url,
           fetched_at = EXCLUDED.fetched_at,
           notice = EXCLUDED.notice,
           ingested_at = now()`,
    [tenderId, notice.source, notice.sourceId, notice.url, notice.fetchedAt, JSON.stringify(notice)],
  );
}

/** Recomputes a tender from all of its notices, or deletes it when none is left. */
async function rebuildTender(client: pg.ClientBase, tenderId: number) {
  const notices = await loadNotices(client, tenderId);
  if (notices.length === 0) {
    await client.query('DELETE FROM tenders WHERE id = $1', [tenderId]);
    return;
  }
  const tender = mergeNotices(notices);
  const buyerId = await upsertBuyer(client, tender.buyer);
  await updateTender(client, tenderId, buyerId, tender);
  await replaceLotsAndCpvCodes(client, tenderId, tender);
}

/**
 * Attaches the notice to the tender it duplicates, or to a new one, then rebuilds that tender
 * from all of its notices. Idempotent: re-ingesting a notice updates it in place.
 */
export async function saveNotice(client: pg.ClientBase, notice: Notice): Promise<SaveResult> {
  const candidates = await findCandidates(client, notice);
  const match = findMatchingTender(notice, candidates);
  const previousTenderId = candidates.find((candidate) => candidate.sourceKeys.includes(sourceKey(notice)))?.id;

  const tenderId = match?.id ?? (await insertTender(client, mergeNotices([notice])));
  await upsertSource(client, tenderId, notice);
  await rebuildTender(client, tenderId);
  // The notice left its previous tender, e.g. a re-scraped page that now links to its BOAMP notice.
  if (previousTenderId !== undefined && previousTenderId !== tenderId) {
    await rebuildTender(client, previousTenderId);
  }

  return { tenderId, created: match === null };
}

/** Removes buyers left behind when a rebuilt tender switched to another buyer identity. */
export async function deleteOrphanBuyers(client: pg.ClientBase): Promise<number> {
  const { rowCount } = await client.query(
    'DELETE FROM buyers b WHERE NOT EXISTS (SELECT 1 FROM tenders t WHERE t.buyer_id = b.id)',
  );
  return rowCount ?? 0;
}
