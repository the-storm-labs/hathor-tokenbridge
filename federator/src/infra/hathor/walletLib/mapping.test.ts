import { mapHistoryTx } from './mapping';

describe('mapHistoryTx', () => {
  const tx = {
    tx_id: 'abc',
    version: 1,
    weight: 18,
    timestamp: 1_700_000_000,
    is_voided: false,
    parents: [],
    inputs: [
      {
        value: 150n,
        token_data: 1,
        script: 'aW5wdXQ=',
        token: 'TOKEN',
        decoded: { type: 'P2PKH', address: 'HSENDER', timelock: null },
        tx_id: 'parent',
        index: 0,
      },
    ],
    outputs: [
      {
        value: 150n,
        token_data: 1,
        script: 'b3V0cHV0',
        token: 'TOKEN',
        decoded: { type: 'MultiSig', address: 'HMULTISIG', timelock: null },
        spent_by: null,
      },
    ],
  };

  it('maps the wire names onto the domain names', () => {
    const mapped = mapHistoryTx(tx as never);
    expect(mapped).toMatchObject({ txId: 'abc', version: 1, timestamp: 1_700_000_000, isVoided: false });
    expect(mapped.inputs[0]).toMatchObject({ tokenData: 1, txId: 'parent', index: 0 });
    expect(mapped.outputs[0]).toMatchObject({ tokenData: 1, spentBy: null });
  });

  it('keeps values as bigint - the library already types them that way', () => {
    const mapped = mapHistoryTx(tx as never);
    expect(mapped.inputs[0]?.value).toBe(150n);
    expect(mapped.outputs[0]?.value).toBe(150n);
  });

  it('survives values beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = { ...tx, outputs: [{ ...tx.outputs[0], value: 2n ** 70n }] };
    expect(mapHistoryTx(huge as never).outputs[0]?.value).toBe(2n ** 70n);
  });

  it('fills in defaults for the fields the library marks optional', () => {
    const sparse = { ...tx, inputs: [{ tx_id: 'parent', index: 0 }], outputs: [{}] };
    const mapped = mapHistoryTx(sparse as never);
    expect(mapped.inputs[0]).toMatchObject({ value: 0n, tokenData: 0, script: '', token: '' });
    expect(mapped.outputs[0]).toMatchObject({ value: 0n, tokenData: 0, script: '', token: '' });
  });

  it('does not drop an output it cannot read, so output indices stay aligned', () => {
    // Signatures are keyed by output index; dropping one would silently shift every later index.
    const withShielded = { ...tx, outputs: [{ type: 'shielded', commitment: 'x' }, tx.outputs[0]] };
    const mapped = mapHistoryTx(withShielded as never);
    expect(mapped.outputs).toHaveLength(2);
    expect(mapped.outputs[1]?.value).toBe(150n);
  });

  it('carries a missing decoded field through as undefined rather than inventing one', () => {
    const noDecode = { ...tx, outputs: [{ ...tx.outputs[0], decoded: undefined }] };
    const mapped = mapHistoryTx(noDecode as never);
    expect(mapped.outputs[0]?.decoded).toEqual({ type: undefined, address: undefined, timelock: undefined });
  });
});
