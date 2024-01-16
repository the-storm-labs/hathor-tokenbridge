// How to run the script: npx hardhat run ./hardhat/script/claimHathorTransaction.js --network mumbai
const hre = require('hardhat');

async function main() {
    const {getNamedAccounts, deployments} = hre;
    let {deployer} = await getNamedAccounts();
    // console.log(deployer);

    deployer = '0xE23d59ef0c1F63B53234b00a1e1EaBEf822397D2'

    const Token = await deployments.get('MainToken');
    
    const Bridge = await deployments.get('Bridge');
    const BridgeProxy = await deployments.get('BridgeProxy');
    const bridge = new web3.eth.Contract(Bridge.abi, BridgeProxy.address)

    const claim = {
        to: '0xE23d59ef0c1F63B53234b00a1e1EaBEf822397D2',
		amount: '10000000000000000',
		blockHash: '0xa56085e3f4b749fa220fcd355c5fb8f426200fa673a9c662551bf5390e11492c',
		transactionHash: '0x7ffa6dcb752f216e02d30a563e250b2c33c0e13fc73ca2c06748c78e20962357',
		logIndex: 129,
		originChainId: 31,
    }

    const receipt = await bridge.methods
        .claim(claim).send({ from: deployer, gasLimit: 3000000 });

    console.log("Tokens claimed, txHash: ", receipt.transactionHash);
}

main()
    .then(() => process.exit(0))
    .catch((error) =>{
        console.error(error);
        process.exit(1)
    });