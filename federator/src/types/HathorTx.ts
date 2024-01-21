import { HathorUtxo } from './HathorUtxo';

export class HathorTx {
  tx_id: string;
  timestamp: string;
  inputs: HathorUtxo[];
  outputs: HathorUtxo[];
  parents: string[];

  constructor(id: string, timestamp: string, outputs: HathorUtxo[], inputs?: HathorUtxo[]) {
    this.tx_id = id;
    this.timestamp = timestamp;
    this.outputs = outputs;
    this.inputs = inputs;
  }

  getCustomDataType(): string {
    if (this.haveCustomData('hsh')) return 'hsh';
    if (this.haveCustomData('hid')) return 'hid';
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

  getCustomTokenData(): any[] {
    const tokenData = this.outputs
      // there is probably a better way to do that filter
      .filter((output) => output.token !== '00' && output.decoded.type === 'MultiSig');

    const customData = [];

    tokenData.forEach((data) => {
      /* It is possible to have multiple inputs with multiple addresses. This could be a issue? 
          At first I think not, buuut....
      */
      const input = this.inputs.find((inpt) => inpt.token == data.token);
      customData.push({
        sender: input.decoded.address,
        value: data.value,
        token: data.token,
      });
    });

    return customData;
  }
}

export default HathorTx;
