require('@nomiclabs/hardhat-web3');
require('@nomiclabs/hardhat-truffle5');
require('solidity-coverage');
require('hardhat-gas-reporter');
require('hardhat-deploy');
require('hardhat-abi-exporter');
require('hardhat-contract-sizer');
require('@thinkanddev/hardhat-erc1820-rsk');
require("@nomiclabs/hardhat-etherscan");

const fs = require('fs');
const chains = require('./hardhat/helper/chains');
const MNEMONIC = fs.existsSync('./mnemonic.key') ? fs.readFileSync('./mnemonic.key', {encoding: 'utf8'}) : ''; // Your metamask's recovery words
const ETHERESCAN_KEY = fs.existsSync('./etherscan.key') ? fs.readFileSync('./etherscan.key', {encoding: 'utf8'}) : ''; // Your Etherscan API Key to verify the contracts
const INFURA_PROJECT_ID = fs.existsSync('./infura.key') ? fs.readFileSync('./infura.key', {encoding: 'utf8'}) : ''; //  Your Infura project ID

const DEFAULT_DEPLOYER_ACCOUNT_INDEX = 0;

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    version: '0.8.9', // Max Supported by hardhat https://hardhat.org/reference/solidity-support.html
    settings: {
      evmVersion: 'istanbul',
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  gasReporter: {
    currency: 'RBTC',
    gasPrice: 0.06,
    enabled: true,
  },
  abiExporter: {
    path: './abi',
    runOnCompile: true,
    clear: true,
    flat: true,
    only: [
      ':AllowTokens',
      ':Bridge',
      ':Federation',
      ':IERC20$',
      ':MainToken$',
      ':ERC777$',
      ':MultiSigWallet$',
      ':ProxyAdmin$',
      ':SideToken',
      ':TransparentUpgradeableProxy$'
    ],
  },
  namedAccounts: getNamedAccounts(),
  etherscan: {
    apiKey: {
      mainnet: ETHERESCAN_KEY,
      ropsten: ETHERESCAN_KEY,
      rinkeby: ETHERESCAN_KEY,
      goerli: ETHERESCAN_KEY,
      kovan: ETHERESCAN_KEY,
      sepolia: ETHERESCAN_KEY,
      holesky: ETHERESCAN_KEY,
      mumbai: ETHERESCAN_KEY,
      amoy: ETHERESCAN_KEY,
      sepolia_arbitrum: ETHERESCAN_KEY
    }
  },
  networks: {
    hardhat: {
      live: false,
      blockGasLimit: 6800000,
      network_id: chains.HARDHAT_TEST_NET_CHAIN_ID,
      token_symbol: 'h',
      gasPrice: 60000000,
      hardfork: 'istanbul', // London hardfork is incompatible with RSK gasPrice

      tags: ['test', 'local'],
    },
    //Ganache
    development: {
      live: false,
      url: 'http://127.0.0.1:8545',
      network_id: chains.GANACHE_DEV_NET_CHAIN_ID,
      token_symbol: 'e',
      gas: 6700000,
      gasPrice: 20000000000,
      hardfork: 'istanbul', // London hardfork is incompatible with RSK gasPrice
      tags: ['integrationTest', 'local'],
      saveDeployments: false,
    },
    mirrorDevelopment: {
      live: false,
      url: 'http://127.0.0.1:8546',
      network_id: chains.GANACHE_DEV_MIRROR_CHAIN_ID,
      token_symbol: 'e',
      gas: 6700000,
      gasPrice: 20000000000,
      hardfork: 'istanbul', // London hardfork is incompatible with RSK gasPrice
      tags: ['integrationTest', 'local'],
      saveDeployments: false,
    },
    // RSK
    rsktestnet: {
      live: true,
      url: 'https://public-node.testnet.rsk.co',
      blockGasLimit: 6800000,
      gasPrice: 68000000, // 0.06 gwei
      network_id: chains.RSK_TEST_NET_CHAIN_ID,
      token_symbol: 'r',
      hardfork: 'istanbul', // London hardfork is incompatible with RSK gasPrice
      accounts: {
        mnemonic: MNEMONIC,
      },
      tags: ['staging'],
    },
    rskmainnet: {
      live: true,
      url: 'https://public-node.rsk.co',
      blockGasLimit: 6800000,
      gasPrice: 60000000, // 0.06 gwei
      network_id: chains.RSK_MAIN_NET_CHAIN_ID,
      token_symbol: 'r',
      hardfork: 'istanbul', // London hardfork is incompatible with RSK gasPrice
      accounts: {
        mnemonic: MNEMONIC,
      },
      tags: ['prod'],
    },
    //Ethereum
    kovan: {
      live: true,
      url: 'https://kovan.infura.io/v3/' + INFURA_PROJECT_ID,
      network_id: chains.KOVAN_TEST_NET_CHAIN_ID,
      token_symbol: 'e',
      gas: 6700000,
      gasPrice: 10000000000,
      accounts: {
        mnemonic: MNEMONIC,
      },
      tags: ['staging'],
    },
    sepolia: {
      live: false,
      url: 'https://sepolia.infura.io/v3/' + INFURA_PROJECT_ID,
      network_id: chains.SEPOLIA_TEST_NET_CHAIN_ID,
      token_symbol: 'e',
      gas: "auto",
      gasPrice: "auto",
      accounts: {
        mnemonic: MNEMONIC,
      },
      tags: ['staging'],
    },  
    arbitrum_mainnet: {
      live: true,
      url: 'https://arbitrum-mainnet.infura.io/v3/' + INFURA_PROJECT_ID,
      network_id: chains.ARBITRUM_ONE_MAIN_NET_CHAIN_ID,
      token_symbol: 'e',
      gas: "auto",
      gasPrice: "auto",
      accounts: {
        mnemonic: MNEMONIC,
      },
      tags: ['prod'],
    },
    sepolia_arbitrum: {
      live: false,
      url: 'https://arbitrum-sepolia.infura.io/v3/' + INFURA_PROJECT_ID,
      network_id: chains.SEPOLIA_ARBITRUM_TEST_NET_CHAIN_ID,
      token_symbol: 'e',
      gas: "auto",
      gasPrice: "auto",
      accounts: {
        mnemonic: MNEMONIC,
      },
      tags: ['staging'],
    },
    holesky: {
      live: false,
      url: 'https://holesky.infura.io/v3/' + INFURA_PROJECT_ID,
      network_id: chains.HOLESKY_TEST_NET_CHAIN_ID,
      token_symbol: 'e',
      gas: 6700000,
      gasPrice: 10000000000,
      accounts: {
        mnemonic: MNEMONIC,
      },
      tags: ['staging'],
    },
    mumbai: {
      live: false,
      url: 'https://polygon-mumbai.infura.io/v3/' + INFURA_PROJECT_ID,
      network_id: chains.MUMBAI_TEST_NET_CHAIN_ID,
      token_symbol: 'p',
      gas: 6700000,
      gasPrice: 5000000000,
      accounts: {
        mnemonic: MNEMONIC,
      },
      tags: ['staging'],
    },
    amoy: {
      live: false,
      url: 'https://polygon-amoy.infura.io/v3/' + INFURA_PROJECT_ID,
      network_id: chains.AMOY_TEST_NET_CHAIN_ID,
      token_symbol: 'p',
      gas: 6700000,
      gasPrice: 160000000000,
      accounts: {
        mnemonic: MNEMONIC,
      },
      tags: ['staging'],
    },    
    rinkeby: {
      live: true,
      url: 'https://rinkeby.infura.io/v3/' + INFURA_PROJECT_ID,
      network_id: chains.RINKEBY_TEST_NET_CHAIN_ID,
      token_symbol: 'e',
      gas: 6700000,
      gasPrice: 10000000000,
      accounts: {
        mnemonic: MNEMONIC,
      },
      tags: ['staging'],
    },
    ethmainnet: {
      live: true,
      url: 'https://mainnet.infura.io/ws/v3/' + INFURA_PROJECT_ID,
      network_id: chains.ETHEREUM_MAIN_NET_CHAIN_ID,
      token_symbol: 'e',
      gas: 6700000,
      gasPrice: 250000000000,
      accounts: {
        mnemonic: MNEMONIC,
      },
      tags: ['prod'],
    },
  },
};

