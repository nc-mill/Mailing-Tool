import { buildRenderSchema } from '@mlain/emails/compile/render-schema';
import type { Document } from '@mlain/emails/document/types';
import type { FieldCatalog } from '../fields/catalog';
import { CONFIRM_URL_PATH } from './default-emails';

/**
 * ZÁVORA: potvrzovací e-mail bez odkazu na potvrzení.
 *
 * Dokument, který je připojený jako POTVRZOVACÍ e-mail seznamu, musí obsahovat
 * odkaz na `{{ data.confirm_url }}`. Bez něj dostane člověk zprávu, ze které
 * přihlášení dokončit nejde, a jeho `pending` visí, dokud ho někdo ručně
 * nepotvrdí nebo dokud to nevzdá. Nic přitom nespadne: render běží
 * s `strictVariables: false`, takže by z chybějící proměnné byl prázdný
 * řetězec, tedy `href=""`.
 *
 * JE TO VLASTNOST VAZBY, NE ŠABLONY. Tentýž dokument je jako uvítací e-mail
 * naprosto v pořádku. Kontrola proto nepatří do domény šablon a nesmí bránit
 * uložení šablony samotné; váže se na okamžik, kdy se šablona připojuje
 * k seznamu, a podruhé na okamžik odeslání (`subscription-emails.ts` vrací
 * `confirm_link_missing` a zapíše to do auditu).
 *
 * ODKUD SE BEROU CESTY. Z `buildRenderSchema`, tedy z téhož sběrače, který
 * plní `render_data` pro sender. Vlastní hledání v dokumentu by se s ním
 * dřív nebo později rozešlo a rozdíl by se projevil tím, že závora pustí
 * e-mail, který odkaz nemá. Sběrač čte i URL pole (tlačítko, odkaz v textu),
 * ne jen výrazy v textu, což je přesně to místo, kam potvrzovací odkaz patří.
 */
export function documentHasConfirmLink(document: Document, fields: FieldCatalog): boolean {
  const schema = buildRenderSchema(document, { fields, skippedBlockIds: new Set() });
  return schema.usedPaths.includes(CONFIRM_URL_PATH);
}

/**
 * DRUHÁ ZÁVORA: odhlašovací odkaz v e-mailu seznamu.
 *
 * E-maily seznamu odcházejí s `messages.kind = 'transactional'` a sender u toho
 * druhu odhlašovací odkaz NEVYRÁBÍ: `worker.go` dosadí do render dat prázdný
 * řetězec (`data["unsubscribe_url"] = unsub`, kde `unsub` je u transakční
 * zprávy `""`). Přepisuje ho BEZPODMÍNEČNĚ, takže si ho ani nejde dosadit
 * vlastní cestou, jako se to dělá u `confirm_url`.
 *
 * Uvítací e-mail s patičkou „Odhlásit se z odběru" by tedy odešel s odkazem
 * do prázdna. Že to má být **chyba blokující uložení, a ne varování**, rozhodl
 * vedoucí týmu 5. 8. 2026. Opírá se přitom o jedinou věc, kterou k tomu řekl
 * zadavatel, totiž že si v editoru nepřeje žádná upozornění: polovičaté
 * „pozor, možná" tam tedy nemá co dělat, buď to projde, nebo to neprojde.
 *
 * ODKUD SE TO POZNÁ. Ze `systemTags` téhož sběrače, který plní `render_data`
 * pro sender, takže se závora nemůže rozejít s tím, co se doopravdy odešle.
 * Zachytí obě podoby: zapnuté odhlášení v patičce i ruční odkaz
 * `{{ unsubscribe_url }}` v textu.
 */
export function documentUsesUnsubscribeUrl(document: Document, fields: FieldCatalog): boolean {
  const schema = buildRenderSchema(document, { fields, skippedBlockIds: new Set() });
  return schema.systemTags.includes('unsubscribe_url');
}
