-- CreateEnum
CREATE TYPE "PurchaseListStatus" AS ENUM ('PENDING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PurchaseUrgency" AS ENUM ('URGENT', 'SUGGESTED', 'EXPIRY');

-- CreateEnum
CREATE TYPE "PurchaseItemStatus" AS ENUM ('PENDING', 'COMPLETED', 'SKIPPED');

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "defaultExpiryAlertDays" INTEGER NOT NULL DEFAULT 7,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "units" TEXT[],
    "totalQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "consumptionRate" DOUBLE PRECISION,
    "expiryAlertDays" INTEGER,
    "safetyStockWeeks" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "purchaseSuggestionWeeks" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpiryBatch" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "alertSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpiryBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumptionLog" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "note" TEXT,
    "isEstimated" BOOLEAN NOT NULL DEFAULT false,
    "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumptionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseList" (
    "id" TEXT NOT NULL,
    "status" "PurchaseListStatus" NOT NULL DEFAULT 'PENDING',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PurchaseList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseListItem" (
    "id" TEXT NOT NULL,
    "purchaseListId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "suggestedQty" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "urgency" "PurchaseUrgency" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "PurchaseItemStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "PurchaseListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptMapping" (
    "id" TEXT NOT NULL,
    "receiptName" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationSession" (
    "id" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Item_name_key" ON "Item"("name");

-- CreateIndex
CREATE INDEX "ExpiryBatch_itemId_idx" ON "ExpiryBatch"("itemId");

-- CreateIndex
CREATE INDEX "ExpiryBatch_expiryDate_idx" ON "ExpiryBatch"("expiryDate");

-- CreateIndex
CREATE INDEX "ConsumptionLog_itemId_idx" ON "ConsumptionLog"("itemId");

-- CreateIndex
CREATE INDEX "ConsumptionLog_consumedAt_idx" ON "ConsumptionLog"("consumedAt");

-- CreateIndex
CREATE INDEX "PurchaseListItem_purchaseListId_idx" ON "PurchaseListItem"("purchaseListId");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptMapping_receiptName_key" ON "ReceiptMapping"("receiptName");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpiryBatch" ADD CONSTRAINT "ExpiryBatch_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionLog" ADD CONSTRAINT "ConsumptionLog_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseListItem" ADD CONSTRAINT "PurchaseListItem_purchaseListId_fkey" FOREIGN KEY ("purchaseListId") REFERENCES "PurchaseList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseListItem" ADD CONSTRAINT "PurchaseListItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptMapping" ADD CONSTRAINT "ReceiptMapping_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
