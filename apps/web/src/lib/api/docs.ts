import type { OpenApiDocument } from './openapi';

/**
 * Rozhodnutí R5 plánu P04. Specifikace 4.7 chce Scalar nebo Redoc "bez externích
 * CDN". Obě knihovny ve výchozím stavu tahají bundle z CDN a jejich vendorování
 * je build krok, který vlastní P01. Tahle stránka je proto soběstačná, bez
 * jediného externího zdroje a bez JavaScriptu. Vendorování bundlu je úkol pro P16.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderDocsHtml(document: OpenApiDocument): string {
  const byTag = new Map<string, string[]>();

  for (const [path, methods] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods)) {
      const op = operation as {
        tags?: string[];
        summary?: string;
        security?: Array<Record<string, string[]>>;
      };
      const tag = op.tags?.[0] ?? 'Ostatní';
      const scopes = (op.security ?? []).flatMap((entry) => Object.values(entry).flat());
      const scopeText =
        scopes.length > 0 ? ` <em>scopes: ${escapeHtml(scopes.join(', '))}</em>` : '';
      const line = `<li><code>${method.toUpperCase()} ${escapeHtml(path)}</code> ${escapeHtml(
        op.summary ?? '',
      )}${scopeText}</li>`;
      byTag.set(tag, [...(byTag.get(tag) ?? []), line]);
    }
  }

  const sections = [...byTag.entries()]
    .map(([tag, lines]) => `<h2>${escapeHtml(tag)}</h2><ul>${lines.sort().join('')}</ul>`)
    .join('');

  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(document.info.title)} ${escapeHtml(document.info.version)}</title>
<style>
body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 60rem; line-height: 1.5; padding: 0 1rem; }
code { background: rgba(127,127,127,0.15); padding: 0.1rem 0.3rem; border-radius: 3px; }
li { margin: 0.25rem 0; }
em { color: #666; font-style: normal; font-size: 0.9em; }
</style>
</head>
<body>
<h1>${escapeHtml(document.info.title)} <small>${escapeHtml(document.info.version)}</small></h1>
<p>${escapeHtml(document.info.description ?? '')}</p>
<p>Strojově čitelná specifikace: <a href="/api/v1/openapi.json">/api/v1/openapi.json</a></p>
${sections}
</body>
</html>`;
}
