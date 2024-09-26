// How to run the script: npx hardhat run ./hardhat/script/claimHathorTransaction.js --network sepolia
const hre = require('hardhat');

async function main() {
    const {getNamedAccounts, deployments} = hre;
    let {deployer} = await getNamedAccounts();
    // let deployer = '0xE23d59ef0c1F63B53234b00a1e1EaBEf822397D2';
    // console.log(deployer);
    
    const Bridge = await deployments.get('Bridge');
    const BridgeProxy = await deployments.get('BridgeProxy');
    const bridge = new web3.eth.Contract(Bridge.abi, BridgeProxy.address)

    const hash = '0x52D9838711F83E5AED15BA549576CAFCEED59C08C7BB3F48ECF1716A09566EF7';

    const claim = {
        to: '0xCC3CF44397Daa4572CDb20f72dee5700507454E4',
		amount: '20000000000000000',
		blockHash: hash,
		transactionHash: hash,
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