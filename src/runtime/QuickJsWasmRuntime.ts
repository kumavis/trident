import { loadQuickJsModule, runtimeInterruptState } from "./loadQuickJsModule.ts";
import type { QuickJsModule } from "./loadQuickJsModule.ts";
import type { QuickJsValue } from "../types.ts";

const encoder = new TextEncoder();

interface QuickJsRuntimeCreateOptions {
  initializeRuntime?: boolean;
  maxCycles?: number;
}

export class QuickJsWasmRuntime {
  private readonly module: QuickJsModule;
  private readonly maxCycles: number | undefined;
  private runtimePtr: number = 0;

  private constructor(module: QuickJsModule, maxCycles?: number) {
    this.module = module;
    this.maxCycles = maxCycles;
  }

  static async create(
    options: QuickJsRuntimeCreateOptions = {}
  ): Promise<QuickJsWasmRuntime> {
    const quickJsModule = await loadQuickJsModule();
    if (options.initializeRuntime !== false) {
      quickJsModule._qjs_init_runtime();
    }
    const runtime = new QuickJsWasmRuntime(quickJsModule, options.maxCycles);
    
    // Get the runtime pointer and set up interrupt handler
    runtime.runtimePtr = quickJsModule._qjs_get_runtime_ptr();
    
    // Always initialize interrupt state for cycle tracking
    runtimeInterruptState.set(runtime.runtimePtr, {
      counter: 0,
      limit: options.maxCycles ?? Infinity,
    });
    
    // Only enable interrupt handler if we have a limit
    if (options.maxCycles !== undefined) {
      quickJsModule._QTS_RuntimeEnableInterruptHandler(runtime.runtimePtr);
    }
    
    return runtime;
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

  evalUtf8(source: string, callMaxCycles?: number): QuickJsValue {
    const { result } = this.evalUtf8WithMetrics(source, callMaxCycles);
    return result;
  }

  evalUtf8WithMetrics(source: string, callMaxCycles?: number): { result: QuickJsValue; cycleCount: number } {
    // Reset interrupt counter and set limit before each eval
    const state = runtimeInterruptState.get(this.runtimePtr);
    if (state) {
      state.counter = 0;
      state.limit = callMaxCycles ?? this.maxCycles ?? Infinity;
    }
    
    const result = this.invokeWithString(source, (ptr, len) => {
      return this.module._qjs_eval_utf8(ptr, len);
    });
    
    const cycleCount = state ? state.counter : 0;
    return { result, cycleCount };
  }

  callFunctionUtf8(functionName: string, args: QuickJsValue[], callMaxCycles?: number): QuickJsValue {
    const { result } = this.callFunctionUtf8WithMetrics(functionName, args, callMaxCycles);
    return result;
  }

  callFunctionUtf8WithMetrics(functionName: string, args: QuickJsValue[], callMaxCycles?: number): { result: QuickJsValue; cycleCount: number } {
    // Reset interrupt counter and set limit before each function call
    const state = runtimeInterruptState.get(this.runtimePtr);
    if (state) {
      state.counter = 0;
      state.limit = callMaxCycles ?? this.maxCycles ?? Infinity;
    }
    
    const result = this.invokeWithString(functionName, (namePtr, nameLen) =>
      this.module._qjs_call_function(namePtr, nameLen, args)
    );
    
    const cycleCount = state ? state.counter : 0;
    return { result, cycleCount };
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

}

