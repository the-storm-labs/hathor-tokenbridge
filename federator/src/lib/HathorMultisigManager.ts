import { ConfigData } from './config';
import web3, { FMT_BYTES, FMT_NUMBER } from 'web3';
import TransactionSender from './TransactionSender';
import { BridgeFactory, IFederation, FederationFactory } from '../contracts';
import * as typescriptUtils from './typescriptUtils';
import Federator from './Federator';
import { ConfigChain } from './configChain';
import { LogWrapper } from './logWrapper';
import { HathorFederationLogsReader } from './HathorFederationLogsReader';
import MetricRegister from '../utils/MetricRegister';

export default class HathorMultisigManager extends Federator {
  private readonly PATH_ORIGIN = 'hmm';
  constructor(config: ConfigData, logger: LogWrapper, metricRegister: MetricRegister) {
    super(config, logger, metricRegister);
  }

  async run({
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
  }): Promise<boolean> {
    const currentBlock = await this.getChainWeb3(process.env.HATHOR_STATE_CONTRACT_HOST_URL).eth.getBlockNumber({
      number: FMT_NUMBER.NUMBER,
      bytes: FMT_BYTES.HEX,
    });
    const mainChainId = Number.parseInt(process.env.FEDERATION_CHAIN_ID);
    this.logger.upsertContext('Main Chain ID', mainChainId);

    this.logger.trace(`Federator Run started currentBlock: ${currentBlock}, currentChainId: ${mainChainId}`);

    const isMainSyncing = await this.getChainWeb3(process.env.HATHOR_STATE_CONTRACT_HOST_URL).eth.isSyncing();
    if (isMainSyncing !== false) {
      this.logger.warn(
        `ChainId ${mainChainId} is Syncing, ${JSON.stringify(
          isMainSyncing,
        )}. Federator won't process requests till is synced`,
      );
      return false;
    }

    this.logger.trace(`Current Block ${currentBlock} ChainId ${mainChainId}`);
    const toBlock = currentBlock - Number.parseInt(process.env.FEDERATION_CONFIRMATION_BLOCKS);

    this.logger.info('Running to Block', toBlock);

    if (toBlock <= 0) {
      return false;
    }

    let fromBlock = this.getLastBlockFromEnv(Number.parseInt(process.env.FEDERATION_CHAIN_ID), 31, this.PATH_ORIGIN);
    if (fromBlock >= toBlock) {
      this.logger.warn(
        `Current chain ${mainChainId} Height ${toBlock} is the same or lesser than the last block processed ${fromBlock}`,
      );
      return false;
    }
    fromBlock = fromBlock + 1;
    this.logger.debug('Running from Block', fromBlock);
    await this.getLogsAndProcess(currentBlock, fromBlock, toBlock, bridgeFactory, federationFactory, transactionSender);

    this.metricRegister.increaseHtrRunCounter();
    this._saveProgress(this.getLastBlockPath(mainChainId, 31, this.PATH_ORIGIN), toBlock);

    return true;
  }

  async getLogsAndProcess(
    currentBlock: number,
    fromBlock: number,
    toBlock: number,
    bridgeFactory: BridgeFactory,
    federationFactory: FederationFactory,
    transactionSender: TransactionSender,
  ) {
    this.logger.trace(
      `getLogsAndProcess started currentBlock: ${currentBlock}, fromBlock: ${fromBlock}, toBlock: ${toBlock}`,
    );
    if (fromBlock >= toBlock) {
      this.logger.trace('getLogsAndProcess fromBlock >= toBlock', fromBlock, toBlock);
      return;
    }
    this.logger.upsertContext('Current Block', currentBlock);

    const recordsPerPage = 1000;
    const numberOfPages = Math.ceil((toBlock - fromBlock) / recordsPerPage);
    this.logger.debug(`Total pages ${numberOfPages}, blocks per page ${recordsPerPage}`);

    let fromPageBlock = fromBlock;

    const logsReader = new HathorFederationLogsReader(
      this.config,
      this.logger,
      bridgeFactory,
      federationFactory,
      transactionSender,
      this.metricRegister,
    );

    /// First we process all the lock input events, so the proposals previously created are synced locally
    for (let currentPage = 1; currentPage <= numberOfPages; currentPage++) {
      let toPagedBlock = fromPageBlock + recordsPerPage - 1;
      if (currentPage === numberOfPages) {
        toPagedBlock = currentBlock;
      }

      fromPageBlock = await this.runFetchEvents(
        currentPage,
        fromPageBlock,
        toPagedBlock,
        recordsPerPage,
        logsReader.fetchLockEventsInBatches,
        logsReader,
      );
    }

    // Reseting fromPageBlock
    fromPageBlock = fromBlock;

    // Now for the regular events
    for (let currentPage = 1; currentPage <= numberOfPages; currentPage++) {
      let toPagedBlock = fromPageBlock + recordsPerPage - 1;
      if (currentPage === numberOfPages) {
        toPagedBlock = toBlock;
      }

      fromPageBlock = await this.runFetchEvents(
        currentPage,
        fromPageBlock,
        toPagedBlock,
        recordsPerPage,
        logsReader.fetchEventsInBatches,
        logsReader,
      );
    }

    return fromPageBlock;
  }

  async runFetchEvents(
    currentPage,
    fromPageBlock,
    toPagedBlock,
    recordsPerPage,
    fetchEventsFunction,
    reader: HathorFederationLogsReader,
  ) {
    this.logger.debug(`Page ${currentPage} getting events from block ${fromPageBlock} to ${toPagedBlock}`);
    this.logger.upsertContext('fromBlock', fromPageBlock);
    this.logger.upsertContext('toBlock', toPagedBlock);
    ///////
    await fetchEventsFunction.call(reader, fromPageBlock, toPagedBlock, recordsPerPage);
    ///////
    fromPageBlock = toPagedBlock + 1;
    return fromPageBlock;
  }

  async checkFederatorIsMember(sideFedContract: IFederation, federatorAddress: string) {
    const isMember = await typescriptUtils.retryNTimes(sideFedContract.isMember(federatorAddress));
    if (!isMember) {
      throw new Error(`This Federator addr:${federatorAddress} is not part of the federation`);
    }
  }
}
