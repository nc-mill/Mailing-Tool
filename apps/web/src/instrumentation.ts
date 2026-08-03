/**
 * Next.js standalone server sám graceful shutdown nedělá. Registrace probíhá
 * tady, protože instrumentation.register() běží jednou při startu serveru.
 */
export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  const { createShutdownController } = await import('@mlain/core/shutdown');
  const { getConfig, getLogger } = await import('@/lib/runtime');

  const config = getConfig();
  const logger = getLogger();
  const controller = createShutdownController({
    graceSeconds: config.SHUTDOWN_GRACE_SECONDS,
    logger,
  });
  controller.register('http', async () => {
    logger.info({}, 'web přestává přijímat nová spojení');
  });
  controller.listen();

  // Kompoziční kořen AI (P15, úkol 39). Sestavuje se při startu, protože jeho
  // vedlejším účinkem je druhá vrstva kritéria 7b: kontrola, že klíč providera
  // nezůstal v prostředí web procesu. Vrstva, kterou nikdo nezavolá, není vrstva.
  const { getAiRuntime } = await import('@/lib/ai/runtime');
  getAiRuntime();

  /**
   * Kompoziční kořen systémové pošty. Bez tohohle řádku měl proces zapojený
   * `LoggingSystemMailer`, takže obnova hesla i pozvánka tiše zmizely a obrazovka
   * přitom hlásila „e-mail odeslán". Volá se i ve workeru (`apps/worker/src/main.ts`),
   * protože upozornění na vypnutý webhook vzniká tam.
   */
  const { installSystemMailer } = await import('@mlain/core/platform/system-mail-runtime');
  installSystemMailer();
  logger.info({}, 'systémová pošta je zapojená');

  /**
   * Vývojářský vypínač brzd přihlašování se hlásí při KAŽDÉM startu, ne až
   * u prvního přihlášení. Vypnutá ochrana, o které se mlčí, je horší než žádná.
   * Volání je idempotentní, takže druhé místo (konstrukce registru limiterů)
   * log nezdvojí.
   */
  const { warnIfLoginThrottlingDisabled } = await import('@mlain/core/identity/throttle');
  warnIfLoginThrottlingDisabled(logger, config);
}
