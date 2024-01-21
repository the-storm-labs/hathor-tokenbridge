// import axiosCurlirize from 'axios-curlirize';
import axios from 'axios';
import { LogWrapper } from './logWrapper';
import { ConfigData } from './config';
import { PubSub } from '@google-cloud/pubsub';
import { HathorTx } from '../types/HathorTx';
import { HathorUtxo } from '../types/HathorUtxo';
import { HathorException } from '../types/HathorException';
import { BridgeFactory } from '../contracts/BridgeFactory';
import { FederationFactory } from '../contracts/FederationFactory';
import { EvmBroker } from './Broker/EvmBroker';
import { Broker } from './Broker/Broker';
import { HathorResponse, StatusResponse } from '../types/HathorResponseTypes';
import { ConfigChain } from './configChain';
import { HathorBroker } from './Broker/HathorBroker';

// axiosCurlirize(axios);

export class HathorWallet {
  public logger: LogWrapper;
  public config: ConfigData;
  public bridgeFactory: BridgeFactory;
  public federationFactory: FederationFactory;
  protected chainConfig: ConfigChain;

  private WALLET_STATUS_CONNECTING = 1;
  private WALLET_STATUS_SYNCING = 2;
  private WALLET_STATUS_READY = 3;
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
  ) {
    this.config = config;
    this.logger = logger;
    this.chainConfig = config.sidechain[0];
    this.bridgeFactory = bridgeFactory;
    this.federationFactory = federationFactory;
  }

  async sendTokensToHathor(receiverAddress: string, qtd: string, tokenAddress: string, txHash: string) {
    if (this.chainConfig.multisigOrder > 1) return;

    await this.isWalletReady(true);
    await this.isWalletReady(false);

    const broker = new EvmBroker(this.config, this.logger, this.bridgeFactory, this.federationFactory);
    await broker.sendTokensToHathor(receiverAddress, qtd, tokenAddress, txHash);
  }

  async listenToEventQueue(): Promise<void> {
    await this.isWalletReady(true);
    switch (this.chainConfig.eventQueueType) {
      case 'pubsub':
        this.listenToPubSubEventQueue();
        break;
      case 'sqs':
        this.logger.error('AWS SQS not implemented.');
        break;
      case 'asb':
        this.logger.error('Azure Service Bus not implemented.');
        break;
    }
  }

  private async listenToPubSubEventQueue() {
    const pubsub = new PubSub({ projectId: this.chainConfig.pubsubProjectId });

    const [subscriptions] = await pubsub.getSubscriptions();
    const subscription = subscriptions.find(
      (sub) =>
        sub.name ===
        `projects/${this.chainConfig.pubsubProjectId}/subscriptions/hathor-federator-${this.chainConfig.multisigOrder}-sub`,
    );

    if (subscription) {
      subscription.on('message', async (message) => {
        try {
          // this.logger.info(`Evento puro: ${message.data.toString()}`);
          await this.parseHathorLogs(JSON.parse(message.data.toString()));
          message.ack();
        } catch (error) {
          // TODO retry policy if fails to parse and resolve
          this.logger.error(`Fail to processing hathor event: ${error}`);
          let isNonRetriable = false;
          if (error instanceof HathorException) {
            const originalError = (error as HathorException).getOriginalMessage();

            for (let index = 0; index < this.nonRetriableErrors.length; index++) {
              const rgxError = this.nonRetriableErrors[index];
              if (originalError.match(rgxError)) {
                isNonRetriable = true;
                break;
              }
            }

            if (isNonRetriable) {
              message.ack();
              return;
            }
          }

          message.nack();
        }
      });
      subscription.on('error', (error) => {
        this.logger.error(
          `Unable to subscribe to topic hathor-federator-${this.chainConfig.multisigOrder}. Make sure it exists. Error: ${error}`,
        );
      });
    } else {
      this.logger.error(
        `Unable to subscribe to topic hathor-federator-${this.chainConfig.multisigOrder}. Make sure it exists.`,
      );
    }
  }

  private async parseHathorLogs(event: any) {
    if (event.type !== 'wallet:new-tx') return;

    await this.isWalletReady(true);
    await this.isWalletReady(false);

    const outUtxos = event.data.outputs.map(
      (o) =>
        new HathorUtxo(o.script, o.token, o.value, {
          type: o.decoded?.type,
          address: o.decoded?.address,
          timelock: o.decoded?.timelock,
        }),
    );

    const inUtxos = event.data.inputs.map(
      (o) =>
        new HathorUtxo(o.script, o.token, o.value, {
          type: o.decoded?.type,
          address: o.decoded?.address,
          timelock: o.decoded?.timelock,
        }),
    );
    const tx = new HathorTx(event.data.tx_id, event.data.timestamp, outUtxos, inUtxos);

    const isProposal = tx.haveCustomData('hex');

    if (isProposal) {
      this.logger.info('Evaluating proposal...');
      const txHex = tx.getCustomData('hex');
      const [broker, dataType] = this.getBrokerAndDataType(tx);
      await broker.sendMySignaturesToProposal(txHex, tx.getCustomData(dataType));
      return;
    }

    const isSignature = tx.haveCustomData('sig');

    if (isSignature && this.chainConfig.multisigOrder >= this.chainConfig.multisigRequiredSignatures) {
      this.logger.info('Evaluating signature...');
      const [broker, dataType] = this.getBrokerAndDataType(tx);
      const txId = tx.getCustomData(dataType);
      const components = await broker.getSignaturesToPush(txId);

      if (components.signatures.length < this.chainConfig.multisigRequiredSignatures) {
        this.logger.info(
          `Number of signatures not reached. Require ${this.chainConfig.multisigRequiredSignatures} signatures, have ${components.signatures.length}`,
        );
        return;
      }

      await broker.signAndPushProposal(components.hex, txId, components.signatures);
      return;
    }

    const isHathorToEvm = tx.haveCustomData('addr');

    if (isHathorToEvm) {
      const broker = new HathorBroker(this.config, this.logger, this.bridgeFactory, this.federationFactory);
      const tokenData = tx.getCustomTokenData()[0];

      const result = await broker.sendTokensFromHathor(
        tx.getCustomData('addr'),
        tokenData.value,
        tokenData.token,
        tx.tx_id,
        tokenData.sender,
        tx.timestamp,
      );
      if (!result) {
        throw new HathorException('Invalid tx', 'Invalid tx'); //TODO change exception type
      }
      return;
    }
  }

  private getBrokerAndDataType(tx: HathorTx): [Broker, string] {
    const customDataType = tx.getCustomDataType();
    switch (customDataType) {
      case 'hsh':
        return [new EvmBroker(this.config, this.logger, this.bridgeFactory, this.federationFactory), customDataType];
      case 'hid':
        return [new HathorBroker(this.config, this.logger, this.bridgeFactory, this.federationFactory), customDataType];
    }
  }

  protected async isWalletReady(multisig: boolean, retry = 1): Promise<boolean> {
    const id = multisig ? this.chainConfig.multisigWalletId : this.chainConfig.singleWalletId;
    if (retry > 3) {
      this.logger.error(`Fail to start ${id} wallet: Maximum number of retries reached.`);
      return false;
    }
    this.logger.info(`Checking ${id} wallet status for the ${retry} time`);
    const url = `${this.chainConfig.walletUrl}/wallet/status`;
    const config = {
      headers: {
        'x-wallet-id': multisig ? this.chainConfig.multisigWalletId : this.chainConfig.singleWalletId,
        'Content-type': 'application/json',
      },
    };

    try {
      const response = await axios.get<StatusResponse>(url, config);
      if (response.data.statusCode === this.WALLET_STATUS_READY) {
        this.logger.info(`${id} wallet is ready.`);
        return true;
      }
      if ([this.WALLET_STATUS_CONNECTING, this.WALLET_STATUS_SYNCING].includes(response.data.statusCode)) {
        this.logger.info(`${id} wallet is ${response.data.statusMessage}.`);
        await this.delay(3000);
        return this.isWalletReady(multisig, ++retry);
      }
      if (!response.data.success && response.data.statusMessage === '') {
        this.logger.info(`${id} wallet looks stopped.`);
        await this.startWallet(multisig);
        await this.delay(3000);
        return this.isWalletReady(multisig, ++retry);
      }
    } catch (error) {
      throw Error(`Fail to get status of ${id} wallet: ${error}`);
    }
  }

  private async startWallet(multisig: boolean): Promise<boolean> {
    const id = multisig ? this.chainConfig.multisigWalletId : this.chainConfig.singleWalletId;
    const seedKey = multisig ? this.chainConfig.multisigSeedKey : this.chainConfig.singleSeedKey;
    this.logger.info(`Trying to start ${id} wallet.`);
    const url = `${this.chainConfig.walletUrl}/start`;
    const config = {
      headers: {
        'Content-type': 'application/json',
      },
    };
    const data = {
      'wallet-id': id,
      seedKey: seedKey,
      multisig: multisig,
    };

    try {
      const response = await axios.post<HathorResponse>(url, data, config);
      return response.status == 200 && response.data.success;
    } catch (error) {
      throw Error(`Fail to start wallet: ${error}`);
    }
  }

  private async delay(time: number) {
    return new Promise((resolve) => setTimeout(resolve, time));
  }
}

export default HathorWallet;
