import { EvmBroker } from '../src/lib/Broker/EvmBroker';
import { HathorBroker } from '../src/lib/Broker/HathorBroker';
import { LogWrapper } from '../src/lib/logWrapper';
import { ConfigData } from '../src/lib/config';
import { BridgeFactory } from '../src/contracts/BridgeFactory';
import { FederationFactory } from '../src/contracts/FederationFactory';
import MetricRegister from '../src/utils/MetricRegister';
import { Registry } from 'prom-client';

// Keep parseSignatureEntry/selectCompleteSignatures real, but make the retry backoff instant so
// these tests don't actually wait SIGN_RETRY_DELAY_MS between attempts.
jest.mock('../src/lib/utils', () => ({
  ...jest.requireActual('../src/lib/utils'),
  sleep: jest.fn().mockResolvedValue(undefined),
}));

describe('Broker - signing-time signature coverage', () => {
  let broker: EvmBroker;
  let mockLogger: jest.Mocked<LogWrapper>;
  let mockConfig: ConfigData;
  let requestWallet: jest.Mock;

  // MetricRegister's Counters self-register on prom-client's global default registry on
  // construction (regardless of which Registry instance is passed in), so building it more than
  // once in the same process throws "metric already registered". Build it once and share it.
  const metricRegister = new MetricRegister(new Registry(), 'broker_test');

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      trace: jest.fn(),
      upsertContext: jest.fn(),
    } as any;

    mockConfig = {
      mainchain: { chainId: 1, host: 'http://localhost' },
      sidechain: [{ chainId: 31, multisigOrder: 1 }],
      privateKey: '0x0',
    } as any;

    const bridgeFactory = { createInstance: jest.fn() } as unknown as BridgeFactory;
    const federationFactory = { createInstance: jest.fn() } as unknown as FederationFactory;

    broker = new EvmBroker(mockConfig, mockLogger, bridgeFactory, federationFactory, metricRegister);

    // HathorWallet is a process-wide singleton; stub its requestWallet directly on the instance
    // Broker's constructor already grabbed, instead of hitting a real wallet over HTTP.
    requestWallet = jest.fn();
    (broker as any).wallet.requestWallet = requestWallet;
  });

  const completeSignature = '031e98e64228360dd2616ee5a9e1831ab07638db40383eb7352607caa20f196a84|0:aaaa|1:bbbb';
  const partialSignature = '027488f1c32779648a556541044ff6a44a4d6eb6c58df57a2037a44c3394253113|1:cccc';

  describe('getCompleteSignature', () => {
    it('returns the signature immediately when it already covers every input', async () => {
      requestWallet.mockResolvedValueOnce({ status: 200, data: { success: true, signatures: completeSignature } });

      const result = await (broker as any).getCompleteSignature('deadbeef', 2);

      expect(result).toEqual(completeSignature);
      expect(requestWallet).toHaveBeenCalledTimes(1);
    });

    it('retries after a partial signature and succeeds once a complete one arrives', async () => {
      requestWallet
        .mockResolvedValueOnce({ status: 200, data: { success: true, signatures: partialSignature } })
        .mockResolvedValueOnce({ status: 200, data: { success: true, signatures: completeSignature } });

      const result = await (broker as any).getCompleteSignature('deadbeef', 2);

      expect(result).toEqual(completeSignature);
      expect(requestWallet).toHaveBeenCalledTimes(2);
    });

    it('gives up and returns null after exhausting all retries on a persistently partial signature', async () => {
      requestWallet.mockResolvedValue({ status: 200, data: { success: true, signatures: partialSignature } });

      const result = await (broker as any).getCompleteSignature('deadbeef', 2);

      expect(result).toBeNull();
      // SIGN_RETRY_ATTEMPTS = 3
      expect(requestWallet).toHaveBeenCalledTimes(3);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Giving up for this round'));
    });

    it('treats a getMySignatures failure like a partial signature and keeps retrying', async () => {
      requestWallet
        .mockRejectedValueOnce(new Error('network blip'))
        .mockResolvedValueOnce({ status: 200, data: { success: true, signatures: completeSignature } });

      const result = await (broker as any).getCompleteSignature('deadbeef', 2);

      expect(result).toEqual(completeSignature);
      expect(requestWallet).toHaveBeenCalledTimes(2);
    });
  });

  describe('signProposal', () => {
    beforeEach(() => {
      jest.spyOn(broker as any, 'validateTx').mockResolvedValue(true);
      jest.spyOn(broker as any, 'decodeTxHex').mockResolvedValue({ inputs: [{}, {}] });
      (broker as any).hathorFederationContract = {
        getUpdateSignatureStateArgs: jest.fn().mockResolvedValue('0xargs'),
      };
      (broker as any).transactionSender = { sendTransaction: jest.fn().mockResolvedValue({ status: true }) };
    });

    it('refuses to sign on-chain when no complete signature can be obtained', async () => {
      requestWallet.mockResolvedValue({ status: 200, data: { success: true, signatures: partialSignature } });

      await (broker as any).signProposal('token', 'txHash', '1', 'sender', 'receiver', 1, 'deadbeef', 'contractTxId');

      expect((broker as any).hathorFederationContract.getUpdateSignatureStateArgs).not.toHaveBeenCalled();
      expect((broker as any).transactionSender.sendTransaction).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('refusing to submit a signature'));
    });

    it('submits on-chain once a complete signature is obtained', async () => {
      requestWallet.mockResolvedValue({ status: 200, data: { success: true, signatures: completeSignature } });

      await (broker as any).signProposal('token', 'txHash', '1', 'sender', 'receiver', 1, 'deadbeef', 'contractTxId');

      expect((broker as any).hathorFederationContract.getUpdateSignatureStateArgs).toHaveBeenCalledWith(
        'token',
        'txHash',
        '1',
        'sender',
        'receiver',
        1,
        completeSignature,
        true,
      );
      expect((broker as any).transactionSender.sendTransaction).toHaveBeenCalled();
    });
  });

  describe('fixed multisig address', () => {
    const FIXED_ADDRESS = 'WfixedMultisigAddress00000000000000';

    beforeEach(() => {
      // getFixedAddress caches per wallet-id on the (process-wide singleton) HathorWallet
      // instance; clear it so each test starts from a clean slate regardless of test order.
      (broker as any).wallet.fixedAddressCache.clear();

      jest.spyOn(broker as any, 'getTokenDecimals').mockResolvedValue(2);
      jest.spyOn(broker, 'getSideChainTokenAddress').mockResolvedValue(['destinationToken', 1]);

      requestWallet.mockImplementation((_post, _id, path) => {
        if (path === 'wallet/address') {
          return Promise.resolve({ status: 200, data: { success: true, address: FIXED_ADDRESS } });
        }
        return Promise.resolve({ status: 200, data: { success: true, txHex: 'abc123' } });
      });
    });

    it('mint-tokens pins change_address and mint_authority_address to the fixed address', async () => {
      await broker.sendEvmNativeTokenProposal('receiver', '10', 'token');

      const mintCall = requestWallet.mock.calls.find((call) => call[2] === 'wallet/p2sh/tx-proposal/mint-tokens');
      expect(mintCall).toBeDefined();
      const [, , , data] = mintCall;
      expect(data.address).toEqual('receiver'); // the real bridge recipient - must NOT be pinned
      expect(data.change_address).toEqual(FIXED_ADDRESS);
      expect(data.mint_authority_address).toEqual(FIXED_ADDRESS);
    });

    it('generic tx-proposal pins change_address to the fixed address', async () => {
      await broker.sendHathorNativeTokenProposal('receiver', '10', 'token');

      const proposalCall = requestWallet.mock.calls.find((call) => call[2] === 'wallet/p2sh/tx-proposal');
      expect(proposalCall).toBeDefined();
      const [, , , data] = proposalCall;
      expect(data.outputs[0].address).toEqual('receiver'); // real recipient, untouched
      expect(data.change_address).toEqual(FIXED_ADDRESS);
    });

    it('melt-tokens pins deposit_address, change_address, and melt_authority_address', async () => {
      const allowTokensContract = {} as any;
      const bridgeFactory = { createInstance: jest.fn() } as unknown as BridgeFactory;
      const federationFactory = { createInstance: jest.fn() } as unknown as FederationFactory;
      const hathorBroker = new HathorBroker(
        mockConfig,
        mockLogger,
        bridgeFactory,
        federationFactory,
        (broker as any).metricRegister,
        allowTokensContract,
      );
      (hathorBroker as any).wallet.requestWallet = requestWallet;
      (hathorBroker as any).wallet.fixedAddressCache.clear();

      await hathorBroker.sendEvmNativeTokenProposal('receiver', 10, 'token');

      const meltCall = requestWallet.mock.calls.find((call) => call[2] === 'wallet/p2sh/tx-proposal/melt-tokens');
      expect(meltCall).toBeDefined();
      const [, , , data] = meltCall;
      expect(data.deposit_address).toEqual(FIXED_ADDRESS);
      expect(data.change_address).toEqual(FIXED_ADDRESS);
      expect(data.melt_authority_address).toEqual(FIXED_ADDRESS);
    });

    it('reuses the cached address instead of calling wallet/address again', async () => {
      await broker.sendEvmNativeTokenProposal('receiver', '10', 'token');
      await broker.sendEvmNativeTokenProposal('receiver', '10', 'token');

      const addressCalls = requestWallet.mock.calls.filter((call) => call[2] === 'wallet/address');
      expect(addressCalls).toHaveLength(1);
    });
  });
});
