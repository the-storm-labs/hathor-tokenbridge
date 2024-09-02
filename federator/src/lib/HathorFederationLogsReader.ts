/* eslint-disable prefer-const */
import { BridgeFactory, FederationFactory, HathorFederationFactory, IHathorFederationV1 } from '../contracts';
import { TransactionTypes } from '../types';
import { Broker, EvmBroker, HathorBroker } from './Broker';
import { ConfigData } from './config';
import { ConfigChain } from './configChain';
import { LogWrapper } from './logWrapper';
import TransactionSender from './TransactionSender';

export class HathorFederationLogsReader {
  public logger: LogWrapper;
  public config: ConfigData;
  public bridgeFactory: BridgeFactory;
  public federationFactory: FederationFactory;
  public transactionSender: TransactionSender;
  protected hathorFederationContract: IHathorFederationV1;
  protected chainConfig: ConfigChain;
  counter: number;

  constructor(
    config: ConfigData,
    logger: LogWrapper,
    bridgeFactory: BridgeFactory,
    federationFactory: FederationFactory,
    transactionSender: TransactionSender,
  ) {
    this.config = config;
    this.logger = logger;
    this.chainConfig = config.sidechain[0];
    this.bridgeFactory = bridgeFactory;
    this.federationFactory = federationFactory;
    this.transactionSender = transactionSender;

    this.hathorFederationContract = new HathorFederationFactory().createInstance() as IHathorFederationV1;
    this.counter = 0;
    console.log(`Counter: ${this.counter}`);
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
            this.transactionSender,
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
        console.log(`Unhandled event type: ${event.event}`);
        console.log(event.returnValues);
    }

    if (!result) {
      return;
    }

    let broker: Broker;

    console.log(`Counter: ${this.counter}`);
    this.counter += 1;

    switch (Number.parseInt(result.transactionType)) {
      case TransactionTypes.MINT:
      case TransactionTypes.TRANSFER:
        broker = new EvmBroker(
          this.config,
          this.logger,
          this.bridgeFactory,
          this.federationFactory,
          this.transactionSender,
        );
        break;
      case TransactionTypes.MELT:
        broker = new HathorBroker(
          this.config,
          this.logger,
          this.bridgeFactory,
          this.federationFactory,
          this.transactionSender,
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
    console.log('ProposalSigned Event:');
    console.log(`Transaction ID: ${transactionId}`);
    console.log(`Original Token Address: ${originalTokenAddress}`);
    console.log(`Transaction Hash: ${transactionHash}`);
    console.log(`Value: ${value}`);
    console.log(`Sender: ${sender}`);
    console.log(`Receiver: ${receiver}`);
    console.log(`Transaction Type: ${transactionType}`);
    console.log(`Member: ${member}`);
    console.log(`Signed: ${signed}`);
    console.log(`Signature: ${signature}`);

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
    console.log('ProposalSent Event:');
    console.log(`Transaction ID: ${transactionId}`);
    console.log(`Original Token Address: ${originalTokenAddress}`);
    console.log(`Transaction Hash: ${transactionHash}`);
    console.log(`Value: ${value}`);
    console.log(`Sender: ${sender}`);
    console.log(`Receiver: ${receiver}`);
    console.log(`Transaction Type: ${transactionType}`);
    console.log(`Processed: ${processed}`);
    console.log(`Hathor Tx ID: ${hathorTxId}`);

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
    console.log('TransactionProposed Event:');
    console.log(`Transaction ID: ${transactionId}`);
    console.log(`Original Token Address: ${originalTokenAddress}`);
    console.log(`Transaction Hash: ${transactionHash}`);
    console.log(`Value: ${value}`);
    console.log(`Sender: ${sender}`);
    console.log(`Receiver: ${receiver}`);
    console.log(`Transaction Type: ${transactionType}`);
    console.log(`Transaction Hex: ${txHex}`);

    return { transactionId, txHex, originalTokenAddress, transactionHash, value, sender, receiver, transactionType };
  }

  handleTransactionFailed(event) {
    let { transactionId, originalTokenAddress, transactionHash, value, sender, receiver, transactionType } =
      event.returnValues;

    if (transactionType != TransactionTypes.MELT) {
      originalTokenAddress = this.hathorFederationContract.getAddress(originalTokenAddress);
    }
    console.log('TransactionFailed Event:');
    console.log(`Transaction ID: ${transactionId}`);
    console.log(`Original Token Address: ${originalTokenAddress}`);
    console.log(`Transaction Hash: ${transactionHash}`);
    console.log(`Value: ${value}`);
    console.log(`Sender: ${sender}`);
    console.log(`Receiver: ${receiver}`);
    console.log(`Transaction Type: ${transactionType}`);

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

      console.log(`Fetching events from block ${fromBlock} to ${toBlock}`);

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
        console.error(`Error fetching events from block ${fromBlock} to ${toBlock}:`, error);
      }

      currentBlock += batchSize;
    }
  }
}
