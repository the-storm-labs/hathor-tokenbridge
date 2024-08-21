import { Broker } from './Broker';
import { LogWrapper } from '../logWrapper';
import { ConfigData } from '../config';
import HathorException from '../../types/HathorException';
import { IBridgeV4 } from '../../contracts/IBridgeV4';
import { CreateProposalResponse } from '../../types/HathorResponseTypes';
import { FederationFactory } from '../../contracts/FederationFactory';
import { BridgeFactory } from '../../contracts/BridgeFactory';
import { HathorWallet } from '../HathorWallet';
import { HathorFederationFactory } from '../../contracts/HathorFederationFactory';
import { IHathorFederation } from '../../contracts/IHathorFederation';
import TransactionSender from '../TransactionSender';
import { TransactionTypes } from '../../types/transactionTypes';


export class EvmBroker extends Broker {
  public txIdType: string;
  private hathorFederationFactory: HathorFederationFactory;
  private transactionSender: TransactionSender;
  

  constructor(
    config: ConfigData,
    logger: LogWrapper,
    bridgeFactory: BridgeFactory,
    federationFactory: FederationFactory,
    transactionSender: TransactionSender,
  ) {
    super(config, logger, bridgeFactory, federationFactory);
    this.txIdType = 'hsh';
    this.transactionSender = transactionSender;
    this.hathorFederationFactory = new HathorFederationFactory();
  }

  async sendTokensToHathor(
    senderAddress: string,
    receiverAddress: string,
    qtd: string,
    tokenAddress: string,
    txHash: string,
  ) {
    // validations
    const [hathorTokenAddress, originalChainId] = await this.getHathorTokenAddress(tokenAddress);
    const hathorFederationContract = (await this.hathorFederationFactory.createInstance(
      this.config.mainchain,
    )) as IHathorFederation;
    const isTokenEvmNative = originalChainId == this.config.mainchain.chainId;
    const transactionType = isTokenEvmNative ? TransactionTypes.MINT : TransactionTypes.TRANSFER;

    const transactionId = await hathorFederationContract.getTransactionId(
      tokenAddress,
      txHash,
      qtd,
      senderAddress,
      receiverAddress,
      transactionType,
    );
    // the transaction has been processed before? if so, nothing to do
    const isProcessed = await hathorFederationContract.isProcessed(transactionId);
    const isSigned = await hathorFederationContract.isSigned(transactionId);
    const isProposed = await hathorFederationContract.isProposed(transactionId);

    const tokenDecimals = await this.getTokenDecimals(tokenAddress, originalChainId);
    const convertedQuantity = this.convertToHathorDecimals(qtd, tokenDecimals);

    if (convertedQuantity <= 0) {
      this.logger.info(
        `The amount transfered can't be less than 0.01 HTR. OG Qtd: ${qtd}, Token decimals ${tokenDecimals}.`,
      );
      return;
    }


    if (isProcessed) return; // No action needed if already processed

    if (isSigned) {
      if (!isProcessed) {
        // Send signatures if already signed but not yet processed

        const arrayLength = await hathorFederationContract.getSignatureCount(transactionId);



        if (arrayLength < this.config.mainchain.multisigRequiredSignatures) return;

        const txHex = await hathorFederationContract.transactionHex(transactionId);

        this.validateTx(txHex, transactionId);


        
        const signatures = await this.getSignaturesFromArray(transactionId);

        await this.signAndPushProposal(txHex, transactionId, signatures)

        

        const args = hathorFederationContract.getUpdateTransactionStateArgs(
          tokenAddress,
          txHash,
          convertedQuantity,
          senderAddress,
          receiverAddress,
          transactionType,
          true
        );

        const receipt = await this.transactionSender.sendTransaction(
          process.env.HATHOR_FEDERATION,
          args,
          0,
          this.config.privateKey,
        );

        if (!receipt.status) {
          this.logger.error(`Sending tokens from evm to hathor failed`, receipt);
        }



      }
      return;
    }

    if (isProposed) {
      if (!isSigned) {
        
        // the transaction if proposed but not signed
        
        
        const txHex = await hathorFederationContract.transactionHex(transactionId);

        this.validateTx(txHex, transactionId);


        const signature = await this.getMySignatures(txHex);

        const args = hathorFederationContract.getUpdateSignatureStateArgs(
          tokenAddress,
          txHash,
          convertedQuantity,
          senderAddress,
          receiverAddress,
          transactionType,
          signature,
          true
        );

        const receipt = await this.transactionSender.sendTransaction(
          process.env.HATHOR_FEDERATION,
          args,
          0,
          this.config.privateKey,
        );

        if (!receipt.status) {
          this.logger.error(`Sending tokens from evm to hathor failed`, receipt);
        }


      }
      return;
    }

    //validate transaction
    const txHex = isTokenEvmNative
      ? await this.sendMintProposal(receiverAddress, convertedQuantity, hathorTokenAddress)
      : await this.sendTransferProposal(receiverAddress, convertedQuantity, hathorTokenAddress);

    
    this.validateTx(txHex, transactionId);

    const args = hathorFederationContract.getSendTransactionProposalArgs(
      tokenAddress,
      txHash,
      convertedQuantity,
      senderAddress,
      receiverAddress,
      transactionType,
      txHex,
    );

    const receipt = await this.transactionSender.sendTransaction(
      process.env.HATHOR_FEDERATION,
      args,
      0,
      this.config.privateKey,
    );

    if (!receipt.status) {
      this.logger.error(`Sending tokens from evm to hathor failed`, receipt);
    }
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
    const wallet = HathorWallet.getInstance(this.config, this.logger);
    const data = {
      address: `${receiverAddress}`,
      amount: qtd,
      token: `${token}`,
    };

    const response = await wallet.requestWallet<CreateProposalResponse>(
      true,
      this.chainConfig.multisigWalletId,
      'wallet/p2sh/tx-proposal/mint-tokens',
      data,
    );
    if (response.status == 200 && response.data.success) {
      return response.data.txHex;
    }
    throw new HathorException(
      `Unable to send a mint proposal ${response.status} - ${response.statusText} - ${JSON.stringify(response.data)}`,
      response.data.message ?? response.data.error,
    );
  }

