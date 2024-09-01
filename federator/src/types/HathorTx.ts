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

  haveCustomData(): boolean {
    return this.outputs.some((utxo) => utxo.haveCustomData);
  }

  getCustomData(): string {
    let customData = '';
    const dataOutputs = this.outputs.filter((output) => output.haveCustomData);
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
