import { Log4jsLogger, configureLogging, federatorLogging, shutdownLogging } from './Log4jsLogger';

/**
 * Captures what actually reaches an appender. Asserting through log4js rather than by spying on
 * the wrapper is what makes this test worth having: the wrapper's whole job is to hand arguments
 * across correctly.
 */
const captured: Array<{ level: string; message: string }> = [];

beforeAll(() => {
  configureLogging({
    appenders: {
      capture: {
        type: {
          configure: () => (event: { level: { levelStr: string }; data: unknown[] }) => {
            captured.push({ level: event.level.levelStr, message: event.data.join(' ') });
          },
        },
      },
    },
    categories: { default: { appenders: ['capture'], level: 'trace' } },
  });
});

afterAll(async () => {
  await shutdownLogging();
});

describe('federatorLogging', () => {
  it('writes to the configured file rather than a hardcoded path', () => {
    // The path used to be fixed at /var/log/federator.log - a volume inside the container and
    // unwritable anywhere else, so the federator could not run outside Docker at all and failed
    // at boot rather than falling back.
    const config = federatorLogging({ file: '/tmp/somewhere/else.log', level: 'info' });
    expect(config.appenders.file).toMatchObject({ type: 'file', filename: '/tmp/somewhere/else.log' });
  });

  it('logs to both the file and the console', () => {
    // The file is what the log scraper reads; the console is what `docker logs` shows.
    const config = federatorLogging({ file: '/tmp/x.log', level: 'warn' });
    expect(config.categories.default).toEqual({ appenders: ['file', 'console'], level: 'warn' });
  });

  it('rotates, so a long-running federator does not fill its volume', () => {
    const config = federatorLogging({ file: '/tmp/x.log', level: 'info' });
    expect(config.appenders.file).toMatchObject({ maxLogSize: 10_485_760, backups: 3, compress: true });
  });
});

describe('Log4jsLogger', () => {
  it('forwards every level with its message', () => {
    captured.length = 0;
    const logger = new Log4jsLogger('test');

    logger.trace('a trace');
    logger.debug('a debug');
    logger.info('an info');
    logger.warn('a warn');
    logger.error('an error');

    expect(captured).toEqual([
      { level: 'TRACE', message: 'a trace' },
      { level: 'DEBUG', message: 'a debug' },
      { level: 'INFO', message: 'an info' },
      { level: 'WARN', message: 'a warn' },
      { level: 'ERROR', message: 'an error' },
    ]);
  });

  it('passes extra arguments through rather than dropping them', () => {
    // Callers log an error object as a second argument; swallowing it would lose the stack.
    captured.length = 0;
    new Log4jsLogger('test').error('failed', new Error('boom'));

    expect(captured).toHaveLength(1);
    expect(captured[0]?.message).toContain('failed');
    expect(captured[0]?.message).toContain('boom');
  });
});
