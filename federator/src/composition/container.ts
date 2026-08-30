import { EvmToHathorFlow } from '../application/EvmToHathorFlow';
import { EvmVoter } from '../application/EvmVoter';
import { HathorToEvmFlow } from '../application/HathorToEvmFlow';
import { ProposalCoordinator } from '../application/ProposalCoordinator';
import type { AppConfig } from '../config/types';
import { AxiosHttpClient } from '../infra/hathor/AxiosHttpClient';
import { HeadlessWalletAdapter } from '../infra/hathor/HeadlessWalletAdapter';
import { WalletLibAdapter } from '../infra/hathor/WalletLibAdapter';
import { Log4jsLogger } from '../infra/logging/Log4jsLogger';
import { PrometheusMetrics } from '../infra/metrics/PrometheusMetrics';
import { EvmChainAdapter } from '../infra/evm/EvmChainAdapter';
import { EvmTransactionSender } from '../infra/evm/EvmTransactionSender';
import { Web3Provider } from '../infra/evm/Web3Provider';
import { AllowTokensAdapter } from '../infra/evm/contracts/AllowTokensAdapter';
import { BridgeAdapter } from '../infra/evm/contracts/BridgeAdapter';
import { EvmFederationAdapter } from '../infra/evm/contracts/EvmFederationAdapter';
import { HathorFederationAdapter } from '../infra/evm/contracts/HathorFederationAdapter';
import { FileCursorStore } from '../infra/storage/FileCursorStore';
import { FileRevertedTransferStore } from '../infra/storage/FileRevertedTransferStore';
import { systemClock } from '../infra/SystemClock';
import type { HathorFederationPort } from '../ports/HathorFederationPort';
import type { HathorWalletPort } from '../ports/HathorWalletPort';
import { EvmBridgeReader } from '../services/EvmBridgeReader';
import { HathorFederationReader } from '../services/HathorFederationReader';
import { HathorService } from '../services/HathorService';
import { HealthEndpoint } from '../services/HealthEndpoint';
import { Scheduler } from '../services/Scheduler';

/**
 * The composition root: the one place that knows both what the application needs and which
 * adapters supply it.
 *
 * Everything is built here and handed down by constructor. There is no container, no decorators
 * and no service locator - the whole dependency graph is this file, readable top to bottom, which
 * is the point.
 */
export interface Federator {
  /** Which wallet adapter this federator was built with - see the rollout switch below. */
  readonly walletAdapter: 'headless' | 'wallet-lib';
  readonly hathorService: HathorService;
  readonly health: HealthEndpoint;
  readonly schedulers: readonly Scheduler[];
  /** What this federator is and how it is doing. Served by /status, and readable directly. */
  status(): Promise<Record<string, unknown>>;
  /**
   * The coordination contract and the two directional flows, exposed for the diagnostic scripts in
   * src/scripts. They are the application's own surface, not an escape hatch: a script that
   * duplicated the wiring would drift from what the federator actually does, which is exactly what
   * you do not want from a tool you reach for during an incident.
   */
  readonly federation: HathorFederationPort;
  readonly evmToHathor: EvmToHathorFlow;
  readonly hathorToEvm: HathorToEvmFlow;
  readonly wallet: HathorWalletPort;
  readonly metrics: PrometheusMetrics;
}

