// Core remains the storage dependency. DAG/Methods own all production execution.
import { dagEngine } from './dagEngine.js';
import { predictWithModel } from './predict.js';
import type { LabEngine } from './port.js';

export const wasmEngine: LabEngine = { ...dagEngine, predict: predictWithModel };
