import abiAllowTokensV1 from '../../../bridge/abi/AllowTokens.json';
import { IAllowTokensV1 } from './IAllowTokensV1';
import * as typescriptUtils from '../lib/typescriptUtils';
import { ContractFactory } from './ContractFactory';
import { VERSIONS } from './Constants';
import { IAllowTokens } from './IAllowTokens';
import { ConfigChain } from '../lib/configChain';

export class AllowTokensFactory extends ContractFactory {
  async getVersion(allowTokensContract) {
    try {
      return await typescriptUtils.retryNTimes(allowTokensContract.methods.version().call());
    } catch (err) {
      return VERSIONS.V0;
    }
  }

  async createInstance(configChain: ConfigChain): Promise<IAllowTokens> {
    const web3 = this.getWeb3(configChain.host);
    const chainId = configChain.chainId;
    const allowTokensContract = this.getContractByAbiAndChainId(
      abiAllowTokensV1,
      configChain.allowTokens,
      web3,
      chainId,
    );

    return new IAllowTokensV1(allowTokensContract, chainId, configChain.multisigOrder);
  }
}
