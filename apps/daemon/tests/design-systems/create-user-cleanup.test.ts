import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsState = vi.hoisted(() => ({
  failMetadataWrite: false,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn<typeof actual.writeFile>(async (...args) => {
      const [target] = args;
      if (fsState.failMetadataWrite && String(target).endsWith(`${path.sep}metadata.json`)) {
        throw new Error('metadata write failed');
      }
      return actual.writeFile(...args);
    }),
  };
});

const { createUserDesignSystem } = await import('../../src/design-systems/index.js');

describe('createUserDesignSystem cleanup', () => {
  let root: string;

  beforeEach(async () => {
    fsState.failMetadataWrite = false;
    root = await mkdtemp(path.join(tmpdir(), 'od-design-system-cleanup-'));
  });

  afterEach(async () => {
    fsState.failMetadataWrite = false;
    await rm(root, { recursive: true, force: true });
  });

  it('removes a partially created draft when metadata writing fails after DESIGN.md', async () => {
    fsState.failMetadataWrite = true;

    await expect(createUserDesignSystem(root, {
      title: 'Acme Product',
      category: 'Brands',
      status: 'draft',
      artifactMode: 'agent-managed',
    })).rejects.toThrow('metadata write failed');

    await expect(readdir(root)).resolves.toEqual([]);
  });
});
