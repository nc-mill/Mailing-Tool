import { describe, expect, it } from 'vitest';
import { registeredRepoModules } from '@mlain/db';
import * as templates from './index';

/**
 * Vstupní bod domény nikdo jiný neimportuje, takže by rozbitý reexport nebo
 * chybějící registrace prošly bez povšimnutí až do chvíle, kdy na doménu sáhne
 * první router. Tenhle soubor je jediné místo, kde se to pozná dřív.
 */
describe('@mlain/core/templates', () => {
  it('vystavuje celou plochu domény, kterou plán slibuje', () => {
    for (const name of [
      'createTemplate',
      'saveDesign',
      'duplicateTemplate',
      'deleteTemplate',
      'restoreTemplateVersion',
      'copyName',
      'createTemplateRow',
      'findTemplateById',
      'findTemplateIdsUsingField',
      'listTemplates',
      'setValidationState',
      'softDeleteTemplate',
      'updateTemplateDesign',
      'createVersion',
      'listVersions',
      'pruneVersions',
      'restoreVersion',
      'validateTemplateDocument',
      'compileTemplate',
      'preSendCheck',
      'assertSendable',
      'PreSendBlockedError',
      'syncAssetReferences',
      'loadAssetRefs',
      'assetIdsInDocument',
    ]) {
      expect(typeof (templates as Record<string, unknown>)[name], name).toBe('function');
    }
    expect(templates.ASSET_REF_TYPES).toContain('template');
  });

  it('registruje čtecí funkce do generického testu izolace z P03', () => {
    const module = registeredRepoModules().find((entry) => entry.name === 'templates');
    expect(module, 'bez registrace by izolaci hlídal jen vlastní test').toBeDefined();
    expect(module!.readers.map((reader) => reader.name).sort()).toEqual([
      'findTemplateById',
      'findTemplateIdsUsingField',
      'listTemplates',
      'listVersions',
      'loadAssetRefs',
    ]);
  });
});
