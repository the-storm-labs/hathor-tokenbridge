const fs = require('fs');
const path = require('path');
const { convertToEvmDecimals, convertToHathorDecimals } = require("../src/lib/utils");
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
    const comparison = new BN("10000000000000000000000").toString();
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
    const result = convertToHathorDecimals("18999999", 6);
    expect(result).toEqual(1899);

    const result2 = convertToHathorDecimals("999999", 6);
    expect(result2).toEqual(99);

    const result3 = convertToHathorDecimals("9999", 6);
    expect(result3).toEqual(0);

    const result4 = convertToHathorDecimals("9999", 18);
    expect(result4).toEqual(0);

    const result5 = convertToHathorDecimals("999999999999999999", 18);
    expect(result5).toEqual(99);

    const result6 = convertToHathorDecimals("1048932999999999999999999", 18);
    expect(result6).toEqual(104893299);
  });

});
