import dotenv from 'dotenv';

import { buildFederator } from '../composition/container';
import { loadConfig } from '../config/load';
import { selectCompleteSignatures } from '../domain/signatures';
import { TransactionType } from '../domain/transactionTypes';
import { configureLogging, federatorLogging } from '../infra/logging/Log4jsLogger';

/**
 * READ-ONLY. Replays what the federator would decide for every transfer the HathorFederation
 * contract mentions in a block range, without acting on any of it.
 *
 * Replaces scripts/replayPushProposal.ts, which reproduced the old Broker's push arithmetic by
 * hand. Here the arithmetic is the real one: the same `selectCompleteSignatures` the coordinator
 * uses, against the same port. A tool that reimplements the logic it is diagnosing tells you about
 * the reimplementation.
 *
 * Nothing here writes. It reads contract state, reads the wallet, and prints - no proposal is
 * built, no signature submitted, no transaction pushed, no gas spent.
 *
 *   npx ts-node ./src/scripts/inspectProposals.ts <fromBlock> <toBlock>
 */
async function main(): Promise<void> {
  dotenv.config();

  const [fromArg, toArg] = process.argv.slice(2);
  if (!fromArg || !toArg) {
    process.stderr.write('usage: inspectProposals.ts <fromBlock> <toBlock>\n');
    process.exit(1);
  }

  const config = loadConfig(process.env);
  configureLogging(federatorLogging({ file: config.runtime.logFile, level: 'warn' }));

  const federator = buildFederator(config);
  await federator.wallet.start();

  const events = await federator.federation.getEvents(Number(fromArg), Number(toArg));
  const transfers = new Map<string, { type: TransactionType; hash: string }>();
  for (const event of events) {
    if (event.kind !== 'lock') {
      transfers.set(event.transactionId, { type: event.transactionType, hash: event.transactionHash });
    }
  }

  const out = (line: string) => process.stdout.write(`${line}\n`);
  out(`${transfers.size} transfer(s) mentioned in blocks ${fromArg}..${toArg}`);
  out(`quorum: ${config.hathor.multisig.numSignatures} of ${config.hathor.multisig.pubkeys.length}\n`);

  for (const [transactionId, { type, hash }] of transfers) {
    const processed = await federator.federation.isProcessed(transactionId);
    const proposed = await federator.federation.isProposed(transactionId);
    const signedByUs = await federator.federation.isSigned(transactionId, config.federator.address);
    const signatures = await federator.federation.getSignatures(transactionId);

    out(`${transactionId}  ${TransactionType[type]}  origin tx ${hash}`);
    out(`  processed=${processed} proposed=${proposed} signedByThisFederator=${signedByUs}`);
    out(`  signatures stored: ${signatures.length}`);

    if (!proposed || processed) {
      out('');
      continue;
    }

    // The number that actually decides a push: how many of the stored signatures cover every
    // input. Selecting by array position instead is what breaks a push with "Signatures are
    // incompatible with redeemScript".
    const txHex = await federator.federation.getTransactionHex(transactionId);
    const { inputs } = await federator.wallet.decodeTxHex(txHex);
    const complete = selectCompleteSignatures(signatures, inputs.length);

    out(`  inputs: ${inputs.length}  |  signatures covering all inputs: ${complete.length}`);
    out(
      complete.length >= config.hathor.multisig.numSignatures
        ? '  -> a push would go ahead'
        : `  -> waiting: ${config.hathor.multisig.numSignatures - complete.length} more complete signature(s) needed`,
    );
    out('');
  }

  await federator.wallet.stop();
  process.exit(0);
}

void main().catch((error) => {
  process.stderr.write(`inspectProposals failed: ${String(error)}\n`);
  process.exit(1);
});
