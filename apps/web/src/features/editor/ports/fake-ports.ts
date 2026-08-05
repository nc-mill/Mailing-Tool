import type { EditorDocument } from '../model/document-types';
import type { EditorPorts } from './types';

/** Dvojník pro jednotkové testy a pro Playwright, když backend neběží. */
export function createFakePorts(overrides: Partial<EditorPorts> = {}): EditorPorts {
  let hash = 'h1';
  let stored: EditorDocument | null = null;
  let created = 0;
  return {
    async createTemplate() {
      created += 1;
      return { id: `tmpl-${created}` };
    },
    async save({ document }) {
      stored = document;
      hash = `h${Number(hash.slice(1)) + 1}`;
      return { ok: true, designHash: hash, updatedAt: new Date().toISOString() };
    },
    async rename() {
      hash = `h${Number(hash.slice(1)) + 1}`;
      return { ok: true as const, designHash: hash };
    },
    async preview({ previewData }) {
      const name = previewData.type === 'sample' && previewData.variant === 'no_name' ? '' : 'Jana';
      return {
        html: `<html lang="cs"><body><p>Dobrý den, ${name || 'zákazníku'}</p></body></html>`,
        text: `Dobrý den, ${name || 'zákazníku'}`,
      };
    },
    async validate() {
      return { findings: [] };
    },
    async testSend() {
      return { ok: true };
    },
    async applyToCampaign() {
      return { ok: true as const, overwritten: false };
    },
    async searchContacts() {
      return [
        {
          id: 'c1',
          email: 'jana@example.cz',
          name: 'Jana Nováková',
          values: {
            email: 'jana@example.cz',
            first_name: 'Jana',
            last_name: 'Nováková',
            greeting: 'Dobrý den, Jano',
            attr: {},
          },
        },
      ];
    },
    async randomContact() {
      return {
        id: 'c2',
        email: 'petr@example.cz',
        name: 'Petr Svoboda',
        values: {
          email: 'petr@example.cz',
          first_name: 'Petr',
          last_name: 'Svoboda',
          greeting: 'Dobrý den, Petře',
          attr: {},
        },
      };
    },
    async listAssets() {
      return [{ id: 'a1', url: '/a/demo/w600.png', name: 'logo.png', width: 600, height: 200 }];
    },
    async uploadAsset(file) {
      return { id: 'a2', url: '/a/upload/w600.png', name: file.name, width: 600, height: 200 };
    },
    ...overrides,
    __stored: () => stored,
  } as EditorPorts;
}
