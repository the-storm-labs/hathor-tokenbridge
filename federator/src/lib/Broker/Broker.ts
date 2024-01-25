// import axiosCurlirize from 'axios-curlirize';
import axios from 'axios';
import Web3 from 'web3';
import { LogWrapper } from '../logWrapper';
import { ConfigData } from '../config';
import { HathorTx } from '../../types/HathorTx';
import { HathorUtxo } from '../../types/HathorUtxo';
import { Data } from '../../types/hathorEvent';
import { HathorException } from '../../types/HathorException';
import { BridgeFactory } from '../../contracts/BridgeFactory';
import { TokenFactory } from '../../contracts/TokenFactory';
import { ITokenV0 } from '../../contracts/ITokenV0';
import { FederationFactory } from '../../contracts/FederationFactory';
import { ConfigChain } from '../configChain';
import {
  DecodeResponse,
  GetAddressResponse,
  GetConfirmationResponse,
  GetMySignatureResponse,
  HathorResponse,
} from '../../types/HathorResponseTypes';
import { IBridgeV4 } from '../../contracts/IBridgeV4';

type ProposalComponents = { hex: string; signatures: string[] };

export abstract class Broker {
  public logger: LogWrapper;
  public config: ConfigData;
  public bridgeFactory: BridgeFactory;
  public federationFactory: FederationFactory;
  public abstract txIdType: string;
  protected chainConfig: ConfigChain;

  constructor(
    config: ConfigData,
    logger: LogWrapper,
    bridgeFactory: BridgeFactory,
    federationFactory: FederationFactory,
  ) {
    this.config = config;
    this.logger = logger;
    this.bridgeFactory = bridgeFactory;
    this.federationFactory = federationFactory;

    if (this.logger.upsertContext) {
      this.logger.upsertContext('service', this.constructor.name);
    }
    this.chainConfig = config.sidechain[0];

    this.web3ByHost = new Map<string, Web3>();
  }

  public web3ByHost: Map<string, Web3>;

  getWeb3(host: string): Web3 {
    let hostWeb3 = this.web3ByHost.get(host);
    if (!hostWeb3) {
      hostWeb3 = new Web3(host);
      this.web3ByHost.set(host, hostWeb3);
    }
    return hostWeb3;
  }

  abstract validateTx(txHex: string, txId: string): Promise<boolean>;

  public async getSignaturesToPush(txId: string): Promise<{ hex: string; signatures: string[] }> {
    const txs = this.castHistoryToTx(await this.getHistory());
    const hex = txs.find((tx) => tx.haveCustomData('hex') && tx.getCustomData(this.txIdType) === txId);
    const signatures = txs.filter((tx) => tx.haveCustomData('sig') && tx.getCustomData(this.txIdType) === txId);

    return {
      hex: hex.getCustomData('hex'),
      signatures: signatures.map((sig) => sig.getCustomData('sig')),
    };
  }

  public async signAndPushProposal(txHex: string, txId: string, signatures: string[]) {
    if (!(await this.validateTx(txHex, txId))) {
      throw new HathorException('Invalid tx', 'Invalid tx');
    }
    const url = `${this.chainConfig.walletUrl}/wallet/p2sh/tx-proposal/sign-and-push`;
    const config = {
      headers: {
        'X-Wallet-Id': this.chainConfig.multisigWalletId,
        'Content-type': 'application/json',
      },
    };

    const data = {
      txHex: `${txHex}`,
      signatures: signatures,
    };

    const response = await axios.post<HathorResponse>(url, data, config);

    if (response.status != 200 || !response.data.success) {
      const fullMessage = `${response.status} - ${response.statusText} - ${JSON.stringify(response.data)}`;
      throw new HathorException(fullMessage, response.data.error);
    }
  }

  protected async broadcastProposal(txHex: string, originalTxId: string) {
    const data = {
      outputs: await this.wrapData('hex', txHex),
    };
    data.outputs = data.outputs.concat(await this.wrapData(this.txIdType, originalTxId));
    data.outputs.push({
      address: await this.getMultiSigAddress(),
      value: 1,
    });
    await this.broadcastDataToMultisig(data);
  }

  public async sendMySignaturesToProposal(txHex: string, txId: string): Promise<void> {
    if (!(await this.validateTx(txHex, txId))) {
      throw new HathorException('Invalid tx', 'Invalid tx');
    }

    const signature = await this.getMySignatures(txHex);
    if (await this.haveISignedBefore(signature, txId)) {
      this.logger.info(`Tx ${txId} was already signed before.`);
      return;
    }
    const wrappedSig = await this.wrapData('sig', signature);
    const data = {
      outputs: wrappedSig,
    };
    data.outputs = data.outputs.concat(await this.wrapData(this.txIdType, txId));
    data.outputs.push({
      address: await this.getMultiSigAddress(),
      value: 1,
    });
    await this.broadcastDataToMultisig(data);
  }

  private async haveISignedBefore(signature: string, txId: string) {
    const historyTxs = this.castHistoryToTx(await this.getHistory());
    let response = false;
    for (let index = 0; index < historyTxs.length; index++) {
      const tx = historyTxs[index];

      if (
        tx.haveCustomData(this.txIdType) &&
        tx.haveCustomData('sig') &&
        tx.getCustomData(this.txIdType) === txId &&
        tx.getCustomData('sig') === signature
      ) {
        response = true;
        break;
      }
    }

    return response;
  }

  protected async getHistory() {
    const url = `${this.chainConfig.walletUrl}/wallet/tx-history`;
    const config = {
      headers: {
        'X-Wallet-Id': this.chainConfig.multisigWalletId,
        'Content-type': 'application/json',
      },
      params: { limit: 50 },
    };

    try {
      const response = await axios.get<Data[]>(url, config);

      if (response.status == 200) {
        return response.data;
      }

      throw Error(`${response.status} - ${response.data}`);
    } catch (error) {
      throw Error(`Fail to getHistory: ${error}`);
    }
  }

