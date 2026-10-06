-- CreateTable
CREATE TABLE "PendingChannel" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "channelId" BIGINT,
    "accessHash" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrphanChannel" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "channelId" BIGINT NOT NULL,
    "accessHash" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrphanChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingChannel_status_createdAt_idx" ON "PendingChannel"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "PendingChannel" ADD CONSTRAINT "PendingChannel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrphanChannel" ADD CONSTRAINT "OrphanChannel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

