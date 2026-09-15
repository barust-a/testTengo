import { pool } from '../db/pool.js';
import type { Buyer, Lot, MarketNature, SourceName } from '../domain/notice.js';

export interface TenderSummary {
  id: number;
  title: string;
  buyerName: string;
  publicationDate: Date | null;
  responseDeadline: Date | null;
  sources: SourceName[];
}

export interface TenderSource {
  source: SourceName;
  sourceId: string;
  url: string | null;
  fetchedAt: Date | null;
  ingestedAt: Date;
}

export interface TenderDetail {
  id: number;
  title: string;
  description: string | null;
  buyerReference: string | null;
  boampId: string | null;
  publicationDate: Date | null;
  responseDeadline: Date | null;
  procedureType: string | null;
  marketNature: MarketNature | null;
  nutsCode: string | null;
  buyer: Buyer & { id: number };
  cpvCodes: string[];
  lots: Lot[];
  sources: TenderSource[];
  createdAt: Date;
  updatedAt: Date;
}

// Publication dates are calendar dates; expose them as UTC midnight like the other timestamps.
const PUBLICATION_DATE = `t.publication_date::timestamp AT TIME ZONE 'UTC' AS "publicationDate"`;

export async function listTenders(limit: number, offset: number): Promise<TenderSummary[]> {
  const { rows } = await pool.query<TenderSummary>(
    `SELECT t.id,
            t.title,
            b.name AS "buyerName",
            ${PUBLICATION_DATE},
            t.response_deadline AS "responseDeadline",
            -- A subquery rather than GROUP BY, so the page is read in index order and stops at LIMIT.
            ARRAY(
              SELECT DISTINCT s.source FROM tender_sources s WHERE s.tender_id = t.id ORDER BY s.source
            ) AS sources
       FROM tenders t
       JOIN buyers b ON b.id = t.buyer_id
      ORDER BY t.publication_date DESC NULLS LAST, t.id DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows;
}

export async function countTenders(): Promise<number> {
  const { rows } = await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM tenders');
  return rows[0].count;
}

export async function findTenderById(id: number): Promise<TenderDetail | null> {
  const [tenders, cpvCodes, lots, sources] = await Promise.all([
    pool.query<Omit<TenderDetail, 'cpvCodes' | 'lots' | 'sources'>>(
      `SELECT t.id,
              t.title,
              t.description,
              t.buyer_reference AS "buyerReference",
              t.boamp_id AS "boampId",
              ${PUBLICATION_DATE},
              t.response_deadline AS "responseDeadline",
              t.procedure_type AS "procedureType",
              t.market_nature AS "marketNature",
              t.nuts_code AS "nutsCode",
              json_build_object(
                'id', b.id, 'name', b.name, 'siret', b.siret, 'street', b.street, 'postcode', b.postcode,
                'city', b.city, 'email', b.email, 'phone', b.phone, 'profileUrl', b.profile_url
              ) AS buyer,
              t.created_at AS "createdAt",
              t.updated_at AS "updatedAt"
         FROM tenders t
         JOIN buyers b ON b.id = t.buyer_id
        WHERE t.id = $1`,
      [id],
    ),
    pool.query<{ code: string }>('SELECT code FROM tender_cpv_codes WHERE tender_id = $1 ORDER BY position', [id]),
    pool.query<Lot>(
      `SELECT number, title, description, cpv_codes AS "cpvCodes"
         FROM lots WHERE tender_id = $1 ORDER BY number`,
      [id],
    ),
    pool.query<TenderSource>(
      `SELECT source, source_id AS "sourceId", url, fetched_at AS "fetchedAt", ingested_at AS "ingestedAt"
         FROM tender_sources WHERE tender_id = $1 ORDER BY source`,
      [id],
    ),
  ]);

  const [tender] = tenders.rows;
  if (!tender) return null;
  return {
    ...tender,
    cpvCodes: cpvCodes.rows.map((row) => row.code),
    lots: lots.rows,
    sources: sources.rows,
  };
}
