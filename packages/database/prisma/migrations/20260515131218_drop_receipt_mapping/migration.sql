/*
  Warnings:

  - You are about to drop the `ReceiptMapping` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ReceiptMapping" DROP CONSTRAINT "ReceiptMapping_itemId_fkey";

-- DropTable
DROP TABLE "ReceiptMapping";
