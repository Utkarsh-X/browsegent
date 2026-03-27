// extension/build.ts — compile stealth.ts + content.ts
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function build(src: string, out: string): void {
  const srcPath = path.resolve(src);
  const outPath = path.resolve(out);
  execSync(`npx esbuild ${srcPath} --bundle=false --format=iife --outfile=${outPath} --target=es2020`, {
    stdio: 'inherit',
  });
  const size = fs.statSync(outPath).size;
  console.log(`\n  ${out.replace('extension/', '')}  ${(size / 1024).toFixed(1)}kb`);
}

build('extension/stealth.ts', 'extension/stealth.js');
build('extension/content.ts', 'extension/content.js');
console.log('\nExtension build complete.');
