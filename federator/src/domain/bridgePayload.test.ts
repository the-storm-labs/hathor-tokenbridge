import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  isBridgeTransaction,
  outputCarriesDestination,
  readDestination,
  readDestinationFromScript,
} from './bridgePayload';
import { output, tx } from './testSupport/builders';

/**
 * Fixtures recorded from the real wallet event stream. Using them keeps this test honest about
 * the actual on-chain script encoding rather than one invented to match the parser.
 */
const FIXTURES = join(__dirname, '../testSupport/fixtures');
const loadFixture = (name: string) => {
  const parsed = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
  return parsed.data ?? parsed;
};

const EXPECTED_DESTINATION = '0xE23d59ef0c1F63B53234b00a1e1EaBEf822397D2';

/** Builds the data-output script Hathor uses: <len> <data> OP_CHECKSIG, base64 encoded. */
function dataScript(payload: string): string {
  const data = Buffer.from(payload, 'utf-8');
  return Buffer.concat([Buffer.from([data.length]), data, Buffer.from([0xac])]).toString('base64');
}

describe('readDestinationFromScript', () => {
  it('reads the EVM address out of a recorded data output', () => {
    const fixture = loadFixture('tx-transfer-to-evm.json');
    const scripts: string[] = fixture.outputs.map((o: { script: string }) => o.script);
    const found = scripts.map(readDestinationFromScript).filter(Boolean);
    expect(found).toEqual([EXPECTED_DESTINATION]);
  });

  it('returns undefined for an ordinary address output rather than throwing', () => {
    // Most outputs are not data outputs. Failing to parse as data is the normal case, not an error.
    const fixture = loadFixture('tx-transfer-to-evm.json');
    expect(readDestinationFromScript(fixture.inputs[0].script)).toBeUndefined();
  });

  it.each([
    ['empty script', ''],
    ['one byte', Buffer.from([0x01]).toString('base64')],
    ['declared length longer than the script', Buffer.from([0x05, 0x61, 0x62, 0xac]).toString('base64')],
    ['missing OP_CHECKSIG', Buffer.from([0x02, 0x61, 0x62]).toString('base64')],
    ['not base64 at all', 'not-base-64!!'],
  ])('returns undefined for a malformed script: %s', (_label, script) => {
    expect(readDestinationFromScript(script)).toBeUndefined();
  });

  it('returns undefined when the data parses but is not an address', () => {
    expect(readDestinationFromScript(dataScript('hello world'))).toBeUndefined();
  });

  it('reads an address written into a synthetic data output', () => {
    expect(readDestinationFromScript(dataScript(EXPECTED_DESTINATION))).toBe(EXPECTED_DESTINATION);
  });
});

describe('isBridgeTransaction', () => {
  it('is true for a recorded transfer to the EVM side', () => {
    expect(isBridgeTransaction({ outputs: loadFixture('tx-transfer-to-evm.json').outputs })).toBe(true);
  });

  it('is false for a transaction with no data output', () => {
    expect(isBridgeTransaction(tx({ outputs: [output()] }))).toBe(false);
  });
});

describe('outputCarriesDestination', () => {
  it('distinguishes a data output from an address output', () => {
    expect(outputCarriesDestination({ script: dataScript(EXPECTED_DESTINATION) })).toBe(true);
    expect(outputCarriesDestination({ script: '' })).toBe(false);
  });
});

describe('readDestination', () => {
  it('returns the destination of a recorded transaction', () => {
    expect(readDestination({ outputs: loadFixture('tx-transfer-to-evm.json').outputs })).toBe(EXPECTED_DESTINATION);
  });

  it('returns undefined when there is no destination', () => {
    expect(readDestination(tx({ outputs: [output()] }))).toBeUndefined();
  });

  it('tolerates the same destination repeated across outputs', () => {
    const repeated = tx({
      outputs: [
        output({ script: dataScript(EXPECTED_DESTINATION) }),
        output({ script: dataScript(EXPECTED_DESTINATION) }),
      ],
    });
    expect(readDestination(repeated)).toBe(EXPECTED_DESTINATION);
  });

  it('refuses to guess between two different destinations', () => {
    // The previous implementation concatenated them, producing a string that is not an address
    // and cannot be delivered to - a silent corruption rather than a refusal.
    const other = '0x1111111111111111111111111111111111111111';
    const ambiguous = tx({
      outputs: [output({ script: dataScript(EXPECTED_DESTINATION) }), output({ script: dataScript(other) })],
    });
    expect(() => readDestination(ambiguous)).toThrow(/2 different bridge destinations/);
  });
});
