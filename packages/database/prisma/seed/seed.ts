import { PrismaClient } from '@prisma/client';
import categories from './default-categories.json' with { type: 'json' };

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding default categories...');

  for (const category of categories) {
    await prisma.category.upsert({
      where: { name: category.name },
      update: {},
      create: category,
    });
  }

  console.log(`Seeded ${categories.length} categories.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
