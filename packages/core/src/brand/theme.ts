import { brandToTheme } from '@mlain/emails/base/brand';
import { DEFAULT_THEME } from '@mlain/emails/document/defaults';
import type { Document, Theme, ThemeColorRole } from '@mlain/emails/document/types';
import { DEFAULT_LIGHT } from '@mlain/emails/theme/palette';
import type { Tx } from '../tx';
import { findDefaultBrandProfile, type BrandProfileSummary } from './repo/profiles.repo';

/**
 * ZNAČKA PROJEKTU JAKO MOTIV DOKUMENTU.
 *
 * PROČ TO EXISTUJE. `brandToTheme` uměla značku na motiv převést od začátku,
 * jenže ji volala jen obrazovka značky a její náhled. Nikdo ji nevolal při
 * zakládání dokumentu, takže každá nová kampaň, šablona i e-mail seznamu
 * dostaly `DEFAULT_THEME`. Ten nese `colors: {}`, barvy tedy dopočítává
 * `resolveTheme` z `DEFAULT_LIGHT`, kde je `brand.primary` modrá `#2563eb`.
 * Uživatel si nastavil fialovou, obrazovka značky mu ji v náhledu ukázala
 * správně a v editoru kampaně i v odeslaném e-mailu byla dál modrá.
 *
 * Motiv je součástí ULOŽENÉHO dokumentu, ne věc kompilace: `CompileContext`
 * pole `brand` vědomě nemá (viz `packages/emails/src/compile/types.ts`).
 * Doplnit se proto musí zápisem, ne dopočtem při zobrazení.
 *
 * ------------------------------------------------------------------------
 * ROZHODUJE SE PO JEDNOTLIVÝCH ROLÍCH, NE PODLE CELÉ MAPY BAREV
 * ------------------------------------------------------------------------
 * Dřív tu stálo pravidlo `hasUnsetBrandTheme`: prázdná mapa `theme.colors`
 * znamenala „značku doplň", neprázdná „nesahej". Stálo na zjištění, že do
 * `theme.colors` v editoru nezapisuje NIKDO, takže obsah té mapy může být jen
 * otisk značky.
 *
 * TEN PŘEDPOKLAD UŽ NEPLATÍ. Panel motivu má od 6. 8. 2026 pole „Pozadí plátna"
 * a „Pozadí obsahu", která píšou přímo do `theme.colors` pod rolemi
 * `surface.canvas` a `surface.content` (`theme-panel.tsx`, `descriptors/theme.ts`).
 * Mapa je od té chvíle MÍCHANÁ: část rolí je otisk značky, část volba uživatele.
 * Pravidlo nad celou mapou by proto dělalo dvě chyby naráz:
 *
 *  * jedno kliknutí na pozadí plátna by ZABLOKOVALO doplnění značky navždy,
 *    protože mapa přestane být prázdná, a uživatel by se nedozvěděl proč,
 *  * převlečení do nové značky by naopak zvolené pozadí PŘEPSALO, tedy ztratilo
 *    vědomou volbu.
 *
 * Rozhoduje se proto u KAŽDÉ ROLE zvlášť a jediným pravidlem, které používá
 * i písmo a rádius: **převezmi hodnotu ze značky jen tam, kde dokument pořád
 * drží to, co by dala značka předchozí, nebo výchozí hodnotu.** Co se od obojího
 * liší, si zvolil člověk a zůstává.
 */

/** Části motivu, o kterých značka rozhoduje. Zbytek dokumentu se nikdy nemění. */
export type BrandThemeParts = Pick<Theme, 'colors' | 'fonts' | 'radius'>;

export function brandProfileTheme(profile: BrandProfileSummary): Theme {
  return brandToTheme({ palette: profile.palette, typography: profile.typography });
}

