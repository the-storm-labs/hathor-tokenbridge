import { scriptsUtils } from '@hathor/wallet-lib';
import { isAddress } from 'web3-utils';

import type { DecodedTx, TxOutput } from './types';

/**
 * A Hathor transaction tells the bridge where to deliver on the EVM side by carrying the
 * destination address in a data output - an output whose script is `<len> <data> OP_CHECKSIG`
 * rather than an address script.
 *
 * Script parsing is delegated to @hathor/wallet-lib's own `parseScriptData`. The previous code
 * carried a ~180-line copy of it (utils/scripts.ts, opcodes.ts, script_data.ts), taken from an
 * older version of the library. Now that the library is a direct dependency, keeping a copy only
 * risks drifting from the protocol it is supposed to implement. The two were compared over every
 * script in the recorded fixtures plus deliberately malformed ones, and agree on both the parsed
 * data and the rejection paths.
 */

/**
 * Reads the bridge destination out of a single output's script.
 *
 * @returns the EVM address, or undefined when the output is not a data output or its data is not
 *          an address. Malformed scripts are not an error here: most outputs are ordinary address
 *          outputs, and failing to parse as data is the normal case.
 */
export function readDestinationFromScript(scriptBase64: string): string | undefined {
  let parsed: { data: string };
  try {
    parsed = scriptsUtils.parseScriptData(Buffer.from(scriptBase64, 'base64'));
  } catch {
    return undefined;
  }

  return isAddress(parsed.data) ? parsed.data : undefined;
}

/** Whether an output carries a bridge destination. */
export function outputCarriesDestination(output: Pick<TxOutput, 'script'>): boolean {
  return readDestinationFromScript(output.script) !== undefined;
}

/** Whether a transaction is addressed to the bridge at all. */
export function isBridgeTransaction(tx: Pick<DecodedTx, 'outputs'>): boolean {
  return tx.outputs.some(outputCarriesDestination);
}

/**
 * Reads the EVM destination a transaction is addressed to.
 *
 * A transaction carrying more than one destination is ambiguous - the previous implementation
 * concatenated them, which yields a string that is not an address and cannot be delivered to - so
 * it is reported as such rather than silently resolved to the first or to a merged value.
 *
 * @returns the destination, or undefined when the transaction carries none.
 */
export function readDestination(tx: Pick<DecodedTx, 'outputs'>): string | undefined {
  const destinations = new Set(
    tx.outputs
      .map((output) => readDestinationFromScript(output.script))
      .filter((address): address is string => address !== undefined),
  );

  if (destinations.size === 0) {
    return undefined;
  }
  if (destinations.size > 1) {
    throw new Error(
      `Transaction carries ${destinations.size} different bridge destinations: ` +
        `${[...destinations].join(', ')}. Refusing to guess which one is intended.`,
    );
  }

  return [...destinations][0] as string;
}
