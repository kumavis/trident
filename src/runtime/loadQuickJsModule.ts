import type { QuickJsValue } from "../types.ts";

export interface QuickJsModule {
  HEAP8: Int8Array;
  HEAPU8: Uint8Array;
  memory: WebAssembly.Memory;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _qjs_init_runtime(): void;
  _qjs_eval_utf8(ptr: number, len: number): QuickJsValue;
  _qjs_call_function(namePtr: number, nameLen: number, args: QuickJsValue[]): QuickJsValue;
  _qjs_post_restore?(): void;
  _qjs_get_runtime_ptr(): number;
  _QTS_RuntimeEnableInterruptHandler(runtimePtr: number): void;
  _QTS_RuntimeDisableInterruptHandler(runtimePtr: number): void;
  _QTS_NewFunction(ctx: number, funcId: number, name: string): number;
  _QTS_ArgvGetJSValueConstPointer(argv: number, index: number): number;
}

export type QuickJsModuleFactory = (imports?: Record<string, unknown>) => Promise<QuickJsModule>;

// Global map to track interrupt state per runtime pointer
export const runtimeInterruptState = new Map<
  number,
  { counter: number; limit: number }
>();

// Global map to store host functions by ID
export const hostFunctionRegistry = new Map<number, (...args: any[]) => any>();
let nextFunctionId = 1;

// Export function to register host functions
export function registerHostFunction(func: (...args: any[]) => any): number {
  const id = nextFunctionId++;
  hostFunctionRegistry.set(id, func);
  return id;
}

// Export function to unregister host functions
export function unregisterHostFunction(id: number): void {
  hostFunctionRegistry.delete(id);
}

// Global shouldInterrupt callback that checks the map
// Note: The WASM callback signature is (_unused, runtimePtr)
function globalShouldInterrupt(_unused: unknown, runtimePtr: number): boolean {
  const state = runtimeInterruptState.get(runtimePtr);
  if (!state) {
    return false;
  }
  state.counter++;
  return state.counter > state.limit;
}

export async function loadQuickJsModule(): Promise<QuickJsModule> {
  // Don't cache - create a fresh module each time with callbacks
  const factory = await importQuickJsModuleFactory();
  const imports = {
    callbacks: {
      shouldInterrupt: globalShouldInterrupt,
      callFunction: (...args: any[]) => {
        // This will be set by the augmented module after it's initialized
        if (typeof (globalThis as any).__trident_host_function_callback === 'function') {
          return (globalThis as any).__trident_host_function_callback(...args);
        }
        throw new Error('Host function callback handler not initialized');
      },
    },
  };
  return factory(imports);
}

async function importQuickJsModuleFactory(): Promise<QuickJsModuleFactory> {
  // TODO: need a better way of distributing the wasm files
  const isBuiltArtifact = /[/\\]dist[/\\]/.test(import.meta.url);
  const wasmRelativePath = isBuiltArtifact ? "./wasm/quickjs.mjs" : "../wasm/quickjs.mjs";
  const quickJsUrl = new URL(wasmRelativePath, import.meta.url);
  const moduleNamespace = (await import(quickJsUrl.href)) as {
    default?: QuickJsModuleFactory;
    QuickJsModuleFactory?: QuickJsModuleFactory;
    factory?: QuickJsModuleFactory;
  };
  const factory =
    moduleNamespace.default ?? moduleNamespace.QuickJsModuleFactory ?? moduleNamespace.factory;
  if (!factory) {
    throw new Error("quickjs.mjs does not export a default module factory");
  }
  return factory;
}

