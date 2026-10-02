import { systemClock } from './SystemClock';

describe('systemClock', () => {
  it('reports the current time', () => {
    const before = Date.now();
    const now = systemClock.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('actually waits', async () => {
    const before = Date.now();
    await systemClock.sleep(20);
    expect(Date.now() - before).toBeGreaterThanOrEqual(15);
  });
});
