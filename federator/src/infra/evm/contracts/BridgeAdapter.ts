import type Web3 from 'web3';
import type { EventLog } from 'web3';

import bridgeAbi from '../../../../../bridge/abi/Bridge.json';
import tokenAbi from '../../../../../bridge/abi/MainToken.json';
import type { BridgePort, CrossEvent, TokenMapping } from '../../../ports/BridgePort';
import type { LoggerPort } from '../../../ports/LoggerPort';
import { type ContractLike, contractAt, method, pastEventsOf } from './contractAccess';

/**
 * The Bridge contract: its token registry, and the `Cross` events it emits when funds are locked.
 *
 * Token mappings and decimals are cached. They are immutable once a token is registered, and the
 * previous code re-read them per event - the mapping twice per transfer, once to route it and
 * again to validate it.
 */
export class BridgeAdapter implements BridgePort {
  private readonly web3: Web3;
  private readonly contract: ContractLike;
  private readonly logger: LoggerPort;

  private readonly mappingsByEvm = new Map<string, TokenMapping>();
  private readonly mappingsByHathor = new Map<string, TokenMapping>();
  private readonly decimals = new Map<string, number>();

  constructor(web3: Web3, address: string, logger: LoggerPort, contract?: ContractLike) {
    this.web3 = web3;
    this.contract = contract ?? contractAt(web3, bridgeAbi, address);
    this.logger = logger;
  }

  async mappingByEvmToken(evmToken: string): Promise<TokenMapping> {
    const cached = this.mappingsByEvm.get(evmToken.toLowerCase());
    if (cached) {
      return cached;
    }

    const hathorToken = (await method(this.contract, 'EvmToHathorTokenMap', evmToken).call()) as string;
    if (!hathorToken) {
      throw new Error(`The bridge has no Hathor token registered for ${evmToken}.`);
    }
    return this.resolveFromHathorToken(hathorToken, evmToken);
  }

  async mappingByHathorToken(hathorToken: string): Promise<TokenMapping> {
    const cached = this.mappingsByHathor.get(hathorToken);
    if (cached) {
      return cached;
    }
    return this.resolveFromHathorToken(hathorToken);
  }

  /**
   * `HathorToEvmTokenMap` is the authority on both halves: it answers with the token's address on
   * the chain it is native to, plus that chain's id. Which side is "original" is what decides
   * whether a transfer mints or transfers, so both lookups funnel through it.
   */
  private async resolveFromHathorToken(hathorToken: string, knownEvmToken?: string): Promise<TokenMapping> {
    const original = (await method(this.contract, 'HathorToEvmTokenMap', hathorToken).call()) as {
      tokenAddress: string;
      originChainId: bigint | number | string;
    };

    if (!original?.tokenAddress) {
      throw new Error(`The bridge has no EVM token registered for Hathor token ${hathorToken}.`);
    }

    const mapping: TokenMapping = {
      hathorToken,
      evmToken: original.tokenAddress,
      originChainId: Number(original.originChainId),
    };

    this.mappingsByHathor.set(hathorToken, mapping);
    this.mappingsByEvm.set(mapping.evmToken.toLowerCase(), mapping);
    if (knownEvmToken) {
      this.mappingsByEvm.set(knownEvmToken.toLowerCase(), mapping);
    }
    return mapping;
  }

  async getEvmTokenDecimals(evmToken: string): Promise<number> {
    const key = evmToken.toLowerCase();
    const cached = this.decimals.get(key);
    if (cached !== undefined) {
      return cached;
    }

    // MainToken rather than IERC20: the repo's IERC20 ABI is the minimal interface and has no
    // `decimals()`, which is not part of the ERC20 standard proper. This is the ABI the previous
    // TokenFactory used for exactly this call.
    const token = this.tokenContract(evmToken);
    const decimals = Number(await method(token, 'decimals').call());
    if (!Number.isInteger(decimals)) {
      throw new Error(`Token ${evmToken} reported non-integer decimals (${decimals}).`);
    }

    this.decimals.set(key, decimals);
    return decimals;
  }

  /** Overridable so the decimals lookup can be driven offline alongside everything else. */
  protected tokenContract(evmToken: string): ContractLike {
    return contractAt(this.web3, tokenAbi, evmToken);
  }

  async getCrossEvents(fromBlock: number, toBlock: number, destinationChainId: number): Promise<CrossEvent[]> {
    const logs = await pastEventsOf(this.contract)('Cross', {
      fromBlock,
      toBlock,
      filter: { _destinationChainId: destinationChainId },
    });

    return logs
      .filter((log): log is EventLog => typeof log !== 'string')
      .map((log) => this.toCrossEvent(log))
      .filter((event): event is CrossEvent => event !== undefined);
  }

  async findCrossEvent(transactionHash: string): Promise<CrossEvent | undefined> {
    // The event is looked up by the block its transaction landed in; scanning a range for one
    // hash would be a different, far more expensive query.
    const tx = await this.web3.eth.getTransaction(transactionHash).catch(() => undefined);
    if (!tx || tx.blockNumber === undefined || tx.blockNumber === null) {
      return undefined;
    }

    const block = Number(tx.blockNumber);
    const logs = await pastEventsOf(this.contract)('Cross', { fromBlock: block, toBlock: block });

    for (const log of logs) {
      if (typeof log === 'string' || log.transactionHash !== transactionHash) {
        continue;
      }
      const event = this.toCrossEvent(log);
      if (event) {
        return event;
      }
    }
    return undefined;
  }

  private toCrossEvent(log: EventLog): CrossEvent | undefined {
    const values = log.returnValues as Record<string, unknown>;

    const transactionHash = log.transactionHash;
    if (!transactionHash) {
      // A pending log has no transaction hash, and the whole pipeline keys on it.
      this.logger.warn('Ignoring a Cross event with no transaction hash.');
      return undefined;
    }

    return {
      transactionHash,
      blockHash: String(log.blockHash ?? ''),
      blockNumber: Number(log.blockNumber ?? 0),
      logIndex: Number(log.logIndex ?? 0),
      receiver: String(values._to ?? ''),
      sender: String(values._from ?? ''),
      amount: BigInt(String(values._amount ?? '0')),
      tokenAddress: String(values._tokenAddress ?? ''),
      originChainId: Number(values._originChainId ?? 0),
      destinationChainId: Number(values._destinationChainId ?? 0),
    };
  }
}
