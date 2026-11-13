import fs from 'node:fs';
import path from 'node:path';

const target = path.resolve('src-tauri/binaries/node-x86_64-pc-windows-msvc.exe');
if (process.platform !== 'win32') {
  console.log('prepare-sidecar: non-Windows host, skipping .exe copy');
  process.exit(0);
}

const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  console.error(`Node >= 22 required, found ${process.versions.node}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
const srcStat = fs.statSync(process.execPath);
const dstStat = fs.existsSync(target) ? fs.statSync(target) : null;

if (!dstStat || dstStat.size !== srcStat.size) {
  fs.copyFileSync(process.execPath, target);
  console.log(`prepare-sidecar: copied Node ${process.versions.node} -> ${target}`);
}
