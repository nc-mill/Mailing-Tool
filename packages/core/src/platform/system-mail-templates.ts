import type { SystemMail, SystemMailName } from './system-mail';

/**
 * Texty systémových e-mailů.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ TÍM, CO V REPU JE. Rozhodnutí R7 plánu P04 počítalo
 * s tím, že šablony dodá P08. P08 je nedodal: `packages/emails` umí jen blokový
 * model kampaňových šablon, který potřebuje dokument, značku a kompilaci, a nic
 * z toho systémový e-mail nemá. Pěti provozním zprávám o čtyřech větách by ta
 * mašinerie byla k ničemu.
 *
 * Texty jsou proto tady, prostý text plus minimální HTML, bez obrázků a bez
 * sledování. Až `packages/emails` systémové šablony dostane, mění se jediný
 * soubor: rozhraní `renderSystemMail` zůstává.
 *
 * Jazyky jsou dva, `cs` a `en`, stejně jako `packages/i18n`. Neznámý jazyk spadne
 * na `en`, nikdy nespadne na chybu: nedoručený e-mail kvůli jazyku by byl horší
 * než e-mail v cizím jazyce.
 */
export type RenderedSystemMail = { subject: string; text: string; html: string };

type Copy = { subject: string; lines: string[]; cta?: string | undefined };

const CS: Record<SystemMailName, (data: Record<string, string>) => Copy> = {
  password_reset: (d) => ({
    subject: 'Obnova hesla',
    lines: [
      'Někdo požádal o obnovu hesla k vašemu účtu.',
      'Odkaz níž platí omezenou dobu a použije se jen jednou.',
      'Pokud jste o obnovu nežádali, nemusíte dělat nic; heslo zůstává beze změny.',
    ],
    cta: d['url'],
  }),
  password_changed: (d) => ({
    subject: 'Heslo bylo změněno',
    lines: [
      `Heslo k vašemu účtu bylo změněno ${d['changed_at'] ?? ''}.`.trim(),
      'Všechna přihlášení na ostatních zařízeních byla ukončena.',
      'Pokud jste heslo neměnili vy, ozvěte se správci instalace.',
    ],
  }),
  invitation: (d) => ({
    subject: 'Pozvánka do projektu',
    lines: [
      'Byli jste pozváni ke spolupráci na projektu.',
      'Pozvánku přijmete odkazem níž. Odkaz má omezenou platnost.',
    ],
    cta: d['url'],
  }),
  webhook_endpoint_disabled: (d) => ({
    subject: 'Webhook byl vypnutý',
    lines: [
      `Koncový bod ${d['endpoint_id'] ?? ''} byl automaticky vypnutý.`.trim(),
      `Důvod: ${d['reason'] ?? 'neuveden'}.`,
      'Dokud ho znovu nezapnete v nastavení, události se na něj nedoručují.',
    ],
  }),
  trial_address_verification: (d) => ({
    subject: 'Potvrzení adresy pro zkušební režim',
    lines: [
      'Tato adresa byla přidána mezi ověřené adresy zkušebního režimu.',
      'Dokud ji nepotvrdíte odkazem níž, žádná kampaň na ni neodejde.',
    ],
    cta: d['url'],
  }),
};

const EN: Record<SystemMailName, (data: Record<string, string>) => Copy> = {
  password_reset: (d) => ({
    subject: 'Password reset',
    lines: [
      'Someone requested a password reset for your account.',
      'The link below is valid for a limited time and can be used once.',
      'If you did not request it, no action is needed; your password stays unchanged.',
    ],
    cta: d['url'],
  }),
  password_changed: (d) => ({
    subject: 'Your password was changed',
    lines: [
      `Your account password was changed ${d['changed_at'] ?? ''}.`.trim(),
      'All sessions on other devices were signed out.',
      'If this was not you, contact the administrator of this installation.',
    ],
  }),
  invitation: (d) => ({
    subject: 'Invitation to a project',
    lines: [
      'You have been invited to collaborate on a project.',
      'Accept the invitation using the link below. The link expires.',
    ],
    cta: d['url'],
  }),
  webhook_endpoint_disabled: (d) => ({
    subject: 'Webhook endpoint disabled',
    lines: [
      `Endpoint ${d['endpoint_id'] ?? ''} was disabled automatically.`.trim(),
      `Reason: ${d['reason'] ?? 'not given'}.`,
      'Events are not delivered to it until you enable it again in settings.',
    ],
  }),
  trial_address_verification: (d) => ({
    subject: 'Confirm this address for trial mode',
    lines: [
      'This address was added to the verified addresses of trial mode.',
      'Until you confirm it with the link below, no campaign will be sent to it.',
    ],
    cta: d['url'],
  }),
};

/** Minimální escapování pro HTML část. Do textů se dosazují URL a identifikátory. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderSystemMail(mail: SystemMail): RenderedSystemMail {
  const table = mail.locale.toLowerCase().startsWith('cs') ? CS : EN;
  const copy = table[mail.template](mail.data);

  const textParts = [...copy.lines];
  if (copy.cta) textParts.push('', copy.cta);
  const text = textParts.join('\n');

  const htmlBody = copy.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('\n');
  const htmlCta = copy.cta
    ? `\n<p><a href="${escapeHtml(copy.cta)}">${escapeHtml(copy.cta)}</a></p>`
    : '';

  return {
    subject: copy.subject,
    text,
    html: `<!doctype html><html><body>\n${htmlBody}${htmlCta}\n</body></html>`,
  };
}

/**
 * Složí RFC 5322 zprávu. Předmět jde vždy přes kódované slovo: diakritika
 * v holé hlavičce není platná a některé servery zprávu odmítnou.
 */
export function buildSystemMailMime(input: {
  from: string;
  to: string;
  rendered: RenderedSystemMail;
  now: Date;
  messageIdHost: string;
}): string {
  const boundary = `mlain-${input.now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const subject = `=?UTF-8?B?${Buffer.from(input.rendered.subject, 'utf8').toString('base64')}?=`;
  const messageId = `<${boundary}@${input.messageIdHost}>`;

  return [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${subject}`,
    `Date: ${input.now.toUTCString()}`,
    `Message-ID: ${messageId}`,
    // Systémová pošta se nesmí objevit v automatických odpovědích ani v prioritních
    // schránkách. `Auto-Submitted` je RFC 3834, `X-Auto-Response-Suppress` chápe Outlook.
    'Auto-Submitted: auto-generated',
    'X-Auto-Response-Suppress: All',
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(input.rendered.text, 'utf8')
      .toString('base64')
      .replace(/(.{76})/g, '$1\n'),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(input.rendered.html, 'utf8')
      .toString('base64')
      .replace(/(.{76})/g, '$1\n'),
    `--${boundary}--`,
  ].join('\n');
}
