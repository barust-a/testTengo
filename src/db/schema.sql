-- Idempotent: applied at the start of every `pnpm ingest`.

CREATE TABLE IF NOT EXISTS buyers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Normalized name + postcode. BOAMP publishes no SIRET, so it cannot be the identity.
  match_key text NOT NULL UNIQUE,
  name text NOT NULL,
  siret text,
  street text,
  postcode text,
  city text,
  email text,
  phone text,
  profile_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The deduplicated tender shown to users, rebuilt from its source notices at every ingestion.
CREATE TABLE IF NOT EXISTS tenders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  buyer_id bigint NOT NULL REFERENCES buyers (id),
  title text NOT NULL,
  description text,
  buyer_reference text,
  boamp_id text UNIQUE,
  publication_date date,
  response_deadline timestamptz,
  procedure_type text,
  market_nature text CHECK (market_nature IN ('works', 'supplies', 'services')),
  nuts_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenders_buyer_id_idx ON tenders (buyer_id);
-- Same order as GET /tenders.
CREATE INDEX IF NOT EXISTS tenders_publication_date_idx ON tenders (publication_date DESC NULLS LAST, id DESC);
-- Deduplication candidates: the rules on buyer reference and on title both require the same deadline.
CREATE INDEX IF NOT EXISTS tenders_response_deadline_idx ON tenders (response_deadline);

-- Provenance: one row per notice, per source.
CREATE TABLE IF NOT EXISTS tender_sources (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tender_id bigint NOT NULL REFERENCES tenders (id) ON DELETE CASCADE,
  source text NOT NULL,
  source_id text NOT NULL,
  url text,
  fetched_at timestamptz,
  -- The notice as normalized from this source; tenders are merged from these.
  notice jsonb NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS tender_sources_tender_id_idx ON tender_sources (tender_id);

CREATE TABLE IF NOT EXISTS lots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tender_id bigint NOT NULL REFERENCES tenders (id) ON DELETE CASCADE,
  number integer NOT NULL,
  title text,
  description text,
  cpv_codes text[] NOT NULL DEFAULT '{}',
  UNIQUE (tender_id, number)
);

-- A table rather than an array: streams and alerts filter tenders by CPV code.
CREATE TABLE IF NOT EXISTS tender_cpv_codes (
  tender_id bigint NOT NULL REFERENCES tenders (id) ON DELETE CASCADE,
  code text NOT NULL,
  -- 0 is the main code.
  position smallint NOT NULL,
  PRIMARY KEY (tender_id, code)
);

CREATE INDEX IF NOT EXISTS tender_cpv_codes_code_idx ON tender_cpv_codes (code);
