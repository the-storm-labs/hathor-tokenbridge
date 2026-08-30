import dotenv from 'dotenv';

import { buildFederator } from '../composition/container';
import { loadConfig } from '../config/load';
import { TransactionType } from '../domain/transactionTypes';
import { configureLogging, federatorLogging } from '../infra/logging/Log4jsLogger';

/**
 * ⚠️  REAL EXECUTION - NOT A DRY RUN.  ⚠️
 *
 * Advances ONE transfer by whatever step the contract state says is outstanding: propose, sign, or
 * push. If the state calls for a push and the signatures are there, this WILL broadcast a real
 * Hathor transaction and send a real transaction from FEDERATOR_KEY.
 *
 * Replaces scripts/executePushProposal.ts. It is short now because the coordinator already does
 * exactly this - "do the step that is outstanding for this transfer" is the federator's whole job,
 * so a tool for one transfer is the same call the reader makes per event, with the loop removed.
 *
 * Scoped to one transactionId on purpose, and the id is required rather than inferred: running the
 * federator instead would walk the whole history and act on everything else pending too.
 *
 * Run inspectProposals.ts first. It shows the same state without touching anything.
 *
 *   npx ts-node ./src/scripts/advanceTransfer.ts <transactionId> <fromBlock> <toBlock>
 */
async function main(): Promise<void> {
  dotenv.config();

  const [transactionId, fromArg, toArg] = process.argv.slice(2);
  if (!transactionId || !fromArg || !toArg) {
    process.stderr.write('usage: advanceTransfer.ts <transactionId> <fromBlock> <toBlock>\n');
    process.exit(1);
  }

  const config = loadConfig(process.env);
  configureLogging(federatorLogging({ file: config.runtime.logFile, level: config.runtime.logLevel }));

  const federator = buildFederator(config);
  await federator.wallet.start();

  // The transfer's own fields come from the contract's events rather than from the command line:
  // every federator derives the transaction id from them, so a typed-in value that differed by one
  // character would act on a different transfer entirely.
  const events = await federator.federation.getEvents(Number(fromArg), Number(toArg));
  const event = events.find((candidate) => candidate.kind !== 'lock' && candidate.transactionId === transactionId);

  if (!event || event.kind === 'lock') {
    process.stderr.write(`No event for ${transactionId} in blocks ${fromArg}..${toArg}.\n`);
    process.exit(1);
  }

  if (await federator.federation.isProcessed(transactionId)) {
    process.stdout.write(`${transactionId} is already processed; nothing to do.\n`);
    process.exit(0);
  }

  process.stdout.write(`Advancing ${transactionId} (${TransactionType[event.transactionType]})...\n`);

  if (event.transactionType === TransactionType.MELT) {
    await federator.hathorToEvm.transfer({
      hathorSenderAddress: event.sender,
      evmReceiverAddress: event.receiver,
      hathorAmount: event.value,
      hathorTokenAddress: event.originalTokenAddress,
      hathorTxId: event.transactionHash,
    });
  } else {
    await federator.evmToHathor.transfer({
      senderAddress: event.sender,
      receiverAddress: event.receiver,
      evmAmount: event.value,
      evmTokenAddress: event.originalTokenAddress,
      transactionHash: event.transactionHash,
    });
  }

  const processed = await federator.federation.isProcessed(transactionId);
  process.stdout.write(`Done. processed=${processed}\n`);

  await federator.wallet.stop();
  process.exit(0);
}

void main().catch((error) => {
  process.stderr.write(`advanceTransfer failed: ${String(error)}\n`);
  process.exit(1);
});
