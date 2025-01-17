import abiBridgeV4 from '../../../bridge/abi/Bridge.json';
import { IBridgeV4 } from './IBridgeV4';
import * as typescriptUtils from '../lib/typescriptUtils';
import { AbiItem } from 'web3-utils';
import { ContractFactory } from './ContractFactory';
import { Contract } from 'web3-eth-contract';
import { ConfigChain } from '../lib/configChain';
import { IBridge } from './IBridge';

export class BridgeFactory extends ContractFactory {
  async getVersion(bridgeContract: Contract): Promise<string> {
    return typescriptUtils.retryNTimes(bridgeContract.methods.version().call());
  }

  async createInstance(configChain: ConfigChain): Promise<IBridge> {
    const web3 = this.getWeb3(configChain.host);
    const chainId = configChain.chainId;
    const bridgeContract = this.getContractByAbiAndChainId(abiBridgeV4 as AbiItem[], configChain.bridge, web3, chainId);
    return new IBridgeV4(bridgeContract, configChain.chainId);
  }
}
