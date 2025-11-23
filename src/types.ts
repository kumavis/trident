export type QuickJsFunction = (...args: QuickJsValue[]) => QuickJsValue;

export type QuickJsObject = {
  [key: string]: QuickJsValue | QuickJsFunction;
  [key: symbol]: QuickJsValue | QuickJsFunction;
};

export type QuickJsValue =
  | null
  | undefined
  | boolean
  | number
  | string
  | QuickJsValue[]
  | QuickJsObject
  | QuickJsFunction;

export type ForkOptions = {
  /** Override the parent VM's maxCycles for the forked VM. If not specified, inherits from parent. */
  maxCycles?: number;
};

export interface ForkableVm {
  readonly globalThis: QuickJsObject;
  eval(code: string, options?: EvalOptions): QuickJsValue;
  evalWithMetrics(code: string, options?: EvalOptions): EvalResult;
  callFunction(name: string, ...args: QuickJsValue[]): QuickJsValue;
  callFunctionWithMetrics(name: string, ...args: QuickJsValue[]): EvalResult;
  fork(options?: ForkOptions): Promise<ForkableVm>;
  dispose(): void;
}

export type CreateVmOptions = {
  /**
   * Maximum number of interrupt cycles before interrupting execution.
   * This limit applies PER CALL to eval() or callFunction().
   * The cycle counter resets to zero at the start of each call.
   * 
   * When set, the VM will throw an error if a single execution exceeds this limit.
   * Each cycle represents one call to the interrupt handler, which occurs
   * periodically during execution (at loop boundaries, function calls, etc.).
   * 
   * Can be overridden per-call using EvalOptions.
   * Use this to prevent infinite loops or excessive computation.
   */
  maxCycles?: number;
};

export type EvalOptions = {
  /** Override the VM's default maxCycles for this specific eval */
  maxCycles?: number;
};

export type EvalResult = {
  result: QuickJsValue;
  cycleCount: number;
};

