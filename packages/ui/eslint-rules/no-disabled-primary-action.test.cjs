const { RuleTester } = require('eslint');
const rule = require('./no-disabled-primary-action.cjs');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2024,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('no-disabled-primary-action', rule, {
  valid: [
    { code: '<Button variant="secondary" disabled>Zpět</Button>' },
    { code: '<Button variant="primary">Odeslat 12 e-mailů</Button>' },
    { code: '<Button variant="primary" unavailableReason="Chybí oprávnění.">Odeslat</Button>' },
    {
      code: '<Button variant="primary" disabled data-allow-disabled="wizard-step-guard">Dál</Button>',
    },
  ],
  invalid: [
    {
      code: '<Button variant="primary" disabled>Odeslat</Button>',
      errors: [{ messageId: 'noDisabledPrimary' }],
    },
    {
      code: '<Button variant="destructive" disabled={!confirmed}>Smazat</Button>',
      errors: [{ messageId: 'noDisabledPrimary' }],
    },
    {
      code: '<button type="submit" className="bg-primary text-primary-foreground" disabled>Uložit</button>',
      errors: [{ messageId: 'noDisabledPrimary' }],
    },
  ],
});

console.log('no-disabled-primary-action: OK');
