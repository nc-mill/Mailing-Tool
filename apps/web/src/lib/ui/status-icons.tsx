import type { ReactNode } from 'react';

/**
 * Ikony stavů pro `Badge`. Všechny jsou `aria-hidden`: význam nese slovo
 * vedle nich, ikona je druhý rozlišovací znak vedle barvy, ne náhrada textu.
 *
 * `Badge` z P05 má prop `icon` povinný a je to tak schválně: stav se nikdy
 * nesděluje jen barvou (pravidlo 11.3 části 6). Ikony v `packages/ui` kreslí
 * `lucide-react`, jenže ta je závislostí `packages/ui`, ne `apps/web`, a P06
 * si do `apps/web/package.json` nesmí přidávat produkční závislosti
 * (kapitola 0.3). Šest ikon proto P06 kreslí sám.
 */
function Frame({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      {children}
    </svg>
  );
}

export const CheckIcon = (
  <Frame>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </Frame>
);

export const SlashIcon = (
  <Frame>
    <circle cx="12" cy="12" r="9" />
    <path d="m6 6 12 12" />
  </Frame>
);

export const ClockIcon = (
  <Frame>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Frame>
);

export const WarningIcon = (
  <Frame>
    <path d="M12 4 2.5 20h19L12 4Z" />
    <path d="M12 10v4" />
    <path d="M12 17.5h.01" />
  </Frame>
);

export const RunningIcon = (
  <Frame>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </Frame>
);

export const DeviceIcon = (
  <Frame>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8" />
  </Frame>
);

/** Odznak „e-mail z formuláře" v knihovně šablon: list papíru s řádky. */
export const FormIcon = (
  <Frame>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8h8" />
    <path d="M8 12h8" />
    <path d="M8 16h4" />
  </Frame>
);

/** Odznak „transakční e-mail" v knihovně šablon: obálka. */
export const MailIcon = (
  <Frame>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3.5 7 8.5 6 8.5-6" />
  </Frame>
);
