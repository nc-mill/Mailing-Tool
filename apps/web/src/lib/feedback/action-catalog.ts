import type { FeedbackChannel } from './action-result';

/** Třídy akcí z 5.1 části 6. A0 je čtení a v katalogu není. */
export type ActionClass = 'A1' | 'A2' | 'A3' | 'A4' | 'A5';

/** Úrovně ochrany z 6.1 části 6. */
export type RiskLevel = 'N1' | 'N2' | 'N3' | 'N4';

/** Závazné mapování třídy na primární kanál podle rozhodovací tabulky 5.2. */
export const CHANNEL_BY_CLASS: Record<ActionClass, FeedbackChannel> = {
  A1: 'inline',
  A2: 'toast',
  A3: 'inlineBlock',
  A4: 'page',
  A5: 'page',
};

export type ActionDescriptor = {
  module: string;
  class: ActionClass;
  channel: FeedbackChannel;
  risk: RiskLevel;
};

/**
 * Každý Server Action plánu P06 má tady právě jeden řádek. Test v tomhle
 * adresáři ověří, že modul akci opravdu exportuje a že kanál sedí s třídou.
 */
export const ACTION_CATALOG = {
  setupAction: { module: 'features/auth/actions', class: 'A5', channel: 'page', risk: 'N1' },
  loginAction: { module: 'features/auth/actions', class: 'A3', channel: 'inlineBlock', risk: 'N1' },
  requestPasswordResetAction: {
    module: 'features/auth/actions',
    class: 'A3',
    channel: 'inlineBlock',
    risk: 'N1',
  },
  confirmPasswordResetAction: {
    module: 'features/auth/actions',
    class: 'A3',
    channel: 'inlineBlock',
    risk: 'N1',
  },
  acceptInvitationAction: {
    module: 'features/auth/actions',
    class: 'A3',
    channel: 'inlineBlock',
    risk: 'N1',
  },
  // ODCHYLKA OD PLÁNU, vynucená testem v tomhle adresáři. Plán psal
  // `class: 'A3', channel: 'page'`, jenže tabulka 5.2 dává A3 kanál
  // `inlineBlock`, takže vlastní test plánu na tomhle řádku padal. Opravuje se
  // TŘÍDA, ne kanál: akce založí projekt a přesměruje na `/w/{slug}`, což je
  // přechod celé stránky, přesně jako `setupAction` o pár řádků výš. Kanál
  // `page` popisuje skutečné chování, třída A3 ne.
  createWorkspaceAction: {
    module: 'features/auth/actions',
    class: 'A5',
    channel: 'page',
    risk: 'N1',
  },
  updateProfileAction: {
    module: 'features/profile/actions',
    class: 'A1',
    channel: 'inline',
    risk: 'N1',
  },
  changePasswordAction: {
    module: 'features/profile/actions',
    class: 'A3',
    channel: 'inlineBlock',
    risk: 'N2',
  },
  revokeSessionAction: {
    module: 'features/profile/actions',
    class: 'A2',
    channel: 'toast',
    risk: 'N1',
  },
  logoutAllAction: { module: 'features/profile/actions', class: 'A5', channel: 'page', risk: 'N2' },
  logoutAction: { module: 'features/profile/actions', class: 'A5', channel: 'page', risk: 'N1' },
  updateWorkspaceAction: {
    module: 'features/workspace-settings/actions',
    class: 'A1',
    channel: 'inline',
    risk: 'N1',
  },
  updateAddressFormAction: {
    module: 'features/workspace-settings/actions',
    class: 'A4',
    channel: 'page',
    risk: 'N2',
  },
  deleteWorkspaceAction: {
    module: 'features/workspace-settings/actions',
    class: 'A5',
    channel: 'page',
    risk: 'N4',
  },
  changeMemberRoleAction: {
    module: 'features/members/actions',
    class: 'A2',
    channel: 'toast',
    risk: 'N1',
  },
  removeMemberAction: {
    module: 'features/members/actions',
    class: 'A2',
    channel: 'toast',
    risk: 'N2',
  },
  inviteMemberAction: {
    module: 'features/members/actions',
    class: 'A3',
    channel: 'inlineBlock',
    risk: 'N1',
  },
  revokeInvitationAction: {
    module: 'features/members/actions',
    class: 'A2',
    channel: 'toast',
    risk: 'N1',
  },
  createApiKeyAction: {
    module: 'features/api-keys/actions',
    class: 'A3',
    channel: 'inlineBlock',
    risk: 'N1',
  },
  rotateApiKeyAction: {
    module: 'features/api-keys/actions',
    class: 'A5',
    channel: 'page',
    risk: 'N3',
  },
  revokeApiKeyAction: {
    module: 'features/api-keys/actions',
    class: 'A5',
    channel: 'page',
    risk: 'N3',
  },
  createWebhookAction: {
    module: 'features/webhooks/actions',
    class: 'A3',
    channel: 'inlineBlock',
    risk: 'N1',
  },
  updateWebhookAction: {
    module: 'features/webhooks/actions',
    class: 'A1',
    channel: 'inline',
    risk: 'N1',
  },
  deleteWebhookAction: {
    module: 'features/webhooks/actions',
    class: 'A2',
    channel: 'toast',
    risk: 'N2',
  },
  testWebhookAction: {
    module: 'features/webhooks/actions',
    class: 'A3',
    channel: 'inlineBlock',
    risk: 'N1',
  },
  enableWebhookAction: {
    module: 'features/webhooks/actions',
    class: 'A3',
    channel: 'inlineBlock',
    risk: 'N1',
  },
  retryDeliveryAction: {
    module: 'features/webhooks/actions',
    class: 'A3',
    channel: 'inlineBlock',
    risk: 'N1',
  },
} as const satisfies Record<string, ActionDescriptor>;

export type ActionName = keyof typeof ACTION_CATALOG;
