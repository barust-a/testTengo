export type SourceName = 'BOAMP' | 'marches-publics.info';

export type MarketNature = 'works' | 'supplies' | 'services';

export interface Buyer {
  name: string;
  siret: string | null;
  street: string | null;
  postcode: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
  profileUrl: string | null;
}

export interface Lot {
  number: number;
  title: string | null;
  description: string | null;
  cpvCodes: string[];
}

/** One notice as published by one source, normalized to a common shape before deduplication. */
export interface Notice {
  source: SourceName;
  sourceId: string;
  url: string | null;
  fetchedAt: Date | null;
  /** The buyer's own reference for the consultation, shared across the sources it publishes on. */
  buyerReference: string | null;
  /** BOAMP notice this notice says it was forwarded to (platform pages link to it). */
  linkedBoampId: string | null;
  title: string;
  description: string | null;
  buyer: Buyer;
  /** Calendar date, YYYY-MM-DD. */
  publicationDate: string | null;
  responseDeadline: Date | null;
  procedureType: string | null;
  marketNature: MarketNature | null;
  nutsCode: string | null;
  /** Main code first. */
  cpvCodes: string[];
  lots: Lot[];
}
