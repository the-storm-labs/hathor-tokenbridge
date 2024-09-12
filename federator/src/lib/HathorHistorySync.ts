import { Data } from '../types';
import HathorService from './HathorService';
import { HathorWallet } from './HathorWallet';
import { ConfigData } from './config';
import { LogWrapper } from './logWrapper';
import { FileManagement } from '../utils/fileManagement';

export class HathorHistorySinc {
  private wallet: HathorWallet;
  private service: HathorService;
  private fileManagement: FileManagement;

  constructor(config: ConfigData, logger: LogWrapper, service: HathorService) {
    this.wallet = HathorWallet.getInstance(config, logger);
    this.service = service;
    this.fileManagement = new FileManagement(config);
  }

  async processHistory() {
    const history = await this.getHistory();
    const recentHistory = history.filter((h) => h.timestamp >= this.fileManagement.getLastTimestampFromEnv());
    const orderedHistory = recentHistory.sort((a, b) => a.timestamp - b.timestamp);
    const hathorTxs = orderedHistory.map((data) => this.service.castDataToTx(data));
    const dataTxs = hathorTxs.filter((tx) => tx.haveCustomData());
    for (const tx of dataTxs) {
      await this.service.sendTokensToEvm(tx);
    }
  }

  private async getHistory(): Promise<Data[]> {
    try {
      const response = await this.wallet.requestWallet<Data[]>(false, 'multi', 'wallet/tx-history');
      if (response.status == 200) {
        return response.data;
      }

      throw Error(`${response.status} - ${response.data}`);
    } catch (error) {
      throw Error(`Fail to getHistory: ${error}`);
    }
  }
}
