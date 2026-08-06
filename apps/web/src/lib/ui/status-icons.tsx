import {
  Ban,
  CircleCheck,
  CircleX,
  Clock,
  Ellipsis,
  FileText,
  LoaderCircle,
  Mail,
  Monitor,
  TriangleAlert,
} from '@mlain/ui/icons';

/**
 * Ikony stavů pro `Badge`, připravené jako hotové prvky.
 *
 * Všechny jsou `aria-hidden`: význam nese slovo vedle nich, ikona je druhý
 * rozlišovací znak vedle barvy, ne náhrada textu. `Badge` proto má prop `icon`
 * povinný, stav se nikdy nesděluje jen barvou (pravidlo 11.3 části 6).
 *
 * DŘÍV SE TYHLE IKONY KRESLILY TADY RUČNĚ. Důvod byl, že `lucide-react` je
 * závislost `packages/ui` a `apps/web` si ji do `package.json` přidat nesmí.
 * Ruční kresba ale znamenala třetí sadu ikon vedle dvou existujících, a ty
 * se lišily tvarem i tloušťkou od návrhu. Od 5. 8. 2026 je sada jedna:
 * `@mlain/ui/icons`. `apps/web` bere ikony odtamtud, `lucide-react` v jeho
 * `package.json` pořád není a být nemá.
 *
 * Když potřebuješ další ikonu, dopiš ji do `packages/ui/src/icons/index.ts`
 * a naimportuj sem. Nekresli ji.
 */

/** Potvrzeno, hotovo, v pořádku. */
export const CheckIcon = <CircleCheck aria-hidden className="icon-sm" />;

/** Zrušeno, zamítnuto, neplatí. */
export const SlashIcon = <CircleX aria-hidden className="icon-sm" />;

/** Čeká, je naplánováno. */
export const ClockIcon = <Clock aria-hidden className="icon-sm" />;

/** Něco je špatně, ale nezastavilo to běh. */
export const WarningIcon = <TriangleAlert aria-hidden className="icon-sm" />;

/** Právě běží. */
export const RunningIcon = <LoaderCircle aria-hidden className="icon-sm" />;

/** Zařízení, ze kterého se e-mail otevřel. */
export const DeviceIcon = <Monitor aria-hidden className="icon-sm" />;

/** Odznak „e-mail z formuláře" v knihovně šablon. */
export const FormIcon = <FileText aria-hidden className="icon-sm" />;

/** Nabídka dalších akcí. */
export const MoreIcon = <Ellipsis aria-hidden className="icon-sm" />;

/** Odznak „transakční e-mail" v knihovně šablon. */
export const MailIcon = <Mail aria-hidden className="icon-sm" />;

/** Zablokovaná adresa, na kterou se neodesílá. */
export const BlockedIcon = <Ban aria-hidden className="icon-sm" />;
