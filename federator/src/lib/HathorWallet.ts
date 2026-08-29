import axios, { AxiosResponse } from 'axios';
import EventEmmiter from 'node:events';
import { GetAddressResponse, HathorResponse, StatusResponse } from '../types/HathorResponseTypes';
import { LogWrapper } from './logWrapper';
import { ConfigChain } from './configChain';
import { ConfigData } from './config';
// import curlirize from 'axios-curlirize';
// curlirize(axios);

export type Wallet = {
  ready: boolean;
  lastCheck: Date;
};

export class HathorWallet {
  private static wallet: HathorWallet;

  // Mirrors WalletState in @hathor/wallet-lib, which is what the headless wallet reports back
  // through GET wallet/status. All six values are handled explicitly below - a status this class
  // does not recognize must never fall through silently, see isReady.
  private readonly WALLET_STATUS_CLOSED = 0;
  private readonly WALLET_STATUS_CONNECTING = 1;
  private readonly WALLET_STATUS_SYNCING = 2;
  private readonly WALLET_STATUS_READY = 3;
  private readonly WALLET_STATUS_ERROR = 4;
  private readonly WALLET_STATUS_PROCESSING = 5;

  public readonly logger: LogWrapper;
  public readonly chainConfig: ConfigChain;
  private readonly wallets: Map<string, Wallet>;
  public readonly walletEmmiter: EventEmmiter;

  private readonly baseDelay = 10000;

  // Caches the address resolved by getFixedAddress per wallet id, so every caller within this
  // process reuses the exact same address instead of asking the headless wallet again.
  private readonly fixedAddressCache: Map<string, string>;

  private constructor(config: ConfigData, logger: LogWrapper) {
    logger.info('New instance of the wallet class');
    this.walletEmmiter = new EventEmmiter();
    this.logger = logger;
    this.chainConfig = config.sidechain[0];
    this.wallets = new Map<string, Wallet>();
    this.wallets.set('multisig', { ready: false, lastCheck: new Date(0) });
    this.fixedAddressCache = new Map<string, string>();
  }

  public static getInstance(config: ConfigData, logger: LogWrapper): HathorWallet {
    if (!HathorWallet.wallet) {
      HathorWallet.wallet = new HathorWallet(config, logger);
    }
    return HathorWallet.wallet;
  }

  /**
   * Resolves a stable, reusable address for `walletId` - always the address at `index`
   * (derivation index 0 by default), fetched via `GET wallet/address?index=<index>`. This is
   * deterministic (never uses `mark_as_used`, so it never advances the wallet's internal
   * "current address" cursor) and cached per wallet id, so every caller gets back the exact
   * same address for the lifetime of this process instead of letting the headless wallet fall
   * back to its own auto-incrementing default for change/deposit/authority outputs.
   */
  public async getFixedAddress(walletId: string, index = 0): Promise<string> {
    const cacheKey = `${walletId}:${index}`;
    if (this.fixedAddressCache.has(cacheKey)) {
      return this.fixedAddressCache.get(cacheKey);
    }

    const response = await this.requestWallet<GetAddressResponse>(false, walletId, 'wallet/address', null, {
      index,
    });
    if (response.status !== 200 || !response.data?.address) {
      throw new Error(
        `Fail to get fixed address for wallet ${walletId} at index ${index}: ${response.status} - ${JSON.stringify(
          response.data,
        )}`,
      );
    }

    this.fixedAddressCache.set(cacheKey, response.data.address);
    return response.data.address;
  }

  public async areWalletsReady(): Promise<[boolean, EventEmmiter]> {
    const multisig = this.wallets.get('multisig');
    const currentTime = new Date();
    const oneHourAgo = currentTime.getTime() - 10 * 60 * 1000;

    // The ideia is to do this asyncronously, but for some reason,
    // it is not working on the google cloud, so it stays syncronous for the time being
    if (multisig.lastCheck.getTime() < oneHourAgo) {
      const multisigReady = await this.isReady(true);
      return [multisigReady, this.walletEmmiter];
    }

    if (multisig.ready) {
      return [true, null];
    }

    return [false, this.walletEmmiter];
  }

  private setWalletReady(wallet: string) {
    this.wallets.set(wallet, { ready: true, lastCheck: new Date() });
    this.logger.info(`Setting ${wallet} wallet as ready`);
    if (this.wallets.get('multisig').ready) {
      this.logger.info('All wallets are ready');
      this.logger.info(`From HathorWallet.ts, we have ${this.walletEmmiter.listenerCount('wallets-ready')} listeners`);
      this.walletEmmiter.emit('wallets-ready');
    }
  }

