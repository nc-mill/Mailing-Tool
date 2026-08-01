import { Img } from '@react-email/components';
import type { ReactElement } from 'react';
import type { SocialBlock } from '../../document/types';
import { socialIconUrl } from '../assets';
import { useEmitter } from '../ctx';
import { px } from '../style';
import { BlockFrame } from './frame';

const NETWORK_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  x: 'X',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  threads: 'Threads',
  pinterest: 'Pinterest',
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
  web: 'Web',
  email: 'E-mail',
};

export function SocialBlockView({ block }: { block: SocialBlock }): ReactElement {
  const { assetBaseUrl, linkHref } = useEmitter();
  const p = block.props;
  return (
    <BlockFrame
      padding={p.padding}
      backgroundColor={p.backgroundColor}
      hideOnMobile={p.hideOnMobile}
      visibleWhen={block.visibleWhen}
      align={p.align}
    >
      <table role="presentation" cellPadding={0} cellSpacing={0} border={0} align={p.align}>
        <tbody>
          <tr>
            {p.items.map((item, index) => (
              <td
                key={index}
                style={{ paddingRight: index === p.items.length - 1 ? '0px' : px(p.gap) }}
              >
                <a href={linkHref(item.href, false)}>
                  <Img
                    src={socialIconUrl(assetBaseUrl, item.network, p.iconStyle)}
                    width={p.iconSize}
                    height={p.iconSize}
                    alt={item.label ?? NETWORK_LABELS[item.network] ?? item.network}
                    style={{ display: 'block', border: 0, outline: 'none', textDecoration: 'none' }}
                  />
                </a>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </BlockFrame>
  );
}
