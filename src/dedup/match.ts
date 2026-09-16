import type { Buyer, Notice } from '../domain/notice.js';
import { matchKey, words } from '../lib/text.js';

/** A stored tender, reduced to what matching needs. */
export interface TenderCandidate {
  id: number;
  /** `source:sourceId` of every notice already attached to the tender. */
  sourceKeys: string[];
  boampId: string | null;
  buyerPostcode: string | null;
  buyerReference: string | null;
  title: string;
  publicationDate: string | null;
  responseDeadline: Date | null;
}

type MatchRule = (notice: Notice, candidate: TenderCandidate) => boolean;

const TITLE_SIMILARITY_THRESHOLD = 0.85;
const PUBLICATION_DATE_TOLERANCE_DAYS = 3;
const DAY_MS = 86_400_000;

/** `source:sourceId`, for a notice or for a stored source row. */
export function sourceKey(notice: { source: string; sourceId: string }): string {
  return `${notice.source}:${notice.sourceId}`;
}

/**
 * Identity of a buyer: normalized name + postcode. BOAMP publishes no SIRET, so it cannot be the identity.
 * Throws when the name has no letter or digit, rather than merging every such buyer of a postcode into one.
 */
export function buyerMatchKey(buyer: Pick<Buyer, 'name' | 'postcode'>): string {
  const name = matchKey(buyer.name);
  if (name === null) throw new Error(`Buyer name "${buyer.name}" cannot identify a buyer`);
  return `${name}|${buyer.postcode ?? ''}`;
}

export function boampIdOf(notice: Notice): string | null {
  return notice.source === 'BOAMP' ? notice.sourceId : notice.linkedBoampId;
}

/** Jaccard index of the accent- and case-insensitive words of both titles. */
export function titleSimilarity(left: string, right: string): number {
  const leftWords = words(left);
  const rightWords = words(right);
  const shared = [...leftWords].filter((word) => rightWords.has(word)).length;
  const total = new Set([...leftWords, ...rightWords]).size;
  return total === 0 ? 0 : shared / total;
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  return left !== null && right !== null && left.getTime() === right.getTime();
}

function sameBuyerPostcode(notice: Notice, candidate: TenderCandidate): boolean {
  return notice.buyer.postcode !== null && notice.buyer.postcode === candidate.buyerPostcode;
}

function publishedCloseTogether(notice: Notice, candidate: TenderCandidate): boolean {
  if (!notice.publicationDate || !candidate.publicationDate) return false;
  const gapMs = Math.abs(Date.parse(notice.publicationDate) - Date.parse(candidate.publicationDate));
  return gapMs <= PUBLICATION_DATE_TOLERANCE_DAYS * DAY_MS;
}

// A tender holds at most one notice per source, and at most one BOAMP notice.
function conflicts(notice: Notice, candidate: TenderCandidate): boolean {
  const key = sourceKey(notice);
  const otherRecordFromSameSource = candidate.sourceKeys.some(
    (existing) => existing !== key && existing.startsWith(`${notice.source}:`),
  );
  const boampId = boampIdOf(notice);
  const otherBoampNotice = boampId !== null && candidate.boampId !== null && candidate.boampId !== boampId;
  return otherRecordFromSameSource || otherBoampNotice;
}

// Strongest evidence first.
const MATCH_RULES: MatchRule[] = [
  // Platform pages link to the BOAMP notice they were forwarded to. Checked before the notice's current
  // tender, so a re-scraped page that gained its link joins the BOAMP tender it had been kept apart from.
  (notice, candidate) => {
    const boampId = boampIdOf(notice);
    return boampId !== null && candidate.boampId === boampId;
  },
  // The notice was already ingested.
  (notice, candidate) => candidate.sourceKeys.includes(sourceKey(notice)),
  // Buyers reuse their internal reference everywhere; the deadline rules out a relaunch under the same reference.
  (notice, candidate) =>
    sameBuyerPostcode(notice, candidate) &&
    matchKey(notice.buyerReference) !== null &&
    matchKey(notice.buyerReference) === matchKey(candidate.buyerReference) &&
    sameInstant(notice.responseDeadline, candidate.responseDeadline),
  // Last resort for trimmed pages that lost both the link and the reference.
  (notice, candidate) =>
    sameBuyerPostcode(notice, candidate) &&
    sameInstant(notice.responseDeadline, candidate.responseDeadline) &&
    publishedCloseTogether(notice, candidate) &&
    titleSimilarity(notice.title, candidate.title) >= TITLE_SIMILARITY_THRESHOLD,
];

export function findMatchingTender(notice: Notice, candidates: TenderCandidate[]): TenderCandidate | null {
  const eligible = candidates.filter((candidate) => !conflicts(notice, candidate));
  for (const rule of MATCH_RULES) {
    const match = eligible.find((candidate) => rule(notice, candidate));
    if (match) return match;
  }
  return null;
}
