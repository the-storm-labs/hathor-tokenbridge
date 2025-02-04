// How to run the script: npx hardhat run ./hardhat/script/sendTokenToHathor.js --network sepolia
const hre = require('hardhat');

async function main() {
    const {getNamedAccounts, deployments} = hre;
    const {deployer} = await getNamedAccounts();
    
    const tokenAddress = "0x97118caae1f773a84462490dd01fe7a3e7c4cdcd";

    const amount = '30000000000000000';
    const amount1 = '60000000000000000';

    const Token = await deployments.get('MainToken');
    const token = new web3.eth.Contract(Token.abi, tokenAddress);
        
    const Bridge = await deployments.get('Bridge');
    const BridgeProxy = await deployments.get('BridgeProxy');
    const bridge = new web3.eth.Contract(Bridge.abi, BridgeProxy.address)    

    const result = await token.methods.approve(BridgeProxy.address, amount).send({from: deployer, gasLimit: 3000000});
    console.log("Tokens approved, txHash: ", result.transactionHash);

    const receipt = await bridge.methods
        .receiveTokensTo(31, 
        tokenAddress, 
        'Wgi9fvVrnBrKsstCuFjySA3kWqWpb4C8ag', 
        amount).send({ from: deployer, gasLimit: 3000000 });

    console.log("Tokens sent, txHash: ", receipt.transactionHash);

    const result1 = await token.methods.approve(BridgeProxy.address, amount1).send({from: deployer, gasLimit: 3000000});
    console.log("Tokens approved, txHash: ", result1.transactionHash);
    
    const receipt1 = await bridge.methods
        .receiveTokensTo(31, 
        tokenAddress, 
        'Wgi9fvVrnBrKsstCuFjySA3kWqWpb4C8ag', 
        amount1).send({ from: deployer, gasLimit: 3000000 });

    console.log("Tokens sent, txHash: ", receipt1.transactionHash);
}

main()
    .then(() => process.exit(0)
    .catch((error) =>{
        console.error(error);
        process.exit(1)
    }));