import { Config } from './lib/config';
import Scheduler from './services/Scheduler';
import Federator from './lib/FederatorHTR';
import { Endpoint } from './lib/Endpoints';
import { ConfigChain } from './lib/configChain';
import { LogWrapper } from './lib/logWrapper';
import {
  Logs,
  LOGGER_CATEGORY_FEDERATOR,
  LOGGER_CATEGORY_FEDERATOR_MAIN,
  LOGGER_CATEGORY_FEDERATOR_SIDE,
  LOGGER_CATEGORY_ENDPOINT,
} from './lib/logs';
import HathorService from './lib/HathorService';
import { BridgeFactory } from './contracts/BridgeFactory';
import { FederationFactory } from './contracts/FederationFactory';
import { HathorWallet } from './lib/HathorWallet';
import TransactionSender from './lib/TransactionSender';
import HathorMultisigManager from './lib/HathorMultisigManager';
import FederatorHTR from './lib/FederatorHTR';
import Web3 from 'web3';
import { HathorHistorySinc } from './lib/HathorHistorySync';
import { Registry } from 'prom-client';
import MetricRegister from './utils/MetricRegister';

export class Main {
  logger: LogWrapper;
  endpoint: any;
  rskFederator: FederatorHTR;
  hathorFederation: HathorMultisigManager;
  config: Config;
  heartBeatScheduler: Scheduler;
  federatorScheduler: Scheduler;
  register: Registry;
  metricRegister: MetricRegister;

  constructor() {
    this.logger = Logs.getInstance().getLogger(LOGGER_CATEGORY_FEDERATOR);
    this.config = Config.getInstance();
    this.register = new Registry();
    this.register.setDefaultLabels({ app: `federator_${this.config.mainchain.multisigOrder}` });
    this.metricRegister = new MetricRegister(this.register);
    this.endpoint = new Endpoint(
      Logs.getInstance().getLogger(LOGGER_CATEGORY_ENDPOINT),
      this.config.endpointsPort,
      this.register,
    );
    this.endpoint.init();

    this.rskFederator = new Federator(
      this.config,
      Logs.getInstance().getLogger(LOGGER_CATEGORY_FEDERATOR_MAIN),
      this.metricRegister,
    );

    this.hathorFederation = new HathorMultisigManager(
      this.config,
      Logs.getInstance().getLogger(LOGGER_CATEGORY_FEDERATOR_SIDE),
      this.metricRegister,
    );
  }

  async start() {
    const wallet = HathorWallet.getInstance(this.config, this.logger);
    const [ready, walletEmmiter] = await wallet.areWalletsReady();

    if (ready) {
      this.logger.info('No need to wait, the wallets are ready, lets go.');
      this.listenToHathorTransactions();
      this.scheduleFederatorProcesses();
      this.scheduleHathorFederationProcess();
      return;
    }

    this.logger.info('It seems the wallets are not ready, lets wait for the event');
    walletEmmiter.on('wallets-ready', async () => {
      this.logger.info('Event emmited, we can start the wallet');
      this.listenToHathorTransactions();
      this.scheduleFederatorProcesses();
      this.scheduleHathorFederationProcess();
    });

    this.logger.info(`From main.ts, we have ${walletEmmiter.listenerCount('wallets-ready')} listeners`);

    // TODO uncoment this after tests
    // this.scheduleHeartbeatProcesses();
  }

  async runFederator() {
    try {
      // TODO uncoment this after tests
      // await this.heartbeat.readLogs();
      await this.runErcRskFederator();
    } catch (err) {
      this.logger.error('Unhandled Error on main.run()', err);
      process.exit(1);
    }
  }

  async runErcRskFederator() {
    this.logger.info('RSK Host', this.config.mainchain.host);
    await this.rskFederator.runAll();
  }

  async runErcOtherChainFederator(sideChainConfig: ConfigChain) {
    const sideFederator = new Federator(
      {
        ...this.config,
        mainchain: sideChainConfig,
        sidechain: [this.config.mainchain],
      },
      Logs.getInstance().getLogger(LOGGER_CATEGORY_FEDERATOR_SIDE),
      this.metricRegister,
    );

    this.logger.info('Side Host', sideChainConfig.host);
    await sideFederator.runAll();
  }

  async listenToHathorTransactions() {
    const client = new Web3(this.config.mainchain.host);
    const service = new HathorService(
      this.config,
      this.logger,
      new BridgeFactory(),
      new FederationFactory(),
      new TransactionSender(client, this.logger, this.config),
      this.metricRegister,
    );
    const sync = new HathorHistorySinc(this.config, this.logger, service);
    await sync.processHistory();
    service.listenToEventQueue();
  }

  async scheduleHathorFederationProcess() {
    const federatorPollingInterval = this.config.runEvery * 1000 * 60; // Minutes
    this.federatorScheduler = new Scheduler(federatorPollingInterval, this.logger, {
      run: async () => {
        try {
          await this.hathorFederation.runAll();
        } catch (err) {
          this.logger.error('Unhandled Error on runFederator()', err);
          process.exit(1);
        }
      },
    });

    this.federatorScheduler.start().catch((err) => {
      this.logger.error('Unhandled Error on federatorScheduler.start()', err);
    });
  }

  async scheduleFederatorProcesses() {
    const federatorPollingInterval = this.config.runEvery * 1000 * 60; // Minutes
    this.federatorScheduler = new Scheduler(federatorPollingInterval, this.logger, {
      run: async () => {
        try {
          await this.runFederator();
        } catch (err) {
          this.logger.error('Unhandled Error on runFederator()', err);
          process.exit(1);
        }
      },
    });

    this.federatorScheduler.start().catch((err) => {
      this.logger.error('Unhandled Error on federatorScheduler.start()', err);
    });
  }
}

const main = new Main();
main.start();

async function exitHandler() {
  process.exit(1);
}
// catches ctrl+c event
process.on('SIGINT', exitHandler);

// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', exitHandler);
process.on('SIGUSR2', exitHandler);
