import log4js from 'log4js';

import type { LoggerPort } from '../../ports/LoggerPort';

/**
 * LoggerPort over log4js, which is what the federator already ships and what the promtail/Alloy
 * scrape config expects to find on disk.
 *
 * Configured once, by the composition root, rather than by a singleton that reads a JSON file as a
 * side effect of being imported.
 */
export function configureLogging(config: log4js.Configuration): void {
  log4js.configure(config);
}

export class Log4jsLogger implements LoggerPort {
  private readonly logger: log4js.Logger;

  constructor(category: string) {
    this.logger = log4js.getLogger(category);
  }

  trace(message: string, ...args: unknown[]): void {
    this.logger.trace(message, ...args);
  }
  debug(message: string, ...args: unknown[]): void {
    this.logger.debug(message, ...args);
  }
  info(message: string, ...args: unknown[]): void {
    this.logger.info(message, ...args);
  }
  warn(message: string, ...args: unknown[]): void {
    this.logger.warn(message, ...args);
  }
  error(message: string, ...args: unknown[]): void {
    this.logger.error(message, ...args);
  }
}

/** Flushes buffered appenders. Worth awaiting on shutdown or the last lines are lost. */
export async function shutdownLogging(): Promise<void> {
  await new Promise<void>((resolve) => log4js.shutdown(() => resolve()));
}
