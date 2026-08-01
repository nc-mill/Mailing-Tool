'use client';

import { useTranslations } from 'next-intl';
import type { EditorBlock, InlineNode, RichText } from '../../model/document-types';
import { AlertTriangle, Lock } from '../icons';
import { useFieldLabel } from '../richtext/field-labels';

function Inline({ nodes }: { nodes: InlineNode[] }) {
  const fieldLabel = useFieldLabel();
  return (
    <>
      {nodes.map((node, index) => {
        if (node.t === 'br') return <br key={index} />;
        if (node.t === 'var') {
          return (
            <span
              key={index}
              data-testid="token"
              className="rounded bg-accent px-1 text-accent-foreground"
            >
              {fieldLabel(node.expr)}
            </span>
          );
        }
        if (node.t === 'a') {
          return (
            <span key={index} className="underline">
              <Inline nodes={node.children} />
            </span>
          );
        }
        const style = [
          node.b && 'font-bold',
          node.i && 'italic',
          node.u && 'underline',
          node.strike && 'line-through',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <span key={index} className={style}>
            {node.v}
          </span>
        );
      })}
    </>
  );
}

function Rich({ value }: { value: RichText }) {
  return (
    <>
      {value.map((node, index) => {
        if (node.t === 'p')
          return (
            <p key={index}>
              <Inline nodes={node.children} />
            </p>
          );
        const List = node.t === 'ul' ? 'ul' : 'ol';
        return (
          <List key={index} className={node.t === 'ul' ? 'list-disc pl-5' : 'list-decimal pl-5'}>
            {node.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <Inline nodes={item} />
              </li>
            ))}
          </List>
        );
      })}
    </>
  );
}

export function BlockPreview({
  block,
  canWriteHtml,
}: {
  block: EditorBlock;
  canWriteHtml: boolean;
}) {
  const t = useTranslations('editor');
  // Přiblížení kreslí libovolný blok včetně neznámého, takže se vlastnosti čtou
  // netypově. `never` z doslovného znění plánu by u `props.items.length` neprošlo
  // typovou kontrolou, proto `Record<string, any>` zúžený na místě použití.
  const props = block.props as Record<string, never>;

  switch (block.type) {
    case 'section':
    case 'column':
      return <p className="text-xs text-muted-foreground">{t(`block.${block.type}`)}</p>;
    case 'columns':
      return (
        <p className="text-xs text-muted-foreground">
          {t('block.columnsWithLayout', { layout: String(props.layout ?? '1-1') })}
        </p>
      );
    case 'heading':
      return (
        <div className="text-xl font-bold">
          <Rich value={(props.content ?? []) as RichText} />
        </div>
      );
    case 'text':
      return (
        <div className="text-sm">
          <Rich value={(props.content ?? []) as RichText} />
        </div>
      );
    case 'button':
      return (
        <span className="inline-block rounded bg-primary px-4 py-2 text-primary-foreground">
          <Rich value={(props.label ?? []) as RichText} />
        </span>
      );
    case 'image':
      return (
        <div className="flex items-center gap-2">
          <div className="h-16 w-24 rounded bg-muted" aria-hidden />
          {!props.decorative && !props.alt ? (
            <span
              data-testid="missing-alt"
              className="flex items-center gap-1 text-xs text-warning-text"
            >
              <AlertTriangle aria-hidden className="size-3" />
              {t('hint.altMissing')}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">{String(props.alt ?? '')}</span>
          )}
        </div>
      );
    case 'divider':
      return <hr className="border-t" />;
    case 'spacer':
      return (
        <div className="bg-muted/40" style={{ height: Number(props.height ?? 24) }} aria-hidden />
      );
    case 'social':
      return (
        <p className="text-xs text-muted-foreground">
          {t('block.socialCount', { count: ((props.items ?? []) as unknown[]).length })}
        </p>
      );
    case 'footer':
      return (
        <div className="text-xs text-muted-foreground">
          <Rich value={(props.senderInfo ?? []) as RichText} />
          <p>
            {[
              props.showUnsubscribe && props.unsubscribeLabel,
              props.showPreferences && props.preferencesLabel,
              props.showWebview && props.webviewLabel,
            ]
              .filter(Boolean)
              .join(' | ')}
          </p>
        </div>
      );
    case 'html':
      return canWriteHtml ? (
        <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
          {String(props.code ?? '')}
        </pre>
      ) : (
        <p data-testid="html-forbidden" className="flex items-center gap-1 text-xs">
          <Lock aria-hidden className="size-3" />
          {t('block.htmlForbidden')}
        </p>
      );
    default:
      return <p className="text-xs">{t('block.lockedHint', { type: block.type })}</p>;
  }
}
