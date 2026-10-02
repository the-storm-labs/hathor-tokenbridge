// Brings a fresh `DeployFromScratch` on sepolia_arbitrum_multi up to the 2-of-3 federator testnet
// described in local/testnet-multi/README.md. Every step reads the current state first and skips
// itself if already done, so it is safe to re-run - e.g. once without HATHOR_TOKEN_UID, and again
// after the Hathor token exists.
//
// How to run the script:
//   npx hardhat run ./hardhat/script/setupTestnetMulti.js --network sepolia_arbitrum_multi
//   HATHOR_TOKEN_UID=<uid> npx hardhat run ./hardhat/script/setupTestnetMulti.js --network sepolia_arbitrum_multi
const fs = require('node:fs');
const path = require('node:path');
const hre = require('hardhat');

const PUBLIC_JSON = path.join(__dirname, '../../../local/testnet-multi/public.json');
// '=1usd' in tokensTypesTestnet() of deploy/09: min 1, medium 10, large 100 whole tokens.
const STABLECOIN_TYPE_ID = 4;
const TEST_TOKEN_DECIMALS = 6; // like USDC, so all three unit scales are exercised
const TEST_TOKEN_SUPPLY = (10n ** 6n * 10n ** 6n).toString(); // one million tUSDC
// HTR as mainnet registers it (hardhat/script/createHathorToken.js): uid "00" on Hathor's synthetic
// chain id 31, type 1 ('ETH' limits on testnet: min 0.0005, max 750).
const HTR_UID = '00';
const HATHOR_CHAIN_ID = 31;
const HTR_TYPE_ID = 1;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

async function main() {
  const { getNamedAccounts, deployments, network } = hre;
  const { deployer } = await getNamedAccounts();
  // localhost is allowed only to rehearse against `npx hardhat node`, which runs DeployFromScratch.
  if (!['sepolia_arbitrum_multi', 'localhost'].includes(network.name)) {
    throw new Error(`Refusing to run against ${network.name}; this script is for sepolia_arbitrum_multi.`);
  }

  const federators = JSON.parse(fs.readFileSync(PUBLIC_JSON, 'utf8')).federators.map((f) => f.evmAddress);

  const MultiSigWallet = await deployments.get('MultiSigWallet');
  const multiSig = new web3.eth.Contract(MultiSigWallet.abi, MultiSigWallet.address);
  const federation = new web3.eth.Contract(
    (await deployments.get('Federation')).abi,
    (await deployments.get('FederationProxy')).address,
  );
  const allowTokens = new web3.eth.Contract(
    (await deployments.get('AllowTokens')).abi,
    (await deployments.get('AllowTokensProxy')).address,
  );
  const bridge = new web3.eth.Contract(
    (await deployments.get('Bridge')).abi,
    (await deployments.get('BridgeProxy')).address,
  );

  // Dry-runs the call as the multisig first, so a revert shows up here with its reason instead of
  // as a silently unexecuted multisig transaction.
  async function viaMultiSig(label, target, methodCall) {
    await methodCall.call({ from: MultiSigWallet.address });
    const receipt = await multiSig.methods
      .submitTransaction(target, 0, methodCall.encodeABI())
      .send({ from: deployer, gasLimit: 3000000 });
    console.log(`${label}: ${receipt.transactionHash}`);
  }

  // 1. The test token.
  const testToken = await deployments.deploy('TestUSDC', {
    contract: 'MainToken',
    from: deployer,
    args: ['Test USDC', 'tUSDC', TEST_TOKEN_DECIMALS, TEST_TOKEN_SUPPLY],
    log: true,
  });

  // 2. Allowed on the bridge.
  if (await allowTokens.methods.isTokenAllowed(testToken.address).call()) {
    console.log('tUSDC already allowed');
  } else {
    await viaMultiSig(
      'setToken(tUSDC)',
      allowTokens.options.address,
      allowTokens.methods.setToken(testToken.address, STABLECOIN_TYPE_ID),
    );
  }

  // 3. The three federators become members, and only then does the deployer leave, so the
  //    federation is never left without members in between.
  for (const federator of federators) {
    if (await federation.methods.isMember(federator).call()) {
      console.log(`${federator} already a member`);
    } else {
      await viaMultiSig(`addMember(${federator})`, federation.options.address, federation.methods.addMember(federator));
    }
  }
  if (await federation.methods.isMember(deployer).call()) {
    await viaMultiSig(`removeMember(${deployer})`, federation.options.address, federation.methods.removeMember(deployer));
  }

  // 4. The Hathor token, once it exists. originalChainId is this chain: tUSDC is EVM-native, which
  //    is what makes the federator mint and melt on the Hathor side.
  const uid = process.env.HATHOR_TOKEN_UID;
  const mapped = await bridge.methods.EvmToHathorTokenMap(testToken.address).call();
  if (!uid) {
    console.log(`HATHOR_TOKEN_UID not set; tUSDC currently maps to "${mapped}"`);
  } else if (mapped === uid) {
    console.log(`tUSDC already maps to ${uid}`);
  } else {
    await viaMultiSig(
      `addHathorToken(${uid})`,
      bridge.options.address,
      bridge.methods.addHathorToken(await web3.eth.getChainId(), testToken.address, uid),
    );
  }

  // 5. HTR, the Hathor-native case, registered the way mainnet is: a side token for the pseudo
  //    address uidToAddress("00") on origin chain 31, and that address mapped back to "00". HTR is
  //    held by the multisig rather than minted, so this exercises the transfer proposals that the
  //    tUSDC mint/melt round trip never reaches.
  const htrAddress = await bridge.methods.uidToAddress(HTR_UID).call();
  let htrSideToken = await bridge.methods.sideTokenByOriginalTokenByChain(HATHOR_CHAIN_ID, htrAddress).call();
  if (htrSideToken === ZERO_ADDRESS) {
    await viaMultiSig(
      'createSideToken(tHTR)',
      bridge.options.address,
      bridge.methods.createSideToken(HTR_TYPE_ID, htrAddress, 18, 'tHTR', 'Testnet Hathor Token', HATHOR_CHAIN_ID),
    );
    htrSideToken = await bridge.methods.sideTokenByOriginalTokenByChain(HATHOR_CHAIN_ID, htrAddress).call();
  } else {
    console.log(`tHTR side token already exists at ${htrSideToken}`);
  }
  const htrOriginal = await bridge.methods.HathorToEvmTokenMap(HTR_UID).call();
  if (htrOriginal.tokenAddress.toLowerCase() === htrAddress.toLowerCase()) {
    console.log(`"${HTR_UID}" already maps to ${htrAddress}`);
  } else {
    await viaMultiSig(
      `addHathorToken(${HTR_UID})`,
      bridge.options.address,
      bridge.methods.addHathorToken(HATHOR_CHAIN_ID, htrAddress, HTR_UID),
    );
  }

  console.log('\nState:');
  console.log('  tHTR         ', htrSideToken, `(side token of ${htrAddress})`);
  console.log('  members      ', await federation.methods.getMembers().call());
  console.log('  required     ', await federation.methods.required().call());
  console.log('  tUSDC        ', testToken.address);
  console.log('  tUSDC -> uid ', await bridge.methods.EvmToHathorTokenMap(testToken.address).call());
  console.log('  Bridge       ', bridge.options.address);
  console.log('  Federation   ', federation.options.address);
  console.log('  AllowTokens  ', allowTokens.options.address);
  console.log('  MultiSig     ', MultiSigWallet.address);
  console.log('  Bridge block ', (await deployments.get('BridgeProxy')).receipt?.blockNumber);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
