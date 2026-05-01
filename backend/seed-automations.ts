import { prisma } from './src/shared/database/prisma-client.js';

async function main() {
  const org = await prisma.organization.findFirst();
  if (!org) {
    console.log('No organization found');
    return;
  }

  // Cập nhật trạng thái thành "converted" khi tag chứa "chot"
  await prisma.automationRule.create({
    data: {
      orgId: org.id,
      name: 'Tự động Chuyển đổi khi gắn tag Chốt',
      description: 'Khi gắn tag có chữ "chot" hoặc "chốt", tự động chuyển trạng thái khách sang Chuyển đổi.',
      trigger: 'contact_updated',
      conditions: [
        {
          field: 'contact.tags',
          operator: 'contains_any',
          value: ['chot', 'chốt', 'Chot', 'Chốt']
        }
      ],
      actions: [
        {
          type: 'update_status',
          payload: { status: 'converted' }
        }
      ],
      enabled: true,
      priority: 10,
    }
  });

  // Cập nhật trạng thái thành "lost" khi tag chứa "mat"
  await prisma.automationRule.create({
    data: {
      orgId: org.id,
      name: 'Tự động báo Mất khi gắn tag Rớt',
      description: 'Khi gắn tag "rot" hoặc "rớt", tự chuyển trạng thái sang Mất.',
      trigger: 'contact_updated',
      conditions: [
        {
          field: 'contact.tags',
          operator: 'contains_any',
          value: ['rot', 'rớt', 'Rot', 'Rớt', 'mat', 'mất']
        }
      ],
      actions: [
        {
          type: 'update_status',
          payload: { status: 'lost' }
        }
      ],
      enabled: true,
      priority: 10,
    }
  });

  console.log('Automation rules created successfully!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
