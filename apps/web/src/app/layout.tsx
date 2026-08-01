import type { ReactNode } from 'react';
// Vstupní styl celé aplikace. Načítá se v kořenovém layoutu, protože jinak
// se Tailwind ani tokeny z @mlain/ui do stránky nikdy nedostanou.
import './globals.css';

export const metadata = { title: 'Mlain Mailer' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="cs">
      <body>{children}</body>
    </html>
  );
}
