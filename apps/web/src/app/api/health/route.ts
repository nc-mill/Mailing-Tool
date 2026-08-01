import { liveness } from '@mlain/core/health';
import { getConfig } from '@/lib/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Liveness. Nekontroluje nic než to, že proces žije (část 1, kapitola 3.12). */
export function GET(): Response {
  const config = getConfig();
  return Response.json(liveness(config.MODE, config.IMAGE_VERSION), {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
