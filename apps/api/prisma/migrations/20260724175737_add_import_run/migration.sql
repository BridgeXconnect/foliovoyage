-- CreateEnum
CREATE TYPE "ImportRunStatus" AS ENUM ('running', 'succeeded', 'failed', 'aborted');

-- CreateTable
CREATE TABLE "ImportRun" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'viator',
    "trigger" TEXT NOT NULL,
    "status" "ImportRunStatus" NOT NULL DEFAULT 'running',
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "normalized" INTEGER NOT NULL DEFAULT 0,
    "quarantined" INTEGER NOT NULL DEFAULT 0,
    "upserted" INTEGER NOT NULL DEFAULT 0,
    "softDeleted" INTEGER NOT NULL DEFAULT 0,
    "cursor" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportRun_provider_startedAt_idx" ON "ImportRun"("provider", "startedAt");
