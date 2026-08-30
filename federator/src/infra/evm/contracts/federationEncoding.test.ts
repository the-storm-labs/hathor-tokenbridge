import Web3 from 'web3';

import { TransactionType } from '../../../domain/transactionTypes';
import { fromBytes32Address, toBytes32, toFederationEvent, toTransfer } from './federationEncoding';

const TOKEN = '0x684a8a976635fb7ad74a0134ace990a6a0fcce84';
const PADDED_TOKEN = '0x000000000000000000000000684a8a976635fb7ad74a0134ace990a6a0fcce84';
/** A Hathor token uid: genuinely 32 bytes, not a padded address. */
const HATHOR_TOKEN = '0000091b1e3609e661f72efaac78ac96f9321cc97ac2c257f349c2553edaeeac';

const noProblem = () => undefined;

describe('toBytes32', () => {
  it('left-pads an address to 32 bytes', () => {
    expect(toBytes32(TOKEN)).toBe(PADDED_TOKEN);
  });

  it('accepts a value with or without the 0x prefix, identically', () => {
    // Every federator must encode identically or they derive different transaction ids.
    expect(toBytes32(TOKEN.slice(2))).toBe(toBytes32(TOKEN));
  });

  it('leaves an already 32-byte value alone', () => {
    expect(toBytes32(`0x${HATHOR_TOKEN}`)).toBe(`0x${HATHOR_TOKEN}`);
  });

  it('matches what the previous implementation produced', () => {
    // The old code padded with web3.utils.padLeft to 64 after prefixing - reproduced here to make
    // the equivalence a test rather than a reading of the diff.
    const legacy = (param: string) => {
      let result = param.indexOf('0x') < 0 ? `0x${param}` : param;
      if (param.length < 64) {
        result = Web3.utils.padLeft(result, 64);
      }
      return result;
    };

    for (const value of [TOKEN, TOKEN.slice(2), `0x${HATHOR_TOKEN}`, HATHOR_TOKEN]) {
      expect(toBytes32(value)).toBe(legacy(value));
    }
  });
});

describe('fromBytes32Address', () => {
  it('recovers the address from a padded value, checksummed', () => {
    expect(fromBytes32Address(PADDED_TOKEN)).toBe(Web3.utils.toChecksumAddress(TOKEN));
  });

  it('matches the character-walking implementation it replaces', () => {
    // The old code walked from the start until isAddress accepted the remainder.
    const legacy = (address: string) => {
      let i = -1;
      let exit = false;
      let result = address;
      while (!exit && i < address.length) {
        i++;
        result = '0x' + address.substring(i);
        exit = Web3.utils.isAddress(result);
      }
      return Web3.utils.toChecksumAddress(result);
    };

    expect(fromBytes32Address(PADDED_TOKEN)).toBe(legacy(PADDED_TOKEN));
  });

  it('refuses a value that is not a padded address rather than truncating it', () => {
    // A Hathor token uid has 40 hex characters at the end too - they just are not an address.
    expect(() => fromBytes32Address('0xzz')).toThrow(/does not contain a 20-byte address/);
  });
});

