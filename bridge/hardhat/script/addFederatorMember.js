// How to run the script: npx hardhat run ./hardhat/script/addFederatorMember.js --network sepolia
const hre = require("hardhat");

async function main() {

  console.log('starting')

  const {getNamedAccounts, deployments} = hre;
  const {deployer} = await getNamedAccounts();

  const transactionEtherValue = 0;
  const memberFederatorAddress = [
    "0xdaC1B4fC75E8792594CabA54a16beE94B4a700e5",
    "0xa50339B4413d5854291e93cACF95599a7265bE59",
    "0x225f64996Cd783E5acE8F5A20cdD7871304F1130",
    "0xcAfbbb39c25adF1AE8859a0197ab7CBD2cE78F56",
    "0xE245a452480a93D7AaCf040E8744964B714C6C4a",
  ];

  const Federation = await deployments.get('Federation');
  const FederationProxy = await deployments.get('FederationProxy');
  const MultiSigWallet = await deployments.get('MultiSigWallet');

  const federator = new web3.eth.Contract(Federation.abi, FederationProxy.address);
  const multiSigContract = new web3.eth.Contract(MultiSigWallet.abi, MultiSigWallet.address);

  for (let i = 0; i < memberFederatorAddress.length; i++) {
    const methodCallAddNewMember = federator.methods.addMember(
      memberFederatorAddress[i]
    );
    const result = await methodCallAddNewMember.call({ from: MultiSigWallet.address});
    console.log("Method call result", result);

    const receipt = await multiSigContract.methods.submitTransaction(
      FederationProxy.address,
      transactionEtherValue,
      methodCallAddNewMember.encodeABI()
    ).send({
      from: deployer,
      gasLimit: 3000000
    });
    console.log("Transaction worked, member added, txHash:", receipt.transactionHash);
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
