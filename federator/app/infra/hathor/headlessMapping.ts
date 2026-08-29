import type { DecodedTx, TxInput, TxOutput } from '../../domain/types';
import type { HeadlessTx, HeadlessTxIo } from './headlessTypes';

/**
 * Translation from the headless wallet's JSON into the domain's shapes.
 *
 * The one thing that matters here is that every value crosses into `bigint`. The headless
 * serialises amounts as JSON numbers, which is exactly why the old code could carry them as
 * `number` throughout without noticing; the domain is bigint, so the conversion has to happen
 * somewhere, and the adapter boundary is that somewhere.
 */

export function toBigInt(value: number | string | undefined, field: string): bigint {
  if (value === undefined) {
    return 0n;
  }
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new TypeError(`${field} is not an integer: ${value}`);
    }
    if (!Number.isSafeInteger(value)) {
      // Past 2^53 the JSON number has already lost precision before we ever saw it. Converting it
      // silently would launder that loss into an exact-looking bigint.
      throw new TypeError(
        `${field} arrived as ${value}, beyond Number.MAX_SAFE_INTEGER - its precision is already lost.`,
      );
    }
    return BigInt(value);
  }
  return BigInt(value);
}

function mapDecoded(io: HeadlessTxIo) {
  return {
    type: io.decoded?.type,
    address: io.decoded?.address,
    timelock: io.decoded?.timelock,
  };
}

export function mapInput(io: HeadlessTxIo, index: number): TxInput {
  return {
    value: toBigInt(io.value, `input[${index}].value`),
    tokenData: io.token_data ?? io.tokenData ?? 0,
    script: io.script ?? '',
    token: io.token ?? '',
    decoded: mapDecoded(io),
    txId: io.tx_id ?? io.txId,
    index: io.index,
    mine: io.mine,
  };
}

export function mapOutput(io: HeadlessTxIo, index: number): TxOutput {
  return {
    value: toBigInt(io.value, `output[${index}].value`),
    tokenData: io.token_data ?? io.tokenData ?? 0,
    script: io.script ?? '',
    token: io.token ?? '',
    decoded: mapDecoded(io),
    spentBy: io.spent_by,
    mine: io.mine,
  };
}

export function mapTx(tx: HeadlessTx): DecodedTx {
  return {
    txId: tx.tx_id ?? tx.txId,
    version: tx.version,
    timestamp: tx.timestamp,
    isVoided: tx.is_voided,
    inputs: (tx.inputs ?? []).map(mapInput),
    outputs: (tx.outputs ?? []).map(mapOutput),
  };
}
