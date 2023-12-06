import * as script from '../utils/scripts';

export class HathorUtxo {
  script: string;

  customData?: CustomUtxoData;
  haveCustomData: boolean;

  constructor(script: string) {
    this.script = script;
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

  constructor(index: number, length: number, data: string, dataType: string) {
    this.dataType = dataType;
    this.index = index;
    this.length = length;
    this.data = data;
  }
}

export default HathorUtxo;
