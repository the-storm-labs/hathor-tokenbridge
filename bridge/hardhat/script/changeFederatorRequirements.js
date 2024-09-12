// How to run the script: npx hardhat run ./hardhat/script/changeFederatorRequirements.js --network sepolia
const hre = require('hardhat');

async function main() {
    const {getNamedAccounts, deployments} = hre;
    let {deployer} = await getNamedAccounts();
    
    const Federation = await deployments.get('Federation');
    const FederationProxy = await deployments.get('FederationProxy');      
    const federation = new web3.eth.Contract(Federation.abi, FederationProxy.address);
    const MultiSigWallet = await deployments.get('MultiSigWallet');
    const multiSigContract = new web3.eth.Contract(MultiSigWallet.abi, MultiSigWallet.address);

    const method = await federation.methods.changeRequirement(3);

    const receipt = await multiSigContract.methods.submitTransaction(
        FederationProxy.address,
        0,
        method.encodeABI()
    ).send({
        from: deployer,
        gasLimit: 3000000
    });

    console.log("txHash: ", receipt.transactionHash);
}

main()
    .then(() => process.exit(0))
    .catch((error) =>{
        console.error(error);
        process.exit(1)
    });