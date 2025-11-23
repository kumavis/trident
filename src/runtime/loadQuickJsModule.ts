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

