import {
  Connection,
  HathorWallet as LibWallet,
  Network,
  SCANNING_POLICY,
  SendTransaction,
  config as libConfig,
  walletApi,
} from '@hathor/wallet-lib';

import type { LoggerPort } from '../../../ports/LoggerPort';
import { WalletOperationError } from '../../../ports/HathorWalletPort';
import type { LibWalletDriver, WalletLibAdapterConfig } from '../WalletLibAdapter';

/**
 * The real driver: the three places WalletLibAdapter needs a network - constructing a connected
 * wallet, broadcasting a transaction, and asking the fullnode for the best block height.
 *
 * This file is deliberately excluded from coverage. Every line of it is a call into the library
 * that only means anything against a running fullnode, so a unit test here could only assert that
 * the library was called the way this file calls it. What actually verifies it is the shared
 * HathorWalletPort contract suite, run live - see WalletLibAdapter.contract.test.ts. Keeping it in
 * its own file is what lets the rest of the adapter be held to a real coverage bar.
 */
export const defaultLibWalletDriver: LibWalletDriver = {
  create(config: WalletLibAdapterConfig, logger: LoggerPort) {
    libConfig.setServerUrl(config.fullnodeUrl);
    libConfig.setTxMiningUrl(config.txMiningUrl);
    libConfig.setNetwork(config.network);

    const network = new Network(config.network);

    const connection = new Connection({
      network: config.network,
      servers: [config.fullnodeUrl],
      logger: {
        debug: (message: string) => logger.debug(`[wallet-lib] ${message}`),
        info: (message: string) => logger.info(`[wallet-lib] ${message}`),
        warn: (message: string) => logger.warn(`[wallet-lib] ${message}`),
        error: (message: string) => logger.error(`[wallet-lib] ${message}`),
      },
    });

    const wallet = new LibWallet({
      connection,
      seed: config.seed,
      // The library's types allow null but not undefined here, and these are always supplied by
      // the adapter - the ?? keeps that promise legible rather than asserting it away.
      password: config.password ?? null,
      pinCode: config.pin ?? null,
      multisig: {
        pubkeys: [...config.multisig.pubkeys],
        numSignatures: config.multisig.numSignatures,
      },
      // Gap limit, deliberately: a non-gap-limit scan policy forces the library into
      // POLLING_HTTP_API mode. preCalculatedAddresses is never set - it silently truncates the
      // sync, see the WalletLibAdapter class comment.
      scanPolicy: { policy: SCANNING_POLICY.GAP_LIMIT, gapLimit: config.gapLimit },
    });

    return { wallet, network };
  },

  async push(wallet, transaction, pin) {
    const send = new SendTransaction({
      storage: wallet.storage,
      transaction: transaction as never,
      pin,
    });
    return send.runFromMining();
  },

  /** walletApi is callback-style; this is the promise wrapper the adapter expects. */
  async bestBlockHeight() {
    return new Promise<number>((resolve, reject) => {
      walletApi
        .getMiningInfo((response: unknown) => {
          const blocks = (response as { blocks?: number } | null)?.blocks;
          if (typeof blocks !== 'number') {
            reject(new WalletOperationError('The fullnode did not report a best block height.'));
            return;
          }
          resolve(blocks);
        })
        .catch(reject);
    });
  },
};
