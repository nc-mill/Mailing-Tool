import type { DataTableColumn } from '@mlain/ui/patterns/data-table';
import type { EmailPreviewLabels } from '@mlain/ui/patterns/email-preview';
import type { ConfirmDialogLabels } from '@mlain/ui/patterns/feedback';
import type { FileUploadLabels } from '@mlain/ui/patterns/file-upload';
import { LineChart } from '@mlain/ui/patterns/charts';
import type { ChartLabels, ChartSeries } from '@mlain/ui/patterns/charts';
import type { FieldDefinition, SegmentAst } from '@mlain/ui/patterns/query-builder';
import type { EmptyStateAction } from '@mlain/ui/patterns/states';
import type { ProblemSummary, ErrorBlockLabels } from '@mlain/ui/patterns/states';
import type { ToastLabels } from '@mlain/ui/patterns/toast';
import type { TimelineEvent, TimelineGender, TimelineLabels } from '@mlain/ui/patterns/timeline';
import type { WizardStep, WizardLabels } from '@mlain/ui/patterns/wizard';

/**
 * Testovací data pro galerii komponent. Reprezentativní stav, ne všechny
 * varianty (galerie má být čitelná). Tvary přebírají hodnoty, které
 * používají jednotkové testy stejných komponent v `packages/ui`.
 */

type Contact = { id: string; email: string; name: string };

const tableRows: Contact[] = Array.from({ length: 5 }, (_, index) => ({
  id: `c${index}`,
  email: `kontakt${index}@firma.cz`,
  name: `Jméno ${index}`,
}));

const tableColumns: DataTableColumn<Contact>[] = [
  { id: 'email', header: 'E-mail', cell: (row) => row.email, sortable: true },
  { id: 'name', header: 'Jméno', cell: (row) => row.name },
];

const tableLabels = {
  selectRow: 'Označit řádek',
  selectAllOnPage: 'Označit všechny řádky na stránce',
  previous: 'Předchozí',
  next: 'Další',
  showing: (shown: number, total: number, estimated: boolean) =>
    `Zobrazeno ${shown} z ${estimated ? '~' : ''}${total}`,
  selectedOnPage: (count: number) => `Vybráno ${count} kontaktů na této stránce`,
  selectAllMatching: (total: number) => `Vybrat všech ${total} odpovídajících filtru`,
  selectedAllMatching: (total: number) => `Vybráno všech ${total} kontaktů odpovídajících filtru.`,
  clearSelection: 'Zrušit výběr',
  cursorInvalid: 'Seznam se mezitím změnil, jste zpátky na začátku.',
  sortNotAvailable: 'Podle tohohle sloupce řadit nejde.',
  sortedAscending: 'seřazeno vzestupně',
  sortedDescending: 'seřazeno sestupně',
  columnSettings: 'Nastavit sloupce',
  columnVisible: (column: string) => `Zobrazit sloupec ${column}`,
  columnWidth: (column: string) => `Šířka sloupce ${column}`,
};

const table = {
  tableId: 'gallery-contacts',
  caption: 'Kontakty',
  columns: tableColumns,
  rows: tableRows,
  getRowId: (row: Contact) => row.id,
  labels: tableLabels,
  count: { value: 12_480, precision: 'estimated' as const },
  pagination: { hasMore: true, onPrevious: () => {}, onNext: () => {}, canGoBack: false },
  order: { value: 'email.asc', onChange: () => {} },
};

const queryBuilderFields: FieldDefinition[] = [
  {
    id: 'attribute:city',
    label: 'Město',
    group: 'Údaje kontaktu',
    ref: { kind: 'attribute', key: 'city' },
    valueType: 'text',
    operators: [
      { id: 'eq', label: 'je', shape: 'scalar' },
      { id: 'neq', label: 'není', shape: 'scalar', negating: true },
      { id: 'in', label: 'je jedna z', shape: 'list', minItems: 1, maxItems: 1000 },
      { id: 'is_empty', label: 'je prázdné', shape: 'none' },
    ],
  },
  {
    id: 'engagement:opened',
    label: 'Otevřel kampaň',
    group: 'Chování',
    ref: { kind: 'engagement', metric: 'opened', scope: { since_days: 90 } },
    valueType: 'number',
    operators: [
      { id: 'did', label: 'ano', shape: 'none' },
      { id: 'count_gte', label: 'aspoň tolikrát', shape: 'integer', min: 0, max: 1_000_000 },
    ],
  },
];

const queryBuilderEmpty: SegmentAst = {
  version: 1,
  root: { type: 'group', op: 'and', not: false, children: [] },
};

