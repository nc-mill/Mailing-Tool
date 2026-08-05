import { brandExtractHandler } from '../../brand/jobs/brand-extract-handler';
import { assetQueueHandlers } from '../../assets/jobs';

/**
 * Fronta se jmenuje `content.brand_extract`, takže codegen workeru (P01,
 * rozhodnutí D4) hledá handler v `src/content/jobs`, i když logika extrakce
 * bydlí v `src/brand`: `handlerModulePath` odvozuje adresář z PREFIXU JMÉNA
 * FRONTY, ne z pole `domain`.
 *
 * Tenhle soubor je proto jen připojovač a nic neimplementuje. Alternativa by
 * byla přejmenovat frontu na `brand.extract`, jenže registr front je zmrazený
 * a vlastní ho P01.
 *
 * Jméno `handlers` je závazné: codegen generuje
 * `import { handlers as hN } from '@mlain/core/<domena>/jobs'`. Pod jiným
 * jménem se soubor přeloží a testy projdou, ale bundle workeru spadne až
 * při buildu image.
 */
// Obsluha DŘÍV visela na `needsDependencies`, protože továrnu `BrandExtractDeps`
// nikdo nedodal: repozitář značky uměl jen číst, zápisy `markRunning`, `finish`
// ani `failStaleExtractions` neexistovaly a `createBrandRuntime` mělo nula
// volajících. Extrakce značky tedy nešla ven vůbec.
//
// Chybějící řetěz držel zafixovaný záměrně červený test v `ai/wiring.test.ts`.
// Zezelenal sám tím, že volající vznikl; jeho tvrzení se nezmírňovalo.
//
// `brandExtractHandler` už je hotový `QueueHandler` včetně obalu `perJob`,
// takže se tu jen připojuje. Ten obal je povinný: pg-boss volá obsluhu
// s DÁVKOU úloh, kdežto `runBrandExtraction` bere jednu.
/**
 * Fronty domény assetů se připojují ROZBALENÍM, ne po jedné.
 *
 * `assetQueueHandlers` je nese už zabalené (`perJob` u `content.process_asset`,
 * `once` u obou cronových), takže se tu nic obalovat nesmí podruhé. Sáhnout
 * sem znovu bude potřeba jedině tehdy, když doména assetů přidá frontu, a to
 * pozná `handler-coverage.test.ts` sám.
 *
 * `content.process_asset` dnes NIKDO NEPLNÍ a je to v pořádku: varianty se
 * generují synchronně při nahrání, protože obrázek si tahá schránka příjemce
 * a líné generování by u kampaně na padesát tisíc lidí znamenalo tolikéž
 * souběžných požadavků na soubor, který ještě neexistuje. Fronta je pro pozdější
 * dogenerování variant ke stávajícím assetům.
 *
 * Obě cronové potřebují `DATABASE_URL_MAINTENANCE`, protože jdou napříč
 * projekty. Bez ní skončí chybou s vysvětlením, ne tiše.
 */
export const handlers = {
  'content.brand_extract': brandExtractHandler,
  ...assetQueueHandlers,
} as const;
