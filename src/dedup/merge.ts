import type { Buyer, Lot, MarketNature, Notice, SourceName } from '../domain/notice.js';
import { boampIdOf } from './match.js';

// The official journal comes first: its dates and classifications are the legal reference.
const SOURCE_PRIORITY: SourceName[] = ['BOAMP', 'marches-publics.info'];

export interface MergedTender {
  boampId: string | null;
  buyerReference: string | null;
  title: string;
  description: string | null;
  buyer: Buyer;
  publicationDate: string | null;
  responseDeadline: Date | null;
  procedureType: string | null;
  marketNature: MarketNature | null;
  nutsCode: string | null;
  cpvCodes: string[];
  lots: Lot[];
}

function lotDetail(notice: Notice): number {
  return notice.lots.reduce((detail, lot) => detail + 1 + lot.cpvCodes.length, 0);
}

/** Builds the tender shown to users from every notice published about it. */
export function mergeNotices(notices: Notice[]): MergedTender {
  const ordered = [...notices].sort(
    (left, right) => SOURCE_PRIORITY.indexOf(left.source) - SOURCE_PRIORITY.indexOf(right.source),
  );
  const [main] = ordered;
  if (!main) throw new Error('Cannot merge an empty list of notices');

  const pick = <T>(read: (notice: Notice) => T | null): T | null =>
    ordered.map(read).find((value) => value !== null) ?? null;
  // Street, postcode and city must come from the same notice to stay consistent.
  const address = ordered.find((notice) => notice.buyer.postcode !== null)?.buyer ?? main.buyer;
  // Lots are only detailed with their CPV codes on platform pages.
  const [mostDetailedLots] = [...ordered].sort((left, right) => lotDetail(right) - lotDetail(left));

  return {
    boampId: pick(boampIdOf),
    buyerReference: pick((notice) => notice.buyerReference),
    title: main.title,
    // BOAMP often only carries a one-line note on pricing: keep the most complete description.
    description: ordered
      .map((notice) => notice.description)
      .reduce<string | null>((best, text) => (text && text.length > (best?.length ?? 0) ? text : best), null),
    buyer: {
      name: main.buyer.name,
      siret: pick((notice) => notice.buyer.siret),
      street: address.street,
      postcode: address.postcode,
      city: address.city,
      email: pick((notice) => notice.buyer.email),
      phone: pick((notice) => notice.buyer.phone),
      profileUrl: pick((notice) => notice.buyer.profileUrl),
    },
    publicationDate: pick((notice) => notice.publicationDate),
    responseDeadline: pick((notice) => notice.responseDeadline),
    procedureType: pick((notice) => notice.procedureType),
    marketNature: pick((notice) => notice.marketNature),
    nutsCode: pick((notice) => notice.nutsCode),
    cpvCodes: [...new Set(ordered.flatMap((notice) => notice.cpvCodes))],
    lots: (mostDetailedLots ?? main).lots,
  };
}
