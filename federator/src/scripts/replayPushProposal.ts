/**
 * READ-ONLY replay of Broker.pushProposal's decision logic (see Broker.ts:249-321),
 * for a specific block range on the EVM "state chain" (HathorFederation coordination contract).
 *
 * WHAT THIS DOES:
 *  - Scans `allEvents` on the HathorFederation contract directly via getPastEvents
 *    (the same call HathorFederationLogsReader.fetchEventsInBatches makes internally),
 *    WITHOUT going through HathorFederationLogsReader.handleEvent/Broker.sendTokens.
 *  - For every distinct transactionId found, replicates pushProposal's own math using
 *    only safe, on-chain *read* calls (.call(), no gas, no state change):
 *      getSignatureCount vs HEADLESS_MULTISIG_SEED_DEFAULT_NUM_SIGNATURES (the quorum gate),
 *      and the full transactionSignatures[] array + the slice(0, maxSignatures) pushProposal
 *      would actually send.
 *  - Optionally (--validate flag) calls the real, public Broker#validateTx on a real
 *    EvmBroker/HathorBroker instance — confirmed safe: it only decodes via wallet/decode
 *    (no push) and does read-only chain/wallet lookups.
 *
 * WHAT THIS NEVER DOES (by construction — these functions are simply never referenced):
 *  - Broker#sendTokens / Broker#pushProposal / Broker#hathorPushProposal
 *    (the last one is what actually POSTs to wallet/p2sh/tx-proposal/sign-and-push).
 *  - TransactionSender#sendTransaction / any updateTransactionState|updateSignatureState|
 *    sendTransactionProposal write (no gas is ever spent, no on-chain state is mutated).
 *
 * Usage (from inside federator/):
 *   npx ts-node ./src/scripts/replayPushProposal.ts [fromBlock] [toBlock] [batchSize] [--validate] [--pin=<blockNumber>]
 *
 * Defaults: fromBlock=496269350 toBlock=496269450 batchSize=450
 */

import log4js from 'log4js';
import { Registry } from 'prom-client';
import { Config } from '../lib/config';
import { LogWrapper } from '../lib/logWrapper';
import { Broker, EvmBroker, HathorBroker } from '../lib/Broker';
import { HathorWallet } from '../lib/HathorWallet';
import { parseSignatureEntry, selectCompleteSignatures } from '../lib/utils';
import {
  HathorFederationFactory,
  IHathorFederationV1,
  BridgeFactory,
  FederationFactory,
  AllowTokensFactory,
  IAllowTokensV1,
} from '../contracts';
import { TransactionTypes, DecodeResponse } from '../types';
import MetricRegister from '../utils/MetricRegister';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const FROM_BLOCK = Number(positional[0] ?? 496269350);
const TO_BLOCK = Number(positional[1] ?? 496269450);
const BATCH_SIZE = Number(positional[2] ?? 450);
const RUN_VALIDATE_TX = args.includes('--validate');
const pinArg = args.find((a) => a.startsWith('--pin='));
const PIN_BLOCK = pinArg ? Number(pinArg.split('=')[1]) : undefined;

interface EventInfo {
  transactionId: string;
  transactionType: number;
  transactionHash: string;
  sender: string;
  receiver: string;
  value: string;
  originalTokenAddress: string;
  blockNumber: number;
  eventName: string;
}

// Deliberately NOT using Logs.getInstance() here: config/log-config.json points its file
// appender at the container-only path /var/log/federator.log (writable inside the docker
// federator service via its volume mount), which throws EACCES when running this script
// locally outside docker. Build a local, console-only log4js logger instead — shared
// config/log-config.json (used by main.ts / the dockerized federator) is left untouched.
function buildLocalLogger(): LogWrapper {
  log4js.configure({
    appenders: { console: { type: 'console' } },
    categories: { default: { appenders: ['console'], level: 'trace' } },
  });
  return new LogWrapper(log4js.getLogger('REPLAY'), 'REPLAY');
}

