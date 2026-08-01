import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * Navigační pomůcky, které samy doplní jazykový prefix.
 * V aplikaci se nikdy nepoužívá `next/link` přímo, jinak by odkaz
 * v anglickém rozhraní spadl na českou cestu.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