describe('toTransfer', () => {
  const base = {
    transactionId: '0xabc',
    transactionHash: '0xdeadbeef',
    value: '1500',
    sender: 'HSENDER',
    receiver: '0xRECEIVER',
  };

  it('un-pads the token address for a mint', () => {
    const transfer = toTransfer(
      { ...base, originalTokenAddress: PADDED_TOKEN, transactionType: TransactionType.MINT },
      noProblem,
    );
    expect(transfer.originalTokenAddress).toBe(Web3.utils.toChecksumAddress(TOKEN));
    expect(transfer.value).toBe(1500n);
    expect(transfer.transactionHash).toBe('deadbeef');
  });

  it('leaves a melt token untouched, because it is a Hathor uid and not an address', () => {
    // Un-padding this would corrupt the token id, and every melt would target the wrong token.
    const transfer = toTransfer(
      { ...base, originalTokenAddress: `0x${HATHOR_TOKEN}`, transactionType: TransactionType.MELT },
      noProblem,
    );
    expect(transfer.originalTokenAddress).toBe(HATHOR_TOKEN);
  });

  it('reports a token it cannot read and passes it through rather than guessing', () => {
    const problems: string[] = [];
    const transfer = toTransfer(
      { ...base, originalTokenAddress: '0xnot-hex', transactionType: TransactionType.TRANSFER },
      (message) => problems.push(message),
    );

    expect(problems[0]).toMatch(/Could not read an address/);
    expect(transfer.originalTokenAddress).toBe('not-hex');
  });

  it('treats a missing value as zero rather than failing to parse', () => {
    const transfer = toTransfer({ transactionType: TransactionType.MELT }, noProblem);
    expect(transfer.value).toBe(0n);
    expect(transfer.originalTokenAddress).toBe('');
  });

  it('reads the value as bigint, whatever the contract hands back', () => {
    const huge = (2n ** 90n).toString();
    expect(
      toTransfer({ ...base, value: huge, originalTokenAddress: PADDED_TOKEN, transactionType: 1 }, noProblem).value,
    ).toBe(2n ** 90n);
  });
});

describe('toFederationEvent', () => {
  const values = {
    transactionId: '0xabc',
    originalTokenAddress: PADDED_TOKEN,
    transactionHash: '0xdeadbeef',
    value: '1500',
    sender: 'HSENDER',
    receiver: '0xRECEIVER',
    transactionType: TransactionType.MINT,
  };

  it.each([
    ['TransactionProposed', 'proposed'],
    ['ProposalSigned', 'signed'],
    ['ProposalSent', 'sent'],
    ['TransactionFailed', 'failed'],
  ])('maps %s onto %s', (eventName, kind) => {
    expect(toFederationEvent(eventName, { ...values, txHex: '0xbeef' }, noProblem)?.kind).toBe(kind);
  });

  it('maps a lock event, which carries only the transaction hex', () => {
    expect(toFederationEvent('LockTransactionHex', { txHex: '0xbeef' }, noProblem)).toEqual({
      kind: 'lock',
      txHex: 'beef',
    });
  });

  it('ignores contract events the bridge has no part in', () => {
    // MemberAddition and OwnershipTransferred are real events, not anomalies.
    expect(toFederationEvent('MemberAddition', { member: '0x1' }, noProblem)).toBeUndefined();
    expect(toFederationEvent('OwnershipTransferred', {}, noProblem)).toBeUndefined();
    expect(toFederationEvent(undefined, {}, noProblem)).toBeUndefined();
  });

  it('fills in defaults rather than emitting the string "undefined"', () => {
    // A contract event with a field missing must not become `"undefined"` travelling downstream,
    // where it would be compared against real ids and silently never match.
    for (const eventName of ['TransactionProposed', 'ProposalSigned', 'ProposalSent', 'TransactionFailed']) {
      const event = toFederationEvent(eventName, {}, noProblem);
      expect(event).toBeDefined();
      // JSON.stringify refuses a bigint, so the values are inspected directly.
      expect(Object.values(event as unknown as Record<string, unknown>).map(String)).not.toContain('undefined');
      expect(event).toMatchObject({ transactionId: '', transactionHash: '', sender: '', receiver: '' });
    }
  });

  it('defaults a lock event with no hex to an empty string', () => {
    expect(toFederationEvent('LockTransactionHex', {}, noProblem)).toEqual({ kind: 'lock', txHex: '' });
  });

  it('carries the signature and member through on a signed event', () => {
    const event = toFederationEvent(
      'ProposalSigned',
      { ...values, member: '0xFED', signed: true, signature: 'pub|0:aaaa' },
      noProblem,
    );
    expect(event).toMatchObject({ kind: 'signed', member: '0xFED', signed: true, signature: 'pub|0:aaaa' });
  });

  it('strips the 0x from a settled Hathor transaction id', () => {
    const event = toFederationEvent('ProposalSent', { ...values, processed: true, hathorTxId: '0xfeed' }, noProblem);
    expect(event).toMatchObject({ kind: 'sent', processed: true, hathorTxId: 'feed' });
  });
});
