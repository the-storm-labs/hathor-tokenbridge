import datadogMetrics from 'datadog-metrics';

const DEFAULT_PROJECT_METRIC_PREFIX = 'token_bridge.';
const FEDERATOR_VOTING_METRIC_NAME = 'federator.voting';
const ADDRESS_METRIC_TAG_KEY = 'address';
const TRANSACTION_ID_TAG_KEY = 'transaction_id';
const FED_VERSION_METRIC_TAG_KEY = 'fed_version';
const CHAIN_ID_METRIC_TAG_KEY = 'chain_id';
const RESULT_METRIC_TAG_KEY = 'result';
const TYPE_METRIC_TAG_KEY = 'type';
const DEFAULT_INCREMENT_METRIC_VALUE = 1;

enum TokenType {
  ERC20 = 'erc20',
  ERC721 = 'erc721',
}

enum ChainType {
  MAIN = 'main',
  SIDE = 'side',
}

export class MetricCollector {
  private static federatorAddress = process.env.FEDERATOR_ADDRESS;
  constructor() {
    if (!process.env.DATADOG_API_KEY) {
      throw new Error("Datadog API key is not set as environment variable 'DATADOG_API_KEY'");
    }

    if (!process.env.FEDERATOR_ADDRESS) {
      throw new Error("Federator Address is not set as environment variable 'FEDERATOR_ADDRESS'");
    }

    datadogMetrics.init({ prefix: DEFAULT_PROJECT_METRIC_PREFIX });
    datadogMetrics.increment('federator.start', DEFAULT_INCREMENT_METRIC_VALUE);
  }

  trackERC20FederatorVotingResult(
    wasTransactionVoted: boolean,
    federatorAddress: string,
    federatorVersion: string,
    chainId: number,
  ) {
    MetricCollector.trackFederatorVotingResult(
      wasTransactionVoted,
      federatorAddress,
      federatorVersion,
      chainId,
      TokenType.ERC20,
    );
  }

  trackERC721FederatorVotingResult(
    wasTransactionVoted: boolean,
    federatorAddress: string,
    federatorVersion: string,
    chainId: number,
  ) {
    MetricCollector.trackFederatorVotingResult(
      wasTransactionVoted,
      federatorAddress,
      federatorVersion,
      chainId,
      TokenType.ERC721,
    );
  }

  private static trackFederatorVotingResult(
    wasTransactionVoted: boolean,
    federatorAddress: string,
    federatorVersion: string,
    chainId: number,
    tokenType: string,
  ) {
    datadogMetrics.increment(FEDERATOR_VOTING_METRIC_NAME, DEFAULT_INCREMENT_METRIC_VALUE, [
      `${ADDRESS_METRIC_TAG_KEY}:${federatorAddress}`,
      `${FED_VERSION_METRIC_TAG_KEY}:${federatorVersion}`,
      `${CHAIN_ID_METRIC_TAG_KEY}:${chainId}`,
      `${RESULT_METRIC_TAG_KEY}:${wasTransactionVoted}`,
      `${TYPE_METRIC_TAG_KEY}:${tokenType}`,
    ]);
  }

  trackFederatorRun() {
    MetricCollector.trackFederatorRun();
  }

  trackHathorSignedProposal(transactionId: string, wasTransactionSuccessfull: boolean) {
    MetricCollector.trackHathorInteraction('signed.proposal', transactionId, wasTransactionSuccessfull);
  }

  trackHathorSentProposal(transactionId: string, wasTransactionSuccessfull: boolean) {
    MetricCollector.trackHathorInteraction('sent.proposal', transactionId, wasTransactionSuccessfull);
  }

  trackHathorPushProposal(transactionId: string, wasTransactionSuccessfull: boolean) {
    MetricCollector.trackHathorInteraction('push.proposal', transactionId, wasTransactionSuccessfull);
  }

  private static trackFederatorRun() {
    datadogMetrics.increment(`hathor.federation.run`, DEFAULT_INCREMENT_METRIC_VALUE, [
      `${ADDRESS_METRIC_TAG_KEY}:${this.federatorAddress}`,
    ]);
  }

  private static trackHathorInteraction(
    interactionType: string,
    transactionId: string,
    wasTransactionSuccessfull: boolean,
  ) {
    datadogMetrics.increment(`hathor.federation.interaction`, DEFAULT_INCREMENT_METRIC_VALUE, [
      `${ADDRESS_METRIC_TAG_KEY}:${this.federatorAddress}`,
      `${TYPE_METRIC_TAG_KEY}:${interactionType}`,
      `${TRANSACTION_ID_TAG_KEY}:${transactionId}`,
      `${RESULT_METRIC_TAG_KEY}:${wasTransactionSuccessfull}`,
    ]);
  }

  trackMainChainHeartbeatEmission(
    from: string,
    fedVersion: string,
    fedBlock: number,
    nodeInfo: string,
    chainId: number,
  ) {
    MetricCollector.trackHeartbeatEmission(from, fedVersion, fedBlock, nodeInfo, chainId, ChainType.MAIN);
  }

  trackSideChainHeartbeatEmission(
    from: string,
    fedVersion: string,
    fedBlock: number,
    nodeInfo: string,
    chainId: number,
  ) {
    MetricCollector.trackHeartbeatEmission(from, fedVersion, fedBlock, nodeInfo, chainId, ChainType.SIDE);
  }

  private static trackHeartbeatEmission(
    from: string,
    fedVersion: string,
    fedBlock: number,
    nodeInfo: string,
    chainId: number,
    chainType: string,
  ) {
    datadogMetrics.gauge(`heartbeat.${chainType}_chain.emission`, fedBlock, [
      `address:${from}`,
      `fed_version:${fedVersion}`,
      `node_info:${nodeInfo}`,
      `chain_id:${chainId}`,
    ]);
  }
}
