import { method } from './contractAccess';
import { FakeContract } from './testSupport/FakeContract';

describe('method', () => {
  it('returns the call for a method the ABI has', async () => {
    const contract = new FakeContract().on('version', 'v4');
    expect(await method(contract, 'version').call()).toBe('v4');
  });

  it('names the contract and the method when the ABI does not have it', async () => {
    // Otherwise this is "undefined is not a function" at the moment a transfer is being processed,
    // which says nothing about which contract or which method drifted.
    const contract = new FakeContract('0xDEPLOYED');
    expect(() => method(contract, 'decimals')).toThrow(/0xDEPLOYED.*no method "decimals".*diverged/s);
  });
});
