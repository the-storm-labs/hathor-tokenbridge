import abi from '../../../bridge/abi/HathorFederation.json';
import { AbiItem } from 'web3-utils';
import { ContractFactory } from './ContractFactory';
import { ConfigChain } from '../lib/configChain';
import { IHathorFederation } from './IHathorFederation';
import { IHathorFederationV1 } from './IHathorFederationV1';

export class HathorFederationFactory extends ContractFactory {
  async createInstance(configChain: ConfigChain): Promise<IHathorFederation> {
    const web3 = this.getWeb3(configChain.host);
    const chainId = configChain.chainId;
    const contract = new web3.eth.Contract(abi as AbiItem[], '0x83e114b4f071d45be22fb3ef546942ed5ca40cab');
    return new IHathorFederationV1(contract, chainId, web3);
  }
}
