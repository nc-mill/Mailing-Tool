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
}
