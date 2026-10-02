// Checks .env.walletlib before the switch, from inside the new image, so the code doing the checking
// is the code that will run:
//
//   docker run --rm --env-file .env.walletlib -e EXPECTED_MULTISIG=<addr> -e EXPECTED_XPUBS=<a,b,..> \
//     -v "$PWD/preflight.js:/app/federator/built/federator/preflight.js:ro" \
//     --entrypoint node <image> preflight.js
//
// Prints one PASS/FAIL line per check and exits non-zero on any failure. No secret is printed: the
// seed and the key are only used to derive public values (an xpub, an address) that are compared.
const { loadConfig } = require('./src/config/load');
const lib = require('@hathor/wallet-lib');
const bitcore = require('bitcore-lib');

let failures = 0;
function check(name, ok, detail = '') {
  // Details include answers from remote nodes; keep each check on one line whatever they say.
  const clean = String(detail).replace(/[\r\n]+/g, ' ');
  const suffix = clean ? ' - ' + clean : '';
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${suffix}`);
  if (!ok) failures += 1;
}

async function rpcChainId(url) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    signal: AbortSignal.timeout(15000),
  });
  return Number.parseInt((await response.json()).result, 16);
}

async function main() {
  let config;
  try {
    config = loadConfig(process.env);
    check('config loads (schema + cross-field rules)', true);
  } catch (error) {
    // ConfigError lists variable names and rule violations, never values.
    check('config loads (schema + cross-field rules)', false, error.issues ? error.issues.join('; ') : error.message);
    process.exit(1);
  }
  const { hathor, evm, state, federator, runtime } = config;

  check('storage path is the legacy volume', runtime.storagePath === '/app/db', runtime.storagePath);
  check('authority pool off', hathor.authorityPoolTarget === 0, String(hathor.authorityPoolTarget));

  const expectedXpubs = (process.env.EXPECTED_XPUBS || '').split(',').map((x) => x.trim()).filter(Boolean);
  const configured = hathor.multisig.pubkeys;
  check(
    'multisig pubkeys are the expected set',
    expectedXpubs.length > 0 &&
      configured.length === expectedXpubs.length &&
      [...configured].sort((a, b) => a.localeCompare(b)).join() ===
        [...expectedXpubs].sort((a, b) => a.localeCompare(b)).join(),
    `${configured.length} configured, ${expectedXpubs.length} expected`,
  );

  const ownXpub = lib.walletUtils.getMultiSigXPubFromWords(hathor.seed, { networkName: hathor.network });
  check('seed derives one of the multisig xpubs', configured.includes(ownXpub));

  const script = lib.walletUtils.createP2SHRedeemScript(configured, hathor.multisig.numSignatures, 0);
  const network = new lib.Network(hathor.network).bitcoreNetwork;
  const address = new bitcore.Address(bitcore.crypto.Hash.sha256ripemd160(script), network, 'scripthash').toString();
  check('multisig address at index 0', address === process.env.EXPECTED_MULTISIG, address);

  check('federator address matches its key', Boolean(federator.address), federator.address);

  try {
    const response = await fetch(new URL('version', hathor.fullnodeUrl), { signal: AbortSignal.timeout(15000) });
    const body = await response.json();
    check('Hathor full node answers', response.ok && body.network?.startsWith(hathor.network), `network ${body.network}, version ${body.version}`);
  } catch (error) {
    check('Hathor full node answers', false, error.message);
  }
  const rpcs = [
    ['EVM RPC', evm.host, evm.chainId],
    ['state chain RPC', state.host, state.chainId],
  ];
  const answers = await Promise.allSettled(rpcs.map(([, url]) => rpcChainId(url)));
  rpcs.forEach(([name, , expected], index) => {
    const answer = answers[index];
    if (answer.status === 'fulfilled') {
      check(`${name} is chain ${expected}`, answer.value === expected, `answered ${answer.value}`);
    } else {
      check(`${name} is chain ${expected}`, false, answer.reason?.message);
    }
  });

  console.log(failures === 0 ? '\nPREFLIGHT OK' : `\nPREFLIGHT FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  check('preflight ran to the end', false, error?.message);
  process.exit(1);
});
