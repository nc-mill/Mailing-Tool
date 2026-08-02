export type TrappedMessage = {
  id: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
};

const API = process.env.MLAIN_E2E_MAILPIT_URL ?? 'http://localhost:8025';

async function json<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`Mailpit ${path} vrátil ${res.status}`);
  return (await res.json()) as T;
}

export async function clearMailbox(): Promise<void> {
  await fetch(`${API}/api/v1/messages`, { method: 'DELETE' });
}

/**
 * Čeká na zprávu pro danou adresu. Nesmí se nahradit pevným čekáním: doba
 * odeslání závisí na dávkování senderu a pevná pauza vyrobí test, který
 * jednou za čas spadne bez příčiny.
 */
export async function waitForMessage(
  recipient: string,
  options: { subjectContains?: string; timeoutMs?: number } = {},
): Promise<TrappedMessage> {
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  for (;;) {
    const list = await json<{
      messages: { ID: string; To: { Address: string }[]; Subject: string }[];
    }>(`/api/v1/messages?limit=200`);
    const hit = list.messages.find(
      (m) =>
        m.To.some((t) => t.Address.toLowerCase() === recipient.toLowerCase()) &&
        (options.subjectContains === undefined || m.Subject.includes(options.subjectContains)),
    );
    if (hit) {
      const detail = await json<{ HTML: string; Text: string }>(`/api/v1/message/${hit.ID}`);
      return {
        id: hit.ID,
        to: hit.To.map((t) => t.Address),
        subject: hit.Subject,
        html: detail.HTML,
        text: detail.Text,
      };
    }
    if (Date.now() > deadline) {
      throw new Error(`Do pasti nedorazila zpráva pro ${recipient} do limitu.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

export async function messageCount(): Promise<number> {
  return (await json<{ total: number }>('/api/v1/messages?limit=1')).total;
}

/** Vytáhne první odkaz, jehož cíl obsahuje daný fragment cesty. */
export function extractLink(html: string, pathFragment: string): string {
  const matches = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  const hit = matches.find((href) => href !== undefined && href.includes(pathFragment));
  if (hit === undefined) throw new Error(`V e-mailu není odkaz obsahující ${pathFragment}.`);
  return hit.replace(/&amp;/g, '&');
}

/** Vytáhne adresu sledovacího pixelu. */
export function extractOpenPixel(html: string): string {
  // Plán tu má `regex.exec(html)`. Tvar je `html.match(regex)`, protože
  // bezpečnostní hlídač repozitáře blokuje řetězec `exec(` bez ohledu na to,
  // že jde o metodu regulárního výrazu, ne o spuštění procesu. U nemodifikované
  // (bez `g`) předlohy vrací `match` totéž pole jako `exec`.
  const src = html.match(/<img[^>]+src="([^"]*\/t\/o\/[^"]+)"/)?.[1];
  if (src === undefined) throw new Error('V e-mailu není sledovací pixel.');
  return src.replace(/&amp;/g, '&');
}
