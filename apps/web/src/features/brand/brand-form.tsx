'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { brandToTheme } from '@mlain/emails/base/brand';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import { SelectField } from '@/lib/forms/select-field';
import { SubmitButton } from '@/lib/forms/submit-button';
import { useFormErrorFocus } from '@/lib/forms/use-form-error-focus';
import { BrandColorField } from './brand-color-field';
import { BrandLogoField, type BrandLogoValue } from './brand-logo-field';
import { BrandThemePreview } from './brand-theme-preview';

/**
 * Identifikátory písem, ne CSS stacky. Proč: `brandToTheme` mapuje uloženou
 * hodnotu zpátky na `FontStackId` regulárními výrazy a stack systémového písma
 * obsahuje „Segoe UI", takže by se ze `system` stala `tahoma`. Identifikátor
 * se mapuje sám na sebe u všech devíti hodnot, ověřeno čtením `STACK_HINTS`.
 */
const FONT_IDS = [
  'system',
  'arial',
  'helvetica',
  'verdana',
  'tahoma',
  'trebuchet',
  'georgia',
  'times',
  'courier',
] as const;

/** Hodnoty, na které `brandToTheme` zaokrouhluje: `Radius` z dokumentu e-mailu. */
const RADII = [0, 4, 6, 8, 12] as const;

export type BrandFormValues = {
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
  headingStack: string;
  bodyStack: string;
  radius: number;
  logo: BrandLogoValue;
};

export type BrandFormProps = {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  workspaceId: string;
  workspaceSlug: string;
  initial: BrandFormValues;
  initialState?: ActionState | undefined;
};

/**
 * Písmo uložené jako CSS stack (tak ho ukládá extrakce webu i `DEFAULT_TYPOGRAPHY`)
 * se přeloží na identifikátor z nabídky.
 *
 * Překlad NEDĚLÁ vlastní tabulka, ale `brandToTheme`, tedy tatáž funkce, která
 * ho udělá při skládání šablony. Druhá tabulka regulárních výrazů by se s ní
 * rozešla a nabídka by ukazovala jiné písmo, než jaké by dostal příjemce.
 */
function toFontIds(headingStack: string, bodyStack: string): { heading: string; body: string } {
  const theme = brandToTheme({
    palette: { primary: '#000000' },
    typography: { headingStack, bodyStack, radius: 0 },
  });
  return { heading: theme.fonts.heading, body: theme.fonts.body };
}

/**
 * Formulář značky projektu.
 *
 * Nabízí PRÁVĚ TO, co se promítne do e-mailu: pět barev, logo z knihovny médií,
 * dvě písma a zaoblení. Nic víc tam schválně není. Zdroj pravdy o tom, co se
 * promítá, je `brandToTheme` v `packages/emails/src/base/brand.ts`; odvozené
 * role (ztlumený text, odkaz, text na barvě, jemné pozadí, podklad obsahu)
 * jsou vidět v tabulce pod formulářem, ale nastavit se nedají, protože by je
 * skládání šablony stejně přepsalo.
 *
 * Hodnoty drží stav komponenty, ne jen `defaultValue`: náhled motivu pod
 * formulářem se překresluje při psaní, takže uživatel vidí důsledek změny
 * dřív, než uloží.
 */
