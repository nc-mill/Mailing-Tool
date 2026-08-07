import { describe, expect, it } from 'vitest';
import type { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { buildSystemMailSesCommand, sendSystemMailSes, type SesSendApi } from './system-mail-ses';
import type { SesConfig } from '../providers/types';

/**
 * Odeslání systémové pošty účtem typu SES.
 *
 * Test NESAHÁ na AWS: klient je podstrčený, protože se měří obsah příkazu
 * a překlad chyby, ne to, jestli Amazon odpoví. Měřit „SDK zavolá SDK" by
 * nedokázalo nic, přesně jako to dělal zelený test portu, ve kterém
 * `setSystemMailer` nikdo nevolal.
 */

const CONFIG: SesConfig = {
  kind: 'ses',
  region: 'eu-central-1',
  access_key_id: 'AKIAEXAMPLE',
  secret_access_key: 'tajne',
  configuration_set_name: 'mlain-set',
  sns_topic_arn: null,
  max_send_rate: 14,
  max_24h_send: 50_000,
};

const MIME = ['From: mlain@example.test', 'To: petr@example.cz', '', 'Ahoj'].join('\n');

function recorder(result: { MessageId?: string } | Error): {
  api: SesSendApi;
  sent: SendEmailCommand[];
} {
  const sent: SendEmailCommand[] = [];
  return {
    sent,
    api: {
      async send(command) {
        sent.push(command);
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
}

describe('systémová pošta přes SES', () => {
  it('posílá hotové MIME jako Raw, ne skládané Simple', async () => {
    const { api, sent } = recorder({ MessageId: 'ses-1' });
    const result = await sendSystemMailSes({
      config: CONFIG,
      from: 'mlain@example.test',
      to: 'petr@example.cz',
      message: MIME,
      timeoutMs: 5000,
      api,
    });

    expect(result).toEqual({ ok: true, messageId: 'ses-1' });
    const input = sent[0]?.input;
    expect(input?.FromEmailAddress).toBe('mlain@example.test');
    expect(input?.Destination?.ToAddresses).toEqual(['petr@example.cz']);
    expect(Buffer.from(input?.Content?.Raw?.Data as Uint8Array).toString('utf8')).toBe(MIME);
    expect(input?.Content?.Simple).toBeUndefined();
  });

  /**
   * NEJDŮLEŽITĚJŠÍ TEST V SOUBORU, je to zmírnění rizika RZ3.
   *
   * Kampaňový dispatcher v Go posílá značky `ml_msg` a `ml_mday`, aby se odraz
   * dal spárovat s řádkem v `messages`. Systémová pošta žádný řádek v `messages`
   * nemá a mít nebude, takže by značky slibovaly párování, které nemůže vyjít.
   * `ListManagementOptions` chybí ze stejného důvodu jako v Go: SES by si do
   * zprávy přidal vlastní odhlašovací hlavičky.
   */
  it('neposílá message tagy ani vlastní správu seznamů', async () => {
    const { api, sent } = recorder({ MessageId: 'ses-2' });
    await sendSystemMailSes({
      config: CONFIG,
      from: 'mlain@example.test',
      to: 'petr@example.cz',
      message: MIME,
      timeoutMs: 5000,
      api,
    });

    const input = sent[0]?.input;
    expect(input?.EmailTags).toBeUndefined();
    expect(input?.ListManagementOptions).toBeUndefined();
  });

  it('konfigurační sadu posílá, jen když ji účet má', () => {
    expect(
      buildSystemMailSesCommand({
        from: 'a@b.cz',
        to: 'c@d.cz',
        message: MIME,
        configurationSetName: 'mlain-set',
      }).input.ConfigurationSetName,
    ).toBe('mlain-set');

    // Prázdný řetězec SES odmítne s BadRequestException, což vypadá jako vada
    // zprávy, přestože jde o nevyplněné nastavení účtu.
    for (const empty of ['', '   ', null]) {
      expect(
        buildSystemMailSesCommand({
          from: 'a@b.cz',
          to: 'c@d.cz',
          message: MIME,
          configurationSetName: empty,
        }).input.ConfigurationSetName,
      ).toBeUndefined();
    }
  });

  /**
   * Riziko RZ2: SES odmítne `From`, které není ověřenou identitou. Kód chyby
   * musí projít ven nezměněný, aby se ve výsledné hlášce dalo poznat „adresa
   * odesílatele není ověřená" od „vyčerpaná kvóta".
   */
  it('jméno výjimky AWS se přenese jako kód chyby', async () => {
    const rejected = Object.assign(new Error('Email address is not verified.'), {
      name: 'MessageRejected',
    });
    const { api } = recorder(rejected);
    const result = await sendSystemMailSes({
      config: CONFIG,
      from: 'mlain@neovereno.test',
      to: 'petr@example.cz',
      message: MIME,
      timeoutMs: 5000,
      api,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('MessageRejected');
    expect(result.detail).toContain('is not verified');
  });

  it('throttling od SES se pozná podle kódu, aby šlo poradit opakování', async () => {
    const throttled = Object.assign(new Error('Maximum sending rate exceeded.'), {
      name: 'TooManyRequestsException',
    });
    const { api } = recorder(throttled);
    const result = await sendSystemMailSes({
      config: CONFIG,
      from: 'mlain@example.test',
      to: 'petr@example.cz',
      message: MIME,
      timeoutMs: 5000,
      api,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TooManyRequestsException');
  });

  it('bezejmenná chyba dostane aspoň zatřídění, ne prázdný kód', async () => {
    const { api } = recorder(new Error('spadlo to'));
    const result = await sendSystemMailSes({
      config: CONFIG,
      from: 'mlain@example.test',
      to: 'petr@example.cz',
      message: MIME,
      timeoutMs: 5000,
      api,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('ses_send_failed');
    expect(result.detail).toContain('unknown');
  });
});
