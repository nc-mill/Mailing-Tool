'use strict';

/**
 * Kritérium 56. V `packages/core/src/brand` a `packages/core/src/templates`
 * se ven chodí výhradně přes `safeFetch`. Ochrana, jejíž jediné vynucení je
 * „implementátor si to přečte", je přání, ne ochrana.
 *
 * Výjimku má `safe-fetch.ts` sám, protože v něm `safeFetch` bydlí,
 * `connector.ts` a `transport.ts`, protože jsou to jediná dvě místa, kde se
 * sahá na `undici` a kde vzniká připnuté spojení.
 */
const GUARDED_DIRS = ['/packages/core/src/brand/', '/packages/core/src/templates/'];
const EXEMPT_FILES = [
  '/packages/core/src/brand/safe-fetch.ts',
  '/packages/core/src/brand/connector.ts',
  '/packages/core/src/brand/transport.ts',
];

const BANNED_CALLEES = new Set(['fetch', 'request', 'axios']);

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Zakazuje přímé volání fetch, undici.request a axios v brand a templates. Ven se chodí jen přes safeFetch.',
    },
    messages: {
      rawFetch:
        'Přímý odchozí požadavek je tady zakázaný. Použij safeFetch z @mlain/core/brand, jinak obejdeš ochranu proti SSRF.',
    },
    schema: [],
  },
  create(context) {
    const filename = (context.filename ?? context.getFilename() ?? '').replaceAll('\\', '/');
    const guarded = GUARDED_DIRS.some((dir) => filename.includes(dir));
    const exempt = EXEMPT_FILES.some((file) => filename.endsWith(file));
    if (!guarded || exempt) return {};

    const localRequestBindings = new Set();

    return {
      ImportDeclaration(node) {
        if (node.source.value !== 'undici') return;
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier' && specifier.imported.name === 'request') {
            localRequestBindings.add(specifier.local.name);
          }
        }
      },
      CallExpression(node) {
        const callee = node.callee;

        if (callee.type === 'Identifier') {
          if (callee.name === 'fetch') {
            context.report({ node, messageId: 'rawFetch' });
            return;
          }
          if (localRequestBindings.has(callee.name)) {
            context.report({ node, messageId: 'rawFetch' });
          }
          return;
        }

        if (callee.type === 'MemberExpression') {
          const objectName = callee.object.type === 'Identifier' ? callee.object.name : '';
          const propertyName = callee.property.type === 'Identifier' ? callee.property.name : '';

          // `deps.request(...)` je v pořádku: injektovaná závislost, kterou
          // testy nahrazují a která uvnitř volá safeFetch.
          if (objectName === 'deps') return;

          if (objectName === 'globalThis' && propertyName === 'fetch') {
            context.report({ node, messageId: 'rawFetch' });
            return;
          }
          if (objectName === 'undici' && BANNED_CALLEES.has(propertyName)) {
            context.report({ node, messageId: 'rawFetch' });
            return;
          }
          if (objectName === 'axios') {
            context.report({ node, messageId: 'rawFetch' });
          }
        }
      },
    };
  },
};
