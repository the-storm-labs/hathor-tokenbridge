// How to run the script: npx hardhat run ./hardhat/script/addHathorToken.js --network sepolia
const hre = require("hardhat");

async function main() {
  const {getNamedAccounts, deployments} = hre;
  const {deployer} = await getNamedAccounts();
  const transactionEtherValue = 0;
  
  const MainToken = await deployments.get('MainToken');  
  const hathorToken = "000002c993795c9ef5b894571af2277aaf344438c2f8608a50daccc6ace7c0a1";

  const Bridge = await deployments.get('Bridge');
  const BridgeProxy = await deployments.get('BridgeProxy');
  const MultiSigWallet = await deployments.get('MultiSigWallet');

  const bridge = new web3.eth.Contract(Bridge.abi, BridgeProxy.address);
  const multiSigContract = new web3.eth.Contract(MultiSigWallet.abi, MultiSigWallet.address);

  const mainToken = await bridge.methods.uidToAddress(hathorToken).call({ from: deployer });

  console.log(`Bytes Main Token Address ${mainToken}`);

  const methodCallAddHathorToken = await bridge.methods.addHathorToken(11155111, MainToken.address, hathorToken);
  const result = await methodCallAddHathorToken.call({ from: MultiSigWallet.address });
  console.log("Method call result", result);

  const receipt = await multiSigContract.methods.submitTransaction(
    BridgeProxy.address,
    transactionEtherValue,
    methodCallAddHathorToken.encodeABI()
  ).send({
    from: deployer,
    gasLimit: 3000000
  });

  console.log("Transaction worked, member added, txHash:", receipt.transactionHash);

  const evmTokenAddress = await bridge.methods.HathorToEvmTokenMap(hathorToken).call({ from: deployer });
  console.log(`EVM Token Address ${evmTokenAddress.tokenAddress} ${evmTokenAddress.originChainId}`);

  const hathorTokenAddress = await bridge.methods.EvmToHathorTokenMap(mainToken).call({ from: deployer });
  console.log(`Hathor Token Address ${hathorTokenAddress}`);

}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
