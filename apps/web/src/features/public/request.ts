/**
 * Čtení požadavku na veřejných stránkách. Žádné cookie, žádná relace: autorizaci
 * nese výhradně podepsaný token nebo neuhodnutelný slug v adrese.
 */

/**
 * Klientská IP z hlaviček reverzní proxy. Bere se PRVNÍ položka `X-Forwarded-For`,
 * protože další si může dopsat kdokoliv po cestě. Stejné pravidlo používá i trackovací
 * povrch `/t/**`.
 */
export function requestIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded !== null && forwarded !== '') {
    const first = forwarded.split(',')[0]?.trim();
    if (first !== undefined && first !== '') return first;
  }
  return request.headers.get('x-real-ip') ?? '0.0.0.0';
}

export function requestUserAgent(request: Request): string {
  return request.headers.get('user-agent') ?? '';
}

/**
 * Tělo požadavku jako `URLSearchParams`, ať přišlo jako urlencoded, nebo jako multipart.
 * RFC 8058 uvádí obě kódování, takže endpoint odhlášení musí umět obojí.
 */
export async function readFormBody(request: Request): Promise<URLSearchParams> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    return new URLSearchParams([...form.entries()].map(([key, value]) => [key, String(value)]));
  }
  return new URLSearchParams(await request.text());
}
