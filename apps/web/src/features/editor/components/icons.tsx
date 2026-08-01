import type { SVGProps } from 'react';

/**
 * Ikony editoru.
 *
 * ODCHYLKA OD PLÁNU: plán importuje `lucide-react`. Ta knihovna je závislostí
 * `packages/ui`, ne `apps/web`, a v přísném pnpm z `apps/web` **není dostupná**
 * (`apps/web/node_modules/lucide-react` neexistuje). Kapitola 0.4 plánu dovoluje
 * do `apps/web/package.json` přidat jen závislosti z kapitoly 2 a `lucide-react`
 * mezi nimi není. Stejnou situaci vyřešil P06 v `src/lib/ui/status-icons.tsx`
 * vlastními SVG; editor dělá totéž a drží je na jednom místě.
 *
 * Všechny mají `aria-hidden` na volajícím, protože význam nese `aria-label`
 * tlačítka. Tvar cest odpovídá tvaru z Lucide (ISC), aby se sada dala jedním
 * commitem vyměnit zpět, až `lucide-react` v `apps/web` bude.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ArrowUp(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </Icon>
  );
}

export function ArrowDown(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M19 12l-7 7-7-7" />
    </Icon>
  );
}

export function ArrowLeft(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </Icon>
  );
}

export function ArrowRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14M12 5l7 7-7 7" />
    </Icon>
  );
}

export function Copy(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Icon>
  );
}

export function Trash2(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" />
    </Icon>
  );
}

export function Plus(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14M12 5v14" />
    </Icon>
  );
}

export function AlertTriangle(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3ZM12 9v4M12 17h.01" />
    </Icon>
  );
}

export function XCircle(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6M9 9l6 6" />
    </Icon>
  );
}

export function Lock(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Icon>
  );
}

export function Info(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </Icon>
  );
}

export function Bold(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z" />
    </Icon>
  );
}

export function Italic(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19 4h-9M14 20H5M15 4 9 20" />
    </Icon>
  );
}

export function Underline(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 4v6a6 6 0 0 0 12 0V4M4 20h16" />
    </Icon>
  );
}

export function Strikethrough(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6M4 12h16" />
    </Icon>
  );
}

export function Link2(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 1 1 0 10h-2M8 12h8" />
    </Icon>
  );
}

export function List(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </Icon>
  );
}

export function ListOrdered(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 16a1.5 1.5 0 1 0-2.4 1.2L6 20H4" />
    </Icon>
  );
}

export function Braces(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1" />
    </Icon>
  );
}
