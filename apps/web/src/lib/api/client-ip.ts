/**
 * 4.5: TRUST_PROXY určuje, kolik proxy vrstev věřit. Naivní "vezmi první hodnotu
 * z XFF" je zakázané, protože ji útočník nastaví.
 */
export function clientIpFrom(input: {
  xff: string | null | undefined;
  remote: string;
  trustProxy: number;
}): string {
  if (input.trustProxy <= 0 || !input.xff) return input.remote;
  const parts = input.xff
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const index = parts.length - input.trustProxy;
  if (index < 0 || index >= parts.length) return input.remote;
  return parts[index]!;
}
