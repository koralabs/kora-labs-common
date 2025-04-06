import { Holder, IApiMetrics, IndexNames, ISlotHistory, StoredHandle } from './api';

export interface IHandlesProvider {
    // SETUP
    initialize: () => Promise<IHandlesProvider>;
    destroy: () => void;
    rollBackToGenesis: () => void;
    getStartingPoint: (
        save: (handle: StoredHandle) => Promise<void>, 
        failed: boolean
    ) => Promise<{ slot: number; id: string; } | null>
    
    // HANDLES
    getHandle: (key: string) => StoredHandle | null;
    getHandleByHex: (hex: string) => StoredHandle | null;
    getAllHandles: () => StoredHandle[];
    setHandle: (key: string, value: StoredHandle) => void;
    removeHandle: (handleName: string) => void;

    // INDEXES
    getIndex: (index:IndexNames) => Map<string|number, Set<string> | Holder | ISlotHistory | StoredHandle>;
    getValueFromIndex: (index:IndexNames, key:string|number) => Set<string> | Holder | ISlotHistory | StoredHandle | undefined;
    setValueOnIndex: (index:IndexNames, key: string|number, value: Set<string> | Holder | ISlotHistory | StoredHandle) => void;
    removeKeyFromIndex: (index:IndexNames, key: string|number) => void;

    // SET INDEXES
    getValuesFromIndexedSet: (index:IndexNames, key: string|number) => Set<string> | undefined;
    addValueToIndexedSet: (index:IndexNames, key: string|number, value: string) => void;
    removeValueFromIndexedSet: (index:IndexNames, key: string|number, value: string) => void;
        
    // METRICS
    getMetrics: () => IApiMetrics;
    setMetrics: (metrics: IApiMetrics) => void;
    count: () => number;
    getSchemaVersion: () => number;
}