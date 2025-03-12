import Web3, { AbiFragment, Contract } from 'web3';

export class ContractFactory {
  contractsByChainIdAndAbi: { [key: number]: Map<AbiFragment[], Contract<AbiFragment[]>> };
  public web3ByHost: Map<string, Web3>;

  constructor() {
    this.contractsByChainIdAndAbi = [];
    this.web3ByHost = new Map<string, Web3>();
  }

  // There should only be one address per abi per chainId - the address is only needed to create a new web3.eth.Contract object.
  getContractByAbiAndChainId(
    abi: AbiFragment[],
    address: string,
    web3: Web3,
    chainId: number,
  ): Contract<AbiFragment[]> {
    let contractForChainId = this.contractsByChainIdAndAbi[chainId];
    if (!contractForChainId) {
      contractForChainId = new Map();
      this.contractsByChainIdAndAbi[chainId] = contractForChainId;
    }
    let contractForAbi = contractForChainId.get(abi);
    if (!contractForAbi) {
      contractForAbi = new web3.eth.Contract(abi, address);
      contractForChainId.set(abi, contractForAbi);
    }
    return contractForAbi;
  }

  getWeb3(host: string): Web3 {
    let hostWeb3 = this.web3ByHost.get(host);
    if (!hostWeb3) {
      hostWeb3 = new Web3(host);
      this.web3ByHost.set(host, hostWeb3);
    }
    return hostWeb3;
  }
}
