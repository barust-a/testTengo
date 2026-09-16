import { boampIdOf, buyerMatchKey, findMatchingTender, sourceKey, type TenderCandidate } from '../dedup/match.js';
import { mergeNotices, type MergedTender } from '../dedup/merge.js';
import type { Buyer, Notice } from '../domain/notice.js';
import { fromCalendarDate, toCalendarDate } from './calendar-date.js';
import type { Prisma } from './prisma.js';

type Tx = Prisma.TransactionClient;

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

function sourceWhere(notice: Notice) {
  return { source_sourceId: { source: notice.source, sourceId: notice.sourceId } };
}

// Only tenders some match rule could accept, each branch served by an index: the same source record,
// the same BOAMP notice, or the same buyer postcode with the same deadline (required by the other rules).
// Three queries rather than one `OR`: Prisma renders the relation filter as a correlated EXISTS, and an
// OR over it makes Postgres filter every tender. Null values are skipped, since in Prisma
// `{ boampId: null }` would match every tender without a BOAMP id.
async function findCandidateIds(tx: Tx, notice: Notice): Promise<bigint[]> {
  const boampId = boampIdOf(notice);
  const { responseDeadline } = notice;
  const { postcode } = notice.buyer;

  const source = await tx.tenderSource.findUnique({ where: sourceWhere(notice), select: { tenderId: true } });
  const sameBoampId =
    boampId === null ? null : await tx.tender.findUnique({ where: { boampId }, select: { id: true } });
  const sameDeadline =
    responseDeadline === null || postcode === null
      ? []
      : await tx.tender.findMany({ where: { responseDeadline, buyer: { postcode } }, select: { id: true } });
  return [source?.tenderId, sameBoampId?.id, ...sameDeadline.map(({ id }) => id)].filter(
    (id): id is bigint => id !== undefined,
  );
}

async function findCandidates(tx: Tx, notice: Notice): Promise<TenderCandidate[]> {
  const ids = await findCandidateIds(tx, notice);
  if (ids.length === 0) return [];

  const tenders = await tx.tender.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      boampId: true,
      buyerReference: true,
      title: true,
      publicationDate: true,
      responseDeadline: true,
      buyer: { select: { postcode: true } },
      sources: { select: { source: true, sourceId: true } },
    },
  });

  return tenders.map((tender) => ({
    id: Number(tender.id),
    sourceKeys: tender.sources.map(sourceKey),
    boampId: tender.boampId,
    buyerPostcode: tender.buyer.postcode,
    buyerReference: tender.buyerReference,
    title: tender.title,
    publicationDate: toCalendarDate(tender.publicationDate),
    responseDeadline: tender.responseDeadline,
  }));
}

function toDateOrNull(isoString: string | null): Date | null {
  return isoString === null ? null : new Date(isoString);
}

async function loadNotices(tx: Tx, tenderId: number): Promise<Notice[]> {
  const rows = await tx.tenderSource.findMany({ where: { tenderId }, select: { notice: true } });
  return rows.map(({ notice }) => {
    const stored = notice as unknown as StoredNotice;
    return {
      ...stored,
      fetchedAt: toDateOrNull(stored.fetchedAt),
      responseDeadline: toDateOrNull(stored.responseDeadline),
    };
  });
}

async function upsertBuyer(tx: Tx, buyer: Buyer): Promise<bigint> {
  const create = {
    matchKey: buyerMatchKey(buyer),
    name: buyer.name,
    siret: buyer.siret,
    street: buyer.street,
    postcode: buyer.postcode,
    city: buyer.city,
    email: buyer.email,
    phone: buyer.phone,
    profileUrl: buyer.profileUrl,
  };
  const { id } = await tx.buyer.upsert({
    where: { matchKey: create.matchKey },
    create,
    // `undefined` leaves a column untouched, so a notice missing a field never erases a known value.
    update: {
      name: buyer.name,
      siret: buyer.siret ?? undefined,
      street: buyer.street ?? undefined,
      postcode: buyer.postcode ?? undefined,
      city: buyer.city ?? undefined,
      email: buyer.email ?? undefined,
      phone: buyer.phone ?? undefined,
      profileUrl: buyer.profileUrl ?? undefined,
    },
    select: { id: true },
  });
  return id;
}

