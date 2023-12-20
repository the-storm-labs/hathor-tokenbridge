const dotenv = require('dotenv');

dotenv.config();

module.exports = {
  mainchain: require("./sepolia.json"), //the json containing the smart contract addresses in rsk
  sidechain: [
    require(process.env.HTR_CONFIG), //the json containing the smart contract addresses in eth
  ],
  runEvery: 1, // In minutes,
  privateKey: process.env.FEDERATOR_KEY,
  storagePath: "./db",
  etherscanApiKey: process.env.ETHERSCAN_KEY,
  runHeartbeatEvery: 1, // In hours
  endpointsPort: 5000, // Server port
  checkHttps: false,
};