const queryBuilderLabels = {
  addRule: 'Přidat podmínku',
  addGroup: 'Přidat skupinu',
  removeRule: 'Odebrat podmínku',
  removeGroup: 'Odebrat skupinu',
  chooseField: 'Vyberte údaj',
  chooseOperator: 'Vyberte vztah',
  value: 'Hodnota',
  valueFrom: 'Od',
  valueTo: 'Do',
  valueList: 'Seznam hodnot',
  addValue: 'Přidat hodnotu',
  removeValue: (item: string) => `Odebrat hodnotu ${item}`,
  listLimit: (max: number) => `Do seznamu se vejde nejvýš ${max} hodnot.`,
  unknownValue: (value: string) => `Smazaná položka (${value})`,
  noOptions: 'Není z čeho vybírat.',
  rangeOrder: 'První hodnota musí být menší nebo rovna druhé.',
  showJson: 'Zobrazit podklad',
  depthLimit: 'Hlouběji už zanořovat nejde, stačí to na každý segment, který jsme viděli.',
  childLimit: 'Do jedné skupiny se vejde nejvýš 50 podmínek.',
  negationHint: 'Vybíráme kontakty, které tuhle skupinu podmínek nesplňují.',
  notNullHint: 'Kontakty s prázdnou hodnotou sem nespadnou. Chcete je přidat?',
  addEmptyCondition: 'Přidat podmínku „je prázdné"',
  all: 'všechny',
  atLeastOne: 'alespoň jednu',
  is: 'splňuje',
  isNot: 'nesplňuje',
};

const wizardSteps: WizardStep[] = [
  { id: 'upload', label: 'Nahrání souboru' },
  { id: 'mapping', label: 'Přiřazení sloupců' },
  { id: 'preview', label: 'Náhled' },
];

const wizardLabels: WizardLabels = {
  stepOf: (current: number, total: number) => `Krok ${current} z ${total}`,
  back: 'Předchozí krok',
  next: 'Pokračovat',
  destructiveBackTitle: 'Změna mapování založí nový import',
  destructiveBackConfirm: 'Vrátit se a začít znovu',
  destructiveBackRetreat: 'Zůstat v náhledu',
};

// Trigger a popisek jsou doslovné znění z e2e klávesového testu v úkolu 32.
const fileUploadLabels: FileUploadLabels = {
  dropzone: 'Přetáhněte sem soubor',
  chooseFile: 'Vybrat soubor z počítače',
  fileInput: 'Soubor k nahrání',
  cancel: 'Zrušit nahrávání',
  progress: (percent: number) => `Nahráno ${percent} %`,
  tooLarge: (limit: string) => `Soubor je větší než ${limit}.`,
  wrongType: 'Tenhle typ souboru neumíme přečíst.',
  selectedFile: (name: string) => `Vybraný soubor: ${name}`,
};

const emailPreviewLabels: EmailPreviewLabels = {
  widthDesktop: 'Šířka počítače',
  widthMobile: 'Šířka mobilu',
  themeLight: 'Světlý režim',
  themeDark: 'Tmavý režim',
  blockedExternal: 'Náhled nenačítá nic z cizích serverů.',
};

const chartSeries: ChartSeries[] = [
  {
    id: 'delivered',
    label: 'Doručeno',
    pattern: 'solid',
    points: [
      { x: '1. 7.', y: 1200 },
      { x: '2. 7.', y: 1180 },
      { x: '3. 7.', y: 1240 },
    ],
  },
  {
    id: 'clicked',
    label: 'Kliklo',
    pattern: 'dashed',
    points: [
      { x: '1. 7.', y: 210 },
      { x: '2. 7.', y: 190 },
      { x: '3. 7.', y: 225 },
    ],
  },
];

const chartLabels: ChartLabels = {
  showTable: 'Zobrazit hodnoty jako tabulku',
  hideTable: 'Skrýt tabulku',
  tableCaption: 'Hodnoty grafu',
  periodColumn: 'Období',
};

// Čtyři události v pětiminutovém okně se sluč do shluku (K8), pátá
// (email_open) se nikdy neshlukuje a zůstává samostatná. Doslovné znění
// popisků odpovídá e2e klávesovému testu v úkolu 32.
const timelineEvents: TimelineEvent[] = [
  {
    id: 'e1',
    type: 'email_open',
    occurredAt: new Date('2026-07-31T12:41:00.000Z'),
    payload: { campaign: 'Letní výprodej' },
  },
  ...[0, 1, 2, 3].map((index) => ({
    id: `p${index}`,
    type: 'page_view',
    occurredAt: new Date(`2026-07-30T16:2${index}:00.000Z`),
    payload: {},
  })),
];

const timelineLabels: TimelineLabels = {
  today: 'Dnes',
  yesterday: 'Včera',
  loadOlder: 'Načíst starší',
  expandCluster: (count: number) => `Rozbalit ${count} událostí`,
  collapseCluster: 'Sbalit skupinu událostí',
  expanded: 'Rozbaleno',
  collapsed: 'Sbaleno',
};

function renderTimelineSentence({
  event,
  gender,
}: {
  event: TimelineEvent;
  gender: TimelineGender;
}) {
  if (event.type === 'email_open') {
    const campaign = String(event.payload.campaign);
    if (gender === 'female') return `Otevřela kampaň ${campaign}`;
    if (gender === 'male') return `Otevřel kampaň ${campaign}`;
    return `Otevření kampaně ${campaign}`;
  }
  return 'Zobrazení stránky';
}