function getNamedAccounts() {
  return {
    deployer: {
      default: DEFAULT_DEPLOYER_ACCOUNT_INDEX,
    },
    multiSig: getMultiSigAddressesByChainId(),
    wrappedCurrency: getWrappedCurrencyAddressesByChainId(),
    proxyAdmin: getProxyAdminAddressesByChainId(),
    allowTokensProxy: getAllowTokensProxyAddressesByChainId(),
    bridgeProxy: getBridgeProxyAddressesByChainId(),
    federationProxy: getFederationProxyAddressesByChainId(),
    sideTokenFactory: getSideTokenFactoryAddressesByChainId(),
  };
}

function getMultiSigAddressesByChainId() {
  const multiSigAddressesByChainId = {};
  multiSigAddressesByChainId[chains.ETHEREUM_MAIN_NET_CHAIN_ID] = '0x040007b1804ad78a97f541bebed377dcb60e4138';
  multiSigAddressesByChainId[chains.RSK_MAIN_NET_CHAIN_ID] = '0x040007b1804ad78a97f541bebed377dcb60e4138';
  multiSigAddressesByChainId[chains.RSK_TEST_NET_CHAIN_ID] = '0x88f6b2bc66f4c31a3669b9b1359524abf79cfc4a';
  multiSigAddressesByChainId[chains.KOVAN_TEST_NET_CHAIN_ID] = '0x040007b1804ad78a97f541bebed377dcb60e4138';
  multiSigAddressesByChainId[chains.BSC_TEST_NET_CHAIN_ID] = '0xE3848f411587C2C8658A0d6F649e7F1E403873a6';
  multiSigAddressesByChainId[chains.RINKEBY_TEST_NET_CHAIN_ID] = '0x04994d7fF4938c5953A6C8411ad30083C9097348';
  return multiSigAddressesByChainId;
}

