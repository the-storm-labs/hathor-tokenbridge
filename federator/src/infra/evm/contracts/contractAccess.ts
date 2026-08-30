import type Web3 from 'web3';
import type { ContractAbi, EventLog } from 'web3';

/**
 * A typed window onto a web3 contract.
 *
 * web3 types `contract.methods` as an index signature whose members may be undefined, and
 * `getPastEvents` only accepts the event names it can prove exist on a generic ABI. Under strict
 * TypeScript that makes every call site a cast. Doing it once, here, keeps the casts in one place
 * where the ABI assumption is stated rather than scattered through the adapters.
 */
export interface ContractCall<T> {
  call(options?: { from?: string }): Promise<T>;
  encodeABI(): string;
}

type ContractMethods = Record<string, ((...args: unknown[]) => ContractCall<unknown>) | undefined>;

/**
 * The narrow shape the adapters actually use.
 *
 * They depend on this rather than on web3's `Contract` class, which is what lets them be driven
 * offline: their caching, their event mapping and their argument order are real logic, and none of
 * it should need a chain to exercise.
 */
export interface ContractLike {
  readonly options: { readonly address?: string | undefined };
  readonly methods: ContractMethods;
  getPastEvents(eventName: string, options: Record<string, unknown>): Promise<(string | EventLog)[]>;
}

/** Builds the real thing. The only place an adapter's dependency meets web3. */
export function contractAt(web3: Web3, abi: unknown, address: string): ContractLike {
  return new web3.eth.Contract(abi as ContractAbi, address) as unknown as ContractLike;
}

/**
 * Looks up a contract method by name, failing loudly when the ABI does not have it.
 *
 * An ABI that has drifted from the code is otherwise a `undefined is not a function` at the moment
 * a transfer is being processed, which says nothing about which contract or which method.
 */
export function method(contract: ContractLike, name: string, ...args: unknown[]): ContractCall<unknown> {
  const fn = contract.methods[name];
  if (typeof fn !== 'function') {
    throw new Error(
      `The ABI for the contract at ${contract.options.address} has no method "${name}". ` +
        `The deployed contract and the bundled ABI have diverged.`,
    );
  }
  return fn(...args);
}

export interface PastEventsReader {
  (eventName: string, options: Record<string, unknown>): Promise<(string | EventLog)[]>;
}

export function pastEventsOf(contract: ContractLike): PastEventsReader {
  return contract.getPastEvents.bind(contract);
}
