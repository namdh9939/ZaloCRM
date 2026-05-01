import { prisma } from './src/shared/database/prisma-client.js';

async function main() {
  const result = await prisma.automationRule.deleteMany({
    where: {
      name: {
        in: ['Tự động Chuyển đổi khi gắn tag Chốt', 'Tự động báo Mất khi gắn tag Rớt']
      }
    }
  });

  console.log(`Deleted ${result.count} automation rules.`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
