'use client';

/**
 * Poslední záchrana, když spadne i kořenový layout.
 *
 * Vznikla ze dvou důvodů naráz.
 *
 * Provozní: bez vlastní verze si Next vyrábí svou výchozí, a ta se při
 * `next build` předrenderovává jako `/_global-error`. Padalo to na
 *
 *   TypeError: Cannot read properties of null (reading 'useContext')
 *   Export encountered an error on /_global-error/page, exiting the build.
 *
 * takže produkční image nešla postavit. Vlastní stránka bez jediného kontextu
 * ten problém nemá.
 *
 * Věcný, a ten je důležitější: tahle obrazovka se ukáže uživateli ve chvíli,
 * kdy je všechno ostatní rozbité. Nesmí proto záviset na ničem, co může být
 * taky rozbité: žádné překlady, žádný návrhový systém, žádný stav. Proto tu
 * jsou texty natvrdo česky a styly přímo v atributu.
 *
 * `digest` je identifikátor chyby ze serverového logu. Je vidět schválně:
 * bez něj nemá uživatel co nahlásit a nikdo nedohledá, co se stalo.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="cs">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          background: '#fafafa',
          color: '#18181b',
        }}
      >
        <main style={{ maxWidth: '32rem', padding: '2rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: '0 0 0.75rem' }}>
            Aplikace se neočekávaně zastavila
          </h1>
          <p style={{ margin: '0 0 1.5rem', lineHeight: 1.6, color: '#52525b' }}>
            Zkuste to prosím znovu. Pokud potíž trvá, ozvěte se nám a přiložte kód níže, díky němu
            dohledáme, co se stalo.
          </p>
          {error.digest !== undefined && (
            <p
              style={{
                margin: '0 0 1.5rem',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '0.875rem',
                color: '#71717a',
              }}
            >
              Kód chyby: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              border: 0,
              borderRadius: '0.5rem',
              padding: '0.625rem 1.25rem',
              fontSize: '0.9375rem',
              fontWeight: 500,
              color: '#ffffff',
              background: '#18181b',
              cursor: 'pointer',
            }}
          >
            Zkusit znovu
          </button>
        </main>
      </body>
    </html>
  );
}
