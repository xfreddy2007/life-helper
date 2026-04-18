-- CreateTable
CREATE TABLE "OperationLog" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reversalData" JSONB NOT NULL,
    "reversed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperationLog_sourceId_createdAt_idx" ON "OperationLog"("sourceId", "createdAt" DESC);
