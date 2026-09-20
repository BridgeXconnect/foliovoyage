-- AlterTable
ALTER TABLE "Tour" ADD COLUMN     "reviewsBySource" JSONB NOT NULL DEFAULT '[]';
