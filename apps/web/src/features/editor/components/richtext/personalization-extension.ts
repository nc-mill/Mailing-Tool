import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { PersonalizationNodeView } from './personalization-node-view';

/**
 * Personalizace je vlastní uzel, ne text se závorkami. Je `atom`, takže se chová jako jeden znak
 * a uživatel ji nemůže rozbít smazáním jedné závorky (část 3, 3.7.5).
 */
export const PersonalizationExtension = Node.create({
  name: 'personalization',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      expr: { default: '' },
      fallback: { default: null },
      dateFormat: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-ml-var]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-ml-var': HTMLAttributes.expr })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PersonalizationNodeView);
  },
});
