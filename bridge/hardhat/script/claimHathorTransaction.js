// How to run the script: npx hardhat run ./hardhat/script/claimHathorTransaction.js --network sepolia
const hre = require('hardhat');

async function main() {
    const {getNamedAccounts, deployments} = hre;
    // let {deployer} = await getNamedAccounts();    
    let deployer = '0xE23d59ef0c1F63B53234b00a1e1EaBEf822397D2';
    // console.log(deployer);
    
    const Bridge = await deployments.get('Bridge');
    const BridgeProxy = await deployments.get('BridgeProxy');
    const bridge = new web3.eth.Contract(Bridge.abi, BridgeProxy.address)

    const claim = {
        to: '0xE23d59ef0c1F63B53234b00a1e1EaBEf822397D2',
		amount: '20000000000000000',
		blockHash: '0xdbba3e4632c6da40a1c82dd75714de00f5a50227994a391dc072a8fa19bd8460',
		transactionHash: '0xdbba3e4632c6da40a1c82dd75714de00f5a50227994a391dc072a8fa19bd8460',
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