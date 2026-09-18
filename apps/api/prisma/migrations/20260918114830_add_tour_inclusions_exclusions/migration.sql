-- AlterTable
ALTER TABLE "Tour" ADD COLUMN     "exclusions" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "inclusions" JSONB NOT NULL DEFAULT '[]';
