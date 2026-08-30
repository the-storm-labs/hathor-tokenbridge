import Web3 from 'web3';

/**
 * One Web3 instance per RPC host, shared by everything that talks to that host.
 *
 * The previous code kept a `web3ByHost` map in three separate classes - Federator, Broker and
 * ContractFactory - each building its own instances of the same providers.
 */
export class Web3Provider {
  private readonly byHost = new Map<string, Web3>();

  get(host: string): Web3 {
    let web3 = this.byHost.get(host);
    if (!web3) {
      web3 = new Web3(host);
      this.byHost.set(host, web3);
    }
    return web3;
  }
}