function getWrappedCurrencyAddressesByChainId() {
  const wrappedCurrencyAddressesByChainId = {};
  wrappedCurrencyAddressesByChainId[chains.ETHEREUM_MAIN_NET_CHAIN_ID] = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
  wrappedCurrencyAddressesByChainId[chains.RSK_MAIN_NET_CHAIN_ID] = '0x967f8799af07df1534d48a95a5c9febe92c53ae0';
  wrappedCurrencyAddressesByChainId[chains.RSK_TEST_NET_CHAIN_ID] = '0x09b6ca5e4496238a1f176aea6bb607db96c2286e';
  wrappedCurrencyAddressesByChainId[chains.KOVAN_TEST_NET_CHAIN_ID] = '0xd0A1E359811322d97991E03f863a0C30C2cF029C';
  wrappedCurrencyAddressesByChainId[chains.BSC_TEST_NET_CHAIN_ID] = '0xae13d989dac2f0debff460ac112a837c89baa7cd';
  wrappedCurrencyAddressesByChainId[chains.BSC_MAIN_NET_CHAIN_ID] = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
  wrappedCurrencyAddressesByChainId[chains.RINKEBY_TEST_NET_CHAIN_ID] = '0x1664Bd54e994C04bD0f9F7B7e9Ad7CC45d1537B1';
  return wrappedCurrencyAddressesByChainId;
}

function getProxyAdminAddressesByChainId() {
  const proxyAdminAddressesByChainId = {};
  proxyAdminAddressesByChainId[chains.ETHEREUM_MAIN_NET_CHAIN_ID] = '0xe4d351911a6d599f91a3db1843e2ecb0f851e7e6';
  proxyAdminAddressesByChainId[chains.RSK_MAIN_NET_CHAIN_ID] = '0x12ed69359919fc775bc2674860e8fe2d2b6a7b5d';
  proxyAdminAddressesByChainId[chains.RSK_TEST_NET_CHAIN_ID] = '0x8c35e166d2dea7a8a28aaea11ad7933cdae4b0ab';
  proxyAdminAddressesByChainId[chains.KOVAN_TEST_NET_CHAIN_ID] = '0xe4d351911a6d599f91a3db1843e2ecb0f851e7e6';
  proxyAdminAddressesByChainId[chains.BSC_TEST_NET_CHAIN_ID] = '0xb37Bf97A42eee6b995732530595E3d16639D9977';
  proxyAdminAddressesByChainId[chains.RINKEBY_TEST_NET_CHAIN_ID] = '0x0b32Ea549AB1F9F7390442B5E9438b58A105cB5f';
  return proxyAdminAddressesByChainId;
}

function getAllowTokensProxyAddressesByChainId() {
  const allowTokensProxyAddressesByChainId = {};
  allowTokensProxyAddressesByChainId[chains.ETHEREUM_MAIN_NET_CHAIN_ID] = '0xa3fc98e0a7a979677bc14d541be770b2cb0a15f3';
  allowTokensProxyAddressesByChainId[chains.RSK_MAIN_NET_CHAIN_ID] = '0xcb789036894a83a008a2aa5b3c2dde41d0605a9a';
  allowTokensProxyAddressesByChainId[chains.RSK_TEST_NET_CHAIN_ID] = '0xc65bf0ae75dc1a5fc9e6f4215125692a548c773a';
  allowTokensProxyAddressesByChainId[chains.KOVAN_TEST_NET_CHAIN_ID] = '0x92bf86334583909b60f9b798a9dd7debd899fec4';
  allowTokensProxyAddressesByChainId[chains.BSC_TEST_NET_CHAIN_ID] = '0x9a64fc2416EE2157e19DC2C79B5B22D113a9E0C3';
  allowTokensProxyAddressesByChainId[chains.RINKEBY_TEST_NET_CHAIN_ID] = '0xAE3852306015df037D458a65173BBc7527F4680b';
  return allowTokensProxyAddressesByChainId;
}

