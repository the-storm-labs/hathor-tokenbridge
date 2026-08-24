/**
 * ⚠️  REAL EXECUTION — NOT A DRY RUN. ⚠️
 *
 * Unlike replayPushProposal.ts (strictly read-only), this script calls the real, unmodified
 * production entry point Broker#sendTokens for exactly ONE transactionId. If the on-chain state
 * still satisfies pushProposal's conditions (this federator isSigned, and — with the fix in
 * Broker.ts — enough COMPLETE signatures exist), it WILL:
 *   - POST to the real Hathor mainnet headless wallet's wallet/p2sh/tx-proposal/sign-and-push
 *     (broadcasts a real Hathor transaction, moving real bridge funds to the receiver).
 *   - Send a real signed Arbitrum One transaction from FEDERATOR_KEY (updateTransactionState),
 *     spending real gas.
 *
 * Deliberately scoped to ONE transactionId (required CLI arg, not inferred/defaulted) instead of
 * running Main/Scheduler, which would also re-walk the entire history since
 * FEDERATION_FROM_BLOCK/config.mainchain.fromBlock and act on every other pending transaction.
 *
 * Usage (from inside federator/):
 *   npx ts-node ./src/scripts/executePushProposal.ts <transactionId> [fromBlock] [toBlock] [batchSize]
 *
 * Defaults: fromBlock=496269350 toBlock=496269450 batchSize=450
 */

import log4js from 'log4js';
import { Registry } from 'prom-client';
import { Config } from '../lib/config';
import { LogWrapper } from '../lib/logWrapper';
import { Broker, EvmBroker, HathorBroker } from '../lib/Broker';
import { HathorWallet } from '../lib/HathorWallet';
import {
  HathorFederationFactory,
  IHathorFederationV1,
  BridgeFactory,
  FederationFactory,
  AllowTokensFactory,
  IAllowTokensV1,
} from '../contracts';
import { TransactionTypes } from '../types';
import MetricRegister from '../utils/MetricRegister';

const TARGET_TRANSACTION_ID = process.argv[2];
const FROM_BLOCK = Number(process.argv[3] ?? 496269350);
const TO_BLOCK = Number(process.argv[4] ?? 496269450);
const BATCH_SIZE = Number(process.argv[5] ?? 450);

// Same console-only logger as replayPushProposal.ts — see that file for why Logs.getInstance()
// (which points its file appender at the container-only /var/log/federator.log) is avoided here.
function buildLocalLogger(): LogWrapper {
  log4js.configure({
    appenders: { console: { type: 'console' } },
    categories: { default: { appenders: ['console'], level: 'trace' } },
  });
  return new LogWrapper(log4js.getLogger('EXECUTE'), 'EXECUTE');
}

// Locate the event carrying a given transactionId's sender/receiver/value/token/type - same
// getPastEvents call HathorFederationLogsReader uses, but filtered to the one we asked for.
async function findTransactionEvent(
  hathorFederationContract: IHathorFederationV1,
  transactionId: string,
  fromBlock: number,
  toBlock: number,
  batchSize: number,
): Promise<any> {
  for (let cur = fromBlock; cur <= toBlock; cur += batchSize) {
    const to = Math.min(cur + batchSize - 1, toBlock);
    const events = await hathorFederationContract.getPastEvents('allEvents', { fromBlock: cur, toBlock: to });
    for (const ev of events) {
      if (typeof ev === 'string') continue;
      const rv = ev.returnValues as any;
      if (rv?.transactionId === transactionId && rv?.sender && rv?.receiver) {
        return rv;
      }
    }
  }
  return undefined;
}