export function buildFederator(config: AppConfig): Federator {
  const logger = new Log4jsLogger('FEDERATOR');
  const metrics = new PrometheusMetrics(undefined, { instance_address: config.federator.address });
  const web3s = new Web3Provider();

  // ---- Hathor ---------------------------------------------------------------------------------

  // The headless adapter is selected by configuring it, and nothing else. That is the rollout
  // switch: a federator can run this whole tree against the wallet container it already has,
  // prove it out, and then drop HATHOR_HEADLESS_URL to move onto the embedded library.
  const walletAdapter = config.hathor.headless ? 'headless' : 'wallet-lib';

  const wallet: HathorWalletPort = config.hathor.headless
    ? new HeadlessWalletAdapter(
        new AxiosHttpClient(config.hathor.headless.url, { 'x-api-key': config.hathor.headless.apiKey }),
        { walletId: 'multi', seedKey: 'default', multisig: true },
        new Log4jsLogger('HEADLESS_WALLET'),
      )
    : new WalletLibAdapter(
        {
          seed: config.hathor.seed,
          multisig: {
            pubkeys: config.hathor.multisig.pubkeys,
            numSignatures: config.hathor.multisig.numSignatures,
          },
          network: config.hathor.network,
          fullnodeUrl: config.hathor.fullnodeUrl,
          txMiningUrl: config.hathor.txMiningUrl,
          gapLimit: config.hathor.gapLimit,
          pushTimeoutMs: config.hathor.pushTimeoutMs,
        },
        new Log4jsLogger('WALLET_LIB'),
      );

  // ---- EVM chains -----------------------------------------------------------------------------

  const evmWeb3 = web3s.get(config.evm.host);
  const stateWeb3 = web3s.get(config.state.host);

  const evmChain = new EvmChainAdapter(evmWeb3);
  const stateChain = new EvmChainAdapter(stateWeb3);

  const evmSender = new EvmTransactionSender(evmWeb3, config.federator.privateKey, new Log4jsLogger('EVM_SENDER'));
  const stateSender = new EvmTransactionSender(
    stateWeb3,
    config.federator.privateKey,
    new Log4jsLogger('STATE_SENDER'),
  );

  const bridge = new BridgeAdapter(evmWeb3, config.evm.bridgeAddress, logger);
  const allowTokens = new AllowTokensAdapter(evmWeb3, config.evm.allowTokensAddress, config.hathor.multisig.order);
  const evmFederation = new EvmFederationAdapter(evmWeb3, config.evm.federationAddress, evmSender);
  const hathorFederation = new HathorFederationAdapter(stateWeb3, config.state.contractAddress, stateSender, logger);

  // ---- storage --------------------------------------------------------------------------------

  const cursors = new FileCursorStore(config.runtime.storagePath, logger);
  const revertedTransfers = new FileRevertedTransferStore(config.runtime.storagePath, logger);

  // ---- application ----------------------------------------------------------------------------

  const coordinator = new ProposalCoordinator({
    wallet,
    federation: hathorFederation,
    logger: new Log4jsLogger('PROPOSALS'),
    metrics,
    clock: systemClock,
    options: {
      federatorAddress: config.federator.address,
      multisigOrder: config.hathor.multisig.order,
      numSignatures: config.hathor.multisig.numSignatures,
    },
  });

  const voter = new EvmVoter({
    federation: evmFederation,
    revertedTransfers,
    logger: new Log4jsLogger('VOTER'),
    metrics,
    federatorAddress: config.federator.address,
  });

  const evmToHathor = new EvmToHathorFlow({
    wallet,
    bridge,
    coordinator,
    logger: new Log4jsLogger('EVM_TO_HATHOR'),
    evmChainId: config.evm.chainId,
    inputLockTtlMs: config.hathor.inputLockTtlMs,
  });

  const hathorToEvm = new HathorToEvmFlow({
    wallet,
    bridge,
    allowTokens,
    coordinator,
    voter,
    logger: new Log4jsLogger('HATHOR_TO_EVM'),
    evmChainId: config.evm.chainId,
    hathorChainId: config.hathor.chainId,
    inputLockTtlMs: config.hathor.inputLockTtlMs,
    minConfirmations: config.hathor.minConfirmations,
    multisigOrder: config.hathor.multisig.order,
  });

  // ---- services -------------------------------------------------------------------------------

  const hathorService = new HathorService({
    wallet,
    flow: hathorToEvm,
    cursors,
    logger: new Log4jsLogger('HATHOR_SERVICE'),
    fromTimestamp: config.hathor.fromTimestamp,
  });

  const bridgeReader = new EvmBridgeReader({
    chain: evmChain,
    bridge,
    allowTokens,
    flow: evmToHathor,
    cursors,
    logger: new Log4jsLogger('BRIDGE_READER'),
    metrics,
    hathorChainId: config.hathor.chainId,
    fromBlock: config.evm.fromBlock,
  });

  const federationReader = new HathorFederationReader({
    chain: stateChain,
    federation: hathorFederation,
    wallet,
    evmToHathor,
    hathorToEvm,
    cursors,
    logger: new Log4jsLogger('FEDERATION_READER'),
    metrics,
    fromBlock: config.state.fromBlock,
    confirmationBlocks: config.state.confirmationBlocks,
    inputLockTtlMs: config.hathor.inputLockTtlMs,
  });

  const schedulerOptions = { intervalMs: config.runtime.pollingIntervalMs };
  const schedulers = [
    new Scheduler(bridgeReader, schedulerOptions, new Log4jsLogger('SCHEDULER')),
    new Scheduler(federationReader, schedulerOptions, new Log4jsLogger('SCHEDULER')),
  ];

  const status = async (): Promise<Record<string, unknown>> => ({
    federator: config.federator.address,
    multisigOrder: config.hathor.multisig.order,
    wallet: await wallet.status(),
    walletAdapter,
    schedulers: schedulers.map((scheduler) => ({ failureStreak: scheduler.failureStreak })),
  });

  const health = new HealthEndpoint({
    port: config.runtime.endpointsPort,
    logger: new Log4jsLogger('ENDPOINT'),
    renderMetrics: () => metrics.render(),
    status,
  });

  return {
    walletAdapter,
    hathorService,
    health,
    schedulers,
    wallet,
    metrics,
    status,
    federation: hathorFederation,
    evmToHathor,
    hathorToEvm,
  };
}
