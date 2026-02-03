export class UTxO {
    id: string;
    tx_id: string;
    index: number;
    blockHash: string;
    blockNum: number;
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
        this.blockHash = utxo.blockHash;
        this.blockNum = utxo.blockNum;
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
    burn?: [string, string[]][];
    metadata: any;
}