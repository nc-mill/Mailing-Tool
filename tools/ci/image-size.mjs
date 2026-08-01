#!/usr/bin/env node
// Kontrola velikosti image. Dělá ji job build-image; samostatný job image-size
// NEEXISTUJE a nezavádí se (část 1, kapitola 3.15, tabulka odkazů).
import { execFileSync } from 'node:child_process';

const LIMIT_BYTES = 250 * 1024 * 1024;
const image = process.argv[2];

if (!image) {
  console.error('Použití: node tools/ci/image-size.mjs <image>');
  process.exit(64);
}

const raw = execFileSync('docker', ['image', 'inspect', image, '--format', '{{.Size}}'], {
  encoding: 'utf8',
}).trim();
const size = Number.parseInt(raw, 10);
const mb = (size / (1024 * 1024)).toFixed(1);

if (Number.isNaN(size)) {
  console.error(`Nepodařilo se přečíst velikost image ${image}.`);
  process.exit(1);
}

console.log(`Velikost ${image}: ${mb} MB, limit 250.0 MB.`);
if (size > LIMIT_BYTES) {
  console.error(
    `Image překročila limit o ${((size - LIMIT_BYTES) / (1024 * 1024)).toFixed(1)} MB.`,
  );
  process.exit(1);
}
