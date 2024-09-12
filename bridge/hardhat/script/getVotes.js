// How to run the script: npx hardhat run ./hardhat/script/getVotes.js --network sepolia
const hre = require("hardhat");

async function main() {
  const {deployments} = hre;

  const Federation = await deployments.get('Federation');
  const FederationProxy = await deployments.get('FederationProxy');
  // const MultiSigWallet = await deployments.get('MultiSigWallet');

  const federator = new web3.eth.Contract(Federation.abi, FederationProxy.address);

  const transactionId = "0xe8ea4d4905add8f36aae714f77d870f8d435c71a37cb6127fc78afe99c49eb55";

  //const result = await federator.methods.hasVoted().call();

  // const result = await federator.methods.isVoted(transactionId, transactionId).call();
const result = await federator.methods.getTransactionCount(transactionId).call();

  // const result = await methodCallGetMembers.call({ from: MultiSigWallet.address});
  console.log("Method call result", result);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
