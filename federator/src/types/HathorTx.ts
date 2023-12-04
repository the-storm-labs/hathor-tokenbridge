import { Utxo } from './HathorUtxo';

export class HathorTx {
  tx_id: string;
  version: number;
  weight: number;
  timestamp: Date;
  is_voided: boolean;
  inputs: input[];
  outputs: Utxo[];
  parents: string[];

  constructor(
    id: string,
    version: number,
    weight: number,
    timestamp: Date,
    is_voided: boolean,
    inputs: input[],
    outputs: Utxo[],
    parents: string[],
  ) {
    this.tx_id = id;
    this.version = version;
    this.weight = weight;
    this.timestamp = timestamp;
    this.is_voided = is_voided;
    this.inputs = inputs;
    this.outputs = outputs;
    this.parents = parents;
  }

  haveCustomData(dataType: string = null): boolean {
    if (dataType != null)
      return this.outputs.some((utxo) => utxo.haveCustomData && utxo.customData?.dataType === dataType);

    return this.outputs.some((utxo) => utxo.haveCustomData);
  }

  getCustomData(): string {
    let customData = '';
    const dataOutputs = this.outputs
      .filter((output) => output.haveCustomData)
      .sort((a, b) => a.customData.index - b.customData.index);
    dataOutputs.forEach((output) => {
      customData += output.customData.data;
    });
    return customData;
  }
}

export class data extends HathorTx {
  address: string;
  history: HathorTx;
  type: string; //can be a enum?
}

export type input = Utxo & {
  tx_id: string;
  index: number;
};

export default HathorTx;