/**
 * Drží dokument u téhle role pořád zděděnou hodnotu?
 *
 * Tři případy, všechny znamenají „o téhle barvě nikdo nerozhodl":
 *  1. role v mapě vůbec není, barvu tedy dopočítává `resolveTheme` z výchozí palety,
 *  2. stojí v ní přesně to, co dala PŘEDCHOZÍ značka,
 *  3. stojí v ní výchozí hodnota z `DEFAULT_LIGHT`.
 *
 * Třetí případ má vědomou slepou skvrnu: kdo si ručně zvolí přesně tu barvu,
 * kterou má výchozí paleta, o svou volbu při změně značky přijde. Rozeznat to
 * bez zapsaného původu nejde a cena je malá, protože jde o jednu konkrétní
 * hodnotu z deseti rolí. Kdyby to jednou vadilo, řešením je původ v dokumentu,
 * ne přísnější dohad.
 */
function roleIsInherited(theme: Theme, role: ThemeColorRole, previous: Theme | null): boolean {
  const current = theme.colors[role];
  if (current === undefined) return true;
  if (previous !== null && previous.colors[role] === current) return true;
  return DEFAULT_LIGHT[role] === current;
}

/** Stojí v dokumentu pořád písmo z předchozí značky, nebo výchozí? */
function fontsAreInherited(theme: Theme, previous: Theme | null): boolean {
  const matches = (other: Theme): boolean =>
    theme.fonts.heading === other.fonts.heading && theme.fonts.body === other.fonts.body;
  return matches(DEFAULT_THEME) || (previous !== null && matches(previous));
}

function radiusIsInherited(theme: Theme, previous: Theme | null): boolean {
  return (
    theme.radius === DEFAULT_THEME.radius || (previous !== null && theme.radius === previous.radius)
  );
}

/**
 * Motiv dokumentu po doplnění značky.
 *
 * NEVRACÍ celý motiv k dosazení: `brandToTheme` vydává `{ ...DEFAULT_THEME, ... }`,
 * takže dosazení celého objektu by shodilo `contentWidth` i `typography` zpátky
 * na výchozí. Přenášejí se jen ty tři klíče, o kterých značka rozhoduje.
 *
 * `previous` je značka platná PŘED změnou. Při zakládání dokumentu žádná taková
 * není a předává se `null`; pravidlo se tím zúží na „doplň role, které dokument
 * nemá, a ty, ve kterých stojí výchozí hodnota".
 */
export function brandThemeParts(
  theme: Theme,
  next: Theme,
  previous: Theme | null,
): BrandThemeParts {
  const colors: Theme['colors'] = { ...theme.colors };
  for (const role of Object.keys(next.colors) as ThemeColorRole[]) {
    const value = next.colors[role];
    if (value !== undefined && roleIsInherited(theme, role, previous)) colors[role] = value;
  }
  return {
    colors,
    fonts: fontsAreInherited(theme, previous) ? next.fonts : theme.fonts,
    radius: radiusIsInherited(theme, previous) ? next.radius : theme.radius,
  };
}

/**
 * Motiv ze značky projektu, nebo `null`, když projekt značku nemá.
 *
 * `null` znamená „nesahej na to", NE „použij neutrální paletu". Kdyby se
 * projektu bez značky dosadila `DEFAULT_PALETTE` z repozitáře, změnila by se
 * barva tlačítek z modré na tmavě šedou všem, kdo si žádnou značku nenastavili,
 * a nikdo o to nežádal.
 */
export async function workspaceBrandTheme(tx: Tx): Promise<Theme | null> {
  const profile = await findDefaultBrandProfile(tx);
  return profile === null ? null : brandProfileTheme(profile);
}

/**
 * Doplní NOVÉMU dokumentu barvy, písmo a rádius ze značky projektu.
 *
 * Doplňuje se po rolích, takže barva, kterou si autor v panelu motivu zvolil,
 * zůstane a zbylé role značku dostanou. Dřív to bylo všechno nebo nic a jedno
 * nastavené pozadí plátna by doplnění zablokovalo celé.
 */
export async function applyWorkspaceBrandTheme<D extends Document>(
  tx: Tx,
  document: D,
): Promise<D> {
  const brand = await workspaceBrandTheme(tx);
  if (brand === null) return document;
  const parts = brandThemeParts(document.theme, brand, null);
  return { ...document, theme: { ...document.theme, ...parts } };
}
