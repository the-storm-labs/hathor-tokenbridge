// How to run the script: npx hardhat run ./hardhat/script/addMainToken.js --network sepolia

const hre = require('hardhat');

async function main() {
    const {deployer} = await getNamedAccounts()
    
    // Parameters
    const tokenAddress = "0x39E592685C791cFFEE63f7e95EC7165840A04d37";
    const hathorTokenAddress = "00004a7de70e9d056322d0dbe3d96d9153c8357b8832a4597cc0fdf9f6626fb7";
    const typeId = 4;
    const networkId = 31;

    // Get contract's ABI and addresses
    const AllowTokens = await deployments.get('AllowTokens');
    const AllowTokensProxy = await deployments.get('AllowTokensProxy');
    const Bridge = await deployments.get('Bridge');
    const BridgeProxy = await deployments.get('BridgeProxy');
    const MultiSigWallet = await deployments.get('MultiSigWallet');
    
    // Instanciate contracts
    const allowTokens = new web3.eth.Contract(AllowTokens.abi, AllowTokensProxy.address);
    const bridge = new web3.eth.Contract(Bridge.abi, BridgeProxy.address);
    const multiSigContract = new web3.eth.Contract(MultiSigWallet.abi, MultiSigWallet.address);
    
    // Set token on allow tokens
    const setTokenData = allowTokens.methods.setToken(tokenAddress, typeId).encodeABI();
    const setTokenReceipt = await multiSigContract.methods.submitTransaction(AllowTokensProxy.address, 0, setTokenData).send({ from: deployer, gasLimit: 600000 });
    console.log(`Transaction worked, token set, txHash:`, setTokenReceipt.transactionHash);

    // Add hathor information to token
    const addHathorTokenData = bridge.methods.addHathorToken(networkId, tokenAddress, hathorTokenAddress).encodeABI();    
    const receipt = await multiSigContract.methods.submitTransaction(BridgeProxy.address, 0, addHathorTokenData).send({ from: deployer, gasLimit: 600000 });
    console.log("Transaction worked, hathor info added, txHash:", receipt.transactionHash);

    const resultHathorToEvmTokenMap = await bridge.methods.HathorToEvmTokenMap(hathorTokenAddress).call({ from: deployer });
    console.log(`EVM Token Address ${resultHathorToEvmTokenMap.tokenAddress} ${resultHathorToEvmTokenMap.originChainId}`);

    const resultEvmToHathorTokenMap = await bridge.methods.EvmToHathorTokenMap(tokenAddress).call({ from: deployer });
    console.log(`Hathor Token Address ${resultEvmToHathorTokenMap}`);
};

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.log(error);
        process.exit(1);
    });