  protected castHistoryToTx(history: Data[]): HathorTx[] {
    const txs: HathorTx[] = [];
    history.forEach((data) => {
      const utxos = data.outputs.map((o) => new HathorUtxo(o.script));
      const tx = new HathorTx(data.tx_id, data.timestamp, utxos);
      txs.push(tx);
    });

    return txs;
  }

  async isTxConfirmed(transactionId: string): Promise<boolean> {
    const confirmations = await this.getTransactionConfirmation(transactionId);
    //so every federator has to wait more than the last one.
    const expectedConfirmations = this.chainConfig.minimumConfirmations * this.chainConfig.multisigOrder;
    const confirmed = confirmations >= expectedConfirmations;
    if (!confirmed) {
      this.logger.info(
        `Not enough confirmations for tx ${transactionId}. Expected ${expectedConfirmations} had ${confirmations}`,
      );
    }
    return confirmed;
  }

  protected async getTransactionConfirmation(transactionId: string): Promise<number> {
    const url = `${this.chainConfig.walletUrl}/wallet/tx-confirmation-blocks`;
    const config = {
      headers: {
        'X-Wallet-Id': this.chainConfig.multisigWalletId,
        'Content-type': 'application/json',
      },
      params: { id: transactionId },
    };

    try {
      const response = await axios.get<GetConfirmationResponse>(url, config);

      if (response.status == 200 && response.data.success) {
        return response.data.confirmationNumber;
      }

      throw Error(`${response.status} - ${response.data}`);
    } catch (error) {
      throw new HathorException(`Fail to getTransactionConfirmation`, error);
    }
  }

  protected async getTokenDecimals(tokenAddress: string, originalChainId: number): Promise<number> {
    const tokenFactory = new TokenFactory();
    if (originalChainId == this.config.sidechain[0].chainId) {
      const bridge = (await this.bridgeFactory.createInstance(this.config.mainchain)) as IBridgeV4;
      tokenAddress = await bridge.sideTokenByOriginalToken(originalChainId, tokenAddress);
    }
    const tokenContract = (await tokenFactory.createInstance(this.config.mainchain, tokenAddress)) as ITokenV0;
    return await tokenContract.getDecimals();
  }

  protected async decodeTxHex(txHex: string): Promise<Data> {
    const url = `${this.chainConfig.walletUrl}/wallet/decode`;
    const config = {
      headers: {
        'X-Wallet-Id': this.chainConfig.multisigWalletId,
        'Content-type': 'application/json',
      },
    };

    try {
      const response = await axios.post<DecodeResponse>(url, { txHex: txHex }, config);

      if (response.status == 200 && response.data.success) {
        return response.data.tx;
      }

      throw Error(`${response.status} - ${response.data}`);
    } catch (error) {
      throw Error(`Error on decodeTxHex: ${error}`);
    }
  }

  private async getMySignatures(txHex: string) {
    const url = `${this.chainConfig.walletUrl}/wallet/p2sh/tx-proposal/get-my-signatures`;
    const config = {
      headers: {
        'X-Wallet-Id': this.chainConfig.multisigWalletId,
        'Content-type': 'application/json',
      },
    };

    try {
      const response = await axios.post<GetMySignatureResponse>(url, { txHex: txHex }, config);

      if (response.status == 200 && response.data.success) {
        return response.data.signatures;
      }

      throw Error(`${response.status} - ${response.data}`);
    } catch (error) {
      throw Error(`Fail to getMySignature: ${error}`);
    }
  }

  protected async getMultiSigAddress() {
    // TODO Provide cache strategy
    const url = `${this.chainConfig.walletUrl}/wallet/address`;
    const config = {
      headers: {
        'X-Wallet-Id': this.chainConfig.multisigWalletId,
        'Content-type': 'application/json',
      },
    };

    try {
      const response = await axios.get<GetAddressResponse>(url, config);
      if (response.status == 200) {
        return response.data.address;
      }
      throw Error(`${response.status} - ${response.statusText} | ${response.data}`);
    } catch (error) {
      throw Error(`Fail to getMultiSigAddress: ${error}`);
    }
  }

  protected async wrapData(dataType: string, data: string): Promise<any[]> {
    const outputs = [];
    /* dataLimit: the max amount of caracters a data field can get, 
        descounted the dataType and positional caracters, ex: hex01{145 caracters}
    */
    const dataLimit = 145;

    const dataLength = data.length;
    const arraySize = Math.ceil(dataLength / dataLimit);

    for (let i = 0; i < arraySize; i++) {
      const start = i * dataLimit;
      const end = start + dataLimit;
      const part = data.substring(start, end);
      outputs.push({
        type: 'data',
        data: `${dataType}${i}${arraySize}${part}`,
      });
    }

    return outputs;
  }

  protected async broadcastDataToMultisig(data: any): Promise<boolean> {
    const url = `${this.chainConfig.walletUrl}/wallet/send-tx`;
    const config = {
      headers: {
        'X-Wallet-Id': this.chainConfig.singleWalletId,
        'Content-type': 'application/json',
      },
    };

    try {
      const response = await axios.post<HathorResponse>(url, data, config);

      if (response.status != 200) {
        throw Error(`Response status: ${response.status} - status message: ${response.statusText}`);
      }
      if (response.status == 200 && !response.data.success) {
        throw Error(`Error message: ${response.data.error}`);
      }

      return true;
    } catch (error) {
      throw Error(`Fail to broadcast data to multisig: ${error}`);
    }
  }
}
