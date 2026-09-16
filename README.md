# Tengo Backend Case

Ingests tender notices from two sources (BOAMP XML, marches-publics.info HTML), deduplicates them into one tender per real consultation while keeping the provenance, and serves them over a small Express API. Postgres is accessed through Prisma.

On the provided fixtures: **22 notices → 13 tenders**, 9 of them published on both sources.

## Quickstart

Requirements: Node 22+, pnpm, Docker.

```bash
pnpm install        # also generates the Prisma client (src/generated/prisma)
pnpm dev            # starts Postgres, applies migrations, ingests fixtures/, serves the API on http://localhost:3000
```

`.env` is optional: the defaults match `docker-compose.yml`. Copy `.env.example` to `.env` to change them.

| Command | Does |
|---|---|
| `pnpm dev` | `db:up` + `ingest` + `start`, safe to re-run |
| `pnpm db:up` | Postgres 16 on localhost:5432 (tengo/tengo/tenders) |
| `pnpm ingest` | applies Prisma migrations, then ingests fixtures/ (safe to re-run) |
| `pnpm start` | API only, against an already ingested database |
| `pnpm check` | typecheck + tests (parsers and deduplication, against the real fixtures) |
| `pnpm db:reset` | deletes the database and rebuilds it from fixtures/ |
| `pnpm db:down` | stops Postgres and removes its volume |

If `pnpm ingest` fails with Prisma error P3005 (a database created before the move to Prisma, with tables but no migration history), run `pnpm db:reset`.

```bash
curl 'localhost:3000/tenders?limit=20&offset=0'
curl localhost:3000/tenders/1
```

## Layout

```
prisma/
  schema.prisma               data model
  migrations/                 SQL migrations, applied by `pnpm ingest` (or `pnpm db:migrate`)
src/
  domain/notice.ts            normalized notice: the contract between parsers and everything else
  sources/boamp.ts            BOAMP XML → Notice
  sources/platform.ts         marches-publics.info HTML → Notice
  sources/fixtures.ts         reads fixtures/, reports unparseable files instead of aborting
  dedup/match.ts              finds the tender a notice belongs to
  dedup/merge.ts              builds a tender from all of its notices
  db/prisma.ts                Prisma client (pg driver adapter)
  db/calendar-date.ts         date column ↔ YYYY-MM-DD
  db/tender-store.ts          saves a notice and rebuilds its tender in one transaction
  api/tenders-repository.ts   Prisma queries behind the two routes
  lib/                        text cleanup, Europe/Paris wall-clock → UTC
  ingest.ts, server.ts        entry points
```

## Data model

| Table | Content |
|---|---|
| `tenders` | The deduplicated tender shown to users: title, description, buyer reference, BOAMP id, publication date, response deadline, procedure, market nature, NUTS code |
| `tender_sources` | Provenance, one row per source notice: source, source id, URL, fetch date, and the normalized notice as `jsonb`. Unique on `(source, source_id)` |
| `buyers` | Name, SIRET, address, contact. Identified by normalized name + postcode |
| `lots` | Number, title, description, CPV codes |
| `tender_cpv_codes` | CPV codes of a tender, main code first. A table rather than an array because streams and alerts filter on it |

Fields kept are the ones a supplier searches, filters or gets alerted on. Legal boilerplate (appeal courts, payment terms, guarantees) is left out; the full normalized notice stays in `tender_sources.notice` if a field turns out to be needed.

## Deduplication

The two sources never share a common identifier: BOAMP has no SIRET, no CPV and only a bare link to the platform, while platform pages link to the BOAMP notice only when the page is complete. A notice is therefore matched against stored tenders with rules ordered from strongest to weakest evidence:

| # | Rule | Fixtures matched |
|---|---|---|
| 1 | Same BOAMP notice: the page links to `boamp.fr/avis/detail/<IDWEB>` | 7 |
| 2 | Same source record: the notice is being re-ingested | (idempotency) |
| 3 | Same buyer postcode + same buyer reference (`idMarche` / "Référence", normalized) + same deadline | 1, a page trimmed before its BOAMP link |
| 4 | Same buyer postcode + same deadline + published at most 3 days apart + title word similarity ≥ 0.85 | 1, a page with neither link nor reference |

Two vetoes apply before any rule: a tender never holds two notices from the same source, nor two different BOAMP notices. The explicit link comes before the notice's current tender, so a re-scraped page that gained its BOAMP link moves to that tender; the tender it leaves is rebuilt, or deleted if nothing is left.

Why these keys:
- **Buyer names are unreliable** ("DÉPARTEMENT DU DOUBS" vs "Département du Doubs", "MAIRIE DE" vs "COMMUNE DE"); the postcode matched in every pair.
- **The deadline guards the buyer reference**: buyers reuse a reference when they relaunch an unsuccessful consultation.
- **Titles alone are dangerous**: buyers publish near-identical titles for different tenders ("Marché public de maîtrise d'oeuvre en bâtiment pour…").

**Merging.** Every source notice is stored, and the tender is rebuilt from all of them on each save, so the result does not depend on ingestion order (tested in both orders) and re-running the ingestion changes nothing. When sources disagree, BOAMP wins for dates, buyer name and classification (it is the official journal); the platform page brings the SIRET, the CPV codes and the lots with their CPV codes; the most complete description is kept.

## Parsing notes

- Both sources publish wall-clock times without offset. They are read as Europe/Paris and stored as UTC: a deadline at 12:00 in July is `10:00:00.000Z`.
- The publication date is a calendar date, exposed as UTC midnight as in the spec example.
- BOAMP encodes enumerations as empty elements (`<natureMarche><services/></natureMarche>`) and repeats some elements only sometimes; values are kept as text so postcodes keep their leading zero.
- Platform pages are label/value table rows. Values are located by their label, never by position, since pages can be trimmed. The deadline regex is anchored on "Remise des offres" because the same cell may also give the opening date.

## API

`GET /tenders` — `{ results, count }`, most recent publication first. Optional `limit` (1–200, default 50) and `offset`; `count` is the total.

`GET /tenders/:id` — the tender with its buyer, CPV codes, lots and sources (id, URL, fetch and ingestion dates).

Errors use one format: `{ "error": { "code": "not_found", "message": "Tender 42 does not exist" } }`, with 400 for invalid parameters and 404 for unknown ids. Unexpected errors are logged and returned as a generic 500.

## Limits and next steps

- **Notice lifecycle.** Only initial notices exist in the fixtures. Corrections, cancellations and award notices (BOAMP `TYPE_AVIS/STATUT`) should update their tender instead of creating one.
- **Buyer identity.** Without a SIRET in BOAMP, a buyer spelled differently on two sources becomes two buyers. Resolving buyers against the SIRENE registry would fix it and give a better dedup key.
- **Scale.** Matching candidates come from three indexed lookups (source record, BOAMP id, deadline + buyer postcode), so each notice costs a few index scans. Ingestion is sequential because matching is check-then-insert; parallel workers would need a lock per tender key. `GET /tenders` uses offset pagination, which should become cursor-based for deep pages.
- **Raw documents.** Only normalized notices are stored. Keeping the raw XML/HTML would allow re-parsing everything after a parser fix.
- **Migrations.** The schema is applied with `CREATE … IF NOT EXISTS`; a migration tool is needed as soon as it evolves.
- **API tests.** Parsers and deduplication are tested on the real fixtures; the routes were checked by hand and would get integration tests against a disposable Postgres (Testcontainers).
- **Amounts** only appear in free text and are not extracted.
