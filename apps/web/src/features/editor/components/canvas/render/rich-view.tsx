'use client';

import { useTranslations } from 'next-intl';
import type { CSSProperties, ReactElement } from 'react';
import type { InlineNode, RichText } from '../../../model/document-types';
import { useFieldLabel } from '../../richtext/field-labels';
import { greetingGuidanceFor } from '../../richtext/greeting-guidance';
import { tokenValue } from '../../view/token-value';
import { useView } from '../../view/view-state';
import { useCanvasValues } from './canvas-context';

/**
 * Štítek personalizace na plátně.
 *
 * Do e-mailu jde `{{ contact.greeting }}`, ale uživateli se syrový výraz
 * ukazovat nesmí: značka se kreslí jako štítek s lidským popiskem („Oslovení").
 * Barvy jsou schválně z tokenů aplikace, ne z motivu e-mailu, protože štítek
 * je pomůcka editoru a musí být poznat, že v hotovém e-mailu takhle nevypadá.
 *
 * `--color-accent-surface` a `--color-accent-text` v `packages/ui/src/tokens.css`
 * SKUTEČNĚ existují. Dřívější plátno používalo `bg-accent` a `text-accent-foreground`,
 * což jsou názvy ze shadcn, které tenhle design systém nemá, takže štítek neměl
 * žádné pozadí a v textu úplně zanikl.
 */
const TOKEN_STYLE: CSSProperties = {
  backgroundColor: 'var(--color-accent-surface)',
  color: 'var(--color-accent-text)',
  borderRadius: '3px',
  padding: '0 3px',
  // Písmo se dědí z bloku, aby štítek nerozhodil řádkování ani výšku řádku.
  fontSize: 'inherit',
  lineHeight: 'inherit',
  whiteSpace: 'nowrap',
};

function Inline({ nodes, linkColor }: { nodes: InlineNode[]; linkColor: string }): ReactElement {
  const t = useTranslations('editor');
  const fieldLabel = useFieldLabel();
  const values = useCanvasValues();
  const { greetingExample } = useView();
  return (
    <>
      {nodes.map((node, index) => {
        if (node.t === 'br') return <br key={index} />;
        if (node.t === 'var') {
          /*
           * Štítek, nebo dosazená hodnota. Rozhoduje volba „Zobrazit jako"
           * v hlavičce: bez ní (`values === null`) se kreslí popisek pole,
           * s ní hodnota toho kontaktu. Přístupné jméno zůstává popisek pole,
           * aby ze čtečky bylo pořád poznat, že je to značka, a ne text.
           */
          const substituted = values ? tokenValue(values, node) : null;
          /*
           * U OSLOVENÍ ŘEKNE ŠTÍTEK I VÝSLEDNOU VĚTU, jinak jen popisek pole.
           *
           * Nález z provozu: „Je tam v šabloně mailu napsáno jen ‚Oslovení'.
           * Ale bude to vypadat jak? Dobrý den Honzo? Nebo Krásný den Honzo?"
           * U jména si výsledek domyslí každý, u oslovení ne: je to hotová věta
           * ze zdvořilostní formule a pátého pádu a její znění řídí nastavení
           * projektu. Vepsat ji do štítku nejde, ten musí zůstat krátký, aby
           * odstavec lámal řádek stejně jako hotový e-mail, takže jde do bubliny.
           *
           * KLÁVESNICE O NI NEPŘIJDE: po vstupu do bloku kreslí tutéž značku
           * `PersonalizationNodeView` jako TLAČÍTKO a věta je i v bublině, kterou
           * otevírá (`TokenInspector`). Bublina po najetí je tedy pohodlí navíc,
           * ne jediná cesta.
           */
          const isGreeting = greetingGuidanceFor(node.expr) === 'greeting';
          const hint =
            isGreeting && substituted === null && greetingExample !== null
              ? t('token.greetingTooltip', {
                  label: fieldLabel(node.expr),
                  example: greetingExample,
                })
              : undefined;
          return (
            <span
              key={index}
              data-testid="token"
              data-token-substituted={substituted === null ? undefined : ''}
              aria-label={hint ?? (substituted === null ? undefined : fieldLabel(node.expr))}
              {...(hint === undefined ? {} : { title: hint })}
              style={TOKEN_STYLE}
            >
              {substituted ?? fieldLabel(node.expr)}
            </span>
          );
        }
        if (node.t === 'a') {
          return (
            <span key={index} style={{ color: linkColor, textDecoration: 'underline' }}>
              <Inline nodes={node.children} linkColor={linkColor} />
            </span>
          );
        }
        let out: ReactElement = <>{node.v}</>;
        if (node.strike) out = <s>{out}</s>;
        if (node.u) out = <u>{out}</u>;
        if (node.i) out = <em>{out}</em>;
        if (node.b) out = <strong>{out}</strong>;
        return <span key={index}>{out}</span>;
      })}
    </>
  );
}

/**
 * Bohatý text na plátně. Struktura se drží `RichTextView` z emitteru
 * (`packages/emails/src/emitter/rich-text.tsx`): odstavce mají nulový okraj
 * a zarovnání z uzlu, seznamy odsazení 24 px. Rozdíl je jediný a záměrný:
 * uzel `var` se kreslí jako štítek, ne jako `{{ … }}`.
 */
export function RichView({
  value,
  color,
  linkColor,
  align,
  style,
  inline,
}: {
  value: RichText;
  color: string;
  linkColor: string;
  align?: 'left' | 'center' | 'right' | 'justify' | undefined;
  style?: CSSProperties | undefined;
  /**
   * Popisek tlačítka se kreslí ŘÁDKOVĚ, ne odstavcem.
   *
   * Odstavec je blokový prvek a uvnitř `inline-block` roztáhne rodiče na celou
   * šířku okolí. Tlačítko „Podívat se" s `fullWidth: false` tak vyšlo přes
   * celou šířku e-mailu. Emitter tuhle past obchází tím, že popisek skládá
   * jako jednořádkové HTML (`richToSingleLineHtml`), plátno tímhle přepínačem.
   */
  inline?: boolean | undefined;
}): ReactElement {
  const paragraph: CSSProperties = { margin: 0, color, textAlign: align ?? 'left', ...style };

  if (inline) {
    return (
      <span style={{ color, ...style }}>
        {value.map((node, index) =>
          node.t === 'p' ? (
            <Inline key={index} nodes={node.children} linkColor={linkColor} />
          ) : (
            node.items.map((item, itemIndex) => (
              <Inline key={`${index}-${itemIndex}`} nodes={item} linkColor={linkColor} />
            ))
          ),
        )}
      </span>
    );
  }

  return (
    <>
      {value.map((node, index) => {
        if (node.t === 'p') {
          return (
            <p key={index} style={{ ...paragraph, textAlign: node.align ?? paragraph.textAlign }}>
              {node.children.length > 0 ? (
                <Inline nodes={node.children} linkColor={linkColor} />
              ) : (
                // Prázdný odstavec by měl nulovou výšku a blok by se na plátně
                // schoval. Nezlomitelná mezera mu ji vrátí.
                <>&nbsp;</>
              )}
            </p>
          );
        }
        const List = node.t === 'ul' ? 'ul' : 'ol';
        return (
          <List key={index} style={{ ...paragraph, paddingLeft: '24px' }}>
            {node.items.map((item, itemIndex) => (
              <li key={itemIndex} style={{ color }}>
                <Inline nodes={item} linkColor={linkColor} />
              </li>
            ))}
          </List>
        );
      })}
    </>
  );
}
