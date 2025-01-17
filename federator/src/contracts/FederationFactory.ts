import abiFederationV3 from '../../../bridge/abi/Federation.json';
import { IFederationV3 } from './IFederationV3';
import * as typescriptUtils from '../lib/typescriptUtils';
import { ContractFactory } from './ContractFactory';
import { AbiItem } from 'web3-utils';
import { Contract } from 'web3-eth-contract';
import { IFederation } from './IFederation';
import { ConfigChain } from '../lib/configChain';

export class FederationFactory extends ContractFactory {
  async createInstance(configChain: ConfigChain, privateKey: string): Promise<IFederation> {
    const web3 = this.getWeb3(configChain.host);
    const chainId = configChain.chainId;
    const federationContract = this.getContractByAbiAndChainId(
      abiFederationV3 as AbiItem[],
      configChain.federation,
      web3,
      chainId,
    );
    return new IFederationV3(configChain, federationContract, privateKey);
  }

  async getVersion(federationContract: Contract) {
    try {
      return await typescriptUtils.retryNTimes(federationContract.methods.version().call());
    } catch (err) {
      return 'v2';
    }
  }
}
