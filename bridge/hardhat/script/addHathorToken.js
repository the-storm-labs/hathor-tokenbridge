// How to run the script: npx hardhat run ./hardhat/script/addHathorToken.js --network mumbai
const hre = require("hardhat");

async function main() {
  const {getNamedAccounts, deployments} = hre;
  const {deployer} = await getNamedAccounts();
  const transactionEtherValue = 0;
  const mainToken = "0x9956D17A0615e2aF9F3745C87a55db05fcc50329";
  const hathorToken = "00000000394112cb11b7ebb96adb435b5796bd3eed4f4829c1ebbd98e370fc18";

  const Bridge = await deployments.get('Bridge');
  const BridgeProxy = await deployments.get('BridgeProxy');
  const MultiSigWallet = await deployments.get('MultiSigWallet');

  const bridge = new web3.eth.Contract(Bridge.abi, BridgeProxy.address);

  const tx = await bridge.methods.uidToAddress(hathorToken).call({ from: deployer });
  console.log(`uid mapped to ${tx}`);

  const evmTokenAddress = await bridge.methods.HathorToEvmTokenMap(hathorToken).call({ from: deployer });
  console.log(`EVM Token Address ${evmTokenAddress}`);

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
