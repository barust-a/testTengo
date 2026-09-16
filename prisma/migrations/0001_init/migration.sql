-- CreateTable
CREATE TABLE "buyers" (
    "id" BIGSERIAL NOT NULL,
    "match_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "siret" TEXT,
    "street" TEXT,
    "postcode" TEXT,
    "city" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "profile_url" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buyers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenders" (
    "id" BIGSERIAL NOT NULL,
    "buyer_id" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "buyer_reference" TEXT,
    "boamp_id" TEXT,
    "publication_date" DATE,
    "response_deadline" TIMESTAMPTZ,
    "procedure_type" TEXT,
    "market_nature" TEXT CHECK ("market_nature" IN ('works', 'supplies', 'services')),
    "nuts_code" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_sources" (
    "id" BIGSERIAL NOT NULL,
    "tender_id" BIGINT NOT NULL,
    "source" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "url" TEXT,
    "fetched_at" TIMESTAMPTZ,
    "notice" JSONB NOT NULL,
    "ingested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tender_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lots" (
    "id" BIGSERIAL NOT NULL,
    "tender_id" BIGINT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "cpv_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_cpv_codes" (
    "tender_id" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "position" SMALLINT NOT NULL,

    CONSTRAINT "tender_cpv_codes_pkey" PRIMARY KEY ("tender_id","code")
);

-- CreateIndex
CREATE UNIQUE INDEX "buyers_match_key_key" ON "buyers"("match_key");

-- CreateIndex
CREATE UNIQUE INDEX "tenders_boamp_id_key" ON "tenders"("boamp_id");

-- CreateIndex
CREATE INDEX "tenders_buyer_id_idx" ON "tenders"("buyer_id");

-- CreateIndex
CREATE INDEX "tenders_publication_date_idx" ON "tenders"("publication_date" DESC NULLS LAST, "id" DESC);

-- CreateIndex
CREATE INDEX "tenders_response_deadline_idx" ON "tenders"("response_deadline");

-- CreateIndex
CREATE INDEX "tender_sources_tender_id_idx" ON "tender_sources"("tender_id");

-- CreateIndex
CREATE UNIQUE INDEX "tender_sources_source_source_id_key" ON "tender_sources"("source", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "lots_tender_id_number_key" ON "lots"("tender_id", "number");

-- CreateIndex
CREATE INDEX "tender_cpv_codes_code_idx" ON "tender_cpv_codes"("code");

-- AddForeignKey
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_sources" ADD CONSTRAINT "tender_sources_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_cpv_codes" ADD CONSTRAINT "tender_cpv_codes_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

