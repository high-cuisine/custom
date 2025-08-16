/*
  Warnings:

  - Added the required column `phone` to the `WhatsappUserbots` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."WhatsappUserbots" ADD COLUMN     "phone" TEXT NOT NULL;
