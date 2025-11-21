import { loadQuickJsModule } from "./loadQuickJsModule.ts";
import type { QuickJsModule } from "./loadQuickJsModule.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface QuickJsRuntimeCreateOptions {
  initializeRuntime?: boolean;
}

export class QuickJsWasmRuntime {
  private readonly module: QuickJsModule;

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
    return this.module.HEAPU8;
  }

  takeSnapshot(): Uint8Array {
    const view = this.getMemoryView();
    const snapshot = new Uint8Array(view.length);
    snapshot.set(view);
    return snapshot;
  }

  restoreSnapshot(snapshot: Uint8Array): void {
    const view = this.getMemoryView();
    if (snapshot.length !== view.length) {
      throw new Error("Snapshot size mismatch");
    }
    view.set(snapshot);
    if (typeof this.module._qjs_post_restore === "function") {
      this.module._qjs_post_restore();
    }
  }

  async evalUtf8(source: string): Promise<string> {
    return this.invokeWithString(source, (ptr, len) => {
      const errorCode = this.module._qjs_eval_utf8(ptr, len);
      if (errorCode !== 0) {
        throw new Error(this.readLastResult());
      }
      return this.readLastResult();
    });
  }

  async callFunctionUtf8(functionName: string, argsJson: string): Promise<string> {
    return this.invokeWithString(functionName, (namePtr, nameLen) =>
      this.invokeWithString(argsJson, (argsPtr, argsLen) => {
        const errorCode = this.module._qjs_call_function(namePtr, nameLen, argsPtr, argsLen);
        if (errorCode !== 0) {
          throw new Error(this.readLastResult());
        }
        return this.readLastResult();
      })
    );
  }

  private invokeWithString<T>(value: string, fn: (ptr: number, len: number) => T): T {
    const { ptr, len } = this.writeString(value);
    try {
      return fn(ptr, len);
    } finally {
      this.module._free(ptr);
    }
  }

  private writeString(value: string): { ptr: number; len: number } {
    const bytes = encoder.encode(value);
    const ptr = this.module._malloc(bytes.length);
    this.module.HEAPU8.set(bytes, ptr);
    return { ptr, len: bytes.length };
  }

  private readLastResult(): string {
    const ptr = this.module._qjs_get_last_result_ptr();
    const len = this.module._qjs_get_last_result_len();
    if (len === 0) {
      return "";
    }
    const bytes = this.module.HEAPU8.subarray(ptr, ptr + len);
    return decoder.decode(bytes);
  }
}

