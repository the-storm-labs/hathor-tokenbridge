import { HathorUtxo } from './HathorUtxo';

export class HathorTx {
  tx_id: string;
  timestamp: number;
  outputs: HathorUtxo[];
  parents: string[];

  constructor(id: string, timestamp: number, outputs: HathorUtxo[]) {
    this.tx_id = id;
    this.timestamp = timestamp;
    this.outputs = outputs;
  }

  haveCustomData(dataType: string = null): boolean {
    if (dataType != null)
      return this.outputs.some((utxo) => utxo.haveCustomData && utxo.customData?.dataType === dataType);

    return this.outputs.some((utxo) => utxo.haveCustomData);
  }

  getCustomData(dataType: string): string {
    let customData = '';
    const dataOutputs = this.outputs
      .filter((output) => output.haveCustomData && output.customData.dataType === dataType)
      .sort((a, b) => a.customData.index - b.customData.index);
    dataOutputs.forEach((output) => {
      customData += output.customData.data;
    });
    return customData;
  }
}

export default HathorTx;
