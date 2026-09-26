-- CreateEnum
CREATE TYPE "TourCopyEvaluator" AS ENUM ('judge', 'human');

-- CreateEnum
CREATE TYPE "TourCopyClaimVerdict" AS ENUM ('clean', 'unsupported', 'contradicted');

-- AlterEnum
ALTER TYPE "TourCopyStatus" ADD VALUE 'withdrawn';

-- AlterTable
ALTER TABLE "TourCopy" ADD COLUMN     "openingPattern" TEXT,
ADD COLUMN     "voiceCounts" JSONB,
ADD COLUMN     "withdrawnAt" TIMESTAMP(3),
ADD COLUMN     "withdrawnByRunId" TEXT;

-- CreateTable
CREATE TABLE "TourCopyEval" (
    "id" TEXT NOT NULL,
    "tourCopyId" TEXT NOT NULL,
    "copyGeneratedAt" TIMESTAMP(3) NOT NULL,
    "judgedText" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "groundingHash" TEXT NOT NULL,
    "evaluator" "TourCopyEvaluator" NOT NULL,
    "evaluatorModel" TEXT,
    "rubricVersion" INTEGER NOT NULL,
    "claims" JSONB NOT NULL,
    "claimVerdict" "TourCopyClaimVerdict" NOT NULL,
    "leadsWithFact" BOOLEAN NOT NULL,
    "evalRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TourCopyEval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TourCopyEval_promptVersion_model_idx" ON "TourCopyEval"("promptVersion", "model");

-- CreateIndex
CREATE UNIQUE INDEX "TourCopyEval_tourCopyId_copyGeneratedAt_evaluator_rubricVer_key" ON "TourCopyEval"("tourCopyId", "copyGeneratedAt", "evaluator", "rubricVersion");

-- AddForeignKey
ALTER TABLE "TourCopyEval" ADD CONSTRAINT "TourCopyEval_tourCopyId_fkey" FOREIGN KEY ("tourCopyId") REFERENCES "TourCopy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
