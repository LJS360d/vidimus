import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after } from 'node:test';

export const fixture = (files: Record<string, string | Buffer>) => {
  const root = mkdtempSync(join(tmpdir(), 'vidimus-'));
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};
