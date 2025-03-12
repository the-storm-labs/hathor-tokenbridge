import { Contract, EventLog } from 'web3-eth-contract';
import { IBridge } from './IBridge';
import { ContractAbi } from 'web3';

interface SideTokenAddressByOriginalTokenInterface {
  originalTokenAddress: string;
  chainId: number;
}

interface OriginalToken {
  tokenAddress: string;
  originChainId: number;
}

export class IBridgeV4 implements IBridge {
  bridgeContract: Contract<ContractAbi>;
  chainId: number;

  constructor(bridgeContract: Contract<ContractAbi>, chainId: number) {
    this.bridgeContract = bridgeContract;
    this.chainId = chainId;
  }

  getFederation() {
    return this.bridgeContract.methods.getFederation();
  }

  getAllowedTokens() {
    return this.bridgeContract.methods.allowedTokens();
  }

  getPastEvents(eventName, destinationChainId: number, options: any): Promise<(string | EventLog)[]> {
    options.filter = { _destinationChainId: destinationChainId };
    return this.bridgeContract.getPastEvents(eventName, options);
  }

  getAddress(): string {
    return this.bridgeContract.options.address;
  }

  getTransactionDataHash({
    to,
    amount,
    blockHash,
    transactionHash,
    logIndex,
    originChainId,
    destinationChainId,
  }): Promise<string> {
    return this.bridgeContract.methods
      .getTransactionDataHash(to, amount, blockHash, transactionHash, logIndex, originChainId, destinationChainId)
      .call();
  }

  getProcessed(transactionDataHash: string): Promise<boolean> {
    return this.bridgeContract.methods.claimed(transactionDataHash).call();
  }

  getVersion(): Promise<string> {
    return this.bridgeContract.methods.version().call();
  }

  getMappedToken(paramsObj: SideTokenAddressByOriginalTokenInterface): Promise<string> {
    return this.bridgeContract.methods
      .sideTokenByOriginalToken(paramsObj.chainId, paramsObj.originalTokenAddress)
      .call();
  }

  EvmToHathorTokenMap(mainToken: string): Promise<string> {
    return this.bridgeContract.methods.EvmToHathorTokenMap(mainToken).call();
  }

  HathorToEvmTokenMap(mainToken: string): Promise<OriginalToken> {
    return this.bridgeContract.methods.HathorToEvmTokenMap(mainToken).call();
  }

  sideTokenByOriginalToken(originChainId: number, originaTokenAddress: string): Promise<string> {
    return this.bridgeContract.methods.sideTokenByOriginalToken(originChainId, originaTokenAddress).call();
  }
}
