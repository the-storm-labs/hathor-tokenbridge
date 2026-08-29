import { HathorWallet } from '../src/lib/HathorWallet';

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
  upsertContext: jest.fn(),
} as any;

const config = { sidechain: [{ multisigSeedKey: 'default', singleSeedKey: 'default' }] } as any;

/**
 * Builds a fresh HathorWallet singleton whose `wallet/status` responses are scripted, so each
 * test can drive isReady through a specific sequence of wallet states.
 */
function buildWallet(statusCodes: number[]) {
  // The class is a singleton; drop the cached instance so tests don't share state.
  (HathorWallet as any).wallet = undefined;
  const wallet = HathorWallet.getInstance(config, logger);
  // Collapse the backoff so the retry path doesn't make the test sleep for a minute.
  (wallet as any).baseDelay = 0;

  const queue = [...statusCodes];
  const requestWallet = jest.fn(async (post: boolean, id: string, path: string) => {
    if (path === 'start') return { status: 200, data: { success: true } };
    const statusCode = queue.length > 1 ? queue.shift() : queue[0];
    return { status: 200, data: { success: true, statusCode, statusMessage: 'x' } };
  });
  (wallet as any).requestWallet = requestWallet;
  return { wallet, requestWallet };
}

describe('HathorWallet readiness gate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports ready when the wallet is already READY', async () => {
    const { wallet } = buildWallet([3]);
    await expect((wallet as any).isReady(true)).resolves.toBe(true);
  });

  it('retries through PROCESSING instead of returning undefined', async () => {
    // PROCESSING (5) used to match no branch, so isReady fell off the end and returned undefined.
    // main.ts read that as "not ready" and waited forever on an event that only isReady emits.
    const { wallet, requestWallet } = buildWallet([5, 5, 3]);
    await expect((wallet as any).isReady(true)).resolves.toBe(true);
    expect(requestWallet).toHaveBeenCalledTimes(3);
  });

  it('retries through CONNECTING and SYNCING', async () => {
    const { wallet } = buildWallet([1, 2, 3]);
    await expect((wallet as any).isReady(true)).resolves.toBe(true);
  });

  it('restarts the wallet when it reports ERROR, then reports ready', async () => {
    const { wallet, requestWallet } = buildWallet([4, 3]);
    await expect((wallet as any).isReady(true)).resolves.toBe(true);
    expect(requestWallet).toHaveBeenCalledWith(true, 'multi', 'start', expect.anything());
  });

  it('restarts the wallet when it reports CLOSED', async () => {
    const { wallet, requestWallet } = buildWallet([0, 3]);
    await expect((wallet as any).isReady(true)).resolves.toBe(true);
    expect(requestWallet).toHaveBeenCalledWith(true, 'multi', 'start', expect.anything());
  });

  it('retries on an unrecognized status rather than falling through', async () => {
    const { wallet } = buildWallet([99, 3]);
    await expect((wallet as any).isReady(true)).resolves.toBe(true);
  });

  it('never resolves undefined, even when the state never becomes ready', async () => {
    // Exhausting the retry budget must resolve to a definite false, not undefined.
    const { wallet } = buildWallet([5]);
    await expect((wallet as any).isReady(true)).resolves.toBe(false);
  });
});
