import { HathorException, CreateProposalResponse, Data, TransactionTypes } from '../../types';
import { ConfigData } from '../config';
import { LogWrapper } from '../logWrapper';
import { Broker } from './Broker';
import FederatorHTR from '../FederatorHTR';
import Web3 from 'web3';
import { BN } from 'ethereumjs-util';
import TransactionSender from '../TransactionSender';
import { BridgeFactory, FederationFactory, IBridgeV4 } from '../../contracts';
import { HathorWallet } from '../HathorWallet';

export class HathorBroker extends Broker {
  constructor(
    config: ConfigData,
    logger: LogWrapper,
    bridgeFactory: BridgeFactory,
    federationFactory: FederationFactory,
    transactionSender: TransactionSender,
  ) {
    super(config, logger, bridgeFactory, federationFactory, transactionSender);
  }

  async validateTx(txHex: string, hathorTxId: string, contractTxId: string): Promise<boolean> {
    // validar que o txid da transação original existe na hathor
    const hathorTransaction = await this.getTransaction(hathorTxId);
    if (!hathorTransaction) {
      this.logger.error(`txHex ${txHex} txID ${hathorTxId} unable to validate tx exists.`);
      return false;
    }
    // validar que o txid não foi enviado anteriormente para o hathor federation contract
    const isProcessed = await this.hathorFederationContract.isProcessed(contractTxId);
    if (isProcessed) {
      this.logger.error(`txHex ${txHex} txID ${hathorTxId} was processed before.`);
      return false;
    }
    // validar que o token seja o mesmo
    const proposalTx = await this.decodeTxHex(txHex);
    const proposalTokens = proposalTx.outputs.filter((o) => o.token);
    const txTokens = (hathorTransaction as Data).outputs.filter((o) => o.token);

    if (proposalTokens.length !== txTokens.length || !proposalTokens.some((t) => txTokens.indexOf(t) < 0)) {
      this.logger.error(`Invalid tx. Unable to find token on hathor tx outputs. HEX: ${txHex} | ID: ${hathorTxId}`);
      return false;
    }

    // validar que o amount seja o mesmo
    if (proposalTokens[0].value == txTokens[0].value) {
      this.logger.error(
        `txHex ${txHex} value ${proposalTokens[0].value} is not the same as txHash value ${txTokens[0].value}.`,
      );
      return false;
    }

    return true;
  }

  async sendEvmNativeTokenProposal(qtd: number, token: string): Promise<string> {
    return;
  }

  async sendHathorNativeTokenProposal(qtd: number, token: string): Promise<string> {
    const wallet = HathorWallet.getInstance(this.config, this.logger);

    const data = {
      amount: qtd,
      token: `${token}`,
    };

    const response = await wallet.requestWallet<CreateProposalResponse>(
      true,
      'multi',
      'wallet/p2sh/tx-proposal/melt-tokens',
      data,
    );
    if (response.status == 200 && response.data.success) {
      return response.data.txHex;
    }
    throw new HathorException(
      `Unable to send a melt proposal ${response.status} - ${response.statusText} - ${JSON.stringify(response.data)}`,
      response.data.message ?? response.data.error,
    );
  }

  async getSideChainTokenAddress(tokenAddress: string): Promise<[string, number]> {
    const originBridge = (await this.bridgeFactory.createInstance(this.config.mainchain)) as IBridgeV4;
    const originalToken = await originBridge.HathorToEvmTokenMap(tokenAddress);

    return [originalToken.tokenAddress, originalToken.originChainId];
  }

  async postProcessing(
    senderAddress: string,
    receiverAddress: string,
    amount: string,
    originalTokenAddress: string,
    txHash: string,
  ) {
    const [evmTokenAddress, originalChainId] = await this.getSideChainTokenAddress(originalTokenAddress);
    const evmTokenDecimals = await this.getTokenDecimals(evmTokenAddress, originalChainId);
    const convertedAmount = new BN(this.convertToEvmDecimals(Number.parseInt(amount), evmTokenDecimals));
    this.voteOnEvm(receiverAddress, convertedAmount, originalTokenAddress, txHash, senderAddress);
  }

  async sendTokens(
    senderAddress: string,
    receiverAddress: string,
    amount: string,
    originalTokenAddress: string,
    destinationTokenAddress: string,
    txHash: string,
  ) {
    // validations
    const [evmTokenAddress, originalChainId] = await this.getSideChainTokenAddress(originalTokenAddress);
    const isTokenEvmNative = originalChainId == this.config.mainchain.chainId;

    if (isTokenEvmNative) {
      await super.sendTokens(
        senderAddress,
        receiverAddress,
        amount,
        originalTokenAddress,
        evmTokenAddress,
        txHash,
        TransactionTypes.MELT,
        isTokenEvmNative,
      );
      return;
    }

    const evmTokenDecimals = await this.getTokenDecimals(evmTokenAddress, originalChainId);
    const convertedAmount = new BN(this.convertToEvmDecimals(Number.parseInt(amount), evmTokenDecimals));

    this.voteOnEvm(receiverAddress, convertedAmount, evmTokenAddress, txHash, senderAddress);
  }

  async voteOnEvm(
    receiverAddress: string,
    amount: BN,
    tokenAddress: string,
    txId: string,
    ogSenderAddress: string,
  ): Promise<boolean> {
    const federator = new FederatorHTR(this.config, this.logger, null);

    const sender = Web3.utils.keccak256(ogSenderAddress);
    const thirdTwoBytesSender = sender.substring(0, 42);
    const idHash = Web3.utils.keccak256(txId);
    const logIndex = 129;

    const transactionSender = new TransactionSender(this.getWeb3(this.config.mainchain.host), this.logger, this.config);
    const federatorAddress = await transactionSender.getAddress(this.config.privateKey);
    const federatorContract = await this.federationFactory.createInstance(
      this.config.mainchain,
      this.config.privateKey,
    );

    const transactionId = await federatorContract.getTransactionId({
      originalTokenAddress: tokenAddress,
      sender: thirdTwoBytesSender,
      receiver: receiverAddress,
      amount: amount,
      blockHash: idHash,
      transactionHash: idHash,
      logIndex: logIndex,
      originChainId: this.config.sidechain[0].chainId,
      destinationChainId: this.config.mainchain.chainId,
    });

    const isTransactionVotedOrProcessed = await this.isTransactionVotedOrProcessed(
      receiverAddress,
      amount,
      idHash,
      idHash,
      logIndex,
      this.config.sidechain[0].chainId,
      this.config.mainchain.chainId,
      tokenAddress,
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
      tokenAddress: tokenAddress,
      senderAddress: thirdTwoBytesSender,
      receiver: receiverAddress,
      amount: amount,
      transactionId: transactionId,
      originChainId: this.config.sidechain[0].chainId,
      destinationChainId: this.config.mainchain.chainId,
      blockHash: idHash,
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