  private async sendTransferProposal(receiverAddress: string, qtd: number, token: string): Promise<string> {
    const wallet = HathorWallet.getInstance(this.config, this.logger);

    const output = {
      address: `${receiverAddress}`,
      value: qtd,
      token: `${token}`,
    };
    const outputs = [];
    outputs.push(output);

    const response = await wallet.requestWallet<CreateProposalResponse>(
      true,
      this.chainConfig.multisigWalletId,
      'wallet/tx-proposal',
      { outputs },
    );

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
  private async getSignaturesFromArray(transactionId: string): Promise<string[]> {

    const hathorFederationContract = (await this.hathorFederationFactory.createInstance(
      this.config.mainchain,
    )) as IHathorFederation;

    const arrayLength = await hathorFederationContract.getSignatureCount(transactionId);
    const signatures = [];

    for (let i = 0; i < arrayLength; ++i) {
        const signature = await hathorFederationContract.transactionSignatures(transactionId, i);
        signatures.push(signature);
    }

    return signatures;
  }

  private async getSignaturesFromEvents(transactionId: string): Promise<string[]> {
    
    const hathorFederationContract = (await this.hathorFederationFactory.createInstance(
      this.config.mainchain,
    )) as IHathorFederation;

    const signatures: string[] = [];

    const events = await hathorFederationContract.getPastEvents('ProposalSigned', {
        filter: { transactionId },
        fromBlock: 0,
        toBlock: 'latest'
    });

    // Extract signatures from the events
    for (const event of events) {
        signatures.push(event.returnValues.signature);
    }

    return signatures;
}

}
