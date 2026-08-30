import { Web3Provider } from './Web3Provider';

describe('Web3Provider', () => {
  it('returns the same instance for a host', () => {
    // Three separate classes used to keep their own map of these, each building its own providers
    // for the same host.
    const provider = new Web3Provider();
    expect(provider.get('http://localhost:8545')).toBe(provider.get('http://localhost:8545'));
  });

  it('keeps hosts apart', () => {
    const provider = new Web3Provider();
    expect(provider.get('http://a.example')).not.toBe(provider.get('http://b.example'));
  });
});
