type QuickJsFunction = (...args: QuickJsValue[]) => QuickJsValue;
type QuickJsObject = {
    [key: string]: QuickJsValue | QuickJsFunction;
    [key: symbol]: QuickJsValue | QuickJsFunction;
};
type QuickJsValue = null | undefined | boolean | number | string | QuickJsValue[] | QuickJsObject | QuickJsFunction;
interface ForkableVm {
    readonly globalThis: QuickJsObject;
    eval(code: string): QuickJsValue;
    callFunction(name: string, ...args: QuickJsValue[]): QuickJsValue;
    fork(): Promise<ForkableVm>;
    dispose(): void;
}
type CreateVmOptions = Record<string, never>;

interface QuickJsRuntimeCreateOptions {
    initializeRuntime?: boolean;
}
declare class QuickJsWasmRuntime {
    private readonly module;
    private constructor();
    static create(options?: QuickJsRuntimeCreateOptions): Promise<QuickJsWasmRuntime>;
    getMemoryView(): Uint8Array;
    takeSnapshot(): Uint8Array;
    restoreSnapshot(snapshot: Uint8Array): void;
    evalUtf8(source: string): QuickJsValue;
    callFunctionUtf8(functionName: string, args: QuickJsValue[]): QuickJsValue;
    private invokeWithString;
    private writeString;
}

declare function createForkableVm(options?: CreateVmOptions): Promise<ForkableVm>;
declare function createPreloadedVm(bootstrapCode: string, options?: CreateVmOptions): Promise<ForkableVm>;

export { type CreateVmOptions, type ForkableVm, type QuickJsFunction, type QuickJsObject, type QuickJsValue, QuickJsWasmRuntime, createForkableVm, createPreloadedVm };
