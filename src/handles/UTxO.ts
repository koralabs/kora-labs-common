export class UTxO {
    id: string;
    tx_id: string;
    index: number;
    slot: number;
    address: string;
    lovelace: number;
    datum?: string;
    script?: {
        type: string;
        cbor: string;
    };

    constructor(utxo: UTxOWithTxInfo) {
        this.id = utxo.id;
        this.tx_id = utxo.tx_id;
        this.index = utxo.index;
        this.slot = utxo.slot;
        this.address = utxo.address;
        this.lovelace = utxo.lovelace;
        this.datum = utxo.datum;
        this.script = utxo.script;
    }
}

export interface UTxOWithTxInfo extends UTxO {
    handles: [string, string[]][];
    mint: [string, string[]][];
    metadata: any;
}