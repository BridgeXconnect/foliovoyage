-- ST-13 / BRI-125: Phase-A Postgres full-text search (docs/02 §8).
--
-- Two search vectors, kept in sync two different ways because their inputs
-- live in different places:
--
--   - City.searchVector: name + country live on the City row itself, so this
--     is a real Postgres GENERATED ALWAYS AS ... STORED column. Postgres
--     backfills it for existing rows as part of the ALTER TABLE, and keeps it
--     current on every future write automatically — no trigger needed.
--
--   - Experience.searchVector: needs title + description (own row) *and* the
--     parent City's name + country (a different row), which a GENERATED column
--     cannot reference. Kept in sync by a BEFORE INSERT/UPDATE trigger instead,
--     plus a second trigger on City so renaming a city refreshes its
--     experiences. Existing rows are backfilled explicitly below, since a
--     trigger only fires on future writes.
--
-- Both vectors are weighted (setweight 'A' > 'B' > 'C') so ts_rank_cd ranks a
-- title match above an incidental destination-name match.

-- AlterTable: City.searchVector as a real generated column.
ALTER TABLE "City" ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("country", '')), 'B')
) STORED;

-- AlterTable: Experience.searchVector, trigger-maintained (see rationale above).
ALTER TABLE "Experience" ADD COLUMN "searchVector" tsvector;

-- Recomputes one Experience row's searchVector from its own title/description
-- plus its parent City's name/country.
CREATE OR REPLACE FUNCTION experience_search_vector_update() RETURNS trigger AS $$
DECLARE
  city_name    TEXT;
  city_country TEXT;
BEGIN
  SELECT "name", "country" INTO city_name, city_country
  FROM "City" WHERE "id" = NEW."cityId";

  NEW."searchVector" :=
    setweight(to_tsvector('english', coalesce(NEW."title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW."description", '')), 'B') ||
    setweight(to_tsvector('english', coalesce(city_name, '') || ' ' || coalesce(city_country, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER experience_search_vector_trigger
  BEFORE INSERT OR UPDATE OF "title", "description", "cityId" ON "Experience"
  FOR EACH ROW EXECUTE FUNCTION experience_search_vector_update();

-- Renaming a City (rare — curated cities are seeded once) refreshes every
-- Experience linked to it, so no experience's destination-name weight goes stale.
CREATE OR REPLACE FUNCTION city_search_vector_propagate() RETURNS trigger AS $$
BEGIN
  UPDATE "Experience" e SET "searchVector" =
    setweight(to_tsvector('english', coalesce(e."title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(e."description", '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW."name", '') || ' ' || coalesce(NEW."country", '')), 'C')
  WHERE e."cityId" = NEW."id";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER city_search_vector_propagate_trigger
  AFTER UPDATE OF "name", "country" ON "City"
  FOR EACH ROW EXECUTE FUNCTION city_search_vector_propagate();

-- Backfill: populate searchVector for every Experience row that already
-- exists (the trigger above only fires on future inserts/updates). The
-- trigger is scoped to UPDATE OF "title", so a no-op self-assignment of that
-- column is what's needed to fire it for every row — assigning "id" would not,
-- since a column-list trigger fires only when a named column is in the SET list.
UPDATE "Experience" SET "title" = "title";

-- CreateIndex
CREATE INDEX "AffiliateClick_tourId_idx" ON "AffiliateClick"("tourId");

-- CreateIndex
CREATE INDEX "City_searchVector_idx" ON "City" USING GIN ("searchVector");

-- CreateIndex
CREATE INDEX "Experience_searchVector_idx" ON "Experience" USING GIN ("searchVector");
