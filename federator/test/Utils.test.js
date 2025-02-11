const fs = require('fs');
const path = require('path');
const { convertToEvmDecimals } = require("../src/lib/utils");
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

  it("Should convert numbers", async () => {

    const result = convertToEvmDecimals(1000000, 18).toString();

    const comparison = new BN("10000000000000000000000").toString();

    expect(result.toString()).toEqual(comparison);
  });


  it("Should convert numbers", async () => {

    const result = convertToEvmDecimals(1000000, 18).toString();

    const comparison = new BN("10000000000000000000000").toString();

    expect(result.toString()).toEqual(comparison);
  });

    it("Should convert big numbers", async () => {

    const result = convertToEvmDecimals(200000000000, 18).toString();

    const comparison = new BN("2000000000000000000000000000").toString();

    expect(result.toString()).toEqual(comparison);
  });

    it("Should convert big numbers", async () => {

    const result = convertToEvmDecimals(3, 18).toString();

    const comparison = new BN("30000000000000000").toString();

    expect(result.toString()).toEqual(comparison);
  });

    it("Should convert big numbers", async () => {

    const result = convertToEvmDecimals(100000000000, 18).toString();

    const comparison = new BN("1000000000000000000000000000").toString();

    expect(result.toString()).toEqual(comparison);
  });
  
    it("Should convert big numbers", async () => {

    const result = convertToEvmDecimals(2500000000000, 18).toString();

    const comparison = new BN("25000000000000000000000000000").toString();

    expect(result.toString()).toEqual(comparison);
  });

    it("Should convert big numbers", async () => {

    const result = convertToEvmDecimals(153, 18).toString();

    const comparison = new BN("1530000000000000000").toString();

    expect(result.toString()).toEqual(comparison);
  });

});