const emptyStateActions: EmptyStateAction[] = [
  { label: 'Vytvořit první kontakt', onClick: () => {} },
];

const filteredEmptyStateActions: EmptyStateAction[] = [];

const problem: ProblemSummary = {
  code: 'contacts.import_failed',
  requestId: 'req_9f3a2b1c',
  occurredAt: new Date('2026-07-31T09:15:00.000Z'),
  path: '/w/eshop-kolo/contacts/import',
};

const errorBlockLabels: ErrorBlockLabels = {
  technicalDetails: 'Technické podrobnosti',
  code: 'Kód',
  requestId: 'ID požadavku',
  time: 'Čas',
  copyBlock: 'Zkopírovat podrobnosti',
  copied: 'Zkopírováno',
  tryAgain: 'Zkusit znovu',
};

const confirmDialogLabels: ConfirmDialogLabels = {
  irreversible: 'Tohle nejde vzít zpět.',
  whatHappens: 'Co se stane:',
  notYetConfirmed: 'Nejdřív zaškrtněte, že rozumíte následkům.',
  notYetTyped: 'Nejdřív opište název.',
  typeToConfirmMismatch: 'Opsaný text zatím nesouhlasí.',
  filterInWords: (filter: string) => `Filtr: ${filter}`,
};

const toastLabels: ToastLabels = {
  undo: 'Vrátit zpět',
  close: 'Zavřít',
  notifications: 'Oznámení',
  countdown: (seconds: number) => `Zbývá ${seconds} s`,
  repeated: (message: string, count: number) => `${message} ×${count}`,
};

export const GALLERY_FIXTURES = {
  table,
  queryBuilder: {
    fields: queryBuilderFields,
    value: queryBuilderEmpty,
    labels: queryBuilderLabels,
  },
  wizard: { steps: wizardSteps, labels: wizardLabels },
  fileUpload: {
    labels: fileUploadLabels,
    accept: '.csv,.xlsx,text/csv',
    maxBytes: 50 * 1024 * 1024,
    onFile: () => {},
  },
  toastLabels,
  toastMessage: 'Uloženo',
  emailPreview: {
    html: '<html><body><h1>Letní výprodej</h1><p>Ukázka náhledu.</p></body></html>',
    title: 'Náhled e-mailu',
    labels: emailPreviewLabels,
  },
  chart: <LineChart title="Doručeno a kliknuto" series={chartSeries} labels={chartLabels} />,
  timeline: {
    events: timelineEvents,
    gender: 'female' as TimelineGender,
    timeZone: 'Europe/Prague',
    now: new Date('2026-07-31T13:00:00.000Z'),
    labels: timelineLabels,
    renderSentence: renderTimelineSentence,
    formatTime: (value: Date) =>
      new Intl.DateTimeFormat('cs', { timeStyle: 'short' }).format(value),
    formatDate: (value: Date) =>
      new Intl.DateTimeFormat('cs', { dateStyle: 'medium' }).format(value),
    hasMore: false,
    onLoadOlder: () => {},
  },
  emptyState: {
    variant: 'first' as const,
    title: 'Zatím žádné kontakty',
    explanation: 'Nahrajte seznam nebo přidejte první kontakt ručně.',
    actions: emptyStateActions,
  },
  filteredEmptyState: {
    title: 'Žádný kontakt neodpovídá filtru',
    explanation: 'Zkuste filtr rozšířit nebo ho úplně zrušit.',
    filterDescription: 'štítek Brno a stav Potvrzený',
    clearFiltersLabel: 'Zrušit filtry',
    onClearFilters: () => {},
    actions: filteredEmptyStateActions,
  },
  errorBlock: {
    title: 'Import se nepodařil dokončit',
    reason: 'Soubor obsahoval řádek bez povinného sloupce e-mail.',
    problem,
    labels: errorBlockLabels,
  },
  forbiddenState: {
    title: 'Na tuhle stránku nemáte oprávnění',
    body: 'Přístup k reportům má jen role Správce a Analytik.',
    whoCanHelp: 'Požádejte administrátora projektu o roli Analytik.',
    code: 'forbidden' as const,
    requestId: 'req_1a2b3c4d',
  },
  confirmDialog: {
    level: 'N3' as const,
    title: 'Smazat 3 402 kontaktů?',
    consequences: [
      'Kontakty zmizí ze všech seznamů a segmentů',
      'Jejich historie otevření a kliknutí se smaže',
      'Kontakty, které se odhlásily, zůstanou na blokovaných adresách',
    ],
    confirmLabel: 'Smazat 3 402 kontaktů',
    cancelLabel: 'Nemazat',
    acknowledgement: 'Rozumím, že smazané kontakty nepůjde obnovit',
    labels: confirmDialogLabels,
  },
};