  private async isReady(multisig: boolean, retry = 1): Promise<boolean> {
    const id = multisig ? 'multi' : 'single';
    if (retry > 5) {
      this.logger.error(`Fail to start ${id} wallet: Maximum number of retries reached.`);
      return false;
    }
    this.logger.info(`Checking ${id} wallet status for the ${retry} time`);
    try {
      const response = await this.requestWallet<StatusResponse>(false, id, 'wallet/status');
      if (response.data.statusCode === this.WALLET_STATUS_READY) {
        this.logger.info(`${id} wallet is ready.`);
        this.setWalletReady(multisig ? 'multisig' : 'single');
        return true;
      }
      // Transient states the wallet passes through on its way to READY. PROCESSING in particular
      // is easy to miss: the wallet reaches it after syncing history, while it processes what it
      // just downloaded, and it is a state this check can legitimately land on during a restart.
      if (
        [this.WALLET_STATUS_CONNECTING, this.WALLET_STATUS_SYNCING, this.WALLET_STATUS_PROCESSING].includes(
          response.data.statusCode,
        )
      ) {
        this.logger.info(`${id} wallet is ${response.data.statusMessage ?? response.data.message}.`);
        await this.delay(this.baseDelay * retry);
        return this.isReady(multisig, ++retry);
      }
      // The wallet is not running (never started, stopped, or errored out). Starting it is
      // idempotent, so this is also the recovery path for a wallet that died mid-sync.
      if (
        [this.WALLET_STATUS_CLOSED, this.WALLET_STATUS_ERROR].includes(response.data.statusCode) ||
        (!response.data.success && response.data.statusMessage === '')
      ) {
        this.logger.info(`${id} wallet looks stopped or errored (statusCode ${response.data.statusCode}).`);
        await this.start(multisig);
        await this.delay(this.baseDelay * retry);
        return this.isReady(multisig, ++retry);
      }
      // Any status this class does not know about. Falling through here used to return undefined,
      // which main.ts read as "not ready" and then waited forever on a 'wallets-ready' event that
      // only this method can emit - the federator would hang at boot with no error. Retrying is
      // the safe reading of an unknown state: it is either transient or the retry budget ends it.
      this.logger.warn(
        `${id} wallet reported an unrecognized statusCode ${response.data.statusCode}; retrying.`,
      );
      await this.delay(this.baseDelay * retry);
      return this.isReady(multisig, ++retry);
    } catch (error) {
      throw Error(`Fail to get status of ${id} wallet: ${error}`);
    }
  }

  private async start(multisig: boolean): Promise<boolean> {
    const id = multisig ? 'multi' : 'single';
    const seedKey = multisig ? this.chainConfig.multisigSeedKey : this.chainConfig.singleSeedKey;
    const data = {
      'wallet-id': id,
      seedKey: seedKey,
      multisig: multisig,
    };
    this.logger.info(`Trying to start ${id} wallet.`);
    try {
      const response = await this.requestWallet<HathorResponse>(true, id, 'start', data);
      return response.status == 200 && response.data.success;
    } catch (error) {
      throw Error(`Fail to start wallet: ${error}`);
    }
  }

  public async putRequestWallet<Type>(
    id: string,
    path: string,
    data?: any,
    params?: any,
  ): Promise<AxiosResponse<Type>> {
    const url = `${process.env.WALLET_URL}/${path}`;
    const config = {
      headers: {
        'Content-type': 'application/json',
        'x-api-key': process.env.HEADLESS_API_KEY,
        'x-wallet-id': id,
      },
      params: params,
    };

    try {
      return await axios.put<Type>(url, data, config);
    } catch (error) {
      throw Error(`Fail to PUT request to hathor wallet endpoint: ${error}`);
    }
  }

  public async requestWallet<Type>(
    post: boolean,
    id: string,
    path: string,
    data?: any,
    params?: any,
  ): Promise<AxiosResponse<Type>> {
    const url = `${process.env.WALLET_URL}/${path}`;
    const config = {
      headers: {
        'Content-type': 'application/json',
        'x-api-key': process.env.HEADLESS_API_KEY,
        'x-wallet-id': id,
      },
      params: params,
    };

    try {
      if (post) return await axios.post<Type>(url, data, config);
      return await axios.get<Type>(url, config);
    } catch (error) {
      throw Error(`Fail to request to hathor wallet endpoint: ${error}`);
    }
  }

  private async delay(time: number) {
    return new Promise((resolve) => setTimeout(resolve, time));
  }
}
