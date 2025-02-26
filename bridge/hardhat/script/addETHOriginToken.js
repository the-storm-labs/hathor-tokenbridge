// How to run the script: npx hardhat run ./hardhat/script/addETHOriginToken.js --network sepolia

const hre = require('hardhat');

async function main() {
    const {deployer} = await getNamedAccounts()
    
    // Parameters
    const tokenAddress = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
    const hathorTokenAddress = "00003b17e8d656e4612926d5d2c5a4d5b3e4536e6bebc61c76cb71a65b81986f";
    const typeId = 2;
    const networkId = 42161;

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
    const receipt = await multiSigContract.methods.submitTransaction(BridgeProxy.address, 0, addHathorTokenData).send({ from: deployer, gasLimit: 1000000 });
    console.log("Transaction worked, hathor info added, txHash:", receipt.transactionHash);

    const resultHathorToEvmTokenMap = await bridge.methods.HathorToEvmTokenMap(hathorTokenAddress).call({ from: deployer });
    console.log(`EVM Token Address ${resultHathorToEvmTokenMap.tokenAddress} ${resultHathorToEvmTokenMap.originChainId}`);

    const bytesFromHathorAddress = await bridge.methods.uidToAddress(hathorTokenAddress).call({ from: deployer });
    console.log(`Bytes from hATHOR Address ${bytesFromHathorAddress}`);

    const resultEvmToHathorTokenMap = await bridge.methods.EvmToHathorTokenMap(tokenAddress).call({ from: deployer });
    console.log(`Hathor Token Address ${resultEvmToHathorTokenMap}`);
};

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.log(error);
        process.exit(1);
    });