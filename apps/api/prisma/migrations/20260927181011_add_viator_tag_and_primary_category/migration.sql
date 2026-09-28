-- AlterTable
ALTER TABLE "Tour" ADD COLUMN     "primaryCategoryTagId" INTEGER;

-- CreateTable
CREATE TABLE "ViatorTag" (
    "tagId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "parentTagIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViatorTag_pkey" PRIMARY KEY ("tagId")
);

-- CreateIndex
CREATE INDEX "Tour_primaryCategoryTagId_idx" ON "Tour"("primaryCategoryTagId");
