import { load, type CheerioAPI } from 'cheerio';

import type { Buyer, Lot, MarketNature, Notice } from '../domain/notice.js';
import { parisLocalToDate } from '../lib/paris-time.js';
import { cleanText } from '../lib/text.js';

/** An entry of `pages.json`: where and when the page was scraped. */
export interface PlatformPage {
  file: string;
  url: string;
  fetchedAt: string;
}

interface Row {
  /** Continuation rows have an empty label cell and belong to the label above. */
  label: string;
  text: string | null;
}

// Stands in for <br> while the source indentation is collapsed. Private-use character, so not matched by \s.
const LINE_BREAK = '';
const FRENCH_DATE = String.raw`(\d{2})/(\d{2})/(\d{2}|\d{4})`;
// Anchored on the wording: the same cell can also give the date the offers are opened.
const DEADLINE = new RegExp(String.raw`Remise des offres le\s*${FRENCH_DATE}\s*à\s*(\d{1,2})h(\d{2})`);
const SENT_FOR_PUBLICATION = new RegExp(String.raw`Envoi le\s*${FRENCH_DATE}\s*à la publication`);
const BOAMP_LINK = /boamp\.fr\/avis\/detail\/(\d{2}-\d{5,6})/;
const POSTCODE_LINE = /^(?:BP\s*\d+\s*-\s*)?(\d{5})\s+(.+?)(?:\s+-\s+CS\s*\d+)?$/i;
const CPV_LABELS = new Set(['Code CPV principal', 'Code CPV complémentaire']);

function cellText(cell: { text(): string }): string | null {
  return cleanText(cell.text().replace(/\s+/g, ' ').replaceAll(LINE_BREAK, '\n'));
}

function fullYear(year: string): number {
  return year.length === 2 ? 2000 + Number(year) : Number(year);
}

function cpvCodesIn(text: string | null): string[] {
  return [...(text ?? '').matchAll(/\b(\d{8})\b/g)].map((match) => match[1]);
}

function marketNatureOf(text: string | null): MarketNature | null {
  if (!text) return null;
  if (/travaux/i.test(text)) return 'works';
  if (/fournitures/i.test(text)) return 'supplies';
  if (/services/i.test(text)) return 'services';
  return null;
}

function readRows($: CheerioAPI): Row[] {
  let label = '';
  return $('#AAPCGenere table.AW_TableM')
    .first()
    .children('tbody')
    .children('tr')
    .toArray()
    .map((row) => {
      const cells = $(row).children('td');
      label = cellText(cells.first()) ?? label;
      return { label, text: cellText(cells.eq(1)) };
    });
}

function readBuyer($: CheerioAPI): Omit<Buyer, 'name'> & { name: string | null } {
  const cell = $('#AAPCGenere td[valign=top]').first().clone();
  cell.find('table').remove();
  const lines = cellText(cell)?.split('\n') ?? [];
  const text = lines.join('\n');
  // Line 0 is the buyer and line 1 the contact person; street lines sit between them and the postcode line.
  const postcodeIndex = lines.findIndex((line, index) => index > 0 && POSTCODE_LINE.test(line));
  const postcodeLine = postcodeIndex === -1 ? null : lines[postcodeIndex].match(POSTCODE_LINE);

  return {
    name: cleanText(cell.children('b').first().text()),
    siret: text.match(/SIRET\s*(\d{14})/)?.[1] ?? null,
    street: postcodeIndex > 2 ? lines.slice(2, postcodeIndex).join(', ') : null,
    postcode: postcodeLine?.[1] ?? null,
    city: postcodeLine?.[2] ?? null,
    email: null,
    phone: text.match(/Tél\s*:\s*([\d .]{10,})/)?.[1].replace(/\D/g, '') ?? null,
    profileUrl: null,
  };
}

function readLots($: CheerioAPI): Lot[] {
  const table = $('#AAPCGenere table')
    .filter((_, element) => cellText($(element).find('td').first()) === 'Lots')
    .first();

  return table
    .children('tbody')
    .children('tr')
    .slice(1)
    .toArray()
    .map((row, index) => {
      const cells = $(row).children('td');
      const [title, ...details] = cellText(cells.eq(1))?.split('\n') ?? [];
      return {
        // "N° 1". Lots are listed in order: the position stands in for a missing number.
        number: Number(cellText(cells.eq(0))?.match(/\d+/)?.[0] ?? index + 1),
        title: title ?? null,
        description: cleanText(details.join('\n').replace(/^Description\s*:\s*/, '')),
        cpvCodes: cpvCodesIn(cellText(cells.eq(5))),
      };
    });
}

export function parsePlatformNotice(html: string, page: PlatformPage): Notice {
  const $ = load(html);
  $('br').replaceWith(LINE_BREAK);
  const rows = readRows($);
  const valueOf = (label: string) => rows.find((row) => row.label === label)?.text ?? null;

  const sourceId = page.file.match(/MPI-pub-(\d+)/)?.[1];
  const title = valueOf('Objet');
  const { name: buyerName, ...buyer } = readBuyer($);
  if (!sourceId || !title || !buyerName) {
    throw new Error(`Platform page ${page.file} lacks an id, a title or a buyer name`);
  }

  const deadline = valueOf('Offres')?.match(DEADLINE);
  const sentOn = rows.map((row) => row.text ?? '').join('\n').match(SENT_FOR_PUBLICATION);
  const procedure = valueOf('Mode');
  const nuts = valueOf('Code NUTS');

  return {
    source: 'marches-publics.info',
    sourceId,
    url: page.url,
    fetchedAt: new Date(page.fetchedAt),
    buyerReference: valueOf('Référence'),
    linkedBoampId: $('#AAPCGenere a[href*="boamp.fr/avis/detail/"]').attr('href')?.match(BOAMP_LINK)?.[1] ?? null,
    title,
    description: valueOf('Description') ?? valueOf('Quantité ou étendue'),
    buyer: { name: buyerName, ...buyer },
    publicationDate: sentOn ? `${fullYear(sentOn[3])}-${sentOn[2]}-${sentOn[1]}` : null,
    responseDeadline: deadline
      ? parisLocalToDate(fullYear(deadline[3]), +deadline[2], +deadline[1], +deadline[4], +deadline[5])
      : null,
    procedureType: procedure && /adapt/i.test(procedure) ? 'adapted' : procedure,
    marketNature: marketNatureOf(valueOf('Type de marché')),
    nutsCode: nuts && /^[A-Z]{2}[A-Z0-9]{0,3}$/.test(nuts) ? nuts : null,
    cpvCodes: [...new Set(rows.filter((row) => CPV_LABELS.has(row.label)).flatMap((row) => cpvCodesIn(row.text)))],
    lots: readLots($),
  };
}
