import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Skládá třídy a u konfliktních Tailwind utilit nechá vyhrát poslední. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
