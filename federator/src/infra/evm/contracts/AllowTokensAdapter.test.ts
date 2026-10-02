import Web3 from 'web3';

import { AllowTokensAdapter } from './AllowTokensAdapter';
import { FakeContract } from './testSupport/FakeContract';

const TOKEN = '0xA5b366e257a09DC8B5A63E97De89B5F29131DaBd';

function build(multisigOrder = 1) {
  const contract = new FakeContract();
  const adapter = new AllowTokensAdapter(new Web3(), '0xALLOW', multisigOrder, contract);
  return { adapter, contract };
}

const infoAndLimits = (allowed: boolean) => ({
  info: { allowed },
  limit: { min: '1000000000000000000', mediumAmount: '10000000000000000000', largeAmount: '100000000000000000000' },
});

describe('AllowTokensAdapter limits', () => {
  it('reads the limits as bigint', async () => {
    const { adapter, contract } = build();
    contract.on('getInfoAndLimits', infoAndLimits(true));

    expect(await adapter.getLimits(TOKEN)).toEqual({
      allowed: true,
      min: 10n ** 18n,
      mediumAmount: 10n ** 19n,
      largeAmount: 10n ** 20n,
    });
  });

  it('caches an allowed token instead of asking per transfer', async () => {
    const { adapter, contract } = build();
    contract.on('getInfoAndLimits', infoAndLimits(true));

    await adapter.getLimits(TOKEN);
    await adapter.getLimits(TOKEN);
    expect(contract.countOf('getInfoAndLimits')).toBe(1);
  });

  it('caches case-insensitively, since addresses arrive in both spellings', async () => {
    const { adapter, contract } = build();
    contract.on('getInfoAndLimits', infoAndLimits(true));

    await adapter.getLimits(TOKEN);
    await adapter.getLimits(TOKEN.toLowerCase());
    expect(contract.countOf('getInfoAndLimits')).toBe(1);
  });

  it('never caches a refusal', async () => {
    // A token can be allowed later. Caching the refusal would keep this federator rejecting it for
    // the life of the process.
    const { adapter, contract } = build();
    contract.on('getInfoAndLimits', infoAndLimits(false));

    await adapter.getLimits(TOKEN);
    await adapter.getLimits(TOKEN);
    expect(contract.countOf('getInfoAndLimits')).toBe(2);
  });
});

describe('AllowTokensAdapter confirmations', () => {
  it('multiplies each depth by this federator multisig order', async () => {
    // Each federator waits longer than the one before it, so they do not all race to propose.
    const { adapter, contract } = build(3);
    contract
      .on('smallAmountConfirmations', '4')
      .on('mediumAmountConfirmations', '8')
      .on('largeAmountConfirmations', '12');

    expect(await adapter.getConfirmations()).toEqual({
      smallAmountConfirmations: 12,
      mediumAmountConfirmations: 24,
      largeAmountConfirmations: 36,
    });
  });

  it('leaves the depths alone for the first federator', async () => {
    const { adapter, contract } = build(1);
    contract
      .on('smallAmountConfirmations', '4')
      .on('mediumAmountConfirmations', '8')
      .on('largeAmountConfirmations', '12');

    expect(await adapter.getConfirmations()).toMatchObject({ smallAmountConfirmations: 4 });
  });
});
