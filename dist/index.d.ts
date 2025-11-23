type QuickJsFunction = (...args: QuickJsValue[]) => QuickJsValue;
type QuickJsObject = {
    [key: string]: QuickJsValue | QuickJsFunction;
    [key: symbol]: QuickJsValue | QuickJsFunction;
};
type QuickJsValue = null | undefined | boolean | number | string | QuickJsValue[] | QuickJsObject | QuickJsFunction;
type ForkOptions = {
    /** Override the parent VM's maxCycles for the forked VM. If not specified, inherits from parent. */
    maxCycles?: number;
};
interface ForkableVm {
    readonly globalThis: QuickJsObject;
    eval(code: string, options?: EvalOptions): QuickJsValue;
    evalWithMetrics(code: string, options?: EvalOptions): EvalResult;
    callFunction(name: string, ...args: QuickJsValue[]): QuickJsValue;
    callFunctionWithMetrics(name: string, ...args: QuickJsValue[]): EvalResult;
    fork(options?: ForkOptions): Promise<ForkableVm>;
    dispose(): void;
}
type CreateVmOptions = {
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
type EvalOptions = {
    /** Override the VM's default maxCycles for this specific eval */
    maxCycles?: number;
};
type EvalResult = {
    result: QuickJsValue;
    cycleCount: number;
};

interface QuickJsRuntimeCreateOptions {
    initializeRuntime?: boolean;
    maxCycles?: number;
}
declare class QuickJsWasmRuntime {
    private readonly module;
    private readonly maxCycles;
    private runtimePtr;
    private constructor();
    static create(options?: QuickJsRuntimeCreateOptions): Promise<QuickJsWasmRuntime>;
    getMemoryView(): Uint8Array;
    takeSnapshot(): Uint8Array;
    restoreSnapshot(snapshot: Uint8Array): void;
    evalUtf8(source: string, callMaxCycles?: number): QuickJsValue;
    evalUtf8WithMetrics(source: string, callMaxCycles?: number): {
        result: QuickJsValue;
        cycleCount: number;
    };
    callFunctionUtf8(functionName: string, args: QuickJsValue[], callMaxCycles?: number): QuickJsValue;
    callFunctionUtf8WithMetrics(functionName: string, args: QuickJsValue[], callMaxCycles?: number): {
        result: QuickJsValue;
        cycleCount: number;
    };
    private invokeWithString;
    private writeString;
}

declare function createForkableVm(options?: CreateVmOptions): Promise<ForkableVm>;
declare function createPreloadedVm(bootstrapCode: string, options?: CreateVmOptions): Promise<ForkableVm>;

export { type CreateVmOptions, type ForkableVm, type QuickJsFunction, type QuickJsObject, type QuickJsValue, QuickJsWasmRuntime, createForkableVm, createPreloadedVm };
