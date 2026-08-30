import type Web3 from 'web3';
import { FMT_BYTES, FMT_NUMBER } from 'web3';

import type { EvmChainPort } from '../../ports/EvmChainPort';

/** The chain itself: how far it has got, and whether it is caught up. */
export class EvmChainAdapter implements EvmChainPort {
  private readonly web3: Web3;

  constructor(web3: Web3) {
    this.web3 = web3;
  }

  async getBlockNumber(): Promise<number> {
    // Asked for as a number rather than the default bigint: block heights are compared and
    // subtracted all over the readers, and mixing the two throws at runtime.
    return this.web3.eth.getBlockNumber({ number: FMT_NUMBER.NUMBER, bytes: FMT_BYTES.HEX });
  }

  async isSyncing(): Promise<boolean> {
    // web3 returns `false` when synced, and a progress object when not.
    return (await this.web3.eth.isSyncing()) !== false;
  }
}
