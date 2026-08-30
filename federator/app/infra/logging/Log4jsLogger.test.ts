import { Log4jsLogger, configureLogging, shutdownLogging } from './Log4jsLogger';

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
