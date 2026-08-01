/**
 * Typový kontrakt P07 vůči P05. Když se tenhle soubor nepodaří přeložit, `packages/ui`
 * nedodal, s čím obrazovky domény kontaktů počítají. Neopravuj to tady, doplň chybějící
 * komponentu do plánu P05.
 *
 * ODCHYLKY OD ZNĚNÍ ÚKOLU 60, ZJIŠTĚNÉ SPUŠTĚNÍM. Plán psal kontrakt dřív, než P05
 * komponenty dodal, takže se v pěti bodech liší od toho, co v repozitáři skutečně je.
 * Platí repozitář (kapitola 2 hlavičky plánu) a rozdíly jsou tady zapsané, aby se
 * nemusely hledat znovu:
 *
 *  1. `ConfirmDialog` se importuje z `@mlain/ui/patterns/feedback`, ne z podcesty
 *     `.../feedback/confirm-dialog`: mapa `exports` vystavuje adresář, ne soubor.
 *  2. `ErrorBlock`, `TableSkeleton` i `DetailSkeleton` existují a jsou v
 *     `@mlain/ui/patterns/states`. Věta z hlavičky plánu, že „neexistují a nezaloží se",
 *     je proti repozitáři neplatná.
 *  3. `DataTable` bere popisky jedním objektem `labels`, popisek řádku je **jeden
 *     řetězec pro všechny řádky** (ne funkce nad řádkem), stránkuje callbacky
 *     `onPrevious`/`onNext` a výběr řídí propem `selection: { selectedIds, onSelectionChange }`.
 *     Propy `caption`, `cursor`, `selectAllLabel` a `rowSelectionLabel` z plánu nemá.
 *  4. `Timeline` nemá prop `empty` ani `groups`: bere `events`, `renderSentence`, `labels`
 *     a formátovače. Prázdný stav si kreslí obrazovka sama.
 *  5. `Badge` má **povinný** prop `icon`, protože stav se nikdy nesděluje jen barvou.
 */
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { Collapsible } from '@mlain/ui/components/collapsible';
import { Dialog } from '@mlain/ui/components/dialog';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { RadioGroup, RadioGroupItem } from '@mlain/ui/components/radio-group';
import { Select, SelectItem } from '@mlain/ui/components/select';
import { Switch } from '@mlain/ui/components/switch';
import { Tabs } from '@mlain/ui/components/tabs';
import { Textarea } from '@mlain/ui/components/textarea';
import { Tooltip, TooltipProvider } from '@mlain/ui/components/tooltip';
// K1: výběr přežije přestránkování, kurzorové stránkování bez čísel stránek, virtualizace od 100 řádků.
import { DataTable } from '@mlain/ui/patterns/data-table';
import type { DataTableColumn, DataTableLabels } from '@mlain/ui/patterns/data-table';
// K4: klávesová alternativa k přetažení souboru.
import { FileUpload } from '@mlain/ui/patterns/file-upload';
// K5: odpočet u „Vrátit zpět", chyba se nezavírá sama.
import { ToastProvider, useToast } from '@mlain/ui/patterns/toast';
// K8: shlukování sérií, oddělovače dnů, věty podle rodu, načítání po dávkách.
import { Timeline } from '@mlain/ui/patterns/timeline';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import {
  DetailSkeleton,
  EmptyState,
  ErrorBlock,
  FilteredEmptyState,
  OverLimitState,
  ReadOnlyBanner,
  TableSkeleton,
} from '@mlain/ui/patterns/states';

/** Tvar, na kterém stojí každá tabulka tohohle plánu. */
export type DataTableContract<Row> = {
  tableId: string;
  caption: string;
  columns: DataTableColumn<Row>[];
  rows: Row[];
  getRowId: (row: Row) => string;
  labels: DataTableLabels;
  count: { value: number; precision: 'exact' | 'estimated' };
  pagination: {
    hasMore: boolean;
    canGoBack: boolean;
    onPrevious: () => void;
    onNext: () => void;
  };
  selection?: { selectedIds: string[]; onSelectionChange: (next: string[]) => void };
  bulkActions?: React.ReactNode;
  emptyState?: React.ReactNode;
  virtualizeFrom?: number;
};

/**
 * Anotace typu je nutná: bez ní chce `tsc` pojmenovat vnitřní typy Radixu z cesty
 * v `.pnpm` a hlásí TS2742. Kontrakt stejně kontroluje jen to, že se všechna jména
 * dají naimportovat.
 */
export const contract: Record<string, unknown> = {
  Badge,
  Button,
  Checkbox,
  Collapsible,
  ConfirmDialog,
  DataTable,
  DetailSkeleton,
  Dialog,
  EmptyState,
  ErrorBlock,
  FileUpload,
  FilteredEmptyState,
  Input,
  Label,
  OverLimitState,
  RadioGroup,
  RadioGroupItem,
  ReadOnlyBanner,
  Select,
  SelectItem,
  Switch,
  TableSkeleton,
  Tabs,
  Textarea,
  Timeline,
  ToastProvider,
  Tooltip,
  TooltipProvider,
  useToast,
} as const;
