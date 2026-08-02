const { RuleTester } = require('eslint');
const rule = require('./no-raw-fetch-in-brand.cjs');

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
});

ruleTester.run('no-raw-fetch-in-brand', rule, {
  valid: [
    {
      code: 'safeFetch(url, limits, policy, deps);',
      filename: '/repo/packages/core/src/brand/x.ts',
    },
    { code: 'fetch(url);', filename: '/repo/packages/core/src/ai/metered-fetch.ts' },
    { code: 'undici.request(url);', filename: '/repo/apps/web/src/lib/x.ts' },
    {
      code: 'const request = deps.request; deps.request(x);',
      filename: '/repo/packages/core/src/brand/jobs/brand-extract.ts',
    },
    {
      code: 'import { Agent } from "undici"; const agent = new Agent({}); agent.request(x);',
      filename: '/repo/packages/core/src/brand/transport.ts',
    },
  ],
  invalid: [
    {
      code: 'fetch("https://kolo-shop.cz");',
      filename: '/repo/packages/core/src/brand/logo.ts',
      errors: [{ messageId: 'rawFetch' }],
    },
    {
      code: 'globalThis.fetch(url);',
      filename: '/repo/packages/core/src/brand/logo.ts',
      errors: [{ messageId: 'rawFetch' }],
    },
    {
      code: 'import { request } from "undici"; request(url);',
      filename: '/repo/packages/core/src/brand/logo.ts',
      errors: [{ messageId: 'rawFetch' }],
    },
    {
      code: 'axios.get(url);',
      filename: '/repo/packages/core/src/templates/preview.ts',
      errors: [{ messageId: 'rawFetch' }],
    },
  ],
});

console.log('no-raw-fetch-in-brand: OK');