/** Upserts the buyer and builds the tender row data to create or update from it. */
async function resolveTenderData(tx: Tx, tender: MergedTender) {
  return {
    buyerId: await upsertBuyer(tx, tender.buyer),
    title: tender.title,
    description: tender.description,
    buyerReference: tender.buyerReference,
    boampId: tender.boampId,
    publicationDate: fromCalendarDate(tender.publicationDate),
    responseDeadline: tender.responseDeadline,
    procedureType: tender.procedureType,
    marketNature: tender.marketNature,
    nutsCode: tender.nutsCode,
  };
}

async function insertTender(tx: Tx, tender: MergedTender): Promise<number> {
  const data = await resolveTenderData(tx, tender);
  const { id } = await tx.tender.create({ data, select: { id: true } });
  return Number(id);
}

async function replaceLotsAndCpvCodes(tx: Tx, tenderId: number, tender: MergedTender) {
  await tx.lot.deleteMany({ where: { tenderId } });
  await tx.tenderCpvCode.deleteMany({ where: { tenderId } });
  await tx.lot.createMany({
    data: tender.lots.map((lot) => ({
      tenderId,
      number: lot.number,
      title: lot.title,
      description: lot.description,
      cpvCodes: lot.cpvCodes,
    })),
  });
  await tx.tenderCpvCode.createMany({
    data: tender.cpvCodes.map((code, position) => ({ tenderId, code, position })),
  });
}

async function upsertSource(tx: Tx, tenderId: number, notice: Notice) {
  // Round-trip through JSON so dates are stored as ISO strings, as loadNotices expects.
  const stored = JSON.parse(JSON.stringify(notice)) as Prisma.InputJsonObject;
  await tx.tenderSource.upsert({
    where: sourceWhere(notice),
    create: {
      tenderId,
      source: notice.source,
      sourceId: notice.sourceId,
      url: notice.url,
      fetchedAt: notice.fetchedAt,
      notice: stored,
    },
    update: { tenderId, url: notice.url, fetchedAt: notice.fetchedAt, notice: stored, ingestedAt: new Date() },
  });
}

/** Recomputes a tender from all of its notices, or deletes it when none is left. */
async function rebuildTender(tx: Tx, tenderId: number) {
  const notices = await loadNotices(tx, tenderId);
  if (notices.length === 0) {
    await tx.tender.delete({ where: { id: tenderId } });
    return;
  }
  const tender = mergeNotices(notices);
  const data = await resolveTenderData(tx, tender);
  await tx.tender.update({ where: { id: tenderId }, data });
  await replaceLotsAndCpvCodes(tx, tenderId, tender);
}

/**
 * Attaches the notice to the tender it duplicates, or to a new one, then rebuilds that tender
 * from all of its notices. Idempotent: re-ingesting a notice updates it in place.
 */
export async function saveNotice(tx: Tx, notice: Notice): Promise<SaveResult> {
  const candidates = await findCandidates(tx, notice);
  const match = findMatchingTender(notice, candidates);
  const previousTenderId = candidates.find((candidate) => candidate.sourceKeys.includes(sourceKey(notice)))?.id;

  const tenderId = match?.id ?? (await insertTender(tx, mergeNotices([notice])));
  await upsertSource(tx, tenderId, notice);
  await rebuildTender(tx, tenderId);
  // The notice left its previous tender, e.g. a re-scraped page that now links to its BOAMP notice.
  if (previousTenderId !== undefined && previousTenderId !== tenderId) {
    await rebuildTender(tx, previousTenderId);
  }

  return { tenderId, created: match === null };
}

/** Removes buyers left behind when a rebuilt tender switched to another buyer identity. */
export async function deleteOrphanBuyers(tx: Tx): Promise<number> {
  const { count } = await tx.buyer.deleteMany({ where: { tenders: { none: {} } } });
  return count;
}
