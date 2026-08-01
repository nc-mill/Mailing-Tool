import { notFound } from 'next/navigation';
import { GalleryClient } from './gallery-client';

export const dynamic = 'force-dynamic';

export default function UiGalleryPage() {
  // Galerie je vývojový nástroj. V produkci neexistuje.
  if (process.env.NODE_ENV === 'production') notFound();
  return <GalleryClient />;
}
