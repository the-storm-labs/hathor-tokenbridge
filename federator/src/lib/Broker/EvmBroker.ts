import { Broker } from './Broker';
import { LogWrapper } from '../logWrapper';
import { ConfigData } from '../config';
import HathorException from '../../types/HathorException';
import axios from 'axios';
import { IBridgeV4 } from '../../contracts/IBridgeV4';
import { CreateProposalResponse } from '../../types/HathorResponseTypes';
import { FederationFactory } from '../../contracts/FederationFactory';
import { BridgeFactory } from '../../contracts/BridgeFactory';

export class EvmBroker extends Broker {
  public txIdType: string;

  constructor(
    config: ConfigData,
    logger: LogWrapper,
    bridgeFactory: BridgeFactory,
    federationFactory: FederationFactory,
  ) {
    super(config, logger, bridgeFactory, federationFactory);
    this.txIdType = 'hsh';
  }

  async sendTokensToHathor(receiverAddress: string, qtd: string, tokenAddress: string, txHash: string) {
    const txs = super.castHistoryToTx(await this.getHistory());
    const proposals = txs.filter(
      (tx) => tx.haveCustomData('hsh') && tx.haveCustomData('hex') && tx.getCustomData('hsh') === txHash,
    );

    if (proposals.length > 0) {
      this.logger.info('Proposal already sent.');
      return;
    }

    const [hathorTokenAddress, originalChainId] = await this.getHathorTokenAddress(tokenAddress);

    const tokenDecimals = await this.getTokenDecimals(tokenAddress, originalChainId);
    const convertedQuantity = this.convertToHathorDecimals(qtd, tokenDecimals);
    if (convertedQuantity <= 0) {
      this.logger.info(
        `The amount transfered can't be less than 0.01 HTR. OG Qtd: ${qtd}, Token decimals ${tokenDecimals}.`,
      );
      return;
    }
    const txHex =
      originalChainId == this.config.mainchain.chainId
        ? await this.sendMintProposal(receiverAddress, convertedQuantity, hathorTokenAddress)
        : await this.sendTransferProposal(receiverAddress, convertedQuantity, hathorTokenAddress);

    await this.broadcastProposal(txHex, txHash);
  }

  async validateTx(txHex: string, txHash: string): Promise<boolean> {
    const hathorTx = await this.decodeTxHex(txHex);
    const evmTx = await this.getWeb3(this.config.mainchain.host).eth.getTransaction(txHash);
    const bridge = (await this.bridgeFactory.createInstance(this.config.mainchain)) as IBridgeV4;
    const events = await bridge.getPastEvents('Cross', this.config.sidechain[0].chainId, {
      fromBlock: evmTx.blockNumber,
      toBlock: evmTx.blockNumber,
    });
    const event = events.find((e) => e.transactionHash === txHash);

    if (!event) {
      this.logger.error(`Invalid tx. Unable to find event on EVM. HEX: ${txHex} | HASH: ${txHash}`);
      return false;
    }

    const evmTranslatedToken = await bridge.EvmToHathorTokenMap(event.returnValues['_tokenAddress']);

    const txOutput = hathorTx.outputs.find((o) => o.token === evmTranslatedToken);

    if (!txOutput) {
      this.logger.error(`Invalid tx. Unable to find token on hathor tx outputs. HEX: ${txHex} | HASH: ${txHash}`);
      return false;
    }

    if (!(txOutput.decoded.address === event.returnValues['_to'])) {
      this.logger.error(
        `txHex ${txHex} address ${txOutput.decoded.address} is not the same as txHash ${txHash} address ${event.returnValues['_to']}.`,
      );
      return false;
    }

    const originalToken = await bridge.HathorToEvmTokenMap(evmTranslatedToken);

    const tokenDecimals = await this.getTokenDecimals(originalToken.tokenAddress, originalToken.originChainId);
    const convertedQuantity = this.convertToHathorDecimals(event.returnValues['_amount'], tokenDecimals);

    if (!(txOutput.value === convertedQuantity)) {
      this.logger.error(
        `txHex ${txHex} value ${txOutput.value} is not the same as txHash ${txHash} value ${convertedQuantity}.`,
      );
      return false;
    }
    return true;
  }

  private async sendMintProposal(receiverAddress: string, qtd: number, token: string): Promise<string> {
    const url = `${this.chainConfig.walletUrl}/wallet/p2sh/tx-proposal/mint-tokens`;
    const config = {
      headers: {
        'X-Wallet-Id': this.chainConfig.multisigWalletId,
        'Content-type': 'application/json',
      },
    };

    const data = {
      address: `${receiverAddress}`,
      amount: qtd,
      token: `${token}`,
    };

    const response = await axios.post<CreateProposalResponse>(url, data, config);
    if (response.status == 200 && response.data.success) {
      return response.data.txHex;
    }
    throw new HathorException(
      `Unable to send a mint proposal ${response.status} - ${response.statusText} - ${JSON.stringify(response.data)}`,
      response.data.message ?? response.data.error,
    );
  }

  private async sendTransferProposal(receiverAddress: string, qtd: number, token: string): Promise<string> {
    const url = `${this.chainConfig.walletUrl}/wallet/tx-proposal`;
    const config = {
      headers: {
        'X-Wallet-Id': this.chainConfig.multisigWalletId,
        'Content-type': 'application/json',
      },
    };

    const output = {
      address: `${receiverAddress}`,
      value: qtd,
      token: `${token}`,
    };

    const outputs = [];
    outputs.push(output);

    const response = await axios.post<CreateProposalResponse>(url, { outputs }, config);
    if (response.status == 200 && response.data.success) {
      return response.data.txHex;
    }
    throw new HathorException(
      `Unable to send a transaction proposal ${response.status} - ${response.statusText} - ${JSON.stringify(
        response.data,
      )}`,
      response.data.message ?? response.data.error,
    );
  }

  private async getHathorTokenAddress(evmTokenAddress: string): Promise<[string, number]> {
    const originBridge = (await this.bridgeFactory.createInstance(this.config.mainchain)) as IBridgeV4;
    const hathorTokenAddress = await originBridge.EvmToHathorTokenMap(evmTokenAddress);
    const originalToken = await originBridge.HathorToEvmTokenMap(hathorTokenAddress);

    return [hathorTokenAddress, originalToken.originChainId];
  }

  private convertToHathorDecimals(originalQtd: string, tokenDecimals: number): number {
    const hathorPrecision = tokenDecimals - 2;
    return Math.floor(Number.parseInt(originalQtd) * Math.pow(10, -hathorPrecision));
  }
}
