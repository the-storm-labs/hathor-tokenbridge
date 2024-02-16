import axios from 'axios';
import EventEmmiter from 'node:events';
// import axiosCurlirize from 'axios-curlirize';
import { HathorResponse, StatusResponse } from '../types/HathorResponseTypes';
import { LogWrapper } from './logWrapper';
import { ConfigChain } from './configChain';
import { ConfigData } from './config';

// axiosCurlirize(axios); // <- just for testing

export type Wallet = {
  ready: boolean;
  lastCheck: Date;
};

export class HathorWallet {
  private static wallet: HathorWallet;

  private WALLET_STATUS_CONNECTING = 1;
  private WALLET_STATUS_SYNCING = 2;
  private WALLET_STATUS_READY = 3;

  public logger: LogWrapper;
  public chainConfig: ConfigChain;
  private wallets: Map<string, Wallet>;
  public walletEmmiter = new EventEmmiter();

  private constructor(config: ConfigData, logger: LogWrapper) {
    this.logger = logger;
    this.chainConfig = config.sidechain[0];
    this.wallets = new Map<string, Wallet>();
    this.wallets.set('multisig', { ready: false, lastCheck: new Date(0) });
    this.wallets.set('single', { ready: false, lastCheck: new Date(0) });
  }

  public static getInstance(config: ConfigData, logger: LogWrapper): HathorWallet {
    if (!HathorWallet.wallet) {
      HathorWallet.wallet = new HathorWallet(config, logger);
    }
    return HathorWallet.wallet;
  }

  public async areWalletsReady(): Promise<[boolean, EventEmmiter]> {
    const multisig = this.wallets.get('multisig');
    const single = this.wallets.get('single');
    const currentTime = new Date();
    const oneHourAgo = currentTime.getTime() - 10 * 60 * 1000;

    if (multisig.lastCheck.getTime() < oneHourAgo || single.lastCheck.getTime() < oneHourAgo) {
      this.isReady(true);
      this.isReady(false);
      return [false, this.walletEmmiter];
    }

    if (multisig.ready && single.ready) {
      return [true, null];
    }

    return [false, this.walletEmmiter];
  }

  private setWalletReady(wallet: string) {
    this.wallets.set(wallet, { ready: true, lastCheck: new Date() });
    if (this.wallets.get('multisig').ready && this.wallets.get('single').ready) {
      this.walletEmmiter.emit('wallets-ready');
    }
  }

  private async isReady(multisig: boolean, retry = 1): Promise<boolean> {
    const id = multisig ? this.chainConfig.multisigWalletId : this.chainConfig.singleWalletId;
    if (retry > 3) {
      this.logger.error(`Fail to start ${id} wallet: Maximum number of retries reached.`);
      return false;
    }
    this.logger.info(`Checking ${id} wallet status for the ${retry} time`);
    const url = `${this.chainConfig.walletUrl}/wallet/status`;
    const config = {
      headers: {
        'x-wallet-id': multisig ? this.chainConfig.multisigWalletId : this.chainConfig.singleWalletId,
        'Content-type': 'application/json',
      },
    };

    try {
      const response = await axios.get<StatusResponse>(url, config);
      if (response.data.statusCode === this.WALLET_STATUS_READY) {
        this.logger.info(`${id} wallet is ready.`);
        this.setWalletReady(multisig ? 'multisig' : 'single');
        return true;
      }
      if ([this.WALLET_STATUS_CONNECTING, this.WALLET_STATUS_SYNCING].includes(response.data.statusCode)) {
        this.logger.info(`${id} wallet is ${response.data.statusMessage ?? response.data.message}.`);
        await this.delay(10000);
        return this.isReady(multisig, ++retry);
      }
      if (!response.data.success && response.data.statusMessage === '') {
        this.logger.info(`${id} wallet looks stopped.`);
        await this.start(multisig);
        await this.delay(10000);
        return this.isReady(multisig, ++retry);
      }
    } catch (error) {
      throw Error(`Fail to get status of ${id} wallet: ${error}`);
    }
  }

  private async start(multisig: boolean): Promise<boolean> {
    const id = multisig ? this.chainConfig.multisigWalletId : this.chainConfig.singleWalletId;
    const seedKey = multisig ? this.chainConfig.multisigSeedKey : this.chainConfig.singleSeedKey;
    this.logger.info(`Trying to start ${id} wallet.`);
    const url = `${this.chainConfig.walletUrl}/start`;
    const config = {
      headers: {
        'Content-type': 'application/json',
      },
    };
    const data = {
      'wallet-id': id,
      seedKey: seedKey,
      multisig: multisig,
    };

    try {
      const response = await axios.post<HathorResponse>(url, data, config);
      return response.status == 200 && response.data.success;
    } catch (error) {
      throw Error(`Fail to start wallet: ${error}`);
    }
  }

  private async delay(time: number) {
    return new Promise((resolve) => setTimeout(resolve, time));
  }
}
