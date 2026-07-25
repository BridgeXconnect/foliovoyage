-- AlterTable
ALTER TABLE "City" ADD COLUMN     "centroidLat" DOUBLE PRECISION,
ADD COLUMN     "centroidLng" DOUBLE PRECISION,
ADD COLUMN     "viatorDestRef" TEXT;

-- AlterTable
ALTER TABLE "Experience" ADD COLUMN     "editorRating" DOUBLE PRECISION,
ADD COLUMN     "latitude" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "longitude" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "sourceProvider" TEXT,
ADD COLUMN     "sourceProviderTourId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'draft';

-- AlterTable
ALTER TABLE "Tour" ADD COLUMN     "destinationRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "experienceId" TEXT,
ADD COLUMN     "imageAlt" TEXT,
ADD COLUMN     "imageUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "City_viatorDestRef_key" ON "City"("viatorDestRef");

-- CreateIndex
CREATE INDEX "Experience_cityId_status_idx" ON "Experience"("cityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Experience_sourceProvider_sourceProviderTourId_key" ON "Experience"("sourceProvider", "sourceProviderTourId");

-- CreateIndex
CREATE INDEX "Tour_experienceId_idx" ON "Tour"("experienceId");

-- AddForeignKey
ALTER TABLE "Tour" ADD CONSTRAINT "Tour_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "Experience"("id") ON DELETE SET NULL ON UPDATE CASCADE;

