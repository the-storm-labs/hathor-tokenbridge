// Hathor-side bootstrap for the 2-of-3 testnet: creates hUSDC with its mint and melt authorities
// held by the multisig, and funds the multisig with HTR for the 1% mint deposit.
//
// It borrows federator #1's seed as an ordinary single-sig wallet (BIP44 path, not the multisig's
// BIP45 one), so there is no extra wallet to keep track of. Run from this directory:
//
//   NODE_PATH=../../federator/node_modules node hathor-bootstrap.js address   # where to send faucet HTR
//   NODE_PATH=../../federator/node_modules node hathor-bootstrap.js run       # create token + fund
//   NODE_PATH=../../federator/node_modules node hathor-bootstrap.js return <hundredths> <0xEvmAddr>
//
// `return` is the Hathor->EVM leg of the test: it sends hUSDC from this wallet back to the multisig
// with the EVM destination in a data output, the shape bridgePayload.ts reads.
//
// `run` is safe to repeat: set HUSDC_UID to skip creating the token again.
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Connection, HathorWallet, SendTransaction, config: libConfig } = require('@hathor/wallet-lib');
const { stopGLLBackgroundTask } = require('@hathor/wallet-lib/lib/sync/gll');

const NETWORK = 'testnet';
const FULLNODE = 'https://node1.testnet.hathor.network/v1a/';
const TX_MINING = 'https://txmining.testnet.hathor.network/';
// The smallest possible initial supply. It is the only hUSDC not backed by locked tUSDC, and it
// stays in this single-sig wallet: the bridge never sees it.
const INITIAL_SUPPLY = 1n;
// 100 HTR: the 1% mint deposit covers minting 10000 hUSDC, far more than the test moves.
const HTR_TO_MULTISIG = 10000n;

const identity = dotenv.parse(fs.readFileSync(path.join(__dirname, 'fed1.identity.env')));
const multisig = JSON.parse(fs.readFileSync(path.join(__dirname, 'public.json'), 'utf8')).multisigAddressIndex0;

async function startWallet() {
  libConfig.setServerUrl(FULLNODE);
  libConfig.setTxMiningUrl(TX_MINING);
  libConfig.setNetwork(NETWORK);
  const wallet = new HathorWallet({
    connection: new Connection({ network: NETWORK, servers: [FULLNODE] }),
    seed: identity.HATHOR_SEED,
    password: 'bootstrap',
    pinCode: 'bootstrap',
  });
  await wallet.start();
  for (let i = 0; !wallet.isReady(); i++) {
    if (i > 240) throw new Error('wallet did not become ready in 2 minutes');
    await new Promise((r) => setTimeout(r, 500));
  }
  return wallet;
}

async function htrBalance(wallet) {
  const [htr] = await wallet.getBalance('00');
  return htr?.balance.unlocked ?? 0n;
}

async function main(mode) {
  const wallet = await startWallet();
  try {
    const address = await wallet.getAddressAtIndex(0);
    const balance = await htrBalance(wallet);
    console.log(`single-sig address: ${address}`);
    console.log(`HTR balance:        ${balance} (hundredths)`);
    console.log(`multisig address:   ${multisig}`);
    if (mode === 'address') return;
    if (mode === 'return') return returnToEvm(wallet);

    let uid = process.env.HUSDC_UID;
    if (uid) {
      console.log(`HUSDC_UID set, not creating a token: ${uid}`);
    } else {
      const needed = HTR_TO_MULTISIG + 1n; // + the deposit on the initial supply
      if (balance < needed) {
        throw new Error(`need at least ${needed} hundredths of HTR at ${address}, have ${balance}`);
      }
      const tx = await wallet.createNewToken('Hathor Test USDC', 'hUSDC', INITIAL_SUPPLY, {
        pinCode: 'bootstrap',
        createMint: true,
        mintAuthorityAddress: multisig,
        allowExternalMintAuthorityAddress: true,
        createMelt: true,
        meltAuthorityAddress: multisig,
        allowExternalMeltAuthorityAddress: true,
      });
      uid = tx.hash;
      console.log(`hUSDC created, uid: ${uid}`);
      // The creation spent the whole HTR UTXO; its change only becomes spendable once the wallet
      // has seen its own transaction come back over the websocket. Sending before that fails with
      // "Insufficient amount of tokens".
      for (let i = 0; (await htrBalance(wallet)) < HTR_TO_MULTISIG; i++) {
        if (i > 120) throw new Error('the token creation change never became spendable');
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    const funding = await wallet.sendTransaction(multisig, HTR_TO_MULTISIG, { pinCode: 'bootstrap' });
    console.log(`sent ${HTR_TO_MULTISIG} hundredths of HTR to the multisig: ${funding.hash}`);
    console.log(`\nNext: HATHOR_TOKEN_UID=${uid} npx hardhat run ./hardhat/script/setupTestnetMulti.js --network sepolia_arbitrum_multi`);
  } finally {
    await wallet.stop({ cleanStorage: true }).catch(() => {});
    stopGLLBackgroundTask?.();
  }
}

async function returnToEvm(wallet) {
  const [amount, evmAddress] = process.argv.slice(3);
  const uid = process.env.HUSDC_UID;
  if (!uid || !/^\d+$/.test(amount ?? '') || !/^0x[0-9a-fA-F]{40}$/.test(evmAddress ?? '')) {
    throw new Error('usage: HUSDC_UID=<uid> node hathor-bootstrap.js return <hundredths> <0xEvmAddress>');
  }
  const send = new SendTransaction({
    wallet,
    pin: 'bootstrap',
    outputs: [
      { address: multisig, value: BigInt(amount), token: uid },
      { type: 'data', data: Buffer.from(evmAddress) },
    ],
  });
  // Trap in wallet-lib 4.1: SendTransaction stores a data output's bytes as HEX in its tx data,
  // but createOutputScript hands that field to ScriptData as a plain string - so the script ends
  // up carrying the hex text ("3078c4...") instead of "0xc4...", and the federator, which reads the
  // data as a UTF-8 EVM address, silently ignores the transaction. Undo the hex before building.
  const txData = await send.prepareTxData();
  for (const output of txData.outputs) {
    if (output.type === 'data') output.data = Buffer.from(output.data, 'hex').toString();
  }
  const tx = await send.run();
  console.log(`sent ${amount} hundredths of hUSDC to the multisig for ${evmAddress}: ${tx.hash}`);
}

const mode = process.argv[2];
if (!['address', 'run', 'return'].includes(mode)) {
  console.error('usage: node hathor-bootstrap.js address|run|return');
  process.exit(2);
}
main(mode).then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
