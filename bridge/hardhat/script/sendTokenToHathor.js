// How to run the script: npx hardhat run ./hardhat/script/isTokenAllowed.js --network rsktestnet
const hre = require('hardhat');

async function main() {
    const {getNamedAccounts, deployments} = hre;
    const {deployer} = await getNamedAccounts();
    console.log(deployer);

    const Token = await deployments.get('MainToken');
    const token = new web3.eth.Contract(Token.abi, Token.address)
    const Bridge = await deployments.get('Bridge');
    const BridgeProxy = await deployments.get('BridgeProxy');
    const bridge = new web3.eth.Contract(Bridge.abi, BridgeProxy.address)

    const result = await token.methods.approve(BridgeProxy.address, '3000000000000000000').send({from: deployer, gasLimit: 3000000});

    console.log("Tokens approved, txHash: ", result.transactionHash);
    
    const receipt = await bridge.methods
        .receiveTokensTo(31, 
        '0x247d6326586a111860D103dB009c3FB4317C8444', 
        'WjDz74uofMpF87xy9F9F1HYs9rjU6vY8Gr', 
        '1000000000000000000').send({ from: deployer, gasLimit: 3000000 });

    console.log("Tokens sent, txHash: ", receipt.transactionHash);
}

main()
    .then(() => process.exit(0))
    .catch((error) =>{
        console.error(error);
        process.exit(1)
    });