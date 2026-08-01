export interface ShutdownLogger {
  info(object: Record<string, unknown>, message?: string): void;
  warn(object: Record<string, unknown>, message?: string): void;
  error(object: Record<string, unknown>, message?: string): void;
}

export interface ShutdownOptions {
  /** SHUTDOWN_GRACE_SECONDS, výchozí 25 (část 1, kapitola 3.12). */
  readonly graceSeconds: number;
  readonly logger: ShutdownLogger;
  readonly process?: NodeJS.Process;
}

export interface ShutdownController {
  register(name: string, cleanup: () => Promise<void> | void): void;
  listen(): void;
  shutdown(signal: string): Promise<void>;
  finished(): Promise<void>;
}

/**
 * Graceful shutdown pro Node procesy podle části 1, kapitoly 3.12.
 *
 * Úklidy běží v OPAČNÉM pořadí registrace, protože pozdější závisí na dřívějším
 * (HTTP server se zavírá dřív než databázový pool). Druhý signál během shutdownu
 * znamená okamžité ukončení. Po vypršení lhůty proces skončí kódem 1, aby bylo
 * v orchestrátoru vidět, že se nedojelo čistě.
 */
export function createShutdownController(options: ShutdownOptions): ShutdownController {
  const proc = options.process ?? process;
  const cleanups: { name: string; run: () => Promise<void> | void }[] = [];
  let started = false;
  let resolveFinished: () => void = () => {};
  const finishedPromise = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });

  async function shutdown(signal: string): Promise<void> {
    if (started) {
      options.logger.warn({ signal }, 'druhý signál během shutdownu, končím okamžitě');
      proc.exit(1);
      return;
    }
    started = true;
    options.logger.info({ signal, grace_seconds: options.graceSeconds }, 'graceful shutdown začal');

    let timedOut = false;
    let resolveTimeout: () => void = () => {};
    const timeoutPromise = new Promise<void>((resolve) => {
      resolveTimeout = resolve;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      options.logger.warn(
        { signal, grace_seconds: options.graceSeconds },
        'graceful shutdown nestihl lhůtu, končím vynuceně',
      );
      proc.exit(1);
      resolveFinished();
      resolveTimeout();
    }, options.graceSeconds * 1000);
    if (typeof timer.unref === 'function') timer.unref();

    // Úklidová smyčka běží proti timeoutu naparalelně (Promise.race), protože
    // `await cleanup.run()` na zaseknutém úklidu by jinak blokoval i po vypršení
    // lhůty a shutdown() by se nikdy nevrátil.
    const runCleanups = async (): Promise<void> => {
      for (const cleanup of [...cleanups].reverse()) {
        if (timedOut) break;
        try {
          await cleanup.run();
          options.logger.info({ step: cleanup.name }, 'úklid hotov');
        } catch (error) {
          options.logger.error(
            { step: cleanup.name, err: (error as Error).message },
            'úklid selhal, pokračuji dalším',
          );
        }
      }
    };

    await Promise.race([runCleanups(), timeoutPromise]);

    clearTimeout(timer);
    if (!timedOut) {
      options.logger.info({ signal }, 'graceful shutdown dokončen');
      proc.exit(0);
      resolveFinished();
    }
  }

  return {
    register(name, cleanup) {
      cleanups.push({ name, run: cleanup });
    },
    listen() {
      // SIGINT se chová stejně jako SIGTERM (část 1, kapitola 3.12).
      proc.on('SIGTERM', () => void shutdown('SIGTERM'));
      proc.on('SIGINT', () => void shutdown('SIGINT'));
    },
    shutdown,
    finished: () => finishedPromise,
  };
}