async function main() {
  if (!TARGET_TRANSACTION_ID) {
    throw new Error(
      'Usage: npx ts-node ./src/scripts/executePushProposal.ts <transactionId> [fromBlock] [toBlock] [batchSize]',
    );
  }

  const config = Config.getInstance();
  const logger = buildLocalLogger();

  logger.warn(
    '=== REAL EXECUTION — this will really push to Hathor mainnet and write on Arbitrum if conditions are met ===',
  );
  logger.info(`Target transactionId=${TARGET_TRANSACTION_ID} scanning fromBlock=${FROM_BLOCK} toBlock=${TO_BLOCK}`);

  const hathorFederationContract = new HathorFederationFactory().createInstance() as IHathorFederationV1;

  // Bail early and cheaply if this is already resolved — no need to touch the wallet/gas at all.
  const alreadyProcessed = await hathorFederationContract.isProcessed(TARGET_TRANSACTION_ID);
  if (alreadyProcessed) {
    logger.info(`transactionId ${TARGET_TRANSACTION_ID} is already isProcessed=true. Nothing to do, exiting.`);
    return;
  }

  const match = await findTransactionEvent(
    hathorFederationContract,
    TARGET_TRANSACTION_ID,
    FROM_BLOCK,
    TO_BLOCK,
    BATCH_SIZE,
  );

  if (!match) {
    throw new Error(
      `Could not find an event for transactionId ${TARGET_TRANSACTION_ID} in blocks ${FROM_BLOCK}-${TO_BLOCK}. ` +
        `Widen the block range or double check the transactionId.`,
    );
  }

  let originalTokenAddress = match.originalTokenAddress;
  const transactionType = Number.parseInt(match.transactionType);
  // Same normalization HathorFederationLogsReader.handleProposalSigned applies before calling
  // sendTokens: non-MELT token addresses come back from the event padded/prefixed and need
  // getAddress() to recover the real checksummed EVM address.
  if (transactionType !== TransactionTypes.MELT) {
    originalTokenAddress = hathorFederationContract.getAddress(originalTokenAddress);
  }

  logger.info(
    `Resolved: sender=${match.sender} receiver=${match.receiver} value=${match.value} ` +
      `originalTokenAddress=${originalTokenAddress} transactionHash=${match.transactionHash} ` +
      `transactionType=${transactionType} (${TransactionTypes[transactionType]})`,
  );

  // Same readiness check Main.start() runs before touching the wallet.
  const wallet = HathorWallet.getInstance(config, logger);
  const [ready] = await wallet.areWalletsReady();
  logger.info(`Local multisig wallet ready=${ready}`);

  const register = new Registry();
  const metricRegister = new MetricRegister(register, 'execute_push_proposal');
  const bridgeFactory = new BridgeFactory();
  const federationFactory = new FederationFactory();
  const allowTokensContract = (await new AllowTokensFactory().createInstance(config.mainchain)) as IAllowTokensV1;

  // Typed as the abstract Broker on purpose: this is exactly how HathorFederationLogsReader
  // calls sendTokens (base 7-arg signature), not EvmBroker's overridden 5-arg convenience one.
  let broker: Broker;
  switch (transactionType) {
    case TransactionTypes.MINT:
    case TransactionTypes.TRANSFER:
      broker = new EvmBroker(config, logger, bridgeFactory, federationFactory, metricRegister);
      break;
    case TransactionTypes.MELT:
      broker = new HathorBroker(config, logger, bridgeFactory, federationFactory, metricRegister, allowTokensContract);
      break;
    default:
      throw new Error(`Unexpected transactionType ${transactionType}`);
  }

  logger.warn('=== Calling the real Broker#sendTokens now ===');
  const result = await broker.sendTokens(
    match.sender,
    match.receiver,
    match.value,
    originalTokenAddress,
    match.transactionHash,
    transactionType,
    transactionType !== TransactionTypes.TRANSFER,
  );
  logger.warn(`sendTokens returned: ${result}`);

  const isProcessedAfter = await hathorFederationContract.isProcessed(TARGET_TRANSACTION_ID);
  logger.info(`isProcessed after call: ${isProcessedAfter}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
