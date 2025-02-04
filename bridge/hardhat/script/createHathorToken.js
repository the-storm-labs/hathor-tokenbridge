// How to run the script: npx hardhat run ./hardhat/script/createHathorToken.js --network sepolia
const hre = require("hardhat");

async function main() {
  const {getNamedAccounts, deployments} = hre;
  const {deployer} = await getNamedAccounts();


  const Bridge = await deployments.get('Bridge');
  const BridgeProxy = await deployments.get('BridgeProxy');
  const MultiSigWallet = await deployments.get('MultiSigWallet');

  const bridge = new web3.eth.Contract(Bridge.abi, BridgeProxy.address);
  const multiSigContract = new web3.eth.Contract(MultiSigWallet.abi, MultiSigWallet.address);

  const hathorAddr = '00';

  const addrFromToken = await bridge.methods.uidToAddress(hathorAddr).call({ from: deployer });

  const tokens = [
    {
      name: 'Regular Hathor Token (eRHT)',
      symbol: 'eHTR',
      typeId: 1,
      originalHathorAddress: hathorAddr,
      originalTokenAddress: addrFromToken,
      chainId: 31
    }
  ];

  for (const token of tokens) {
    console.log("Token", token);
    console.log("deployer", deployer);
    console.log("\nBridge", Bridge.address);
    console.log("\nBridgeProxy", BridgeProxy.address);
    console.log("\nMultiSigWallet", MultiSigWallet.address);

    const methodCallCreateSideToken = bridge.methods.createSideToken(
      token.typeId,
      token.originalTokenAddress,
      18,
      token.symbol,
      token.name,
      token.chainId
    );
    const result = await methodCallCreateSideToken.call({ from: MultiSigWallet.address});
    console.log("Method call result", result);

    const receipt = await multiSigContract.methods.submitTransaction(
      BridgeProxy.address,
      0,
      methodCallCreateSideToken.encodeABI()
    ).send({
      from: deployer,
      gasLimit: 3000000
    });
    console.log("Transaction worked", receipt.transactionHash);

    const methodCallAddHathorToken = await bridge.methods.addHathorToken(31, addrFromToken, hathorAddr);

    const receipt1 = await multiSigContract.methods.submitTransaction(
      BridgeProxy.address,
      0,
      methodCallAddHathorToken.encodeABI()
    ).send({
      from: deployer,
      gasLimit: 3000000
    });

    console.log("Transaction worked", receipt1.transactionHash);
  }

  console.log("finish");

  //0xfb163D3CB9D63b547eEbc060BcC32EA22D5d2838 -> mumbai
  //0x0280f915ce595ec0d3457f89a0eba554999ec273 -> hathor
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors. 1.4539
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });