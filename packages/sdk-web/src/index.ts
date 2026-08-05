import { ConsentGate, type ConsentState } from './consent';
import { Emitter, type SdkEventName } from './emitter';
import { PageTracker, type PageProperties } from './page';
import { EventQueue, type QueuedEvent } from './queue';
import { Session } from './session';
import { Storage } from './storage';
import { takeIdentityToken, sendIdentityToken } from './ml-token';
import { uuidv4 } from './uuid';

const EVENT_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
const PII_TRAIT_KEYS = ['email', 'e_mail', 'phone', 'tel', 'telefon'];

export type InitOptions = {
  key: string;
  host: string;
  // ODCHYLKA OD PLÁNU: volitelné položky mají v typu i undefined kvůli
  // exactOptionalPropertyTypes, jinak je nejde přeposlat dál.
  autoPageView?: boolean | undefined;
  consent?: ConsentState | undefined;
  sessionTimeoutMinutes?: number | undefined;
  debug?: boolean | undefined;
};

export type SdkRuntimeOptions = {
  fetchImpl?: typeof fetch | undefined;
  sendBeacon?: ((url: string, data: Blob) => boolean) | undefined;
};

export function createSdk(runtime: SdkRuntimeOptions = {}) {
  const storage = new Storage();
  const emitter = new Emitter();
  const gate = new ConsentGate();
  const pages = new PageTracker();

  let options: InitOptions | null = null;
  let queue: EventQueue | null = null;
  let session: Session | null = null;
  let pendingToken: string | null = null;

  const log = (...args: unknown[]): void => {
    // ODCHYLKA OD PLÁNU: console.error místo console.warn. Sdílené pravidlo
    // no-console v monorepu povoluje jen console.error a konfigurace lintu
    // se kvůli jednomu balíčku měnit nebude. Vypisuje se stejně jen v debug režimu.
    if (options?.debug === true) console.error('[mlain]', ...args);
  };

  const enqueue = (
    name: string,
    properties: Record<string, unknown>,
    page?: Record<string, unknown>,
  ): void => {
    const now = Date.now();
    const event: QueuedEvent = {
      id: uuidv4(),
      name,
      occurred_at: new Date(now).toISOString(),
      properties,
      context: {
        locale: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        screen: { w: window.screen.width, h: window.screen.height },
        viewport: { w: window.innerWidth, h: window.innerHeight },
      },
    };
    if (page !== undefined) event.page = page;

    // Souhlas je vstupní podmínka. Bez něj se drží jen v paměti.
    if (!gate.isGranted()) {
      gate.hold(event);
      return;
    }

    const current = session!.current(now);
    if (current.started) {
      queue!.push({
        id: uuidv4(),
        name: 'session_started',
        occurred_at: new Date(now).toISOString(),
        session_id: current.id,
        properties: { referrer: document.referrer, entry_path: window.location.pathname },
        context: {},
      });
    }
    event.session_id = current.id;
    queue!.push(event);
  };

  const emitPageView = (overrides: PageProperties = {}): void => {
    const page = pages.describe(overrides);
    if (!pages.shouldEmit(String(page.path), Date.now())) return;
    enqueue('page_view', {}, page);
  };

  const api = {
    init(input: InitOptions): void {
      options = { autoPageView: true, ...input };
      session = new Session(storage, input.sessionTimeoutMinutes);
      queue = new EventQueue({
        host: input.host,
        key: input.key,
        storage,
        emitter,
        anonymousId: () => storage.readAnonymousId(),
        sendBeacon: runtime.sendBeacon,
        fetchImpl: runtime.fetchImpl,
      });

      // Token se přečte a z adresy odstraní hned, i než přijde souhlas.
      pendingToken = takeIdentityToken();

      if (input.consent !== undefined) api.consent(input.consent);
      emitter.emit('ready');
    },

    consent(state: ConsentState): void {
      const released = gate.grant(state);

      if (!gate.isGranted()) {
        // Odvolání je okamžité a idempotentní.
        storage.clear();
        pendingToken = null;
        return;
      }

      const anonymousId = storage.ensureAnonymousId();
      queue!.attachLifecycleHandlers();
      queue!.replayStoredQueue();

      for (const held of released) queue!.push(held as QueuedEvent);

      if (options?.autoPageView !== false) {
        emitPageView();
        pages.observe(() => emitPageView());
      }

      // Vazba na kontakt vyžaduje souhlas s personalizací, ne jen se sběrem.
      if (pendingToken !== null && gate.allowsPersonalization()) {
        void sendIdentityToken({
          host: options!.host,
          key: options!.key,
          anonymousId,
          token: pendingToken,
          fetchImpl: runtime.fetchImpl ?? fetch,
          onIdentified: () => emitter.emit('identified'),
        });
      }
      pendingToken = null;
    },

    track(name: string, properties: Record<string, unknown> = {}): void {
      if (!EVENT_NAME_RE.test(name)) {
        log('neplatné jméno události, zahazuji', name);
        return;
      }
      enqueue(name, properties);
    },

    page(properties: PageProperties = {}): void {
      emitPageView(properties);
    },

    identify(
      externalId: string,
      traits: Record<string, unknown> = {},
      identifyOptions: { signature?: string | undefined } = {},
    ): void {
      const hasPii = Object.keys(traits).some((key) => PII_TRAIT_KEYS.includes(key.toLowerCase()));
      if (hasPii && identifyOptions.signature === undefined) {
        // E-mail z prohlížeče bez serverového podpisu se ani neodešle.
        log('identify s osobním údajem vyžaduje serverový podpis');
        emitter.emit('error', { code: 'tracking_identify_unsigned_pii' });
        return;
      }
      enqueue('identify', {
        external_id: externalId,
        traits,
        signature: identifyOptions.signature,
      });
    },

    reset(): void {
      storage.clear();
      if (gate.isGranted()) storage.ensureAnonymousId();
    },

    getAnonymousId(): string | null {
      return storage.readAnonymousId();
    },

    async flush(): Promise<void> {
      await queue?.flush();
    },

    on(event: SdkEventName, handler: (payload: unknown) => void): () => void {
      return emitter.on(event, handler);
    },

    /** Přehraje frontu window.Mlain.q, aby šlo volat API dřív, než se skript načte. */
    bootstrap(): void {
      const global = window as unknown as { Mlain?: { q?: unknown[][] } };
      const pending = global.Mlain?.q ?? [];
      for (const [method, ...args] of pending) {
        const fn = (api as unknown as Record<string, (...a: unknown[]) => unknown>)[String(method)];
        if (typeof fn === 'function') {
          try {
            fn(...args);
          } catch (error) {
            log('chyba ve frontě', error);
          }
        }
      }
      global.Mlain = api as never;
    },
  };

  return api;
}

// Automatický start při načtení jako <script src>.
if (typeof window !== 'undefined') {
  createSdk().bootstrap();
}