export function BrandForm({
  action,
  workspaceId,
  workspaceSlug,
  initial,
  initialState,
}: BrandFormProps) {
  const t = useTranslations('ai');
  const tEditor = useTranslations('editor');
  const [state, formAction] = useActionState(action, initialState ?? IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};
  useFormErrorFocus(fieldErrors, formRef);

  const [values, setValues] = useState<BrandFormValues>(() => {
    const fonts = toFontIds(initial.headingStack, initial.bodyStack);
    return { ...initial, headingStack: fonts.heading, bodyStack: fonts.body };
  });
  const patch = (next: Partial<BrandFormValues>) =>
    setValues((current) => ({ ...current, ...next }));

  const [savedVisible, setSavedVisible] = useState(false);
  useEffect(() => {
    if (state.status !== 'success') return;
    setSavedVisible(true);
    const timer = window.setTimeout(() => setSavedVisible(false), 3000);
    return () => window.clearTimeout(timer);
  }, [state]);

  return (
    <section aria-labelledby="brand-definition" className="flex flex-col gap-[var(--spacing-card)]">
      <div className="flex flex-wrap items-baseline justify-between gap-[var(--spacing-stack)]">
        <div>
          <h2
            id="brand-definition"
            className="text-h3 font-semibold tracking-[var(--tracking-heading)] text-text"
          >
            {t('brand.definitionTitle')}
          </h2>
          <p className="mt-1 max-w-[var(--container-prose)] text-ui text-text-muted">
            {t('brand.definitionIntro')}
          </p>
        </div>
        <p role="status" className="text-meta text-success-text">
          {savedVisible ? t('brand.saved') : ''}
        </p>
      </div>

      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <SettingsProblem problem={state.problem} />
      ) : null}

      <form
        ref={formRef}
        action={formAction}
        className="flex flex-col gap-[var(--spacing-card)]"
        noValidate
      >
        <input type="hidden" name="workspace_slug" value={workspaceSlug} readOnly />
        <input type="hidden" name="logo_asset_id" value={values.logo?.id ?? ''} readOnly />

        <div>
          <Label htmlFor="brand-name">{t('brand.name')}</Label>
          <Input
            id="brand-name"
            name="name"
            value={values.name}
            maxLength={120}
            onChange={(event) => patch({ name: event.target.value })}
            {...fieldAria('name', fieldErrors)}
          />
          <FieldError name="name" errors={fieldErrors} />
        </div>

        <fieldset className="flex flex-col gap-[var(--spacing-gutter)]">
          <legend className="meta-caps mb-[var(--spacing-inline)] text-text-muted">
            {t('brand.colorsLegend')}
          </legend>
          <BrandColorField
            name="primary"
            label={t('brand.primary')}
            hint={t('brand.primaryHint')}
            value={values.primary}
            onChange={(next) => patch({ primary: next })}
            errors={fieldErrors}
          />
          <BrandColorField
            name="secondary"
            label={t('brand.secondary')}
            hint={t('brand.secondaryHint')}
            value={values.secondary}
            onChange={(next) => patch({ secondary: next })}
            errors={fieldErrors}
          />
          <BrandColorField
            name="accent"
            label={t('brand.accent')}
            hint={t('brand.accentHint')}
            value={values.accent}
            onChange={(next) => patch({ accent: next })}
            errors={fieldErrors}
          />
          <BrandColorField
            name="background"
            label={t('brand.background')}
            hint={t('brand.backgroundHint')}
            value={values.background}
            onChange={(next) => patch({ background: next })}
            errors={fieldErrors}
          />
          <BrandColorField
            name="text"
            label={t('brand.text')}
            hint={t('brand.textHint')}
            value={values.text}
            onChange={(next) => patch({ text: next })}
            errors={fieldErrors}
          />
        </fieldset>

        <fieldset className="flex flex-col gap-[var(--spacing-stack)]">
          <legend className="meta-caps mb-[var(--spacing-inline)] text-text-muted">
            {t('brand.logo')}
          </legend>
          <p className="max-w-[var(--container-prose)] text-meta text-text-muted">
            {t('brand.logoHint')}
          </p>
          <BrandLogoField
            workspaceId={workspaceId}
            value={values.logo}
            onChange={(next) => patch({ logo: next })}
          />
        </fieldset>

        <fieldset className="flex flex-col gap-[var(--spacing-gutter)]">
          <legend className="meta-caps mb-[var(--spacing-inline)] text-text-muted">
            {t('brand.typographyLegend')}
          </legend>
          <p className="max-w-[var(--container-prose)] text-meta text-text-muted">
            {t('brand.fontNote')}
          </p>
          <SelectField
            name="heading_stack"
            label={t('brand.headingFont')}
            placeholder={t('brand.fontPlaceholder')}
            defaultValue={values.headingStack}
            options={FONT_IDS.map((id) => ({ value: id, label: tEditor(`value.font.${id}`) }))}
            errors={fieldErrors}
            onSelected={(next) => patch({ headingStack: next })}
          />
          <SelectField
            name="body_stack"
            label={t('brand.bodyFont')}
            placeholder={t('brand.fontPlaceholder')}
            defaultValue={values.bodyStack}
            options={FONT_IDS.map((id) => ({ value: id, label: tEditor(`value.font.${id}`) }))}
            errors={fieldErrors}
            onSelected={(next) => patch({ bodyStack: next })}
          />
          <SelectField
            name="radius"
            label={t('brand.radius')}
            placeholder={t('brand.fontPlaceholder')}
            defaultValue={String(values.radius)}
            options={RADII.map((value) => ({
              value: String(value),
              label: tEditor(`value.radius.${value}`),
            }))}
            errors={fieldErrors}
            onSelected={(next) => patch({ radius: Number(next) })}
          />
        </fieldset>

        <BrandThemePreview
          palette={{
            primary: values.primary,
            secondary: values.secondary,
            accent: values.accent,
            background: values.background,
            text: values.text,
          }}
          typography={{
            headingStack: values.headingStack,
            bodyStack: values.bodyStack,
            radius: values.radius,
          }}
        />

        <div>
          <SubmitButton label={t('brand.save')} pendingLabel={t('brand.saving')} />
        </div>
      </form>
    </section>
  );
}
