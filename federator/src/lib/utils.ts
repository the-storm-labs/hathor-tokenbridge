import * as ethUtils from 'ethereumjs-util';
import Web3, { FMT_BYTES, FMT_NUMBER } from 'web3';
import { HathorException } from '../types';

/**
 * Retry system with async / await
 *
 * @param {Function} fn : export function to execute
 * @param {Array} args : arguments of fn function
 * @param {Object} config : arguments of fn function
 * @property {Number} config.retriesMax : number of retries, by default 3
 * @property {Number} config.interval : interval (in ms) between retry, by default 0
 * @property {Boolean} config.exponential : use exponential retry interval, by default true
 * @property {Number} config.factor: interval incrementation factor
 * @property {Number} config.isCb: is fn a callback style export function ?
 */
export async function retry(
  fn,
  args = [],
  config: any = {
    retriesMax: 3,
    interval: 0,
    exponential: true,
    factor: 2,
  },
) {
  const retriesMax = config.retriesMax;
  let interval = config.interval;
  const exponential = config.exponential;
  const factor = config.factor;

  for (let i = 0; i < retriesMax; i++) {
    try {
      if (!config.isCb) {
        return await fn(...args);
      }
    } catch (error) {
      checkRetriesMax(retriesMax, i, error);

      interval = exponential ? interval * factor : interval;
      // if interval is set to zero, do not use setTimeout, gain 1 event loop tick
      if (interval) {
        await new Promise((r) => setTimeout(r, interval));
      }
    }
  }
  return fn(...args);
}

function checkRetriesMax(retriesMax: number, i: number, error: any) {
  if (retriesMax === i + 1 || (Object.prototype.hasOwnProperty.call(error, 'retryable') && !error.retryable)) {
    throw error;
  }
}

export async function retry3Times(func, params = null) {
  return retry(func, params, { retriesMax: 3, interval: 1_000, exponential: false });
}

export async function waitBlocks(client, numberOfBlocks) {
  const startBlock = await client.eth.getBlockNumber();
  let currentBlock = startBlock;
  while (numberOfBlocks > currentBlock - startBlock) {
    const newBlock = await client.eth.getBlockNumber();
    if (newBlock !== currentBlock) {
      currentBlock = newBlock;
    } else {
      await sleep(20000);
    }
  }
}

export async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForReceipt(txHash, explorerUrl = '') {
  let timeElapsed = 0;
  const interval = 10000;
  return new Promise((resolve, reject) => {
    const checkInterval = setInterval(async () => {
      timeElapsed += interval;
      const web3 = new Web3();
      const receipt = await web3.eth.getTransactionReceipt(txHash);
      if (receipt != null) {
        clearInterval(checkInterval);
        resolve(receipt);
      }
      if (timeElapsed > 120_000) {
        reject(
          `Operation took too long <a target="_blank" href="${explorerUrl}/tx/${txHash}">check Tx on the explorer</a>`,
        );
      }
    }, interval);
  });
}

export function hexStringToBuffer(hexString) {
  return ethUtils.toBuffer(ethUtils.addHexPrefix(hexString));
}

export function stripHexPrefix(str) {
  return str.indexOf('0x') === 0 ? str.slice(2) : str;
}

export function privateToAddress(privateKey) {
  return ethUtils.bufferToHex(ethUtils.privateToAddress(this.hexStringToBuffer(privateKey)));
}

// Returns current memory allocated in MB
export function memoryUsage() {
  const { heapUsed } = process.memoryUsage();
  return Math.round(heapUsed / (1024 * 1024));
}

