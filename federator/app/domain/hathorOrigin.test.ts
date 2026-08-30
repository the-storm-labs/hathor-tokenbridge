import { HATHOR_SYNTHETIC_LOG_INDEX, deriveEvmOriginIdentity } from './hathorOrigin';

const ADDRESS = 'WjTMMX5Rs8oinnpRQfyMuxFYYaPWEPSRPm';
const TX_ID = '000019c59eb441d208beb9a07850e73fbc9c8d1230587b55624a1ca4f0858dec';

describe('deriveEvmOriginIdentity', () => {
  it('is deterministic - every federator must derive the same id', () => {
    expect(deriveEvmOriginIdentity(ADDRESS, TX_ID)).toEqual(deriveEvmOriginIdentity(ADDRESS, TX_ID));
  });

  it('produces a checksummed 20-byte address from a Hathor address', () => {
    const { sender } = deriveEvmOriginIdentity(ADDRESS, TX_ID);
    expect(sender).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(sender).toBe(toChecksummed(sender));
  });

  it('produces a 32-byte hash to stand in for the block and transaction hashes', () => {
    expect(deriveEvmOriginIdentity(ADDRESS, TX_ID).idHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('separates different senders and different transactions', () => {
    const base = deriveEvmOriginIdentity(ADDRESS, TX_ID);
    expect(deriveEvmOriginIdentity('WdifferentAddress000000000000000000', TX_ID).sender).not.toBe(base.sender);
    expect(deriveEvmOriginIdentity(ADDRESS, `${'0'.repeat(63)}1`).idHash).not.toBe(base.idHash);
  });

  it('uses the agreed synthetic log index', () => {
    // Changing this changes every derived transaction id and orphans every in-flight transfer.
    expect(deriveEvmOriginIdentity(ADDRESS, TX_ID).logIndex).toBe(129);
    expect(HATHOR_SYNTHETIC_LOG_INDEX).toBe(129);
  });
});

/** Round-trips through web3's checksum so the assertion tests the value, not the spelling. */
function toChecksummed(address: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { toChecksumAddress } = require('web3-utils') as { toChecksumAddress: (a: string) => string };
  return toChecksumAddress(address);
}
