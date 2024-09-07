// How to run the script: npx hardhat run ./hardhat/script/getTokenDecimals.js --network sepolia
const hre = require("hardhat");

async function main() {
  const {deployments} = hre;

  const Token = await deployments.get('MainToken');

  const token = new web3.eth.Contract(Token.abi, "0x5C2b6fd29BA6CfC27858fAE03aAc5eac14e5081D");

  const result = await token.methods.decimals().call();
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
