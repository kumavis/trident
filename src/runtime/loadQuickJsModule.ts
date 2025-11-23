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
}

export type QuickJsModuleFactory = (imports?: Record<string, unknown>) => Promise<QuickJsModule>;

// Global map to track interrupt state per runtime pointer
export const runtimeInterruptState = new Map<
  number,
  { counter: number; limit: number }
>();

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

