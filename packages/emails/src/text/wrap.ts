export const PLAIN_TEXT_WIDTH = 78;

/**
 * Zalomení na hranici slova. Liquid výraz se nikdy nerozdělí, protože se
 * tokenizuje jako jeden celek: rozdělený výraz je neplatný Liquid a sender
 * by na něm spadl s render_failed.
 */
export function wrapPlain(input: string, opts: { indent?: string } = {}): string[] {
  if (input === '') return [''];
  const indent = opts.indent ?? '';
  const tokens = tokenize(input);
  const lines: string[] = [];
  let current = '';

  for (const token of tokens) {
    const prefix = lines.length === 0 ? '' : indent;
    const candidate = current === '' ? prefix + token : `${current} ${token}`;
    if (candidate.length <= PLAIN_TEXT_WIDTH) {
      current = candidate;
      continue;
    }
    if (current !== '') lines.push(current);
    current = (lines.length === 0 ? '' : indent) + token;
  }
  if (current !== '') lines.push(current);
  return lines;
}

/** Slova oddělená bílým znakem, ale `{{ ... }}` a `{% ... %}` drží pohromadě. */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const pattern = /\{\{[^}]*\}\}|\{%[^%]*%\}|\S+/g;
  for (const match of input.matchAll(pattern)) tokens.push(match[0]);
  return tokens;
}
