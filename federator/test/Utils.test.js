const fs = require('fs');
const path = require('path');
const { convertToEvmDecimals, convertToHathorDecimals, parseSignatureEntry, selectCompleteSignatures } = require("../src/lib/utils");
const web3Mock = require("./web3Mock");
const { BN } = require('ethereumjs-util');

const configFile = fs.readFileSync(path.join(__dirname, "config.js"), "utf8");
const config = JSON.parse(configFile);

const logger = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: console.log,
  warn: jest.fn(),
  error: console.log,
};

describe("Hathor Broker module tests", () => {
  beforeEach(async function () {
    jest.clearAllMocks();
  });

  it("Should convert numbers from Hathor to EVM", async () => {

    const result = convertToEvmDecimals(1000000).toString();
    const comparison = BigInt("10000000000000000000000").toString();
    expect(result.toString()).toEqual(comparison);

    const result2 = convertToEvmDecimals(1000000).toString();
    const comparison2 = new BN("10000000000000000000000").toString();
    expect(result2.toString()).toEqual(comparison2);

    const result3 = convertToEvmDecimals(200000000000).toString();
    const comparison3 = new BN("2000000000000000000000000000").toString();
    expect(result3.toString()).toEqual(comparison3);

    const result4 = convertToEvmDecimals(3).toString();
    const comparison4 = new BN("30000000000000000").toString();
    expect(result4.toString()).toEqual(comparison4);

    const result5 = convertToEvmDecimals(100000000000).toString();
    const comparison5 = new BN("1000000000000000000000000000").toString();
    expect(result5.toString()).toEqual(comparison5);

    const result6 = convertToEvmDecimals(2500000000000).toString();
    const comparison6 = new BN("25000000000000000000000000000").toString();
    expect(result6.toString()).toEqual(comparison6);

    const result7 = convertToEvmDecimals(153).toString();
    const comparison7 = new BN("1530000000000000000").toString();
    expect(result7.toString()).toEqual(comparison7);


    const result8 = convertToEvmDecimals(199999999999).toString();
    const comparison8 = new BN("1999999999990000000000000000").toString();
    expect(result8.toString()).toEqual(comparison8);

  });

  it("Should convert number from EVM to Hathor", async () => {
    const result = convertToHathorDecimals(BigInt(18990000), 6);
    expect(result).toEqual(1899);

    const result2 = convertToHathorDecimals(BigInt(999999), 6);
    expect(result2).toEqual(99);

    expect(() => { convertToHathorDecimals(BigInt(9999), 18) }).toThrow(
      "Unable to convert amount to Hathor amount. 9999 is invalid."
    );

    const result5 = convertToHathorDecimals(BigInt("999999999999999999"), 18);
    expect(result5).toEqual(99);

    const result6 = convertToHathorDecimals(BigInt("1048932999999999999999999"), 18);
    expect(result6).toEqual(104893299);
  });

});

describe("P2SH signature coverage tests", () => {
  // Real entries captured from the production incident: signer index 3 only signed input 1,
  // missing input 0 ("Signatures are incompatible with redeemScript" when pushed).
  const COMPLETE_SIGNER_0 = "031e98e64228360dd2616ee5a9e1831ab07638db40383eb7352607caa20f196a84|0:3045022100895|1:3044022019";
  const COMPLETE_SIGNER_1 = "03720eb3c4cdee9a37a48779a79f5694e443794a30c091109e8aead473151721b6|0:3044022049|1:3044022017";
  const COMPLETE_SIGNER_2 = "03152eeafce44cc327aa688efb43d5f9dee05afe449a970e9588cc7f19c064c36e|0:3045022100879|1:3044022062";
  const PARTIAL_SIGNER_3 = "027488f1c32779648a556541044ff6a44a4d6eb6c58df57a2037a44c3394253113|1:3045022100e89";
  const COMPLETE_SIGNER_4 = "037906a7c2efddc5ca9862210b5d225f819fc0a34856a18a326a36aeee6468ea4c|0:3045022100f43|1:3044022029";

  it("Should parse a complete signature entry (covers every input)", () => {
    const { pubkey, indices } = parseSignatureEntry(COMPLETE_SIGNER_0);
    expect(pubkey).toEqual("031e98e64228360dd2616ee5a9e1831ab07638db40383eb7352607caa20f196a84");
    expect(indices).toEqual([0, 1]);
  });

  it("Should parse a partial signature entry (missing an input)", () => {
    const { pubkey, indices } = parseSignatureEntry(PARTIAL_SIGNER_3);
    expect(pubkey).toEqual("027488f1c32779648a556541044ff6a44a4d6eb6c58df57a2037a44c3394253113");
    expect(indices).toEqual([1]);
  });

  it("Should filter out partial signatures, matching the incident's on-chain order", () => {
    const signatures = [COMPLETE_SIGNER_0, COMPLETE_SIGNER_1, COMPLETE_SIGNER_2, PARTIAL_SIGNER_3, COMPLETE_SIGNER_4];

    const complete = selectCompleteSignatures(signatures, 2);

    expect(complete).toEqual([COMPLETE_SIGNER_0, COMPLETE_SIGNER_1, COMPLETE_SIGNER_2, COMPLETE_SIGNER_4]);
    // Reproduces the fix: naive slice(0, 4) on the raw array picks the broken 4th entry;
    // slice(0, 4) on the filtered array instead picks the 4 signers that can actually complete
    // the redeem script.
    expect(complete.slice(0, 4)).not.toContain(PARTIAL_SIGNER_3);
  });

  it("Should report not-enough-complete-signatures when too many are partial", () => {
    const signatures = [COMPLETE_SIGNER_0, PARTIAL_SIGNER_3];

    const complete = selectCompleteSignatures(signatures, 2);

    expect(complete).toEqual([COMPLETE_SIGNER_0]);
  });
});
