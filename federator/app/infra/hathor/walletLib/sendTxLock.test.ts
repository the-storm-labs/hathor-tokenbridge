import { SendTxLock } from './sendTxLock';

/** Resolves only when told to, so ordering can be observed rather than raced. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SendTxLock', () => {
  it('runs a single operation immediately', async () => {
    const lock = new SendTxLock();
    expect(await lock.run(async () => 'done')).toBe('done');
  });

  it('does not start the second operation until the first has finished', async () => {
    // The point of the lock: two proposals built concurrently can select the same UTXO before
    // either has marked it, leaving the second unspendable.
    const lock = new SendTxLock();
    const first = deferred();
    const order: string[] = [];

    const a = lock.run(async () => {
      order.push('a:start');
      await first.promise;
      order.push('a:end');
    });
    const b = lock.run(async () => {
      order.push('b:start');
    });

    await Promise.resolve();
    expect(order).toEqual(['a:start']);

    first.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start']);
  });

  it('keeps the queue moving after an operation fails', async () => {
    // One failed push must not wedge every proposal queued behind it.
    const lock = new SendTxLock();
    const failing = lock.run(async () => {
      throw new Error('push failed');
    });

    await expect(failing).rejects.toThrow('push failed');
    expect(await lock.run(async () => 'still works')).toBe('still works');
  });

  it('propagates each operation own result and error', async () => {
    const lock = new SendTxLock();
    const results = await Promise.allSettled([
      lock.run(async () => 1),
      lock.run(async () => {
        throw new Error('two failed');
      }),
      lock.run(async () => 3),
    ]);

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect((results[0] as PromiseFulfilledResult<number>).value).toBe(1);
    expect((results[2] as PromiseFulfilledResult<number>).value).toBe(3);
  });

  it('preserves submission order across many operations', async () => {
    const lock = new SendTxLock();
    const order: number[] = [];

    await Promise.all(
      [0, 1, 2, 3, 4].map((index) =>
        lock.run(async () => {
          // A varying delay would reorder these if they were not serialised.
          await new Promise((resolve) => setTimeout(resolve, (5 - index) * 2));
          order.push(index);
        }),
      ),
    );

    expect(order).toEqual([0, 1, 2, 3, 4]);
  });
});
