// How to run the script: npx hardhat run ./hardhat/script/addHathorToken.js --network sepolia
const hre = require("hardhat");

async function main() {
  const {getNamedAccounts, deployments} = hre;
  const {deployer} = await getNamedAccounts();
  const transactionEtherValue = 0;
  
  const MainToken = await deployments.get('Bridge');
  
  const mainToken = "0x3Bd3b546F5FB3Ac5Fc50596646C5Efd27889f729";
  const hathorToken = "00000000965355c07150672d8bac0bfa52486cfe8ec7c3af8e44cfb66a945b32";

  const Bridge = await deployments.get('Bridge');
  const BridgeProxy = await deployments.get('BridgeProxy');
  const MultiSigWallet = await deployments.get('MultiSigWallet');

  const bridge = new web3.eth.Contract(Bridge.abi, BridgeProxy.address);
  const multiSigContract = new web3.eth.Contract(MultiSigWallet.abi, MultiSigWallet.address);

  // const mainToken = await bridge.methods.uidToAddress(hathorToken).call({ from: deployer });

  const methodCallAddHathorToken = await bridge.methods.addHathorToken(11155111, mainToken, hathorToken);
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
