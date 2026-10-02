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

export interface LoggingOptions {
  /**
   * Where the log file goes. The path was hardcoded to /var/log/federator.log, which is a mounted
   * volume inside the container and unwritable anywhere else - so the federator could not be run
   * outside Docker at all, and failed at boot rather than falling back.
   */
  readonly file: string;
  readonly level: string;
}

/**
 * The federator's logging setup: a rotating file for the log scraper, and the console for
 * `docker logs`. Built here rather than read from a JSON file, so the path can come from the
 * environment like everything else.
 */
export function federatorLogging(options: LoggingOptions): log4js.Configuration {
  return {
    appenders: {
      file: {
        type: 'file',
        filename: options.file,
        maxLogSize: 10_485_760,
        backups: 3,
        compress: true,
        keepFileExt: true,
      },
      console: { type: 'console' },
    },
    categories: { default: { appenders: ['file', 'console'], level: options.level } },
  };
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
