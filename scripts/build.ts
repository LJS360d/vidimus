import { execFileSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

rmSync('dist', { recursive: true, force: true });
execFileSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
cpSync('src/core/peer-types.d.ts', 'dist/core/peer-types.d.ts');
execFileSync(process.execPath, ['scripts/schema.ts'], { stdio: 'inherit' });
