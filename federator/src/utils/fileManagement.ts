import * as fs from 'fs';
import { ConfigData } from '../lib/config';
export class FileManagement {
  private config: ConfigData;
  constructor(config: ConfigData) {
    this.config = config;
  }

  getLastTimestampFromEnv(): number {
    let fromTimestamp: number;
    const originalFromTimestamp = Number.parseInt(process.env.HATHOR_LAST_TIMESTAMP) || Date.now();
    try {
      fromTimestamp = parseInt(fs.readFileSync(this.getLastTimestamp(), 'utf8'));
    } catch (err) {
      fromTimestamp = originalFromTimestamp;
    }
    if (fromTimestamp < originalFromTimestamp) {
      fromTimestamp = originalFromTimestamp;
    }
    return fromTimestamp;
  }

  getLastTimestamp(): string {
    return `${this.config.storagePath}/lastHathorTimestamp.txt`;
  }

  _saveProgress(value) {
    if (value) {
      fs.writeFileSync(`${this.config.storagePath}/lastHathorTimestamp.txt`, value.toString());
    }
  }
}
