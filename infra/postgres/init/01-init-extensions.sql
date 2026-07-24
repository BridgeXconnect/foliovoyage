-- First-init extension bootstrap for Folio Voyage (ST-2 / BRI-97).
--
-- Runs exactly once, when the Postgres data directory is first created, via the
-- postgis image's /docker-entrypoint-initdb.d hook. At that point the script
-- executes as the superuser (POSTGRES_USER) against POSTGRES_DB — the only
-- context with the privileges to CREATE EXTENSION — and it completes before the
-- server starts accepting connections, so app migrations always find these
-- extensions already present.
--
-- IF NOT EXISTS keeps this idempotent: the postgis image may already install
-- PostGIS, and re-running is harmless.

-- Geospatial support (PostGIS geometry/geography, GiST indexes). Architecture §6.
CREATE EXTENSION IF NOT EXISTS postgis;

-- Trigram fuzzy text matching for Phase-A search (typo-tolerant, GIN). Architecture §6.3.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
