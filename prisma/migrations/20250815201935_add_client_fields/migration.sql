/*
  Warnings:

  - Added the required column `email` to the `Clients` table without a default value. This is not possible if the table is not empty.
  - Added the required column `name` to the `Clients` table without a default value. This is not possible if the table is not empty.
  - Added the required column `telegramId` to the `Clients` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `Clients` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."Clients" ADD COLUMN     "email" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "telegramId" TEXT NOT NULL DEFAULT '0',
ADD COLUMN     "userId" INTEGER NOT NULL DEFAULT 0;

-- Update existing records with default values
UPDATE "public"."Clients" SET 
  "email" = COALESCE("email", ''),
  "name" = COALESCE("name", ''),
  "telegramId" = COALESCE("telegramId", '0'),
  "userId" = COALESCE("userId", 0);

-- Remove default values after updating existing records
ALTER TABLE "public"."Clients" ALTER COLUMN "email" DROP DEFAULT,
ALTER COLUMN "name" DROP DEFAULT,
ALTER COLUMN "telegramId" DROP DEFAULT,
ALTER COLUMN "userId" DROP DEFAULT;
