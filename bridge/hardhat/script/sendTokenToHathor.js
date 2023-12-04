const hre = require('hardhat');

async function main() {
    const {getNamedAccounts, deployments} = hre;
    const {deployer} = await getNamedAccounts();
    console.log(deployer);

    const Bridge = await deployments.get('Bridge');
    const BridgeProxy = await deployments.get('BridgeProxy');
    const bridge = new web3.eth.Contract(Bridge.abi, BridgeProxy.address)

    const methodReceiveTokensTo = bridge.methods
        .receiveTokensTo(31, 
        '0x2bfe63ddb1de113f337ae454edf8bd1d4a19ee14', 
        'wY5dNSAqCsmcimkgHig3CzZPjYRDyBWbjv', 
        10000000000000000000n);

    const result = await methodReceiveTokensTo.call({ from: deployer.address });
    console.log('Send tokens result', result);    
}

main()
    .then(() => process.exit(0))
    .catch((error) =>{
        console.error(error);
        process.exit(1)
    });