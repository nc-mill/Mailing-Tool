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
}
