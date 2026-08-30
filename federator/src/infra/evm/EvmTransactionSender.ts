import type Web3 from 'web3';

import type { LoggerPort } from '../../ports/LoggerPort';

/**
 * Signs and broadcasts a transaction from the federator's key.
 *
 * Ported from lib/TransactionSender.ts, with two deliberate departures:
 *
 *  - Signing goes through web3's own account handling rather than `ethereumjs-tx@1.3.7`, which
 *    predates typed transactions entirely. The transactions built here are legacy-type either way,
 *    so what changes is which library serialises them, not what reaches the chain.
 *  - The Etherscan re-broadcast is gone. It worked around a geth bug and was gated on
 *    `chainId === 1`, so it never once fired on Arbitrum or Sepolia - the only chains this bridge
 *    runs against.
 *
 * Gas estimation keeps its floor. Estimation is unreliable on RSK and, since London, on Ethereum
 * too, so a too-low estimate is raised rather than trusted.
 */
const GAS_FLOOR = 250_000;

/** RSK's node reports a gas price that needs a margin to actually get mined. */
const RSK_CHAIN_IDS = new Set([30, 31, 33]);
const RSK_GAS_PRICE_MULTIPLIER = 1.03;
const ETH_GAS_PRICE_MULTIPLIER = 1.5;

export interface TransactionReceiptSummary {
  readonly status: boolean;
  readonly transactionHash?: string | undefined;
  readonly error?: string | undefined;
}

export class EvmTransactionSender {
  private readonly web3: Web3;
  private readonly logger: LoggerPort;
  private readonly privateKey: string;
  private chainId?: number;

  constructor(web3: Web3, privateKey: string, logger: LoggerPort) {
    this.web3 = web3;
    this.privateKey = privateKey;
    this.logger = logger;
  }

  private async getChainId(): Promise<number> {
    if (this.chainId === undefined) {
      this.chainId = Number(await this.web3.eth.getChainId());
    }
    return this.chainId;
  }

  private async getGasPrice(): Promise<bigint> {
    const price = await this.web3.eth.getGasPrice();
    const chainId = await this.getChainId();
    const multiplier = RSK_CHAIN_IDS.has(chainId) ? RSK_GAS_PRICE_MULTIPLIER : ETH_GAS_PRICE_MULTIPLIER;

    // A zero price would never be mined; treat the node's answer as a floor of 1 wei first.
    const base = price > 0n ? price : 1n;
    return BigInt(Math.ceil(Number(base) * multiplier));
  }

  private async getGasLimit(tx: { from: string; to: string; data: string; value: string }): Promise<number> {
    try {
      const estimate = Number(await this.web3.eth.estimateGas(tx));
      return estimate < GAS_FLOOR ? GAS_FLOOR : estimate;
    } catch (error) {
      // An estimate that reverts usually means the call itself would revert - but the caller has
      // its own idea of whether to send anyway, so this reports rather than decides.
      this.logger.warn('Gas estimation failed; falling back to the floor.', error);
      return GAS_FLOOR;
    }
  }

  /**
   * @returns a receipt summary. A reverted transaction is a result, not an exception: the callers
   *          record it and move on rather than treating it as a transport failure.
   */
  async send(to: string, data: string, value = 0): Promise<TransactionReceiptSummary> {
    const account = this.web3.eth.accounts.privateKeyToAccount(this.privateKey);
    const from = account.address;

    try {
      const nonce = await this.web3.eth.getTransactionCount(from, 'pending');
      const gasPrice = await this.getGasPrice();
      const gas = await this.getGasLimit({ from, to, data, value: `0x${value.toString(16)}` });

      const signed = await account.signTransaction({
        from,
        to,
        data,
        value,
        gas,
        gasPrice,
        nonce,
        chainId: await this.getChainId(),
      });

      const receipt = await this.web3.eth.sendSignedTransaction(signed.rawTransaction);
      const status = Boolean(receipt.status);

      if (status) {
        this.logger.info(`Transaction ${receipt.transactionHash} mined in block ${receipt.blockNumber}.`);
      } else {
        this.logger.error(`Transaction ${receipt.transactionHash} reverted.`, receipt);
      }

      return { status, transactionHash: String(receipt.transactionHash) };
    } catch (error) {
      this.logger.error(`Failed to send a transaction to ${to}.`, error);
      return { status: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
