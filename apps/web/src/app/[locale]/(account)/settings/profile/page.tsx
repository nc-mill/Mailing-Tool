import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SUPPORTED_LOCALES } from '@mlain/i18n/locales';
import { updateProfileAction } from '@/features/profile/actions';
import { ProfileForm } from '@/features/profile/profile-form';
import { ChangePasswordForm } from '@/features/profile/change-password-form';
import { SessionsSection, type SessionRow } from '@/features/profile/sessions-section';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { supportedTimezones } from '@/features/settings/timezones';
import { apiFetch } from '@/lib/api-client/fetch';
import { requireUser } from '@/lib/identity/require-user';

/**
 * Stránka závisí na přihlášeném uživateli, takže se NEPŘEDRENDEROVÁVÁ.
 *
 * Bez tohohle ji Next při `next build` vykreslí a spadne, protože v době
 * sestavení žádná relace neexistuje:
 *
 *   TypeError: Cannot read properties of null (reading 'useContext')
 *   Export encountered an error on <cesta>, exiting the build.
 *
 * Chyba nemíří na příčinu, takže se hledá v komponentách. Statická podoba
 * téhle stránky přitom neexistuje: obsah je pro každého jiný.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('profile.title') };
}

/**
 * Stav S8 (částečná data) je tady vidět: když selže načtení relací, formulář
 * s osobními údaji funguje dál a chybu si vykreslí jen sekce relací. Přesně
 * to žádá matice 7.2 části 6 u typu obrazovky Nastavení.
 */
export default async function ProfilePage() {
  const t = await getTranslations('settings');

  // Obě čtení běží naráz, aby vedle sebe nevznikl vodopád dvou požadavků.
  const [me, sessions] = await Promise.all([
    requireUser('/settings/profile'),
    apiFetch<{ data: SessionRow[] }>('/api/v1/auth/sessions'),
  ]);

  if (!me.ok) return <SettingsProblem problem={me.problem} />;

  return (
    <>
      <h1 className="text-2xl font-semibold">{t('profile.title')}</h1>
      <p className="mt-2 text-text-muted">{t('profile.lead')}</p>

      <div className="mt-8 space-y-12">
        <ProfileForm
          action={updateProfileAction}
          user={me.data.user}
          locales={SUPPORTED_LOCALES}
          timezones={supportedTimezones()}
        />
        <ChangePasswordForm email={me.data.user.email} />
        <SessionsSection sessions={sessions} now={new Date()} />
      </div>
    </>
  );
}
