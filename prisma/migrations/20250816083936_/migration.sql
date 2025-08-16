-- AlterTable
ALTER TABLE "public"."Clients" ADD COLUMN     "proccesed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "public"."Texts" (
    "id" SERIAL NOT NULL,
    "content" TEXT NOT NULL,

    CONSTRAINT "Texts_pkey" PRIMARY KEY ("id")
);
