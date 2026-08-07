// Typový kontrakt P06 vůči P05. Když se tenhle soubor nepodaří přeložit,
// packages/ui nedodal, s čím obrazovky P06 počítají. Neopravuj to tady,
// doplň chybějící komponentu do plánu P05.
//
// Importuje se NA ÚROVEŇ ADRESÁŘE. Mapa exports v packages/ui má vzor
// ./patterns/<jméno> mířící na ./src/patterns/<jméno>/index.ts, takže
// patterns/feedback/confirm-dialog by se hledal jako adresář a neexistuje.
// Kořenový import @mlain/ui neexistuje vůbec: P05 klíč "." odstranil.
//
// V kontraktu je JEN to, co P06 někde v JSX skutečně vykresluje. Jméno, které
// se nikde nevykresluje, je tvrzení, které nemá čím podložit, a přesně kvůli
// takovým jménům P05 pět komponent vědomě nezaložil. Primitiva jako `Dialog`
// nebo `Tabs` P06 nepoužívá, `DataTable` a `JobsCenter` taky ne, takže tady
// nejsou; kdyby je začal používat, přidají se sem zároveň s prvním použitím.
//
// ODCHYLKA OD PLÁNU, jen typová: plán psal `React.ReactNode`, jenže jmenný
// prostor `React` není v .ts souboru globální. Typ se proto importuje jménem.
import type { ReactNode } from 'react';
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { CopyButton } from '@mlain/ui/components/copy-button';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { RadioGroup } from '@mlain/ui/components/radio-group';
import { Select, SelectItem } from '@mlain/ui/components/select';
import { Skeleton } from '@mlain/ui/components/skeleton';
import { Textarea } from '@mlain/ui/components/textarea';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import {
  NAVIGATION,
  visibleNavigation,
  type NavigationItem,
  type VisibleNavigationItem,
} from '@mlain/ui/patterns/navigation';
import {
  Alert,
  DetailSkeleton,
  EmptyState,
  ErrorBlock,
  FilteredEmptyState,
  ForbiddenState,
  NotFoundState,
  OverLimitState,
  ReadOnlyBanner,
  ReadOnlyValue,
  StaleBanner,
  TableSkeleton,
} from '@mlain/ui/patterns/states';
import { useToast } from '@mlain/ui/patterns/toast';
import { useDelayedFlag } from '@mlain/ui/lib/use-delayed-flag';

/**
 * Registr je strom se `children` a s příznakem `mvp0`. P06 ho jen čte
 * a filtrování nechává na `visibleNavigation`, protože pravidlo „sekce bez
 * jediné viditelné podpoložky zmizí celá" se při druhém psaní zapomíná.
 */
export type NavigationItemContract = {
  id: string;
  labelKey: string;
  path: string;
  permission?: string;
  mvp0: boolean;
  children?: NavigationItemContract[];
};

const navigationIsCompatible: NavigationItemContract[] = NAVIGATION;

/** Výstup filtrování musí nést hotové `href` se slugem projektu. */
const visibleNavigationIsCompatible: (input: {
  permissions: string[];
  workspaceSlug?: string;
}) => Array<{ id: string; href: string; children?: Array<{ id: string; href: string }> }> =
  visibleNavigation;

/**
 * Potvrzovací dialog musí umět úrovně N2 až N4 a u N4 opisování názvu.
 * Tlačítko nesmí být `disabled` (kritérium 18), výchozí fokus patří ústupu.
 * `labels` je povinný: texty do `packages/ui` natvrdo nepatří.
 */
export type ConfirmDialogContract = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  level: 'N2' | 'N3' | 'N4';
  title: string;
  consequences: string[];
  confirmLabel: string;
  cancelLabel: string;
  acknowledgement?: string;
  confirmPhrase?: string;
  confirmPhraseLabel?: string;
  onConfirmPhraseChange?: (value: string) => void;
  extraAction?: ReactNode;
  /** Povinné: barva potvrzení se nesmí dát přehlédnout, viz `ConfirmDialog`. */
  destructive: boolean;
  irreversible?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  labels: {
    irreversible: string;
    whatHappens: string;
    notYetConfirmed: string;
    notYetTyped: string;
    typeToConfirmMismatch: string;
    filterInWords: (filter: string) => string;
  };
};

const confirmDialogIsCompatible: (props: ConfirmDialogContract) => unknown = ConfirmDialog;

// ODCHYLKA OD PLÁNU, jen typová: plán psal `as const`. Tvar `Checkbox`
// a `RadioGroup` vede přes `forwardRef` na typy z `@radix-ui/*`, které
// tsc u exportované konstanty neumí pojmenovat (TS2742). Anotace tvar
// zapouzdří; kontrakt tím neztrácí smysl, protože pořád vyžaduje, aby
// každé jméno existovalo jako hodnota.
export const contract: Record<string, unknown> = {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  CopyButton,
  DetailSkeleton,
  EmptyState,
  ErrorBlock,
  FilteredEmptyState,
  ForbiddenState,
  Input,
  Label,
  NotFoundState,
  OverLimitState,
  RadioGroup,
  ReadOnlyBanner,
  ReadOnlyValue,
  Select,
  SelectItem,
  Skeleton,
  StaleBanner,
  TableSkeleton,
  Textarea,
  confirmDialogIsCompatible,
  navigationIsCompatible,
  visibleNavigationIsCompatible,
  useDelayedFlag,
  useToast,
};

export type { NavigationItem, VisibleNavigationItem };
