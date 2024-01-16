import * as script from '../utils/scripts';
import web3 from 'web3';

export class HathorUtxo {
  script: string;
  token: string;
  value: number;
  decoded: decodeInput;

  customData?: CustomUtxoData;
  haveCustomData: boolean;

  constructor(script: string, token?: string, value?: number, decoded?: decodeInput) {
    this.script = script;
    this.token = token;
    this.value = value;
    this.decoded = decoded;
    this.haveCustomData = false;

    this.decodeScript();
  }

  private decodeScript() {
    const buffer = Buffer.from(this.script, 'base64');
    try {
      const decodedData = script.parseScriptData(buffer).data;
      this.customData = new CustomUtxoData(decodedData);
      this.haveCustomData = true;
    } catch (error) {
      // If false, we don't have custom data. If true, an unexpected error ocurred, so we log it
      if (error.toString().indexOf('Invalid output script.') == -1) {
        console.log(error);
      }
      // Nothing else to do here, let's leave
      return;
    }
  }
}

class CustomUtxoData {
  index: number;
  length: number;
  data: string;
  dataType: string;

  constructor(decodedData: string) {
    if (web3.utils.isAddress(decodedData)) {
      this.dataType = 'addr';
      this.data = decodedData;
      return;
    }

    this.dataType = decodedData.substring(0, 3);
    this.index = parseInt(decodedData.substring(3, 4));
    this.length = parseInt(decodedData.substring(4, 5));
    this.data = decodedData.substring(5);
  }
}

interface decodeInput {
  type: string;
  address: string;
  timelock: any;
}

export default HathorUtxo;
