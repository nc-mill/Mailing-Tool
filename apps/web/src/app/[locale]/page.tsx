import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/identity/require-user';

/**
 * Rozcestník na kořeni aplikace.
 *
 * PROČ VZNIKL: segment `[locale]` žádnou vlastní stránku NEMĚL. Kořenová
 * `app/page.tsx` sice existuje, jenže mezijazyková vrstva přepíše `/` na
 * `/{locale}`, a tam už se nic nevykreslí. Uživatel, který si otevřel adresu
 * instalace bez další cesty, tedy dostal **404 na vstupní stránce produktu**:
 *
 *   GET / 404 in 2.1s
 *
 * Nešlo to poznat z testů ani z odkazů uvnitř aplikace, protože všechny míří
 * na konkrétní obrazovky. Poznalo se to teprve tím, že si někdo otevřel
 * `http://localhost:3100/` a neměl se kde přihlásit.
 *
 * Chování se drží toho, co dělá přihlášení v `features/auth/actions.ts`:
 * přihlášený jde na svůj první projekt, nepřihlášený na přihlášení a člen bez
 * projektu na obrazovku, která mu ho nabídne založit.
 */
export const dynamic = 'force-dynamic';

export default async function RootPage() {
  const me = await requireUser('/');
  // `requireUser` u nepřihlášeného sám přesměruje na přihlášení; když vrátí
  // chybu, znamená to jinou potíž a nemá smysl ji tady dublovat vlastní
  // hláškou, protože rozcestník nemá co zobrazovat.
  if (!me.ok) redirect('/login');

  const first = me.data.memberships[0];
  redirect(first ? `/w/${first.slug}` : '/no-workspace');
}
