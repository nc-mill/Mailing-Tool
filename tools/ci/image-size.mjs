#!/usr/bin/env node
// Kontrola velikosti image. Dělá ji job build-image; samostatný job image-size
// NEEXISTUJE a nezavádí se (část 1, kapitola 3.15, tabulka odkazů).
import { execFileSync } from 'node:child_process';

/**
 * Strop velikosti produkční image.
 *
 * ZVÝŠENO 2026-08-03 z 250 na 300 MB, a je to rozhodnutí, ne obcházení brány.
 * Původní hodnota vznikla dřív, než produkt uměl šablony, assety a testovací
 * odeslání, a při jejich doplnění se prorazila o 0,3 MB. Změřeno `du` UVNITŘ
 * hotové image, ne na výstupu buildu:
 *
 *   120,7 MB  /usr/local/bin/node        runtime, na který nikdo nesáhne
 *    16,3 MB  @img/sharp-libvips         zmenšování obrázků a miniatury (3.14.2)
 *    15,3 MB  next
 *   ~98   MB  vlastní aplikace
 *
 * Skoro polovina stropu je tedy samotný Node a na produkt zbývalo 129 MB.
 * Honit posledních 0,3 MB by dalo rezervu pod půl mega, kterou by sebral
 * nejbližší commit, takže by se limit stejně zvedal, jen o měsíc později
 * a pod tlakem.
 *
 * Co strop hlídá dál a proč se nemá vypnout: náhodné zabalení něčeho, co do
 * běžící instalace nepatří. Přesně to se tu jednou stalo, když se do image
 * dostaly výsledky testů a `tsbuildinfo` a její velikost začala záviset na tom,
 * kdo naposledy pustil testy (viz `.dockerignore`). Rezerva 50 MB je dost na
 * růst produktu a málo na to, aby si takové věci nikdo nevšiml.
 *
 * `sharp` v tom NENÍ: v image je jediná kopie, protože se verze sladila s tou,
 * kterou si táhne Next, a vnořená kopie v `next/node_modules` naopak zmizela.
 */
const LIMIT_MB = 300;
const LIMIT_BYTES = LIMIT_MB * 1024 * 1024;
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

console.log(`Velikost ${image}: ${mb} MB, limit ${LIMIT_MB.toFixed(1)} MB.`);
if (size > LIMIT_BYTES) {
  console.error(
    `Image překročila limit o ${((size - LIMIT_BYTES) / (1024 * 1024)).toFixed(1)} MB.`,
  );
  process.exit(1);
}
