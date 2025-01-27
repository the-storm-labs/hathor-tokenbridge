# Hathor <-> EVM Token Bridge

Hathor/EVM Bridge that allows moving ERC20-like tokens from one chain to the other.

## Rationale

Cross-chain events are crucial for the future of crypto. Exchanging tokens between networks enables token holders to use them on their preferred chain without being restricted by the contract owner’s network choice. Additionally, this allows Layer 2 solutions to leverage the same tokens across different chains. When combined with stablecoins, this concept creates an effective method for low-volatility payments across networks.

## Overview

The mechanism relies on a **Multisig** system on the Hathor network instead of a smart contract-based bridge. The process involves:

1. A user deposits and locks tokens in the **Multisig wallet** on Hathor.
2. This action triggers an off-chain event that is processed by a group of validators.
3. Once a threshold of validators signs the transaction, an equivalent amount of tokens is minted on the EVM blockchain in an ERC20-compatible mirror contract.
4. When tokens are transferred back, the process is reversed—tokens on the EVM side are burned, and validators release the locked tokens on Hathor.

This model ensures security and decentralization while allowing seamless asset movement between the two blockchains.

<p align="center">
  <img src="./docs/images/token-bridge-diagram.png"/>
</p>

## Usage

You can use the **Hathor-EVM Token Bridge Dapp** with compatible wallets such as MetaMask (configured for the EVM network) and Hathor Wallet to transfer tokens between networks.

For detailed instructions, refer to the [Dapp Guide](#) (link to documentation).

## Contracts Deployed on Hathor and EVM Blockchain

Here are the [addresses](#) of the deployed contracts on different networks.

## Report Security Vulnerabilities

To report a vulnerability, please follow the [security reporting guidelines](#).

## Developers

### Contracts

The smart contracts used by the bridge and the instructions for deployment are available in the [bridge folder](#).
The ABI for interacting with the contracts is in the [abi folder](#).

### Dapp

The frontend for the token bridge can be found in the repository [hathor-evm-tokenbridge-ui](#).

### Multisig Validators

The Multisig system on Hathor ensures security by requiring a majority consensus before executing a transaction. A predefined number of signers must approve any token locking or unlocking event to maintain trust in the system.

For more details, see the [Multisig documentation](#).

### Integration Test

Integration tests are prepared for contracts and validators. To properly run integration tests, ensure the network configuration is set up correctly in the `truffle-config.js` and `package.json` files in the `bridge` folder.

Steps:

1. Check `mnemonic.key` in `bridge`.
2. Ensure the correct network settings in the `bridge/migrations` folder.
3. Run `npm run deployIntegrationTest` in `bridge`.
4. Run `npm run integrationTest` in the `validator` folder.

By following these steps, you can verify that the bridge operates correctly across both networks.

