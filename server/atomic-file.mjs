import { open, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// The existing destination remains intact until the complete replacement is synced.
// beforeCommit is an internal test barrier, never exposed through IPC or HTTP.
export async function atomicReplace(target, produce, { beforeCommit } = {}) {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await produce(temporary);
    const handle = await open(temporary, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
    await beforeCommit?.(temporary);
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
}
