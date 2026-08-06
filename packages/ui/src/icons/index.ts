/**
 * Ikony aplikace. **Jediné místo, odkud se ikona bere.**
 *
 * Návrh kreslí ikony Lucide vloženými SVG. Aplikace je proto bere z knihovny
 * `lucide-react`, která tytéž tvary vykresluje: stejná mřížka 24×24, stejný
 * obrys `stroke-width: 2` se zakulacenými konci. Tvary se tím nemusí opisovat
 * ručně a nemůžou se rozejít s návrhem.
 *
 * PROČ PŘES TENHLE SOUBOR A NE PŘÍMO Z `lucide-react`:
 *
 * `lucide-react` je závislost `packages/ui`, ne `apps/web`, a v přísném pnpm
 * z `apps/web` dostupná není. Dřív to obcházely dva soubory v `apps/web`
 * (`lib/ui/status-icons.tsx` a `features/editor/components/icons.tsx`), které
 * si potřebné ikony překreslovaly ručně. Byly to tři sady vedle sebe: jedna
 * pravá a dvě opsané, které se lišily tloušťkou i tvarem.
 *
 * Teď je sada jedna. `apps/web` si `lucide-react` do `package.json` nepřidává,
 * importuje `@mlain/ui/icons` a dostane tytéž komponenty. Oba staré soubory
 * z `apps/web` odsud jen re-exportují, aby se nemuselo přepisovat sto míst.
 *
 * VELIKOST se nastavuje třídou `icon-xs` … `icon-xl` (viz `globals.css`),
 * nikdy `size-4` a podobně: 16 px z výchozí škály Tailwindu je náhoda,
 * kdežto `icon-sm` je rozhodnutí návrhu.
 *
 * PŘÍSTUPNOST: ikona sama nikdy nenese význam. Buď má vedle sebe slovo, nebo
 * má nadřazený prvek `aria-label`. Proto se ikonám dává `aria-hidden`.
 *
 * Nový import se do seznamu dopisuje podle **kanonického názvu z Lucide**
 * (ne podle zastaralého aliasu jako `AlertTriangle`), ať se v seznamu dá
 * hledat podle toho, co je vidět na lucide.dev.
 *
 * POZNÁMKA K SESTAVENÍ SEZNAMU: ikony jsem z návrhů vytáhl strojově,
 * porovnáním geometrie SVG proti datům Lucide. Napoprvé mi to podhodilo
 * `SlidersHorizontal`, protože porovnávač bral jen atribut `d`, kdežto tahle
 * ikona je v návrhu poskládaná z devíti `<line>`. Návrhy navíc vznikly nad
 * STARŠÍ verzí Lucide, takže část ikon má jinou geometrii než dnešní 1.28
 * a strojově se spárovat nedá vůbec. **Strojové porovnání je tedy vodítko,
 * ne důkaz.** Když ti kresba nesedí, porovnej ji okem s lucide.dev.
 */

export type { LucideIcon, LucideProps } from 'lucide-react';

export {
  // navigace a směr
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  Undo2,

  // skořápka a hlavní menu
  ChartColumn,
  ChartNoAxesColumn,
  FileText,
  Image,
  LayoutDashboard,
  LayoutTemplate,
  Megaphone,
  Settings,
  Users,
  Workflow,

  // pošta a odesílání
  Mail,
  MailCheck,
  MailOpen,
  MailPlus,
  MailX,
  SendHorizontal,
  MousePointerClick,
  Send,

  // nastavení projektu
  AtSign,
  Bell,
  BellOff,
  Calendar,
  CalendarDays,
  FolderOpen,
  Globe,
  Hash,
  Key,
  Layers,
  Palette,
  Paperclip,
  Percent,
  Server,
  Timer,
  Webhook,

  // stavy a hlášky
  Ban,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  CircleCheckBig,
  CircleQuestionMark,
  CircleX,
  Clock,
  Eye,
  EyeOff,
  Info,
  LoaderCircle,
  Lock,
  Radar,
  Shield,
  ShieldCheck,
  TriangleAlert,
  Zap,

  // akce
  Archive,
  ArchiveRestore,
  Check,
  Copy,
  Download,
  Ellipsis,
  EllipsisVertical,
  Import,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  SearchX,
  SquarePen,
  SquarePlus,
  Trash,
  Trash2,
  Upload,
  X,

  // kontakty, seznamy, štítky, segmenty
  ClipboardList,
  Funnel,
  Grip,
  GripVertical,
  Link,
  List,
  SpellCheck,
  SpellCheck2,
  Tag,
  Tags,
  User,
  UserMinus,
  UserPlus,
  UserRound,
  UserRoundCheck,
  UserRoundMinus,
  UserRoundPlus,
  UserRoundX,

  // tabulka a filtry
  ArrowUpDown,
  SlidersHorizontal,
  ChevronsUpDown,
  Columns3,
  ListFilter,
  Rows3,
  Settings2,
  Table,

  // editor obsahu
  Bold,
  Braces,
  Code,
  CodeXml,
  Italic,
  Link2,
  ListOrdered,
  Monitor,
  // Měsíc pro tmavý režim plátna. Přepínač v hlavičce editoru přišel o slova,
  // aby se pruh vešel na jeden řádek, takže ikona je jediné, co je z ovladače
  // vidět; jméno akce nese `aria-label` a bublina.
  Moon,
  Smartphone,
  Sparkles,
  Strikethrough,
  TextAlignStart,
  TextQuote,
  Underline,
} from 'lucide-react';
