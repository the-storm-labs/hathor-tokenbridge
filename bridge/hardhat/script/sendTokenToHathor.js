// How to run the script: npx hardhat run ./hardhat/script/sendTokenToHathor.js --network sepolia
const hre = require('hardhat');

async function main() {
    const {getNamedAccounts, deployments} = hre;
    // const {deployer} = await getNamedAccounts();
    let deployer = '0xE23d59ef0c1F63B53234b00a1e1EaBEf822397D2';    
    // const tokenAddress = "0x76c6af5A264A4fA4360432e365F5A80503476415";
    const tokenAddress = "0x5C2b6fd29BA6CfC27858fAE03aAc5eac14e5081D";

    const Token = await deployments.get('MainToken');
    const token = new web3.eth.Contract(Token.abi, tokenAddress);
        
    const Bridge = await deployments.get('Bridge');
    const BridgeProxy = await deployments.get('BridgeProxy');
    const bridge = new web3.eth.Contract(Bridge.abi, BridgeProxy.address)

    const amount = '100000000000000000';

    const result = await token.methods.approve(BridgeProxy.address, amount).send({from: deployer, gasLimit: 3000000});
    console.log("Tokens approved, txHash: ", result.transactionHash);
    
    const receipt = await bridge.methods
        .receiveTokensTo(31, 
        tokenAddress, 
        'WjDz74uofMpF87xy9F9F1HYs9rjU6vY8Gr', 
        amount).send({ from: deployer, gasLimit: 3000000 });

    console.log("Tokens sent, txHash: ", receipt.transactionHash);
}

main()
    .then(() => process.exit(0))
    .catch((error) =>{
        console.error(error);
        process.exit(1)
    });