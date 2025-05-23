import { ConfigData } from './config';
import web3, { FMT_BYTES, FMT_NUMBER } from 'web3';
import fs from 'fs';
import TransactionSender from './TransactionSender';
import { BridgeFactory } from '../contracts/BridgeFactory';
import { FederationFactory } from '../contracts/FederationFactory';
import * as utils from '../lib/utils';
import * as typescriptUtils from './typescriptUtils';
import { ConfigChain } from './configChain';
import { IFederation } from '../contracts/IFederation';
import { LogWrapper } from './logWrapper';
import MetricRegister from '../utils/MetricRegister';

export default abstract class Federator {
  public logger: LogWrapper;
  public config: ConfigData;
  public metricRegister: MetricRegister;
  public chainId: number;
  public sideChain: ConfigChain;
  public web3ByHost: Map<string, web3>;
  private numberOfRetries: number;

  constructor(config: ConfigData, logger: LogWrapper, metricRegister: MetricRegister) {
    this.config = config;
    this.logger = logger;
    if (this.logger.upsertContext) {
      this.logger.upsertContext('service', this.constructor.name);
    }

    if (config.checkHttps && !utils.checkHttpsOrLocalhost(config.mainchain.host)) {
      this.logger.info('Check of checkHttpsOrLocalhost failed');
      throw new Error(`Invalid host configuration, https or localhost required`);
    }

    this.metricRegister = metricRegister;
    this.numberOfRetries = config.federatorRetries;
    this.web3ByHost = new Map<string, web3>();
    this.checkStoragePath();
  }

  async getCurrentChainId() {
    if (this.chainId === undefined) {
      this.chainId = await this.getMainChainWeb3().eth.net.getId({
        number: FMT_NUMBER.NUMBER,
        bytes: FMT_BYTES.HEX,
      });
    }
    return this.chainId;
  }

  async getChainId(client: web3) {
    return client.eth.net.getId();
  }

  getLastBlockPath(mainChainId: number, sideChainId: number, origin: string): string {
    return `${this.config.storagePath}/lastBlock_${origin}_${mainChainId}_${sideChainId}.txt`;
  }

  getRevertedTxnsPath(sideChainId: number, mainChainId: number): string {
    return `${this.config.storagePath}/revertedTxns_${mainChainId}_${sideChainId}.txt`;
  }

  getWeb3(host: string): web3 {
    let hostWeb3 = this.web3ByHost.get(host);
    if (!hostWeb3) {
      hostWeb3 = new web3(host);
      this.web3ByHost.set(host, hostWeb3);
    }
    return hostWeb3;
  }

  getMainChainWeb3(): web3 {
    return this.getWeb3(this.config.mainchain.host);
  }

  getChainWeb3(host: string): web3 {
    return this.getWeb3(host);
  }

  getLastBlock(mainChainId: number, sideChainId: number, origin: string): number {
    let fromBlock: number;
    const originalFromBlock = this.config.mainchain.fromBlock || 0;
    try {
      fromBlock = parseInt(fs.readFileSync(this.getLastBlockPath(mainChainId, sideChainId, origin), 'utf8'));
    } catch (err) {
      fromBlock = originalFromBlock;
    }
    if (fromBlock < originalFromBlock) {
      fromBlock = originalFromBlock;
    }
    return fromBlock;
  }

  getLastBlockFromEnv(mainChainId: number, sideChainId: number, origin: string): number {
    let fromBlock: number;
    const originalFromBlock = Number.parseInt(process.env.FEDERATION_FROM_BLOCK) || 0;
    try {
      fromBlock = parseInt(fs.readFileSync(this.getLastBlockPath(mainChainId, sideChainId, origin), 'utf8'));
    } catch (err) {
      fromBlock = originalFromBlock;
    }
    if (fromBlock < originalFromBlock) {
      fromBlock = originalFromBlock;
    }
    return fromBlock;
  }

  private checkStoragePath() {
    if (!fs.existsSync(this.config.storagePath)) {
      fs.mkdirSync(this.config.storagePath, {
        recursive: true,
      });
    }
  }

  abstract run({
    sideChainConfig,
    sideChainWeb3,
    transactionSender,
    bridgeFactory,
    federationFactory,
  }: {
    sideChainConfig: ConfigChain;
    sideChainWeb3: web3;
    transactionSender: TransactionSender;
    bridgeFactory: BridgeFactory;
    federationFactory: FederationFactory;
  }): Promise<boolean>;

  getCurrentRetrie(): number {
    return this.config.federatorRetries - this.numberOfRetries;
  }

  async runAll(): Promise<boolean> {
    for (const sideChainConfig of this.config.sidechain) {
      this.logger.trace(`${this.constructor.name} from ${this.config.mainchain.chainId} to ${sideChainConfig.chainId}`);
      this.resetRetries();
      const sideChainWeb3 = this.getWeb3(process.env.HATHOR_STATE_CONTRACT_HOST_URL);
      const transactionSender = new TransactionSender(sideChainWeb3, this.logger, this.config);
      const federationFactory = new FederationFactory();
      this.logger.upsertContext('Retrie', this.getCurrentRetrie());
      try {
        while (this.numberOfRetries > 0) {
          const bridgeFactory = new BridgeFactory();
          const success: boolean = await this.run({
            sideChainConfig,
            sideChainWeb3,
            transactionSender,
            bridgeFactory,
            federationFactory,
          });
          if (success) {
            this.resetRetries();
            break;
          }
        }
      } catch (err) {
        this.logger.error(new Error('Exception Running Federator'), err);
        this.numberOfRetries--;
        this.logger.debug(`Runned ${this.getCurrentRetrie()} retrie`);
        this.checkRetries();
        await utils.sleep(this.config.mainchain.blockTimeMs);
      }
    }

    return true;
  }

  checkRetries() {
    if (this.numberOfRetries < 0) {
      process.exit(1);
    }
  }

  private resetRetries() {
    this.numberOfRetries = this.config.federatorRetries;
  }

  async checkFederatorIsMember(sideFedContract: IFederation, federatorAddress: string) {
    const isMember = await typescriptUtils.retryNTimes(sideFedContract.isMember(federatorAddress));
    if (!isMember) {
      throw new Error(`This Federator addr:${federatorAddress} is not part of the federation`);
    }
  }

  _saveProgress(path, value) {
    if (value) {
      fs.writeFileSync(path, value.toString());
    }
  }
}
