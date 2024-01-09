const hathorTx = require("../src/types/HathorTx");
const hathorUtxo = require("../src/types/HathorUtxo");
const HathorWallet = require("../src/lib/HathorWallet");

const logger = {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};
const config = {
  sidechain: []
}

describe("Hathor Tx Data tests", () => {
  beforeEach(async function () {
    jest.clearAllMocks();
    config.sidechain.push({});
  });

  it("Should check if can read translate partial outputs", () => {
    const encodedData =
      "TFNoZXgyMzE0ODUyMGQzNmFiZTRmYWM2YmEzYjE4NWI4ZWRkYmU1OTVlYWFmMzNiNzg3NDAzMGJhMjQzNjVjOWZmZjY1NTUzMGQ4MDAwMDAwMDAwMKw";
    let utxo = new hathorUtxo.default(encodedData);
    const translatedData = utxo.customData;
    const decodedData = {
      dataType: "hex",
      index: 2,
      length: 3,
      data: "148520d36abe4fac6ba3b185b8eddbe595eaaf33b7874030ba24365c9fff655530d80000000000",
    };

    expect(translatedData).toEqual(decodedData);
  });

  it("Should check if can find a txHex in a tx", async () => {
    const jsonTx = require("./resources/tx-example.json");
    const utxos = jsonTx.data.outputs.map(
      (o) => new hathorUtxo.default(o.script)
    );
    let tx = new hathorTx.default(
      jsonTx.data.tx_id,
      jsonTx.data.timestamp,
      utxos
    );
    const hasTx = tx.haveCustomData("hex");
    expect(hasTx).toEqual(true);
  });

  it("Should not find a txHex in a tx", async () => {
    const jsonTx = require('./resources/tx-without-hex-example.json');
    const utxos = jsonTx.data.outputs.map(
      (o) => new hathorUtxo.default(o.script)
    );
    let tx = new hathorTx.default(
      jsonTx.data.tx_id,
      jsonTx.data.timestamp,
      utxos
    );
    const hasTx = tx.haveCustomData("hex");
    expect(hasTx).toEqual(false);
  });

  it("Should return a complete txHex", async () => {
    const hex =
      "0001010202000001f8107c19b57397acb4d44d66208015b6c0eb6cbc3c46651c6fc1e43cdd00000448b416622900b24325fa9279ffcadb2805a013eae700ad488ad7cfaa6c00000000000f481f2421a04d5021d31cb5834a267766929d0b557e300dd43f85b5cc2b02000000000001010017a9148895e0b178ffd7e2ddf4d5346d2d3c83b506bf9d8700000001810017a9148520d36abe4fac6ba3b185b8eddbe595eaaf33b7874030ba24365c9fff655530d80000000000";

    const jsonTx = require('./resources/tx-example.json');
    const utxos = jsonTx.data.outputs.map(
      (o) => new hathorUtxo.default(o.script)
    );
    let tx = new hathorTx.default(
      jsonTx.data.tx_id,
      jsonTx.data.timestamp,
      utxos
    );
    expect(tx.getCustomData('hex')).toEqual(hex);
  });

  it("Should correctly convert evm token decimals to hathor", async () => {
      let wallet = new HathorWallet.default(config, logger, {});
      let originWithDecimals = "200000000000000"; 
      expect(wallet.convertDecimals(originWithDecimals, 18)).toEqual(0);

      originWithDecimals = "80000000000000000"; 
      expect(wallet.convertDecimals(originWithDecimals, 18)).toEqual(8);

      originWithDecimals = "3025000000000000000"; 
      expect(wallet.convertDecimals(originWithDecimals, 18)).toEqual(302);
  });

  // it("Should validate if a Hathor TxHex has the correct parameters for it's EVM TxHash", async () => {
  //   const hathorWallet = new hathorWallet.default()
  // });
});
