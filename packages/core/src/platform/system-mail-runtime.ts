import { DefaultSystemMailer } from './system-mailer';
import { currentSystemMailer, setSystemMailer, type SystemMailer } from './system-mail';

/**
 * Zapojení systémové pošty při startu procesu.
 *
 * NENÍ TO PODMÍNKA FUNKČNOSTI a je to schválně. `queueSystemMail` si odesílatele
 * sestaví líně sama, takže i proces, který tuhle funkci nezavolá, poštu odešle.
 * Modulový singleton nastavený odjinud je v Next.js křehký předpoklad: obsluha
 * trasy a `instrumentation.ts` můžou být v oddělených modulových grafech a každý
 * pak vidí vlastní kopii proměnné.
 *
 * K čemu tedy je: sestaví odesílatele DŘÍV, než přijde první požadavek, a to
 * v obou procesech, kde systémová pošta vzniká. Ve webu jde o obnovu hesla,
 * změnu hesla, pozvánku a ověření adresy zkušebního režimu, ve workeru
 * o upozornění na vypnutý webhook z jobu `platform.webhook_deliver`.
 */
let installed = false;

export function installSystemMailer(override?: SystemMailer): SystemMailer {
  if (!installed || override) {
    setSystemMailer(override ?? new DefaultSystemMailer());
    installed = true;
  }
  return currentSystemMailer() ?? new DefaultSystemMailer();
}

/** Jen pro testy: dovolí zapojit odesílatele znovu. */
export function resetSystemMailerInstallation(): void {
  installed = false;
}
