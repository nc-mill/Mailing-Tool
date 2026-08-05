import type { ReactElement } from 'react';
import type { FooterBlock } from '../../document/types';
import type { EmitterProps } from '../ctx';
import { RichTextView } from '../rich-text';
import { lineHeightStyle, px } from '../style';
import { BlockFrame } from './frame';

/**
 * Patička nese právní minimum. Nemá `visibleWhen` už na úrovni schématu,
 * takže ji nejde podmínit a musí ji dostat každý příjemce (pravidlo S14).
 * Systémové adresy zůstávají Liquid výrazem: sender je interpoluje z podepsaného
 * tokenu, kompilace o nich neví nic víc než jejich jméno.
 *
 * ODKAZ NA PŘEDVOLBY MÁ DVĚ PODMÍNKY, ODHLÁŠENÍ ŽÁDNOU. `showPreferences` patří
 * ŠABLONĚ, `emitter.preferenceCenterEnabled` PROJEKTU, a platí přísnější z nich:
 * když správce předvolby nenabízí, nesmí na ně odkazovat ani šablona uložená dřív.
 * Odhlašovací odkaz se takhle podmínit NESMÍ, je to zákonná povinnost.
 */
export function FooterBlockView({
  block,
  emitter,
}: { block: FooterBlock } & EmitterProps): ReactElement {
  const { theme } = emitter;
  const p = block.props;
  const color = theme.light.color(p.color);
  const links: Array<{ label: string; href: string }> = [];
  if (p.showUnsubscribe) links.push({ label: p.unsubscribeLabel, href: '{{ unsubscribe_url }}' });
  if (p.showPreferences && emitter.preferenceCenterEnabled !== false) {
    links.push({ label: p.preferencesLabel, href: '{{ preferences_url }}' });
  }
  if (p.showWebview) links.push({ label: p.webviewLabel, href: '{{ webview_url }}' });

  return (
    <BlockFrame
      emitter={emitter}
      padding={p.padding}
      backgroundColor={p.backgroundColor}
      hideOnMobile={false}
      tdStyle={{
        fontFamily: theme.fonts.body,
        fontSize: px(p.fontSize),
        color,
        ...lineHeightStyle(p.fontSize, 1.5),
      }}
      align="center"
    >
      <div className="ml-muted" style={{ color, textAlign: 'center' }}>
        <RichTextView
          emitter={emitter}
          rich={p.senderInfo}
          color={color}
          linkColor={color}
          align="center"
          style={{ fontSize: px(p.fontSize) }}
        />
      </div>
      <div className="ml-muted" style={{ color, textAlign: 'center', paddingTop: '8px' }}>
        {links.map((link, index) => (
          <span key={link.href}>
            {index > 0 ? ' | ' : null}
            <a className="ml-link" href={link.href} style={{ color, textDecoration: 'underline' }}>
              {link.label}
            </a>
          </span>
        ))}
      </div>
    </BlockFrame>
  );
}