function getBridgeProxyAddressesByChainId() {
  const bridgeProxyAddressesByChainId = {};
  bridgeProxyAddressesByChainId[chains.ETHEREUM_MAIN_NET_CHAIN_ID] = '0x12ed69359919fc775bc2674860e8fe2d2b6a7b5d';
  bridgeProxyAddressesByChainId[chains.RSK_MAIN_NET_CHAIN_ID] = '0x9d11937e2179dc5270aa86a3f8143232d6da0e69';
  bridgeProxyAddressesByChainId[chains.RSK_TEST_NET_CHAIN_ID] = '0x684a8a976635fb7ad74a0134ace990a6a0fcce84';
  bridgeProxyAddressesByChainId[chains.KOVAN_TEST_NET_CHAIN_ID] = '0x12ed69359919fc775bc2674860e8fe2d2b6a7b5d';
  bridgeProxyAddressesByChainId[chains.BSC_TEST_NET_CHAIN_ID] = '0xd9d2f9ee990ddb1147e595ae4f69ec468a0b58d0';
  bridgeProxyAddressesByChainId[chains.RINKEBY_TEST_NET_CHAIN_ID] = '0x7E339118346364d7D86AB67cb0775CBB808E65F7';
  return bridgeProxyAddressesByChainId;
}

function getFederationProxyAddressesByChainId() {
  const federationProxyAddressesByChainId = {};
  federationProxyAddressesByChainId[chains.ETHEREUM_MAIN_NET_CHAIN_ID] = '0x5e29c223d99648c88610519f96e85e627b3abe17';
  federationProxyAddressesByChainId[chains.RSK_MAIN_NET_CHAIN_ID] = '0x7ecfda6072942577d36f939ad528b366b020004b';
  federationProxyAddressesByChainId[chains.RSK_TEST_NET_CHAIN_ID] = '0x5d663981d930e8ec108280b9d80885658148ab0f';
  federationProxyAddressesByChainId[chains.KOVAN_TEST_NET_CHAIN_ID] = '0xa347438bc288f56cb6083a79133e70dd2d1f6c2d';
  federationProxyAddressesByChainId[chains.BSC_TEST_NET_CHAIN_ID] = '0xD40F8613173E636D570c47dB3A6Ac57EA9ccac83';
  federationProxyAddressesByChainId[chains.RINKEBY_TEST_NET_CHAIN_ID] = '0xBC383764ceBc13b66c04E1abeb36804a0Caaa5C6';
  return federationProxyAddressesByChainId;
}

function getSideTokenFactoryAddressesByChainId() {
  const sideTokenFactoryAddressesByChainId = {};
  sideTokenFactoryAddressesByChainId[chains.ETHEREUM_MAIN_NET_CHAIN_ID] = '0xF73C60863BF2930Bde2c69dF4CB8fE700Ae713fB';
  sideTokenFactoryAddressesByChainId[chains.RSK_MAIN_NET_CHAIN_ID] = '0x44fcd0854d745efdef4cfe9868efe4d4eb51ecd6';
  sideTokenFactoryAddressesByChainId[chains.RSK_TEST_NET_CHAIN_ID] = '0x08C191A7B5Edaa59853705F7eaE95E3E4238D73e';
  sideTokenFactoryAddressesByChainId[chains.KOVAN_TEST_NET_CHAIN_ID] = '0x984192ad76A8FFF2edf39C260324d32d8A80512b';
  sideTokenFactoryAddressesByChainId[chains.BSC_TEST_NET_CHAIN_ID] = '0xe2EBFC705d473C3dDd52CB49AF0bdE3132E8831e';
  sideTokenFactoryAddressesByChainId[chains.RINKEBY_TEST_NET_CHAIN_ID] = '0x1CB41Dc4603612A4da692669916e8F4dEF2994dC';
  return sideTokenFactoryAddressesByChainId;
}
