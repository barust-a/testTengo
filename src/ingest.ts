import path from 'node:path';

import { prisma } from './db/prisma.js';
import { deleteOrphanBuyers, saveNotice } from './db/tender-store.js';
import { sourceKey } from './dedup/match.js';
import { loadFixtureNotices } from './sources/fixtures.js';

const FIXTURES_DIR = path.resolve(import.meta.dirname, '..', 'fixtures');

async function main(): Promise<void> {
  const { notices, failures } = await loadFixtureNotices(FIXTURES_DIR);
  for (const failure of failures) {
    console.error(`Could not parse ${failure.file}:`, failure.error);
  }

  let createdCount = 0;
  let attachedCount = 0;
  // Sequential on purpose: each notice must be matched against the tenders saved before it.
  for (const notice of notices) {
    try {
      const { created } = await prisma.$transaction((tx) => saveNotice(tx, notice));
      if (created) createdCount += 1;
      else attachedCount += 1;
    } catch (error) {
      failures.push({ file: sourceKey(notice), error });
      console.error(`Could not save ${sourceKey(notice)}:`, error);
    }
  }
  const orphanBuyerCount = await prisma.$transaction(deleteOrphanBuyers);

  const [tenderCount, sourceCount] = await Promise.all([prisma.tender.count(), prisma.tenderSource.count()]);
  console.log(
    `Created ${createdCount} tenders; attached ${attachedCount} notices to an existing tender ` +
      '(published by another source, or already ingested).',
  );
  if (orphanBuyerCount > 0) console.log(`Removed ${orphanBuyerCount} buyers no tender refers to anymore.`);
  console.log(`Database: ${tenderCount} tenders from ${sourceCount} source notices.`);

  if (failures.length > 0) {
    console.error(`${failures.length} notice(s) failed, see above.`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
