import { IApiMetrics, IndexNames, StoredHandle } from './api';

export interface IHandlesProvider {
    // SETUP
    initialize: () => IHandlesProvider;
    destroy: () => void;
    rollBackToGenesis: () => void;
    
    //HANDLES
    getHandle: (key: string) => StoredHandle | null;
    getHandleByHex: (hex: string) => StoredHandle | null;
    getAllHandles: () => StoredHandle[];
    setHandle: (key: string, value: StoredHandle) => void;
    removeHandle: (handleName: string) => void;

    // INDEXES
    getIndex: (index:IndexNames) => any;
    getValuesFromIndex: (index:IndexNames, key: string|number) => any;
    setValueOnIndex: (index:IndexNames, key: string|number, value: any) => void;
    removeValueFromIndex: (index:IndexNames, key: string|number, value: string) => void;
    removeKeyFromIndex: (index:IndexNames, key: string|number) => void;
        
    // METRICS
    getMetrics: () => IApiMetrics;
    setMetrics: (metrics: IApiMetrics) => void;
    count: () => number;
    getSchemaVersion: () => number;
}