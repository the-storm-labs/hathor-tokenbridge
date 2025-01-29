/* eslint-disable prefer-const */
import { BridgeFactory, FederationFactory, HathorFederationFactory, IHathorFederationV1 } from '../contracts';
import { TransactionTypes } from '../types';
import { Broker, EvmBroker, HathorBroker } from './Broker';
import { ConfigData } from './config';
import { ConfigChain } from './configChain';
import { LogWrapper } from './logWrapper';
import { MetricCollector } from './MetricCollector';
import TransactionSender from './TransactionSender';

export class HathorFederationLogsReader {
  public logger: LogWrapper;
  public config: ConfigData;
  public bridgeFactory: BridgeFactory;
  public federationFactory: FederationFactory;
  public transactionSender: TransactionSender;
  protected hathorFederationContract: IHathorFederationV1;
  protected chainConfig: ConfigChain;
  private metricCollector: MetricCollector;

  constructor(
    config: ConfigData,
    logger: LogWrapper,
    bridgeFactory: BridgeFactory,
    federationFactory: FederationFactory,
    transactionSender: TransactionSender,
    metricCollector: MetricCollector,
  ) {
    this.config = config;
    this.logger = logger;
    this.chainConfig = config.sidechain[0];
    this.bridgeFactory = bridgeFactory;
    this.federationFactory = federationFactory;
    this.transactionSender = transactionSender;
    this.metricCollector = metricCollector;

    this.hathorFederationContract = new HathorFederationFactory().createInstance() as IHathorFederationV1;
  }
  // Function to handle different event types
  async handleEvent(event) {
    let result;

    switch (event.event) {
      case 'ProposalSigned':
        result = this.handleProposalSigned(event);
        break;
      case 'ProposalSent':
        result = this.handleProposalSent(event);
        if (result.transactionType == TransactionTypes.MELT) {
          new HathorBroker(
            this.config,
            this.logger,
            this.bridgeFactory,
            this.federationFactory,
            this.metricCollector,
          ).postProcessing(
            result.sender,
            result.receiver,
            result.value,
            result.originalTokenAddress,
            result.transactionHash,
          );
        }
        return;
      case 'TransactionFailed':
        result = this.handleTransactionFailed(event);
        break;
      case 'TransactionProposed':
        result = this.handleTransactionProposed(event);
        break;
      default:
        this.logger.info(`Unhandled event type: ${event.event}`);
        this.logger.info(event.returnValues);
    }

    if (!result) {
      return;
    }

    let broker: Broker;

    switch (Number.parseInt(result.transactionType)) {
      case TransactionTypes.MINT:
      case TransactionTypes.TRANSFER:
        broker = new EvmBroker(
          this.config,
          this.logger,
          this.bridgeFactory,
          this.federationFactory,
          this.metricCollector,
        );
        break;
      case TransactionTypes.MELT:
        broker = new HathorBroker(
          this.config,
          this.logger,
          this.bridgeFactory,
          this.federationFactory,
          this.metricCollector,
        );
        break;
    }

    await broker.sendTokens(
      result.sender,
      result.receiver,
      result.value,
      result.originalTokenAddress,
      result.transactionHash,
      result.transactionType,
      result.transactionType != TransactionTypes.TRANSFER,
    );
  }

  async handleLockEvent(event) {
    let { txHex } = event.returnValues;

    txHex = (txHex as string).substring(2);
    this.logger.info(
      `LockTransactionHex Event:
       Transaction Hex: ${txHex}`,
    );

    const broker = new EvmBroker(
      this.config,
      this.logger,
      this.bridgeFactory,
      this.federationFactory,
      this.metricCollector,
    );

    await broker.hathorLockProposalInputs(txHex);
  }

  // Example handler for 'ProposalSigned' event
  handleProposalSigned(event) {
    let {
      transactionId,
      member,
      signed,
      signature,
      originalTokenAddress,
      transactionHash,
      value,
      sender,
      receiver,
      transactionType,
    } = event.returnValues;
    if (transactionType != TransactionTypes.MELT) {
      originalTokenAddress = this.hathorFederationContract.getAddress(originalTokenAddress);
    }
    this.logger.info(
      `ProposalSigned Event:
       Transaction ID: ${transactionId}
       Original Token Address: ${originalTokenAddress}
       Transaction Hash: ${transactionHash}
       Value: ${value}
       Sender: ${sender}
       Receiver: ${receiver}
       Transaction Type: ${transactionType}
       Member: ${member}
       Signed: ${signed}
       Signature: ${signature}`,
    );

    return {
      transactionId,
      member,
      signed,
      signature,
      originalTokenAddress,
      transactionHash,
      value,
      sender,
      receiver,
      transactionType,
    };
  }

