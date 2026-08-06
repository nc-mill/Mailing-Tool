import {
  ChartNoAxesColumn,
  FileText,
  Image,
  LayoutDashboard,
  LayoutTemplate,
  Megaphone,
  Settings,
  Users,
  Workflow,
  type LucideIcon,
} from '../../icons';

/**
 * Ikona hlavní položky bočního menu.
 *
 * Stojí MIMO registr navigace schválně. Registr (`registry.ts`) je čistá data:
 * co kam vede a kdo to smí vidět. Ikona je rozhodnutí návrhu, mění se s ním
 * a nemá co dělat v seznamu, který čtou i testy oprávnění. Kdyby byla
 * v registru, každá změna vzhledu by sahala do souboru, u kterého se hlídá,
 * že se nerozšiřuje.
 *
 * Tvary jsou z návrhu obrazovky Přehled, kde je boční menu vykreslené celé.
 * Automatizace v návrhu nejsou (jsou to rezervované položky pro MVP 2),
 * proto mají ikonu odvozenou, ne opsanou.
 *
 * PODPOLOŽKY IKONU NEMAJÍ. V návrhu je druhá úroveň jen odsazený text,
 * uvnitř i ve vysouvacím panelu. Není to opomenutí: devět ikon pod sebou
 * v jednom sloupci se čte jako mřížka, ne jako seznam.
 */
const SECTION_ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboard,
  contacts: Users,
  forms: FileText,
  campaigns: Megaphone,
  templates: LayoutTemplate,
  media: Image,
  statistics: ChartNoAxesColumn,
  settings: Settings,
  automations: Workflow,
};

/**
 * Ikona sekce podle jejího `id`. Neznámé `id` dostane obecný list papíru,
 * aby nová položka menu nezůstala bez ikony a nerozhodila zarovnání sloupce.
 */
export function sectionIcon(id: string): LucideIcon {
  return SECTION_ICONS[id] ?? FileText;
}
