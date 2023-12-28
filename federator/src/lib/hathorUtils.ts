import { Data } from "../types/hathorEvent";

export class HathorUtils {

    validateTx(hathorTx: Data, evmTx: any): boolean {
        console.log(hathorTx);
        const txOutput = hathorTx.outputs.find((o) => o.token === evmTx.);
        if (!(txOutput.decoded.address === evmTx.to)) {
            console.log(
                `txHex address ${txOutput.decoded.address} is not the same as txHash address ${evmTx.to}.`,
            );
            return false;
        }
        if (!(txOutput.value === parseInt(evmTx.value))) {
            console.log(
                `txHex value ${txOutput.value} is not the same as txHash value ${evmTx.value}.`,
            );
            return false;
        }

        return true;
    }
}

export default HathorUtils