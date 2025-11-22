import { loadQuickJsModule } from "./loadQuickJsModule.ts";
import type { QuickJsModule } from "./loadQuickJsModule.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface QuickJsRuntimeCreateOptions {
  initializeRuntime?: boolean;
}

export class QuickJsWasmRuntime {
  private module: QuickJsModule | null;
  private disposed = false;

  private constructor(module: QuickJsModule) {
    this.module = module;
  }

  static async create(
    options: QuickJsRuntimeCreateOptions = {}
  ): Promise<QuickJsWasmRuntime> {
    const quickJsModule = await loadQuickJsModule();
    if (options.initializeRuntime !== false) {
      quickJsModule._qjs_init_runtime();
    }
    return new QuickJsWasmRuntime(quickJsModule);
  }

  getMemoryView(): Uint8Array {
    const module = this.getModule();
    return module.HEAPU8;
  }

  takeSnapshot(): Uint8Array {
    this.ensureNotDisposed();
    const view = this.getMemoryView();
    const snapshot = new Uint8Array(view.length);
    snapshot.set(view);
    return snapshot;
  }

  restoreSnapshot(snapshot: Uint8Array): void {
    const module = this.getModule();
    const view = module.HEAPU8;
    if (snapshot.length !== view.length) {
      throw new Error("Snapshot size mismatch");
    }
    view.set(snapshot);
    if (typeof module._qjs_post_restore === "function") {
      module._qjs_post_restore();
    }
  }

  evalUtf8(source: string): string {
    this.ensureNotDisposed();
    const module = this.getModule();
    return this.invokeWithString(source, (ptr, len) => {
      const errorCode = module._qjs_eval_utf8(ptr, len);
      if (errorCode !== 0) {
        throw new Error(this.readLastResult());
      }
      return this.readLastResult();
    });
  }

  callFunctionUtf8(functionName: string, argsJson: string): string {
    this.ensureNotDisposed();
    const module = this.getModule();
    return this.invokeWithString(functionName, (namePtr, nameLen) =>
      this.invokeWithString(argsJson, (argsPtr, argsLen) => {
        const errorCode = module._qjs_call_function(namePtr, nameLen, argsPtr, argsLen);
        if (errorCode !== 0) {
          throw new Error(this.readLastResult());
        }
        return this.readLastResult();
      })
    );
  }

  private invokeWithString<T>(value: string, fn: (ptr: number, len: number) => T): T {
    const module = this.getModule();
    const { ptr, len } = this.writeStringInternal(value, module);
    try {
      return fn(ptr, len);
    } finally {
      module._free(ptr);
    }
  }

  private writeString(value: string): { ptr: number; len: number } {
    const module = this.getModule();
    return this.writeStringInternal(value, module);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    const module = this.getModule();
    if (typeof module._qjs_dispose_runtime === "function") {
      module._qjs_dispose_runtime();
    }
    this.module = null;
    this.disposed = true;
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error("QuickJsWasmRuntime has been disposed");
    }
  }

  private getModule(): QuickJsModule {
    if (!this.module) {
      throw new Error("QuickJsWasmRuntime has been disposed");
    }
    return this.module;
  }

  private writeStringInternal(value: string, module: QuickJsModule): { ptr: number; len: number } {
    const bytes = encoder.encode(value);
    const ptr = module._malloc(bytes.length);
    module.HEAPU8.set(bytes, ptr);
    return { ptr, len: bytes.length };
  }

  private readLastResult(): string {
    const module = this.getModule();
    const ptr = module._qjs_get_last_result_ptr();
    const len = module._qjs_get_last_result_len();
    if (len === 0) {
      return "";
    }
    const bytes = module.HEAPU8.subarray(ptr, ptr + len);
    return decoder.decode(bytes);
  }
}

