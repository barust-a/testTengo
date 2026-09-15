import { XMLParser } from 'fast-xml-parser';

import type { Lot, MarketNature, Notice } from '../domain/notice.js';
import { parseParisIso } from '../lib/paris-time.js';
import { cleanText, firstLine } from '../lib/text.js';

type XmlNode = Record<string, unknown>;

const REPEATED_TAGS = new Set(['lot', 'DEP_PUBLICATION', 'DESCRIPTEUR', 'criterePondere']);

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  // Postcodes, phone numbers and references carry leading zeros: keep every value as text.
  parseTagValue: false,
  isArray: (tagName) => REPEATED_TAGS.has(tagName),
  // Rendered copies of the notice, not needed.
  stopNodes: ['*.HTML', '*.HTMLSYNTHESE'],
});

const MARKET_NATURES: Record<string, MarketNature> = {
  travaux: 'works',
  fournitures: 'supplies',
  services: 'services',
};

const PROCEDURE_TYPES: Record<string, string> = {
  procedureAdaptee: 'adapted',
};

// Platforms relay buyer mail through this mailbox; it does not reach the buyer.
const PLATFORM_RELAY_EMAIL = /@aws-france\.com$/i;

export function boampNoticeUrl(idweb: string): string {
  return `https://www.boamp.fr/pages/avis/?q=idweb:${idweb}`;
}

function node(value: unknown): XmlNode {
  return typeof value === 'object' && value !== null ? (value as XmlNode) : {};
}

// BOAMP encodes enumerations as an empty child element: <natureMarche><services/></natureMarche>.
function markerName(value: unknown): string | null {
  return Object.keys(node(value))[0] ?? null;
}

function parseLots(lots: unknown): Lot[] {
  const items = node(lots).lot;
  if (!Array.isArray(items)) return [];
  return items.map((item, index) => {
    const description = cleanText(node(item).description);
    return {
      // Lots are listed in order: the position stands in for a missing number.
      number: Number.parseInt(cleanText(node(item).numLot) ?? '', 10) || index + 1,
      title: firstLine(description),
      description,
      cpvCodes: [],
    };
  });
}

export function parseBoampNotice(xml: string): Notice {
  const root = node(node(parser.parse(xml)).ann);
  const reference = node(node(root.GESTION).REFERENCE);
  const indexation = node(node(root.GESTION).INDEXATION);
  // DONNEES holds a single procedure family (MAPA here) with the buyer and the notice body.
  const family = node(Object.values(node(root.DONNEES))[0]);
  const organisme = node(family.organisme);
  const body = node(family.initial);
  const description = node(body.description);
  const caracteristiques = node(body.caracteristiques);
  const renseignements = node(body.renseignements);
  const address = node(organisme.adr);
  const contact = node(organisme.coord);

  const sourceId = cleanText(reference.IDWEB);
  const title = cleanText(description.objet) ?? cleanText(indexation.RESUME_OBJET);
  const buyerName = cleanText(organisme.acheteurPublic) ?? cleanText(indexation.NOMORGANISME);
  if (!sourceId || !title || !buyerName) {
    throw new Error(`BOAMP notice ${sourceId ?? '(no IDWEB)'} lacks a title or a buyer name`);
  }

  const email = cleanText(contact.mel);
  const procedure = markerName(body.procedure);
  const nature = markerName(body.natureMarche);
  const additionalInfo = cleanText(renseignements.rensgComplt);

  return {
    source: 'BOAMP',
    sourceId,
    url: boampNoticeUrl(sourceId),
    fetchedAt: null,
    buyerReference: cleanText(renseignements.idMarche),
    linkedBoampId: null,
    title,
    description: cleanText(caracteristiques.principales) ?? cleanText(caracteristiques.quantites),
    buyer: {
      name: buyerName,
      siret: null,
      street: cleanText(node(address.voie).nomvoie),
      postcode: cleanText(address.cp),
      city: cleanText(address.ville),
      email: email && !PLATFORM_RELAY_EMAIL.test(email) ? email : null,
      phone: cleanText(contact.tel),
      profileUrl: cleanText(organisme.urlProfilAcheteur),
    },
    publicationDate: cleanText(indexation.DATE_PUBLICATION)?.slice(0, 10) ?? null,
    responseDeadline: parseParisIso(
      cleanText(indexation.DATE_LIMITE_REPONSE) ?? cleanText(node(body.delais).receptionOffres),
    ),
    procedureType: procedure ? (PROCEDURE_TYPES[procedure] ?? procedure) : null,
    marketNature: nature ? (MARKET_NATURES[nature] ?? null) : null,
    nutsCode: additionalInfo?.match(/Code NUTS\s*:\s*([A-Z]{2}[A-Z0-9]{0,3})\b/)?.[1] ?? null,
    cpvCodes: [],
    lots: parseLots(body.lots),
  };
}
