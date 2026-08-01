import fs from 'node:fs';
import path from 'node:path';
import { buildConfigManifest } from '../src/config/manifest';

const target = path.join(import.meta.dirname, '../src/config/config.manifest.json');
fs.writeFileSync(target, `${JSON.stringify(buildConfigManifest(), null, 2)}\n`);
console.log(`Zapsáno ${target}`);
