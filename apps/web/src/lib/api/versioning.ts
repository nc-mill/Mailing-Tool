import { ApiError } from '@mlain/core/errors/api-error';

export type VersionPhase = 'active' | 'deprecated' | 'sunset';
export type VersionState = { phase: VersionPhase; sunsetAt?: Date };

/**
 * 4.6: verze je v cestě, ne v hlavičce a ne v datu. Je vidět v logu, v curl
 * příkazu i v dokumentaci a nikdo si ji omylem nezmění.
 *
 * Minimální doba mezi ohlášením deprecated a sunsetem je 12 měsíců u celé verze
 * a 6 měsíců u jednotlivého endpointu. U self-hosted produktu je to důležitější
 * než u SaaS, protože uživatel aktualizuje, kdy chce.
 */
export const API_VERSIONS: Record<string, VersionState> = {
  v1: { phase: 'active' },
};

const VERSION_IN_PATH = /^\/api\/(v\d+)(\/|$)/;

export function versionFromPath(pathname: string): string | null {
  return pathname.match(VERSION_IN_PATH)?.[1] ?? null;
}

export function assertVersionSupported(
  version: string,
  states: Record<string, VersionState> = API_VERSIONS,
): void {
  const state = states[version];
  if (!state) throw new ApiError('unsupported_api_version', { params: { requested: version } });
  if (state.phase === 'sunset') {
    throw new ApiError('endpoint_removed', {
      params: { version, sunset_at: state.sunsetAt?.toISOString() ?? null },
    });
  }
}

/** RFC 8594: Sunset je datum ve formátu RFC 1123, tedy toUTCString(). */
export function deprecationHeaders(
  version: string,
  states: Record<string, VersionState> = API_VERSIONS,
): Record<string, string> {
  const state = states[version];
  if (!state || state.phase !== 'deprecated') return {};
  const headers: Record<string, string> = { Deprecation: 'true' };
  if (state.sunsetAt) headers['Sunset'] = state.sunsetAt.toUTCString();
  return headers;
}
