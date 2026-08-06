/**
 * Ikony editoru.
 *
 * DŘÍV SE TADY KRESLILY RUČNĚ, protože `lucide-react` je závislost
 * `packages/ui` a `apps/web` si ji do `package.json` přidat nesmí. Výsledkem
 * byla druhá sada ikon vedle té pravé, s vlastní tloušťkou a vlastními tvary.
 *
 * Od 5. 8. 2026 je sada jedna: `@mlain/ui/icons`. `apps/web` si `lucide-react`
 * pořád nepřidává, jen si ikony půjčuje přes `@mlain/ui`, který je svou
 * závislostí má. Tenhle soubor zůstává jako rozcestník, aby se nemuselo
 * přepisovat každé místo v editoru, a aby bylo z jednoho pohledu vidět,
 * které ikony editor používá.
 *
 * Velikost se nastavuje třídou `icon-xs` … `icon-xl`, ne `size-*`.
 * `aria-hidden` patří na volajícího nebo přímo na ikonu: význam nese
 * `aria-label` tlačítka, ne kresba.
 *
 * NOVOU IKONU NEKRESLI. Dopiš ji do `packages/ui/src/icons/index.ts`
 * a přidej sem řádek.
 */
export {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bold,
  Braces,
  Check,
  ChevronLeft,
  ChevronRight,
  Code,
  Copy,
  GripVertical,
  Info,
  Italic,
  Link2,
  List,
  ListOrdered,
  Lock,
  MailCheck,
  Monitor,
  Moon,
  Plus,
  Smartphone,
  Sparkles,
  Strikethrough,
  Trash2,
  Underline,
  UserRound,
  // `XCircle` je zastaralý alias, kanonický název v Lucide je `CircleX`.
  CircleX as XCircle,
  // Tři řádky textu, poslední kratší. V Lucide se to jmenuje `TextAlignStart`.
  TextAlignStart as TextLines,
} from '@mlain/ui/icons';
