import { Img } from '@react-email/components';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { AssetRef } from '../../compile/types';
import type { ImageBlock } from '../../document/types';
import { assetUrl, pickVariant } from '../assets';
import { useEmitter } from '../ctx';
import { px } from '../style';
import { BlockFrame } from './frame';

function scaledHeight(asset: AssetRef, displayWidth: number): number {
  if (!asset.width || !asset.height) return displayWidth;
  return Math.round((displayWidth * asset.height) / asset.width);
}

function Picture({
  asset,
  block,
  displayWidth,
  className,
}: {
  asset: AssetRef;
  block: ImageBlock;
  displayWidth: number;
  className?: string | undefined;
}): ReactElement {
  const { assetBaseUrl, theme } = useEmitter();
  const radius = block.props.borderRadius ?? theme.radius;
  return (
    <Img
      className={className}
      src={assetUrl(assetBaseUrl, asset, pickVariant(asset, displayWidth))}
      width={displayWidth}
      height={scaledHeight(asset, displayWidth)}
      alt={block.props.decorative ? '' : block.props.alt}
      {...(block.props.decorative ? { role: 'presentation' } : {})}
      style={{
        display: 'block',
        border: 0,
        outline: 'none',
        textDecoration: 'none',
        maxWidth: '100%',
        height: 'auto',
        borderRadius: px(radius),
      }}
    />
  );
}

export function ImageBlockView({
  block,
  width,
}: {
  block: ImageBlock;
  width: number;
}): ReactElement | null {
  const { assets, linkHref } = useEmitter();
  const asset = assets[block.props.assetId];
  // Chybějící asset zastaví validátor pravidlem S6. Kdyby přesto prošel,
  // je lepší obrázek vynechat než odeslat rozbitý <img> bez rozměrů.
  if (!asset) return null;

  const displayWidth = block.props.width === 'full' ? width : Math.min(block.props.width, width);
  const darkAsset = block.props.darkVariantAssetId
    ? assets[block.props.darkVariantAssetId]
    : undefined;

  const picture: ReactNode = darkAsset ? (
    <>
      <div
        className="ml-logo-dark"
        style={
          { display: 'none', maxHeight: 0, overflow: 'hidden', msoHide: 'all' } as CSSProperties
        }
      >
        <Picture asset={darkAsset} block={block} displayWidth={displayWidth} />
      </div>
      <div className="ml-logo-light">
        <Picture asset={asset} block={block} displayWidth={displayWidth} />
      </div>
    </>
  ) : (
    <Picture asset={asset} block={block} displayWidth={displayWidth} />
  );

  return (
    <BlockFrame
      padding={block.props.padding}
      backgroundColor={block.props.backgroundColor}
      hideOnMobile={block.props.hideOnMobile}
      visibleWhen={block.visibleWhen}
      align={block.props.align}
    >
      {block.props.href ? (
        <a href={linkHref(block.props.href, block.props.trackable)}>{picture}</a>
      ) : (
        picture
      )}
    </BlockFrame>
  );
}
