import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_NODE_VERSION = '24.19.0';
const REQUIRED_ARCH = 'x64';
const target = path.resolve('src-tauri/binaries/node-x86_64-pc-windows-msvc.exe');

if (process.platform !== 'win32') {
  console.log('prepare-sidecar: non-Windows host, skipping .exe copy');
  process.exit(0);
}

if (process.versions.node !== REQUIRED_NODE_VERSION || process.arch !== REQUIRED_ARCH) {
  console.error(
    `prepare-sidecar: expected Node ${REQUIRED_NODE_VERSION} (${REQUIRED_ARCH}), found ${process.versions.node} (${process.arch})`
  );
  process.exit(1);
}

const sha256 = (filePath) =>
  crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

fs.mkdirSync(path.dirname(target), { recursive: true });
const srcHash = sha256(process.execPath);
const dstHash = fs.existsSync(target) ? sha256(target) : null;

if (dstHash !== srcHash) {
  fs.copyFileSync(process.execPath, target);
  console.log(`prepare-sidecar: copied Node ${process.versions.node} (${process.arch}) sha256=${srcHash} -> ${target}`);
} else {
  console.log(`prepare-sidecar: verified Node ${process.versions.node} (${process.arch}) sha256=${srcHash}`);
}
