// Retained as an explicit diagnostic target. Demonstration models must never
// produce scientific calibration scores or routine predictions.
import type { FittedModel, LabEngine, MaterializedDataset, PipelineDSL, PredictResult, RunOptions, RunResult } from './port.js';

export class StubEngine implements LabEngine {
  readonly name = 'stub';

  async run(_ds: MaterializedDataset, _dsl: PipelineDSL, _opts?: RunOptions): Promise<RunResult> {
    throw new Error('The demonstration engine cannot calibrate a scientific model.');
  }

  async predict(_model: FittedModel, _Xnew: Float64Array, _nSamples: number, _nFeatures: number): Promise<PredictResult> {
    throw new Error('The demonstration engine cannot make routine predictions.');
  }
}
