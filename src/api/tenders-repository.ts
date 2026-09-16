import { prisma } from '../db/prisma.js';
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

// Publication dates are `date` columns, which Prisma returns as UTC midnight like the other timestamps.

export async function listTenders(limit: number, offset: number): Promise<TenderSummary[]> {
  const tenders = await prisma.tender.findMany({
    orderBy: [{ publicationDate: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
    take: limit,
    skip: offset,
    select: {
      id: true,
      title: true,
      buyer: { select: { name: true } },
      publicationDate: true,
      responseDeadline: true,
      sources: { select: { source: true }, orderBy: { source: 'asc' } },
    },
  });
  return tenders.map((tender) => ({
    id: Number(tender.id),
    title: tender.title,
    buyerName: tender.buyer.name,
    publicationDate: tender.publicationDate,
    responseDeadline: tender.responseDeadline,
    sources: [...new Set(tender.sources.map(({ source }) => source as SourceName))],
  }));
}

export async function countTenders(): Promise<number> {
  return prisma.tender.count();
}

export async function findTenderById(id: number): Promise<TenderDetail | null> {
  const tender = await prisma.tender.findUnique({
    where: { id },
    include: {
      buyer: true,
      cpvCodes: { select: { code: true }, orderBy: { position: 'asc' } },
      lots: { select: { number: true, title: true, description: true, cpvCodes: true }, orderBy: { number: 'asc' } },
      sources: {
        select: { source: true, sourceId: true, url: true, fetchedAt: true, ingestedAt: true },
        orderBy: { source: 'asc' },
      },
    },
  });
  if (!tender) return null;

  const { buyer } = tender;
  return {
    id: Number(tender.id),
    title: tender.title,
    description: tender.description,
    buyerReference: tender.buyerReference,
    boampId: tender.boampId,
    publicationDate: tender.publicationDate,
    responseDeadline: tender.responseDeadline,
    procedureType: tender.procedureType,
    marketNature: tender.marketNature as MarketNature | null,
    nutsCode: tender.nutsCode,
    buyer: {
      id: Number(buyer.id),
      name: buyer.name,
      siret: buyer.siret,
      street: buyer.street,
      postcode: buyer.postcode,
      city: buyer.city,
      email: buyer.email,
      phone: buyer.phone,
      profileUrl: buyer.profileUrl,
    },
    createdAt: tender.createdAt,
    updatedAt: tender.updatedAt,
    cpvCodes: tender.cpvCodes.map(({ code }) => code),
    lots: tender.lots,
    sources: tender.sources.map((source) => ({ ...source, source: source.source as SourceName })),
  };
}
