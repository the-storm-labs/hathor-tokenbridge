import { LogWrapper } from './logWrapper';
import { ConfigData } from './config';
import { Message, PubSub, Subscription } from '@google-cloud/pubsub';
import * as rabbitmq from 'amqplib';
import { HathorTx } from '../types/HathorTx';
import { HathorUtxo } from '../types/HathorUtxo';
import { HathorException } from '../types/HathorException';
import { BridgeFactory } from '../contracts/BridgeFactory';
import { FederationFactory } from '../contracts/FederationFactory';
import { EvmBroker } from './Broker/EvmBroker';
import { ConfigChain } from './configChain';
import { HathorBroker } from './Broker/HathorBroker';
import TransactionSender from './TransactionSender';
import { FileManagement } from '../utils/fileManagement';

export class HathorService {
  public logger: LogWrapper;
  public config: ConfigData;
  public bridgeFactory: BridgeFactory;
  public federationFactory: FederationFactory;
  public transactionSender: TransactionSender;
  protected chainConfig: ConfigChain;
  private fileManagement: FileManagement;

  private nonRetriableErrors = [
    /Invalid transaction. At least one of your inputs has already been spent./,
    /Transaction already exists/,
    /Invalid tx/,
  ];

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
    this.fileManagement = new FileManagement(config);
  }

  async sendTokensToHathor(
    senderAddress: string,
    receiverAddress: string,
    qtd: string,
    tokenAddress: string,
    txHash: string,
  ) {
    const broker = new EvmBroker(this.config, this.logger, this.bridgeFactory, this.federationFactory);
    await broker.sendTokens(senderAddress, receiverAddress, qtd, tokenAddress, txHash);
  }

  async listenToEventQueue(): Promise<void> {
    switch (this.chainConfig.eventQueueType) {
      case 'pubsub':
        this.listenToPubSubEventQueue();
        break;
      case 'rabbitmq':
        this.listenToRabbitMQEventQueue();
        break;
      case 'sqs':
        this.logger.error('AWS SQS not implemented.');
        break;
      case 'asb':
        this.logger.error('Azure Service Bus not implemented.');
        break;
    }
  }

  private async listenToRabbitMQEventQueue() {
    const queue = 'main_queue';

    try {
      const conn = await rabbitmq.connect(process.env.RABBITMQ_URL);

      if (!conn) {
        this.logger.info('Failed to connected to rabbitmq');
        return;
      }

      this.logger.info('Connected to rabbitmq');
      const channel = await conn.createChannel();
      await channel.assertQueue(queue, { deadLetterExchange: 'dlx_exchange', deadLetterRoutingKey: 'dlq_queue' });
      this.rabbitConsume(channel, queue);
    } catch (error) {
      this.logger.error(error);
    }
  }

  private rabbitConsume(channel: rabbitmq.Channel, queue: string) {
    channel.consume(queue, async (message) => {
      if (!message || message == null) {
        this.logger.error('Consumer cancelled by server');
        return;
      }

      try {
        const response = await this.parseHathorLogs(JSON.parse(message.content.toString()));
        if (response) {
          channel.ack(message);
          return;
        }
      } catch (error) {
        this.logger.error(`Fail to processing hathor event: ${error}`);
        if (error instanceof HathorException) {
          if (this.isNonRetriableError((error as HathorException).getOriginalMessage())) {
            channel.ack(message);
            return;
          }
        }
      }

      channel.reject(message, false);
    });
  }

  private async listenToPubSubEventQueue() {
    const subscription = await this.getOrCreateSubscrition();
    subscription.on('message', this.pubSubConsume);
    subscription.on('error', (error) => {
      this.logger.error(
        `Unable to subscribe to topic hathor-federator-${this.chainConfig.multisigOrder}. Make sure it exists. Error: ${error}`,
      );
    });
  }

  private async pubSubConsume(message: Message) {
    try {
      const response = await this.parseHathorLogs(JSON.parse(message.data.toString()));
      if (response) {
        message.ack();
        return;
      }
    } catch (error) {
      this.logger.error(`Fail to processing hathor event: ${error}`);
      if (error instanceof HathorException) {
        if (this.isNonRetriableError((error as HathorException).getOriginalMessage())) {
          message.ack();
          return;
        }
      }
    }
    message.nack();
  }

  private isNonRetriableError(errorMessage) {
    let isNonRetriable = false;
    for (let index = 0; index < this.nonRetriableErrors.length; index++) {
      const rgxError = this.nonRetriableErrors[index];
      if (errorMessage.match(rgxError)) {
        isNonRetriable = true;
        break;
      }
    }
    return isNonRetriable;
  }

  private async getOrCreateSubscrition(): Promise<Subscription> {
    const pubsub = new PubSub({ projectId: this.chainConfig.pubsubProjectId });

    const [subscriptions] = await pubsub.getSubscriptions();
    const subscriptionName = `projects/${this.chainConfig.pubsubProjectId}/subscriptions/hathor-federator-${this.chainConfig.multisigOrder}-sub`;
    const subscription = subscriptions.find((sub) => sub.name === subscriptionName);

    if (subscription && subscription.topic) {
      return subscription;
    }

    if (subscription) {
      await subscription.delete();
    }

    const topicName = `projects/${this.chainConfig.pubsubProjectId}/topics/hathor-federator-${this.chainConfig.multisigOrder}`;
    const [newSubscription] = await pubsub.createSubscription(topicName, subscriptionName, {
      ackDeadlineSeconds: 60,
      enableMessageOrdering: true,
      enableExactlyOnceDelivery: true,
      retryPolicy: {
        minimumBackoff: {
          seconds: 60,
        },
        maximumBackoff: {
          seconds: 120,
        },
      },
    });

    return newSubscription;
  }

  private async parseHathorLogs(event: any): Promise<boolean> {
    if (event.type !== 'wallet:new-tx') return true;

    const tx = this.castDataToTx(event.data);

    const isHathorToEvm = tx.haveCustomData();

    if (isHathorToEvm) {
      this.sendTokensToEvm(tx);
    }
  }

  castDataToTx(data): HathorTx {
    const outUtxos = data.outputs.map(
      (o) =>
        new HathorUtxo(
          o.script,
          o.token,
          o.value,
          {
            type: o.decoded?.type,
            address: o.decoded?.address,
            timelock: o.decoded?.timelock,
          },
          o.spent_by,
        ),
    );

    const inUtxos = data.inputs.map(
      (o) =>
        new HathorUtxo(o.script, o.token, o.value, {
          type: o.decoded?.type,
          address: o.decoded?.address,
          timelock: o.decoded?.timelock,
        }),
    );

    return new HathorTx(data.tx_id, data.timestamp, outUtxos, inUtxos);
  }

  async sendTokensToEvm(tx: HathorTx): Promise<boolean> {
    const broker = new HathorBroker(this.config, this.logger, this.bridgeFactory, this.federationFactory);

    const confirmed = await broker.isTxConfirmed(tx.tx_id);
    if (!confirmed) {
      return false;
    }

    const token = tx.getCustomTokenData();

    const isMulsigAddress = await broker.isMultisigAddress(token.receiverAddress);

    if (!isMulsigAddress) {
      throw Error('Not a multisig address.');
    }

    await broker.sendTokens(token.senderAddress, tx.getCustomData(), token.amount, token.tokenAddress, tx.tx_id);
    this.fileManagement._saveProgress(tx.timestamp);
    return true;
  }
}

export default HathorService;
