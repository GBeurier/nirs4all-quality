declare module '@nirs4all/methods' {
  interface Matrix { data: Float64Array; rows: number; cols: number }
  export function loadModule(): Promise<unknown>;
  export function version(): string;
  export function abiVersion(): readonly [number, number, number];
  export class FlexiblePCA {
    constructor(params: { n_components: number });
    fit(X: Matrix): this;
    transform(X: Matrix): Matrix;
    dispose(): void;
  }
  export class HotellingT2 {
    constructor(params: { n_components: number; alpha: number });
    run(X: Matrix): Record<string, Matrix | number>;
  }
  export class QResiduals extends HotellingT2 {}
  export class Resampler {
    constructor(params: { target_wavelengths: number[]; method: 'linear'; bounds_error: boolean; extrapolate: boolean });
    fit(X: Matrix, y?: undefined, inputs?: { axis: number[] }): this;
    transform(X: Matrix): Matrix;
    dispose(): void;
  }
}
