import * as script from '../utils/scripts';

export class Utxo {
  value: number;
  token_data: number;
  script: string;
  decoded: decodedUtxo;
  token: string;
  spent_by?: any;

  customData?: CustomUtxoData;
  haveCustomData: boolean;

  constructor(value: number, token_data: number, script: string, decoded: decodedUtxo, token: string, spent_by?: any) {
    this.value = value;
    this.token_data = token_data;
    this.script = script;
    this.decoded = decoded;
    this.token = token;
    this.spent_by = spent_by;
    this.haveCustomData = false;

    this.decodeScript();
  }

  private decodeScript() {
    const buffer = Buffer.from(this.script, 'base64');
    try {
      const decodedData = script.parseScriptData(buffer).data;
      this.customData = new CustomUtxoData(
        parseInt(decodedData.substring(3, 4)),
        parseInt(decodedData.substring(4, 5)),
        decodedData.substring(5),
        decodedData.substring(0, 3),
      );
      this.haveCustomData = true;
    } catch (error) {
      // If false, we don't have custom data. If true, an unexpected error ocurred, so we log it
      if (error.indexOf('Invalid output script.') == -1) {
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

  constructor(index: number, length: number, data: string, dataType: string) {
    this.dataType = dataType;
    this.index = index;
    this.length = length;
    this.data = data;
  }
}

type decodedUtxo = {
  type: string;
  address: string;
  timelock?: any;
};

export default Utxo;
