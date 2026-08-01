import { Body, Head, Html } from '@react-email/components';
import { OPEN_PIXEL_MARKER } from '@mlain/contracts/markers';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { useEmitter } from './ctx';
import { buildHeadCss, MSO_HEAD_BLOCK } from './head-css';
import { Raw, useRaw } from './raw';

const MSO_NAMESPACES = {
  'xmlns:v': 'urn:schemas-microsoft-com:vml',
  'xmlns:o': 'urn:schemas-microsoft-com:office:office',
};

/**
 * Výplň preheaderu. Jsou to skutečné znaky Unicode (U+034F, U+200C, U+00A0),
 * ne HTML entity: React by z entity udělal `&amp;#847;` a schránka by ji ukázala.
 */
const PREHEADER_FILLER = '͏‌ '.repeat(40);

export function EmailShell({
  language,
  title,
  preheader,
  children,
}: {
  language: string;
  title: string;
  preheader: string;
  // Nepovinné kvůli `createElement`: sekce se předávají variadickými argumenty,
  // které typová signatura `createElement` do objektu props nezapočítá.
  children?: ReactNode;
}): ReactElement {
  const { theme } = useEmitter();
  const raw = useRaw();
  const scheme = theme.darkModeEnabled ? 'light dark' : 'light';
  return (
    <Html lang={language} {...MSO_NAMESPACES}>
      <Head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta httpEquiv="x-ua-compatible" content="ie=edge" />
        <meta name="color-scheme" content={scheme} />
        <meta name="supported-color-schemes" content={scheme} />
        <title>{title}</title>
        <Raw html={MSO_HEAD_BLOCK} />
        {/* Obsah <style> jde raw slotem: React text uvnitř <style> escapuje
            a `"Segoe UI"` by se rozpadlo na `&quot;`, což prohlížeč uvnitř
            stylu nedekóduje a font stack by přestal platit.
            Odchylka od plánu: žeton se sem vkládá jako řetězec přes `useRaw`,
            ne komponentou `<Raw/>`. React 19 má `<style>` zvlášť ošetřený a
            element mezi jeho potomky zploští na `[object Object]`. */}
        <style>{raw(buildHeadCss(theme))}</style>
      </Head>
      <Body
        id="body"
        className="ml-body ml-canvas"
        style={{
          margin: 0,
          padding: 0,
          width: '100%',
          backgroundColor: theme.light.roles['surface.canvas'],
        }}
      >
        <div
          style={
            {
              display: 'none',
              fontSize: '1px',
              lineHeight: '1px',
              maxHeight: 0,
              maxWidth: 0,
              opacity: 0,
              overflow: 'hidden',
              msoHide: 'all',
            } as CSSProperties
          }
        >
          {preheader}
          {PREHEADER_FILLER}
        </div>
        {children}
      </Body>
    </Html>
  );
}

export { OPEN_PIXEL_MARKER };