export function calculatePrefixesSuffixes(nodes) {
  const prefixes = [];
  const suffixes = [];
  const ns = [];

  for (let i = 0; i < nodes.length; i++) {
    nodes[i] = stripHexPrefix(nodes[i]);
  }

  for (let k = 0, l = nodes.length; k < l; k++) {
    if (k + 1 < l && nodes[k + 1].indexOf(nodes[k]) >= 0) {
      continue;
    }

    ns.push(nodes[k]);
  }

  let hash = Web3.utils.sha3(Buffer.from(ns[0], 'hex').toString());
  hash = stripHexPrefix(hash);

  prefixes.push('0x');
  suffixes.push('0x');

  for (let k = 1, l = ns.length; k < l; k++) {
    const p = ns[k].indexOf(hash);

    prefixes.push(ethUtils.addHexPrefix(ns[k].substring(0, p)));
    suffixes.push(ethUtils.addHexPrefix(ns[k].substring(p + hash.length)));

    hash = Web3.utils.sha3(Buffer.from(ns[k], 'hex').toString());
    hash = stripHexPrefix(hash);
  }
  return { prefixes: prefixes, suffixes: suffixes };
}

export function checkHttpsOrLocalhost(url = '') {
  if (process.env.BRIDGE_SKIP_HTTPS === 'true') {
    return true;
  }
  const isHttps = url.startsWith('https://');
  const isLocalhost = url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost');

  return isHttps || isLocalhost;
}

export function checkIfItsInRSK(chainId = -1) {
  return chainId === 0 || chainId === 5777 || chainId === 30 || chainId === 31 || chainId === 33;
}

export async function getHeartbeatPollingInterval({ host, runHeartbeatEvery = 1 }) {
  const web3 = new Web3(host);
  const chainId = await web3.eth.net.getId({
    number: FMT_NUMBER.NUMBER,
    bytes: FMT_BYTES.HEX,
  });
  return [30, 31].includes(chainId) ? 1000 * 60 * 60 : runHeartbeatEvery * 1000 * 60;
}

export async function asyncMine(anotherWeb3Instance = null) {
  let web3Instance = anotherWeb3Instance;
  if (!web3Instance) {
    web3Instance = new Web3();
  }
  return new Promise((resolve, reject) => {
    web3Instance.currentProvider.send(
      {
        jsonrpc: '2.0',
        method: 'evm_mine',
        id: new Date().getTime(),
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }
        return resolve(result);
      },
    );
  });
}

export async function evm_mine(iterations, web3Instance = null) {
  for (let i = 0; i < iterations; i++) {
    await asyncMine(web3Instance);
  }
}

export function increaseTimestamp(web3, increase) {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send(
      {
        method: 'evm_increaseTime',
        params: [increase],
        jsonrpc: '2.0',
        id: new Date().getTime(),
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }
        return asyncMine(web3).then(() => resolve(result));
      },
    );
  });
}
export const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function clone(instance: any): any {
  const copy = new (instance.constructor as { new (): any })();
  Object.assign(copy, instance);
  return copy;
}

export function convertToEvmDecimals(originalQtd: number): BigInt {
  try {
    const bnQtd = BigInt(originalQtd);
    const precision = BigInt(Math.pow(10, 16).toString());
    return bnQtd * precision;
  } catch (error) {
    console.log(error);
  }
}

export function convertToHathorDecimals(originalQtd: string, tokenDecimals: number): number {
  // Hathor Network tokens always have two decimals,
  // so here we get the number of decimals we need to discard
  const decimalDifference = BigInt(tokenDecimals) - BigInt(2);
  const originalQtdString = originalQtd.toString();
  // The original number minus the amount of decimals we need to discard
  const result = originalQtdString.substring(0, originalQtdString.length - Number(decimalDifference));
  // If the number is less than the two decimals, lets say 0,001
  // for a token with 6 digits we would have "100".
  // Then we would get the substring to -1 which would lead to a empty ('') result.
  // We throw a exception, as we can have 0 or invalid value sent to hathor.

  if (!result) {
    throw new HathorException(`Unable to convert amount to Hathor amount. ${originalQtd} is invalid.`);
  }

  const amount = parseInt(result);

  if (isNaN(amount) || amount === 0) {
    throw new HathorException(`Invalid amount. ${originalQtd} is NaN or 0.`);
  }

  return amount;
}