async function main() {
  const config = Config.getInstance();
  const logger = buildLocalLogger();

  logger.info(
    `Replay (READ-ONLY) fromBlock=${FROM_BLOCK} toBlock=${TO_BLOCK} batchSize=${BATCH_SIZE} ` +
      `validate=${RUN_VALIDATE_TX} pin=${PIN_BLOCK ?? '(live)'}`,
  );

  const hathorFederationContract = new HathorFederationFactory().createInstance() as IHathorFederationV1;
  const rawContract = hathorFederationContract.hathorFederationContract; // public field, used only for pinned reads

  const maxSignaturesEnv = process.env.HEADLESS_MULTISIG_SEED_DEFAULT_NUM_SIGNATURES;
  if (!maxSignaturesEnv) {
    throw new Error('HEADLESS_MULTISIG_SEED_DEFAULT_NUM_SIGNATURES not set in federator/.env');
  }
  logger.info(`Threshold HEADLESS_MULTISIG_SEED_DEFAULT_NUM_SIGNATURES=${maxSignaturesEnv}`);

  // ---- STEP 1: manual, chunked, read-only log scan (no LogsReader, no handleEvent) ----
  const byTxId = new Map<string, EventInfo>();
  for (let cur = FROM_BLOCK; cur <= TO_BLOCK; cur += BATCH_SIZE) {
    const to = Math.min(cur + BATCH_SIZE - 1, TO_BLOCK);
    logger.info(`Scanning allEvents ${cur}-${to}`);
    const events = await hathorFederationContract.getPastEvents('allEvents', { fromBlock: cur, toBlock: to });
    for (const ev of events) {
      if (typeof ev === 'string') continue; // web3 typing allows raw log strings; skip if untyped
      const rv = ev.returnValues as any;
      if (!rv?.transactionId) continue;
      logger.info(
        `event=${ev.event} block=${ev.blockNumber} txHash=${ev.transactionHash} ` +
          `transactionId=${rv.transactionId} member=${rv.member ?? ''}`,
      );
      byTxId.set(rv.transactionId, {
        transactionId: rv.transactionId,
        transactionType: Number(rv.transactionType),
        transactionHash: rv.transactionHash,
        sender: rv.sender,
        receiver: rv.receiver,
        value: rv.value,
        originalTokenAddress: rv.originalTokenAddress,
        blockNumber: Number(ev.blockNumber),
        eventName: ev.event,
      });
    }
  }
  logger.info(`Discovered ${byTxId.size} distinct transactionId(s) in range.`);

  // Helper: read either via the typed wrapper (live) or via the raw contract pinned to PIN_BLOCK.
  const readCall = async (fn: 'isProcessed' | 'isSigned' | 'isProposed' | 'getSignatureCount', callArgs: any[]) => {
    if (PIN_BLOCK === undefined) {
      return (hathorFederationContract as any)[fn](...callArgs);
    }
    try {
      return await rawContract.methods[fn](...callArgs).call({}, PIN_BLOCK);
    } catch (err) {
      logger.warn(
        `Pinned read of ${fn} @block ${PIN_BLOCK} failed (likely non-archive RPC), falling back to live: ${err}`,
      );
      return (hathorFederationContract as any)[fn](...callArgs);
    }
  };

  // Optional broker wiring, built once, only if --validate was passed.
  let evmBroker: EvmBroker | undefined;
  let hathorBroker: HathorBroker | undefined;
  if (RUN_VALIDATE_TX) {
    // Same readiness check Main.start() does before touching the wallet (HathorWallet.ts:45-62)
    // — makes the local headless wallet load/sync the 'multi' wallet from its seed if it hasn't
    // already. This is local wallet-server bookkeeping only: no Hathor transaction is created or
    // broadcast by this call.
    const wallet = HathorWallet.getInstance(config, logger);
    const [ready] = await wallet.areWalletsReady();
    logger.info(`Local multisig wallet ready=${ready}`);

    const register = new Registry();
    const metricRegister = new MetricRegister(register, 'replay_push_proposal');
    const bridgeFactory = new BridgeFactory();
    const federationFactory = new FederationFactory();
    const allowTokensContract = (await new AllowTokensFactory().createInstance(config.mainchain)) as IAllowTokensV1;
    evmBroker = new EvmBroker(config, logger, bridgeFactory, federationFactory, metricRegister);
    hathorBroker = new HathorBroker(
      config,
      logger,
      bridgeFactory,
      federationFactory,
      metricRegister,
      allowTokensContract,
    );
  }

  // ---- STEP 2: replicate pushProposal's decision logic per transactionId (all safe reads) ----
  for (const info of byTxId.values()) {
    logger.info(`\n=== transactionId ${info.transactionId} (event ${info.eventName} @block ${info.blockNumber}) ===`);

    const isProcessed = await readCall('isProcessed', [info.transactionId]);
    const isSigned = await readCall('isSigned', [info.transactionId, process.env.FEDERATOR_ADDRESS]);
    const isProposed = await readCall('isProposed', [info.transactionId]);
    const arrayLength = await readCall('getSignatureCount', [info.transactionId]);

    logger.info(`isProcessed=${isProcessed} isSigned(FEDERATOR_ADDRESS)=${isSigned} isProposed=${isProposed}`);
    logger.info(
      `getSignatureCount=${arrayLength} (threshold=${maxSignaturesEnv}) -> gate ${
        arrayLength < maxSignaturesEnv
          ? 'pushProposal would RETURN early (below threshold)'
          : 'pushProposal would PROCEED'
      }`,
    );

    if (arrayLength < maxSignaturesEnv) {
      continue;
    }

    // getSignaturesFromArray (Broker.ts:456-465) re-reads the count itself — replicate that exactly.
    const freshCount = await readCall('getSignatureCount', [info.transactionId]);
    const signatures: string[] = [];
    for (let i = 0; i < freshCount; i++) {
      const sig =
        PIN_BLOCK === undefined
          ? await hathorFederationContract.transactionSignatures(info.transactionId, i)
          : await rawContract.methods.transactionSignatures(info.transactionId, i).call({}, PIN_BLOCK);
      signatures.push(sig as unknown as string);
    }
    const slice = signatures.slice(0, parseInt(maxSignaturesEnv));

    logger.info(`getSignaturesFromArray -> ${signatures.length} signatures: ${JSON.stringify(signatures)}`);
    logger.info(
      `pushProposal's signatures.slice(0, ${maxSignaturesEnv}) -> ${slice.length} would be sent: ${JSON.stringify(
        slice,
      )}`,
    );

    if (signatures.length > slice.length) {
      logger.warn(
        `On-chain array had ${signatures.length} signatures but slice(0,${maxSignaturesEnv}) caps what ` +
          `pushProposal would actually send at ${slice.length}. This means pushProposal's own code cannot ` +
          `structurally emit more than the configured threshold in a single call — if 5 signatures really ` +
          `reached the wallet, the discrepancy is NOT a naive "sent all 5" bug in this function. Worth checking: ` +
          `(a) whether the array ORDER changed between the count check and this read (race/reordering), and ` +
          `(b) whether a different federator's own pushProposal call, with a different local view of the array, ` +
          `is what actually pushed.`,
      );
    }

    const txHex = await hathorFederationContract.transactionHex(info.transactionId);
    logger.info(`transactionHex length=${txHex.length}`);

    // ---- STEP 3 (optional, --validate): safe validateTx reproduction ----
    if (RUN_VALIDATE_TX) {
      // Raw wallet/decode call first — same endpoint Broker#decodeTxHex uses (read-only,
      // never pushes), but logged here with the FULL response body instead of
      // decodeTxHex's own `${response.status} - ${response.data}` (which stringifies an
      // object to the useless "[object Object]").
      try {
        const decodeResponse = await HathorWallet.getInstance(config, logger).requestWallet<DecodeResponse>(
          true,
          'multi',
          'wallet/decode',
          { txHex },
        );
        logger.info(`wallet/decode -> status=${decodeResponse.status} body=${JSON.stringify(decodeResponse.data)}`);

        // Cross-check using the SAME logic pushProposal now uses (selectCompleteSignatures,
        // src/lib/utils.ts): does each of the naive slice(0,maxSignatures) signers actually
        // cover every input index the decoded tx requires? A signer missing coverage for one of
        // the tx's inputs is exactly the shape of error that manifests on Hathor's side as
        // "Signatures are incompatible with redeemScript".
        const inputCount = decodeResponse.data?.tx?.inputs?.length;
        if (decodeResponse.data?.success && typeof inputCount === 'number') {
          const requiredIndices = Array.from({ length: inputCount }, (_, i) => i);
          logger.info(`Decoded tx requires signatures covering input indices: [${requiredIndices.join(', ')}]`);

          for (const entry of slice) {
            const { pubkey, indices } = parseSignatureEntry(entry);
            const missing = requiredIndices.filter((idx) => !indices.includes(idx));
            if (missing.length > 0) {
              logger.warn(
                `[BEFORE FIX] naive slice(0,${maxSignaturesEnv}): signer ${pubkey} only covers input indices ` +
                  `[${indices.join(', ')}], MISSING [${missing.join(', ')}] — this is exactly what produces Hathor's ` +
                  `"Signatures are incompatible with redeemScript" rejection.`,
              );
            } else {
              logger.info(`[BEFORE FIX] naive slice(0,${maxSignaturesEnv}): signer ${pubkey} covers all inputs.`);
            }
          }

          const fixedSelection = selectCompleteSignatures(signatures, inputCount).slice(0, parseInt(maxSignaturesEnv));
          logger.info(
            `[AFTER FIX] selectCompleteSignatures(...).slice(0,${maxSignaturesEnv}) -> ` +
              `${fixedSelection.length} signer(s) would be sent: ` +
              `${JSON.stringify(fixedSelection.map((e) => parseSignatureEntry(e).pubkey))}`,
          );
          if (fixedSelection.length < parseInt(maxSignaturesEnv)) {
            logger.warn(
              `[AFTER FIX] Not enough complete signatures yet (${fixedSelection.length}/${maxSignaturesEnv}) — ` +
                `the fixed pushProposal would wait instead of pushing, matching its new early-return behavior.`,
            );
          }
        }
      } catch (err) {
        logger.error(`wallet/decode call itself failed: ${err}`);
      }

      const broker: Broker = info.transactionType === TransactionTypes.MELT ? hathorBroker! : evmBroker!;
      try {
        const valid = await broker.validateTx(txHex, info.transactionHash, info.transactionId);
        logger.info(`validateTx(...) -> ${valid}`);
      } catch (err) {
        logger.error(`validateTx threw (this itself may be the real rejection reason): ${err}`);
      }
    }
  }

  logger.info('\nDone. No wallet sign-and-push call and no on-chain write were made by this script.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
