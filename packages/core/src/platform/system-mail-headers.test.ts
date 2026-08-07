import { describe, expect, it } from 'vitest';
import { buildSystemMailMime, renderSystemMail } from './system-mail-templates';
import type { SystemMail, SystemMailName } from './system-mail';

/**
 * PODMÍNKA, KTEROU SYSTÉMOVÁ POŠTA NESMÍ PORUŠIT: žádný odhlašovací odkaz
 * a žádná hlavička `List-Unsubscribe`.
 *
 * Není to teorie ani přenesené pravidlo z transakční pošty. Odesílač u druhu
 * `transactional` přepisuje `unsubscribe_url` na prázdný řetězec
 * (`apps/sender/internal/app/worker.go`), takže odkaz vložený do textu skončí
 * jako prázdný `href`: uživatel klikne a nic se nestane. U systémové pošty by to
 * bylo ještě horší, protože ta odchází mimo odesílací pipeline úplně, takže by
 * odhlašovací odkaz nesměřoval nikam ani teoreticky, a odhlášení z pozvánky do
 * projektu nedává smysl ani věcně.
 *
 * Hlavička `List-Unsubscribe` je samostatná past. Poštovní klienti podle ní
 * nabídnou tlačítko „odhlásit", a když ho někdo použije u obnovy hesla, ohlásí
 * poskytovatel stížnost na adresu, na kterou se musí dát doručit vždycky.
 *
 * Test měří SLOŽENOU ZPRÁVU, ne úmysl. Kdo přidá odhlašovací patičku do
 * `system-mail-templates.ts` nebo hlavičku do `buildSystemMailMime`, dozví se
 * to tady, ne od uživatele.
 */

const TEMPLATES: SystemMailName[] = [
  'password_reset',
  'password_changed',
  'invitation',
  'webhook_endpoint_disabled',
  'trial_address_verification',
];

const DATA: Record<string, string> = {
  url: 'https://mlain.test/reset-password?token=abc',
  changed_at: '7. 8. 2026',
  endpoint_id: 'ep_1',
  reason: 'příliš mnoho chyb',
};

function mailsOf(template: SystemMailName): SystemMail[] {
  return ['cs', 'en'].map((locale) => ({
    template,
    to: 'petr@example.cz',
    locale,
    data: DATA,
  }));
}

function mimeOf(mail: SystemMail): string {
  return buildSystemMailMime({
    from: 'mlain@example.test',
    to: mail.to,
    rendered: renderSystemMail(mail),
    now: new Date('2026-08-07T10:00:00Z'),
    messageIdHost: 'example.test',
  });
}

describe('systémová pošta nenese nic z marketingové cesty', () => {
  for (const template of TEMPLATES) {
    for (const mail of mailsOf(template)) {
      it(`${template} (${mail.locale}) nemá hlavičku List-Unsubscribe`, () => {
        const mime = mimeOf(mail);
        expect(mime).not.toMatch(/^List-Unsubscribe/im);
        expect(mime).not.toMatch(/^List-Unsubscribe-Post/im);
        expect(mime).not.toMatch(/^List-Id/im);
        expect(mime).not.toMatch(/^Precedence:\s*bulk/im);
      });

      it(`${template} (${mail.locale}) nenese odhlašovací ani sledovací odkaz`, () => {
        const rendered = renderSystemMail(mail);
        const body = `${rendered.text}\n${rendered.html}`;
        // Veřejné cesty odhlášení a preferencí: /u/{token}, /p/{token}, /s/c/{token}.
        expect(body).not.toMatch(/\/(u|p)\/[^\s"']+/);
        expect(body).not.toMatch(/\/s\/c\//);
        // Sledovací cesty otevření a prokliku.
        expect(body).not.toMatch(/\/(o|c)\/[^\s"']+/);
        expect(body.toLowerCase()).not.toContain('unsubscribe');
        expect(body.toLowerCase()).not.toContain('odhlásit');
        expect(body.toLowerCase()).not.toContain('odhlaseni');
      });
    }
  }

  /**
   * Druhá strana téhož pravidla: hlavičky, které tam naopak BÝT MUSÍ. Bez nich
   * se systémová zpráva objeví v automatické odpovědi „jsem na dovolené" a ta
   * odpověď půjde na `mlain@doména`, tedy na adresu, kterou nikdo nečte.
   */
  it('drží Auto-Submitted a X-Auto-Response-Suppress', () => {
    const mime = mimeOf(mailsOf('password_reset')[0] as SystemMail);
    expect(mime).toMatch(/^Auto-Submitted: auto-generated$/im);
    expect(mime).toMatch(/^X-Auto-Response-Suppress: All$/im);
  });
});
