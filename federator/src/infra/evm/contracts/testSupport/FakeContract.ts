import type { EventLog } from 'web3';

import type { ContractCall, ContractLike } from '../contractAccess';

/**
 * A contract whose methods and events are scripted, so an adapter's real logic - its caching, its
 * event mapping, its argument order - can be driven without a chain.
 */
export class FakeContract implements ContractLike {
  public readonly options: { address?: string };
  public readonly methods: Record<string, ((...args: unknown[]) => ContractCall<unknown>) | undefined> = {};
  public events: (string | EventLog)[] = [];

  /** Every call made, in order, for asserting on argument shape. */
  public readonly calls: Array<{ name: string; args: unknown[]; from?: string | undefined }> = [];
  public readonly eventQueries: Array<{ eventName: string; options: Record<string, unknown> }> = [];

  constructor(address = '0xCONTRACT') {
    this.options = { address };
  }

  /** Scripts a method: `result` may be a value or a function of the call arguments. */
  on(name: string, result: unknown | ((...args: unknown[]) => unknown)): this {
    this.methods[name] = (...args: unknown[]) => {
      const call: ContractCall<unknown> = {
        call: async (options?: { from?: string }) => {
          this.calls.push({ name, args, from: options?.from });
          return typeof result === 'function' ? (result as (...a: unknown[]) => unknown)(...args) : result;
        },
        encodeABI: () => {
          this.calls.push({ name, args });
          return `0x${name}`;
        },
      };
      return call;
    };
    return this;
  }

  async getPastEvents(eventName: string, options: Record<string, unknown>): Promise<(string | EventLog)[]> {
    this.eventQueries.push({ eventName, options });
    return this.events;
  }

  /** Arguments the named method was last called with. */
  argsFor(name: string): unknown[] | undefined {
    return [...this.calls].reverse().find((call) => call.name === name)?.args;
  }

  countOf(name: string): number {
    return this.calls.filter((call) => call.name === name).length;
  }
}
