import { HathorService } from '../src/lib/HathorService';
import { LogWrapper } from '../src/lib/logWrapper';
import { ConfigData } from '../src/lib/config';
import { BridgeFactory } from '../src/contracts/BridgeFactory';
import { FederationFactory } from '../src/contracts/FederationFactory';
import TransactionSender from '../src/lib/TransactionSender';
import MetricRegister from '../src/utils/MetricRegister';
import { HathorTx } from '../src/types/HathorTx';

jest.mock('@google-cloud/pubsub');
jest.mock('amqplib');

describe('HathorService', () => {
  let hathorService: HathorService;
  let mockLogger: jest.Mocked<LogWrapper>;
  let mockConfig: ConfigData;
  let mockBridgeFactory: jest.Mocked<BridgeFactory>;
  let mockFederationFactory: jest.Mocked<FederationFactory>;
  let mockTransactionSender: jest.Mocked<TransactionSender>;
  let mockMetricRegister: jest.Mocked<MetricRegister>;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      trace: jest.fn(),
    };

    mockConfig = {
      sidechain: [{
        eventQueueType: 'pubsub',
        pubsubProjectId: 'test-project',
        multisigOrder: 1
      }]
    } as ConfigData;

    mockBridgeFactory = {
      createInstance: jest.fn()
    } as any;

    mockFederationFactory = {
      createInstance: jest.fn()
    } as any;

    mockTransactionSender = {
      send: jest.fn()
    } as any;

    mockMetricRegister = {
      increment: jest.fn(),
      timing: jest.fn()
    } as any;

    hathorService = new HathorService(
      mockConfig,
      mockLogger,
      mockBridgeFactory,
      mockFederationFactory,
      mockTransactionSender,
      mockMetricRegister,
    );
  });

  describe('isNonRetriableError', () => {
    it('should return true for known non-retriable errors', () => {
      const error = 'Invalid transaction. At least one of your inputs has already been spent.';
      expect(hathorService['isNonRetriableError'](error)).toBe(true);
    });

    it('should return false for unknown errors', () => {
      const error = 'Some random error';
      expect(hathorService['isNonRetriableError'](error)).toBe(false);
    });
    it('should return false for empty error message', () => {
      const error = '';
      expect(hathorService['isNonRetriableError'](error)).toBe(false);
    });
    
    it('should return false for null error message', () => {
      const error = null;
      expect(hathorService['isNonRetriableError'](error)).toBe(false);
    });
    it('should return false for non string error message', () => {
      const error = 1234;
      expect(hathorService['isNonRetriableError'](error)).toBe(false);
    });

  });

  describe('parseHathorLogs', () => {
    it('should return true for non wallet:new-tx events', async () => {
      const event = { type: 'other-event' };
      const result = await hathorService['parseHathorLogs'](event);
      expect(result).toBe(true);
    });

    it('should process wallet:new-tx events', async () => {
      const mockTx = {
        haveCustomData: jest.fn().mockReturnValue(true),
        getCustomData: jest.fn().mockReturnValue('data'),
        getCustomTokenData: jest.fn().mockReturnValue({
          senderAddress: '0x123',
          amount: 100,
          tokenAddress: '0x456',
        }),
      };

      jest.spyOn(hathorService, 'castDataToTx').mockReturnValue(mockTx as any);
      jest.spyOn(hathorService, 'sendTokensToEvm').mockResolvedValue(true);

      const event = {
        type: 'wallet:new-tx',
        data: {
          outputs: [],
          inputs: []
        }
      };

      const result = await hathorService['parseHathorLogs'](event);
      expect(result).toBe(true);
    });
  });

  describe('sendTokensToHathor', () => {
    it('should successfully send tokens to Hathor', async () => {
      const sendTokensSpy = jest.fn().mockResolvedValue(true);
      jest.spyOn(require('../src/lib/Broker/EvmBroker').EvmBroker.prototype, 'sendTokens')
        .mockImplementation(sendTokensSpy);

      await hathorService.sendTokensToHathor(
        '0x123',
        '0x456',
        '100',
        '0x789',
        'txHash'
      );

      expect(sendTokensSpy).toHaveBeenCalledWith(
        '0x123',
        '0x456',
        '100',
        '0x789',
        'txHash'
      );
    });
  });

  describe('castDataToTx', () => {
    it('should correctly cast data to HathorTx', () => {
      const mockData = {
        tx_id: 'test-id',
        timestamp: '123456',
        outputs: [{
          script: 'script1',
          token: 'token1',
          value: 100,
          decoded: {
            type: 'type1',
            address: 'addr1',
            timelock: 0
          },
          spent_by: 'tx1'
        }],
        inputs: [{
          script: 'script2',
          token: 'token2',
          value: 200,
          decoded: {
            type: 'type2',
            address: 'addr2',
            timelock: 0
          }
        }]
      };

      const result = hathorService.castDataToTx(mockData);
      expect(result).toBeInstanceOf(HathorTx);
      expect(result.tx_id).toBe('test-id');
      expect(result.timestamp).toBe('123456');
      expect(result.outputs).toHaveLength(1);
      expect(result.inputs).toHaveLength(1);
    });
  });
});