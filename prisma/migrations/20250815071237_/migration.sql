-- CreateTable
CREATE TABLE "public"."TelegramsUserbots" (
    "id" SERIAL NOT NULL,
    "session" TEXT NOT NULL,
    "isBan" BOOLEAN NOT NULL DEFAULT false,
    "dailyCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TelegramsUserbots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WhatsappUserbots" (
    "id" SERIAL NOT NULL,
    "session" TEXT NOT NULL,
    "isBan" BOOLEAN NOT NULL DEFAULT false,
    "dailyCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WhatsappUserbots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Users" (
    "id" SERIAL NOT NULL,
    "telegramId" TEXT NOT NULL,

    CONSTRAINT "Users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Clients" (
    "id" SERIAL NOT NULL,
    "phone" TEXT NOT NULL,

    CONSTRAINT "Clients_pkey" PRIMARY KEY ("id")
);
