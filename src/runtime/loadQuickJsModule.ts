export interface QuickJsModule {
  HEAP8: Int8Array;
  HEAPU8: Uint8Array;
  memory: WebAssembly.Memory;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _qjs_init_runtime(): void;
  _qjs_eval_utf8(ptr: number, len: number): number;
  _qjs_call_function(namePtr: number, nameLen: number, argsPtr: number, argsLen: number): number;
  _qjs_get_last_result_ptr(): number;
  _qjs_get_last_result_len(): number;
  _qjs_dispose_runtime(): void;
  _qjs_post_restore?(): void;
}

export type QuickJsModuleFactory = (imports?: Record<string, unknown>) => Promise<QuickJsModule>;

let cachedFactoryPromise: Promise<QuickJsModuleFactory> | null = null;

export async function loadQuickJsModule(): Promise<QuickJsModule> {
  if (!cachedFactoryPromise) {
    cachedFactoryPromise = importQuickJsModuleFactory();
  }
  const factory = await cachedFactoryPromise;
  return factory();
}

async function importQuickJsModuleFactory(): Promise<QuickJsModuleFactory> {
  const quickJsUrl = new URL("../../wasm/quickjs.mjs", import.meta.url);
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

