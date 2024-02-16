import axios from 'axios';
import HathorException from '../../types/HathorException';
import { ConfigData } from '../config';
import { LogWrapper } from '../logWrapper';
import { Broker } from './Broker';
import { CreateProposalResponse } from '../../types/HathorResponseTypes';
import { IBridgeV4 } from '../../contracts/IBridgeV4';
import FederatorHTR from '../FederatorHTR';
import Web3 from 'web3';
import { BN } from 'ethereumjs-util';
import TransactionSender from '../TransactionSender';
import { BridgeFactory } from '../../contracts/BridgeFactory';
import { FederationFactory } from '../../contracts/FederationFactory';

export class HathorBroker extends Broker {
  public txIdType: string;
  constructor(
    config: ConfigData,
    logger: LogWrapper,
    bridgeFactory: BridgeFactory,
    federationFactory: FederationFactory,
  ) {
    super(config, logger, bridgeFactory, federationFactory);
    this.txIdType = 'hid';
  }

  async validateTx(txHex: string, txId: string): Promise<boolean> {
    const hathorTx = await this.decodeTxHex(txHex);
    const bridge = (await this.bridgeFactory.createInstance(this.config.mainchain)) as IBridgeV4;

    // TODO validate if the txHex comes from a tx that was initiated by the multisig? does it make sense? or it has to be?
    // TODO think what's importante to validate here

    // get token from event
    // const evmTranslatedToken = await bridge.EvmToHathorTokenMap(hathorTx);

    // check if token is mapped on bridge

    // check if destination is a valid address
    return true;
  }

  private async sendMeltProposal(qtd: number, token: string): Promise<string> {
    const url = `${this.chainConfig.walletUrl}/wallet/p2sh/tx-proposal/melt-tokens`;
    const config = {
      headers: {
        'X-Wallet-Id': this.chainConfig.multisigWalletId,
        'Content-type': 'application/json',
      },
    };

    const data = {
      amount: qtd,
      token: `${token}`,
    };

    const response = await axios.post<CreateProposalResponse>(url, data, config);
    if (response.status == 200 && response.data.success) {
      return response.data.txHex;
    }
    throw new HathorException(
      `Unable to send a melt proposal ${response.status} - ${response.statusText} - ${JSON.stringify(response.data)}`,
      response.data.message ?? response.data.error,
    );
  }

  private async getEvmTokenAddress(tokenAddress: string): Promise<[string, number]> {
    const originBridge = (await this.bridgeFactory.createInstance(this.config.mainchain)) as IBridgeV4;
    const originalToken = await originBridge.HathorToEvmTokenMap(tokenAddress);

    return [originalToken.tokenAddress, originalToken.originChainId];
  }

  async sendTokensFromHathor(
    receiverAddress: string,
    qtd: number,
    hathorTokenAddress: string,
    txId: string,
    ogSenderAddress: string,
    timestamp: string,
  ): Promise<boolean> {
    const [evmTokenAddress, originalChainId] = await this.getEvmTokenAddress(hathorTokenAddress);

    if (originalChainId == this.config.mainchain.chainId && this.chainConfig.multisigOrder == 1) {
      const txHex = await this.sendMeltProposal(qtd, hathorTokenAddress);
      await this.broadcastProposal(txHex, txId);
    }
    const federator = new FederatorHTR(this.config, this.logger, null);

    const evmTokenDecimals = await this.getTokenDecimals(evmTokenAddress, originalChainId);

    const sender = Web3.utils.keccak256(ogSenderAddress);
    const thirdTwoBytesSender = sender.substring(0, 42);
    const idHash = Web3.utils.keccak256(txId);
    const convertedAmount = new BN(this.convertToEvmDecimals(qtd, evmTokenDecimals));
    const timestampHash = Web3.utils.soliditySha3(timestamp);
    const logIndex = 129;

    const transactionSender = new TransactionSender(this.getWeb3(this.config.mainchain.host), this.logger, this.config);
    const federatorAddress = await transactionSender.getAddress(this.config.privateKey);
    const federatorContract = await this.federationFactory.createInstance(
      this.config.mainchain,
      this.config.privateKey,
    );

    const transactionId = await federatorContract.getTransactionId({
      originalTokenAddress: evmTokenAddress,
      sender: thirdTwoBytesSender,
      receiver: receiverAddress,
      amount: convertedAmount,
      blockHash: timestampHash,
      transactionHash: idHash,
      logIndex: logIndex,
      originChainId: this.config.sidechain[0].chainId,
      destinationChainId: this.config.mainchain.chainId,
    });

    const isTransactionVotedOrProcessed = await this.isTransactionVotedOrProcessed(
      receiverAddress,
      convertedAmount,
      timestampHash,
      idHash,
      logIndex,
      this.config.sidechain[0].chainId,
      this.config.mainchain.chainId,
      evmTokenAddress,
      transactionId,
      federatorAddress,
    );

    if (isTransactionVotedOrProcessed) return true;

    const txParams = {
      sideChainId: this.config.mainchain.chainId,
      mainChainId: this.config.sidechain[0].chainId,
      transactionSender: transactionSender,
      sideChainConfig: this.config.mainchain,
      sideFedContract: federatorContract,
      federatorAddress: federatorAddress,
      tokenAddress: evmTokenAddress,
      senderAddress: thirdTwoBytesSender,
      receiver: receiverAddress,
      amount: convertedAmount,
      transactionId: transactionId,
      originChainId: this.config.sidechain[0].chainId,
      destinationChainId: this.config.mainchain.chainId,
      blockHash: timestampHash,
      transactionHash: idHash,
      logIndex: logIndex,
    };

    return await federator._voteTransaction(txParams);
  }

  async isTransactionVotedOrProcessed(
    receiver: string,
    amount: BN,
    blockHash: string,
    transactionHash: string,
    logIndex: number,
    originChainId: number,
    destinationChainId: number,
    tokenAddress: string,
    txId: string,
    federatorAddress: string,
  ): Promise<boolean> {
    const dataToHash = {
      to: receiver,
      amount: amount,
      blockHash: blockHash,
      transactionHash: transactionHash,
      logIndex: logIndex,
      originChainId: originChainId,
      destinationChainId: destinationChainId,
    };
    this.logger.info('===dataToHash===', dataToHash);
    const bridge = await this.bridgeFactory.createInstance(this.config.mainchain);
    const transactionDataHash = await bridge.getTransactionDataHash(dataToHash);
    const wasProcessed = await bridge.getProcessed(transactionDataHash);
    if (wasProcessed) {
      this.logger.info(
        `Already processed Block: ${blockHash} Tx: ${transactionHash}
          originalTokenAddress: ${tokenAddress}`,
      );
      return true;
    }
    const federation = await this.federationFactory.createInstance(this.config.mainchain, this.chainConfig.federation);
    const hasVoted = await federation.hasVoted(txId, federatorAddress);
    if (hasVoted) {
      this.logger.debug(
        `Block: ${blockHash} Tx: ${transactionHash}
        originalTokenAddress: ${tokenAddress}  has already been voted by us`,
      );
      return true;
    }

    return false;
  }

  private convertToEvmDecimals(originalQtd: number, tokenDecimals: number): string {
    const hathorPrecision = tokenDecimals - 2;
    return (originalQtd * Math.pow(10, hathorPrecision)).toString();
  }
}
