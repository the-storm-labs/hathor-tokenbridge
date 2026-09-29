import { toChecksumAddress } from 'web3-utils';

import { HATHOR_SYNTHETIC_LOG_INDEX, deriveEvmOriginIdentity } from './hathorOrigin';

const ADDRESS = 'WjTMMX5Rs8oinnpRQfyMuxFYYaPWEPSRPm';
const TX_ID = '000019c59eb441d208beb9a07850e73fbc9c8d1230587b55624a1ca4f0858dec';

describe('deriveEvmOriginIdentity', () => {
  it('is deterministic - every federator must derive the same id', () => {
    expect(deriveEvmOriginIdentity(ADDRESS, TX_ID, 'text')).toEqual(deriveEvmOriginIdentity(ADDRESS, TX_ID, 'text'));
  });

  it('produces a checksummed 20-byte address from a Hathor address', () => {
    const { sender } = deriveEvmOriginIdentity(ADDRESS, TX_ID, 'text');
    expect(sender).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // Round-trip through web3's own checksum, so the assertion tests the value rather than
    // the spelling this test happens to use.
    expect(sender).toBe(toChecksumAddress(sender));
  });

  it('produces a 32-byte hash to stand in for the block and transaction hashes', () => {
    expect(deriveEvmOriginIdentity(ADDRESS, TX_ID, 'text').idHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('separates different senders and different transactions', () => {
    const base = deriveEvmOriginIdentity(ADDRESS, TX_ID, 'text');
    expect(deriveEvmOriginIdentity('WdifferentAddress000000000000000000', TX_ID, 'text').sender).not.toBe(base.sender);
    expect(deriveEvmOriginIdentity(ADDRESS, `${'0'.repeat(63)}1`, 'text').idHash).not.toBe(base.idHash);
  });

  it('uses the agreed synthetic log index', () => {
    // Changing this changes every derived transaction id and orphans every in-flight transfer.
    expect(deriveEvmOriginIdentity(ADDRESS, TX_ID, 'text').logIndex).toBe(129);
    expect(HATHOR_SYNTHETIC_LOG_INDEX).toBe(129);
  });

  // Pinned against Arbitrum Sepolia: the 2-of-3 testnet's first melt (hUSDC back to tUSDC).
  // Its Voted events carry 0x5544…, which is the text hash - the bug this guards against - while
  // the pre-rearchitecture federator, and hathor-functions, derive the bytes hash for a melt.
  describe('pinned ids', () => {
    const MELT_SENDER = 'WSU3yq3f7r31JsiPHe1jPwE5zVv3BQCxnS';
    const MELT_TX_ID = '00d40d1b327748dc3c289bf6411afa75709ed12eae11659f863bd2d2ac86b78e';

    it('hashes a melt over the decoded bytes of its transaction id', () => {
      expect(deriveEvmOriginIdentity(MELT_SENDER, MELT_TX_ID, 'bytes').idHash).toBe(
        '0x0b702c3dd17f372ee5e72d72951d48e515224e95e3c8c9e8247c05a1726292e9',
      );
    });

    it('hashes a Hathor-native transfer over the text of its transaction id', () => {
      expect(deriveEvmOriginIdentity(MELT_SENDER, MELT_TX_ID, 'text').idHash).toBe(
        '0x5544efa8a88afeca9d664510791f2d1114655fab3f69ed386c9ab0bafbdd3855',
      );
    });

    it('does not care whether the id arrives with a 0x', () => {
      for (const encoding of ['bytes', 'text'] as const) {
        expect(deriveEvmOriginIdentity(MELT_SENDER, `0x${MELT_TX_ID}`, encoding)).toEqual(
          deriveEvmOriginIdentity(MELT_SENDER, MELT_TX_ID, encoding),
        );
      }
    });

    it('keeps the case of the Hathor address it hashes', () => {
      expect(deriveEvmOriginIdentity(MELT_SENDER, MELT_TX_ID, 'bytes').sender).toBe(
        '0xB8498C013D4F953F6c3840773Ed2B761Eb212929',
      );
    });
  });
});
