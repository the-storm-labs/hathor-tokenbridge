import dotenv from 'dotenv';

import { buildFederator } from './composition/container';
import { ConfigError, loadConfig } from './config/load';
import { Log4jsLogger, configureLogging, shutdownLogging } from './infra/logging/Log4jsLogger';
import logConfig from '../config/log-config.json';

/**
 * The federator's entry point.
 *
 * Boot order matters and is explicit: configuration, then logging, then the wallet, and only then
 * the schedulers. The readers depend on a wallet that can answer, and starting them first means a
 * first run that fails for no reason other than being early.
 *
 * Nothing here calls process.exit on a running federator. The process owns a MemoryStore that is
 * rebuilt from scratch on every start, so exiting is expensive, and a scheduled run failing is not
 * a reason to pay for it - the Scheduler absorbs those. What does end the process is a failure to
 * boot at all, which is a configuration problem a restart will not fix, and a signal.
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
    process.exitCode = 1;
    return;
  }

  configureLogging(logConfig);
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
    process.exitCode = 0;
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
  process.exitCode = 1;
});
