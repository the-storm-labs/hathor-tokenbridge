// How to run the script: npx hardhat run ./hardhat/script/sendTokenToHathor.js --network mumbai
const hre = require('hardhat');

async function main() {
    const {getNamedAccounts, deployments} = hre;
    // const {deployer} = await getNamedAccounts();
    // console.log(deployer);
    let deployer = '0xE23d59ef0c1F63B53234b00a1e1EaBEf822397D2';    

    const Token = await deployments.get('MainToken');
    // const token = new web3.eth.Contract(Token.abi, Token.address)
    const sideTokenAddress = "0xfb163D3CB9D63b547eEbc060BcC32EA22D5d2838";
    const token = new web3.eth.Contract(Token.abi, sideTokenAddress);
        
    const Bridge = await deployments.get('Bridge');
    const BridgeProxy = await deployments.get('BridgeProxy');
    const bridge = new web3.eth.Contract(Bridge.abi, BridgeProxy.address)

    const result = await token.methods.approve(BridgeProxy.address, '10000000000000000').send({from: deployer, gasLimit: 3000000});

    // console.log(`Is ${Token.address} correct? 0x9956d17a0615e2af9f3745c87a55db05fcc50329`);
    console.log("Tokens approved, txHash: ", result.transactionHash);
    
    const receipt = await bridge.methods
        .receiveTokensTo(31, 
        sideTokenAddress, 
        'WjDz74uofMpF87xy9F9F1HYs9rjU6vY8Gr', 
        '10000000000000000').send({ from: deployer, gasLimit: 3000000 });

    console.log("Tokens sent, txHash: ", receipt.transactionHash);
}

main()
    .then(() => process.exit(0))
    .catch((error) =>{
        console.error(error);
        process.exit(1)
    });