  // Example handler for 'ProposalSent' event
  handleProposalSent(event) {
    let {
      transactionId,
      processed,
      originalTokenAddress,
      transactionHash,
      value,
      sender,
      receiver,
      transactionType,
      hathorTxId,
    } = event.returnValues;
    if (transactionType != TransactionTypes.MELT) {
      originalTokenAddress = this.hathorFederationContract.getAddress(originalTokenAddress);
    }
    this.logger.info(
      `ProposalSent Event:
       Transaction ID: ${transactionId}
       Original Token Address: ${originalTokenAddress}
       Transaction Hah: ${transactionHash}
       Value: ${value}
       Sender: ${sender}
       Receiver: ${receiver}
       Transaction Type: ${transactionType}
       Processed: ${processed}
       Hathor Tx ID: ${hathorTxId}`,
    );

    return {
      transactionId,
      processed,
      originalTokenAddress,
      transactionHash,
      value,
      sender,
      receiver,
      transactionType,
      hathorTxId,
    };
  }

  // Example handler for 'TransactionProposed' event
  handleTransactionProposed(event) {
    let { transactionId, txHex, originalTokenAddress, transactionHash, value, sender, receiver, transactionType } =
      event.returnValues;

    if (transactionType != TransactionTypes.MELT) {
      originalTokenAddress = this.hathorFederationContract.getAddress(originalTokenAddress);
    }
    txHex = (txHex as string).substring(2);
    this.logger.info(
      `TransactionProposed Event:
       Transaction ID: ${transactionId}
       Original Token Address: ${originalTokenAddress}
       Transaction Hash: ${transactionHash}
       Value: ${value}
       Sender: ${sender}
       Receiver: ${receiver}
       Transaction Type: ${transactionType}
       Transaction Hex: ${txHex}`,
    );

    return { transactionId, txHex, originalTokenAddress, transactionHash, value, sender, receiver, transactionType };
  }

  handleTransactionFailed(event) {
    let { transactionId, originalTokenAddress, transactionHash, value, sender, receiver, transactionType } =
      event.returnValues;

    if (transactionType != TransactionTypes.MELT) {
      originalTokenAddress = this.hathorFederationContract.getAddress(originalTokenAddress);
    }
    this.logger.info(
      `TransactionFailed Event: \n
       Transaction ID: ${transactionId} \n
       Original Token Address: ${originalTokenAddress} \n
       Transaction Hash: ${transactionHash} \n
       Value: ${value} \n
       Sender: ${sender} \n
       Receiver: ${receiver} \n
       Transaction Type: ${transactionType}`,
    );

    return {
      transactionId,
      originalTokenAddress,
      transactionHash,
      value,
      sender,
      receiver,
      transactionType,
    };
  }

  // Function to fetch and process events in batches
  async fetchEventsInBatches(startBlock, endBlock, batchSize) {
    let currentBlock = startBlock;

    while (currentBlock <= endBlock) {
      const fromBlock = currentBlock;
      const toBlock = Math.min(currentBlock + batchSize - 1, endBlock);

      this.logger.info(`Fetching events from block ${fromBlock} to ${toBlock}`);

      try {
        const events = await this.hathorFederationContract.getPastEvents('allEvents', {
          fromBlock: fromBlock,
          toBlock: toBlock,
        });

        // Process each event using the handleEvent function
        for (const event of events) {
          await this.handleEvent(event);
        }
      } catch (error) {
        this.logger.error(`Error fetching events from block ${fromBlock} to ${toBlock}:`, error);
      }

      currentBlock += batchSize;
    }
  }

  async fetchLockEventsInBatches(this: HathorFederationLogsReader, startBlock, endBlock, batchSize) {
    let currentBlock = startBlock;

    while (currentBlock <= endBlock) {
      const fromBlock = currentBlock;
      const toBlock = Math.min(currentBlock + batchSize - 1, endBlock);

      this.logger.info(`Fetching lock events from block ${fromBlock} to ${toBlock}`);

      try {
        const events = await this.hathorFederationContract.getPastEvents('LockTransactionHex', {
          fromBlock: fromBlock,
          toBlock: toBlock,
        });

        // Process each event using the handleEvent function
        for (const event of events) {
          await this.handleLockEvent(event);
        }
      } catch (error) {
        this.logger.error(`Error fetching lock events from block ${fromBlock} to ${toBlock}:`, error);
      }

      currentBlock += batchSize;
    }
  }
}
