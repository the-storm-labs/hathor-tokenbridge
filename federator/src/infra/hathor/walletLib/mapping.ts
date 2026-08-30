import type { IHistoryTx } from '@hathor/wallet-lib/lib/types';

import type { DecodedTx, TxInput, TxOutput } from '../../../domain/types';

/**
 * Translation from wallet-lib's history shapes into the domain's.
 *
 * Unlike the headless adapter's mapping, nothing has to be widened here: wallet-lib 4.x already
 * types values as `OutputValueType`, which is `bigint`. The conversion this file exists for is the
 * naming one - snake_case wire fields to the domain's names - plus filling in the defaults for the
 * fields wallet-lib marks optional.
 */

function mapDecoded(decoded: { type?: string; address?: string; timelock?: number | null } | undefined) {
  return {
    type: decoded?.type,
    address: decoded?.address,
    timelock: decoded?.timelock,
  };
}

export function mapHistoryInput(input: IHistoryTx['inputs'][number]): TxInput {
  return {
    value: input.value ?? 0n,
    tokenData: input.token_data ?? 0,
    script: input.script ?? '',
    token: input.token ?? '',
    decoded: mapDecoded(input.decoded),
    txId: input.tx_id,
    index: input.index,
  };
}

export function mapHistoryOutput(output: IHistoryTx['outputs'][number]): TxOutput {
  // Shielded outputs carry no transparent value or script; they are not something the bridge can
  // act on, so they map to a zero-value entry rather than being dropped - dropping would shift the
  // output indices that signatures are keyed by.
  const transparent = output as Partial<{
    value: bigint;
    token_data: number;
    script: string;
    token: string;
    decoded: { type?: string; address?: string; timelock?: number | null };
    spent_by: string | null;
  }>;

  return {
    value: transparent.value ?? 0n,
    tokenData: transparent.token_data ?? 0,
    script: transparent.script ?? '',
    token: transparent.token ?? '',
    decoded: mapDecoded(transparent.decoded),
    spentBy: transparent.spent_by,
  };
}

export function mapHistoryTx(tx: IHistoryTx): DecodedTx & { txId: string; timestamp: number } {
  return {
    txId: tx.tx_id,
    version: tx.version,
    timestamp: tx.timestamp,
    isVoided: tx.is_voided,
    inputs: tx.inputs.map(mapHistoryInput),
    outputs: tx.outputs.map(mapHistoryOutput),
  };
}
