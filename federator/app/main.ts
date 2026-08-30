import dotenv from 'dotenv';

import { buildFederator } from './composition/container';
import { ConfigError, loadConfig } from './config/load';
import { Log4jsLogger, configureLogging, federatorLogging, shutdownLogging } from './infra/logging/Log4jsLogger';

/**
 * The federator's entry point.
 *
 * Boot order matters and is explicit: configuration, then logging, then the wallet, and only then
 * the schedulers. The readers depend on a wallet that can answer, and starting them first means a
 * first run that fails for no reason other than being early.
 *
 * Nothing here ends a RUNNING federator. The process owns a MemoryStore that is rebuilt from
 * scratch on every start, so exiting is expensive, and a scheduled run failing is not a reason to
 * pay for it - the Scheduler absorbs those. What does end the process is a failure to boot at all,
 * which is a configuration problem a restart will not fix, and a signal - and in both of those the
 * exit is explicit, because a third-party import-time timer would otherwise keep it alive.
 */
async function main(): Promise<void> {
  dotenv.config();

  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    // Logging is not configured yet, and a configuration error has to reach the operator whatever
    // state the rest of the process is in.
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write(`Failed to read configuration: ${String(error)}\n`);
    }
    // Exit rather than returning: importing wallet-lib starts a self-renewing timer at module
    // load, so the event loop stays alive and the process would hang here forever instead of
    // reporting a configuration error and stopping. See the shutdown path for the same reason.
    process.exit(1);
  }

  configureLogging(federatorLogging({ file: config.runtime.logFile, level: config.runtime.logLevel }));
  const logger = new Log4jsLogger('MAIN');

  logger.info(
    `Starting federator ${config.federator.address} at multisig order ${config.hathor.multisig.order}, ` +
      `bridging ${config.evm.name} (${config.evm.chainId}) and ${config.hathor.name}.`,
  );

  const federator = buildFederator(config);

  await federator.health.start();

  // The wallet first: a cold start rebuilds the whole Hathor history, and the readers have nothing
  // useful to do until it can answer.
  await federator.hathorService.start();

  for (const scheduler of federator.schedulers) {
    scheduler.start();
  }

  logger.info('Federator is running.');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.info(`Received ${signal}; shutting down.`);
    // Stop scheduling before stopping the wallet: a run halfway through a proposal still needs it.
    await Promise.all(federator.schedulers.map((scheduler) => scheduler.stop()));
    await federator.hathorService.stop();
    await federator.health.stop();
    await shutdownLogging();

    // Explicit, and only once shutdown has finished. @hathor/wallet-lib schedules a self-renewing
    // timer when it is imported, which nothing in its public surface clears - so a federator that
    // merely stopped its own work would still never exit, and every `docker stop` would end in a
    // SIGKILL after the grace period.
    process.exit(0);
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => void shutdown(signal));
  }

  // A rejection nothing handled is a bug, not a reason to discard a synced wallet. Report it and
  // keep running; the alternative is a resync every time an RPC call is dropped.
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection. The federator stays up.', reason);
  });
}

void main().catch((error) => {
  process.stderr.write(`Federator failed to start: ${String(error)}\n`);
  // Explicit for the same reason as above: wallet-lib's import-time timer keeps the event loop
  // alive, so setting an exit code alone leaves a failed boot hanging instead of reporting it.
  process.exit(1);
});
