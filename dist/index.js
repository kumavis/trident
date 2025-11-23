// src/runtime/loadQuickJsModule.ts
var runtimeInterruptState = /* @__PURE__ */ new Map();
function globalShouldInterrupt(_unused, runtimePtr) {
  const state = runtimeInterruptState.get(runtimePtr);
  if (!state) {
    return false;
  }
  state.counter++;
  return state.counter > state.limit;
}
async function loadQuickJsModule() {
  const factory = await importQuickJsModuleFactory();
  const imports = {
    callbacks: {
      shouldInterrupt: globalShouldInterrupt
    }
  };
  return factory(imports);
}
async function importQuickJsModuleFactory() {
  const isBuiltArtifact = /[/\\]dist[/\\]/.test(import.meta.url);
  const wasmRelativePath = isBuiltArtifact ? "./wasm/quickjs.mjs" : "../wasm/quickjs.mjs";
  const quickJsUrl = new URL(wasmRelativePath, import.meta.url);
  const moduleNamespace = await import(quickJsUrl.href);
  const factory = moduleNamespace.default ?? moduleNamespace.QuickJsModuleFactory ?? moduleNamespace.factory;
  if (!factory) {
    throw new Error("quickjs.mjs does not export a default module factory");
  }
  return factory;
}

// src/runtime/QuickJsWasmRuntime.ts
var encoder = new TextEncoder();
var QuickJsWasmRuntime = class _QuickJsWasmRuntime {
  constructor(module, maxCycles) {
    this.runtimePtr = 0;
    this.module = module;
    this.maxCycles = maxCycles;
  }
  static async create(options = {}) {
    const quickJsModule = await loadQuickJsModule();
    if (options.initializeRuntime !== false) {
      quickJsModule._qjs_init_runtime();
    }
    const runtime = new _QuickJsWasmRuntime(quickJsModule, options.maxCycles);
    runtime.runtimePtr = quickJsModule._qjs_get_runtime_ptr();
    runtimeInterruptState.set(runtime.runtimePtr, {
      counter: 0,
      limit: options.maxCycles ?? Infinity
    });
    if (options.maxCycles !== void 0) {
      quickJsModule._QTS_RuntimeEnableInterruptHandler(runtime.runtimePtr);
    }
    return runtime;
  }
  getMemoryView() {
    return this.module.HEAPU8;
  }
  takeSnapshot() {
    const view = this.getMemoryView();
    const snapshot = new Uint8Array(view.length);
    snapshot.set(view);
    return snapshot;
  }
  restoreSnapshot(snapshot) {
    const view = this.getMemoryView();
    if (snapshot.length !== view.length) {
      throw new Error("Snapshot size mismatch");
    }
    view.set(snapshot);
    if (typeof this.module._qjs_post_restore === "function") {
      this.module._qjs_post_restore();
    }
  }
  evalUtf8(source, callMaxCycles) {
    const { result } = this.evalUtf8WithMetrics(source, callMaxCycles);
    return result;
  }
  evalUtf8WithMetrics(source, callMaxCycles) {
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
  callFunctionUtf8(functionName, args, callMaxCycles) {
    const { result } = this.callFunctionUtf8WithMetrics(functionName, args, callMaxCycles);
    return result;
  }
  callFunctionUtf8WithMetrics(functionName, args, callMaxCycles) {
    const state = runtimeInterruptState.get(this.runtimePtr);
    if (state) {
      state.counter = 0;
      state.limit = callMaxCycles ?? this.maxCycles ?? Infinity;
    }
    const result = this.invokeWithString(
      functionName,
      (namePtr, nameLen) => this.module._qjs_call_function(namePtr, nameLen, args)
    );
    const cycleCount = state ? state.counter : 0;
    return { result, cycleCount };
  }
  invokeWithString(value, fn) {
    const { ptr, len } = this.writeString(value);
    try {
      return fn(ptr, len);
    } finally {
      this.module._free(ptr);
    }
  }
  writeString(value) {
    const bytes = encoder.encode(value);
    const ptr = this.module._malloc(bytes.length);
    this.module.HEAPU8.set(bytes, ptr);
    return { ptr, len: bytes.length };
  }
};

// src/vm/QuickJsForkableVm.ts
var QuickJsForkableVm = class _QuickJsForkableVm {
  constructor(runtime, options = {}) {
    this.busy = false;
    this.disposed = false;
    this.runtime = runtime;
    this.options = options;
  }
  static async create(options = {}) {
    const runtime = await QuickJsWasmRuntime.create({
      maxCycles: options.maxCycles
    });
    return new _QuickJsForkableVm(runtime, options);
  }
  get globalThis() {
    return this.withExclusiveAccessSync(() => this.runtime.evalUtf8("globalThis"));
  }
  eval(code, options) {
    return this.withExclusiveAccessSync(() => this.runtime.evalUtf8(code, options?.maxCycles));
  }
  evalWithMetrics(code, options) {
    return this.withExclusiveAccessSync(() => this.runtime.evalUtf8WithMetrics(code, options?.maxCycles));
  }
  callFunction(name, ...args) {
    return this.withExclusiveAccessSync(() => this.runtime.callFunctionUtf8(name, args));
  }
  callFunctionWithMetrics(name, ...args) {
    return this.withExclusiveAccessSync(() => this.runtime.callFunctionUtf8WithMetrics(name, args));
  }
  async fork(options) {
    return this.withExclusiveAccessAsync(async () => {
      const snapshot = this.runtime.takeSnapshot();
      const childMaxCycles = options?.maxCycles !== void 0 ? options.maxCycles : this.options.maxCycles;
      const childRuntime = await QuickJsWasmRuntime.create({
        initializeRuntime: false,
        maxCycles: childMaxCycles
      });
      childRuntime.restoreSnapshot(snapshot);
      const childOptions = {
        ...this.options,
        maxCycles: childMaxCycles
      };
      return new _QuickJsForkableVm(childRuntime, childOptions);
    });
  }
  dispose() {
    this.withExclusiveAccessSync(() => {
      this.disposed = true;
    });
  }
  async withExclusiveAccessAsync(fn) {
    this.throwIfUnavailable();
    if (this.busy) {
      throw new Error("VM operation already in progress");
    }
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }
  withExclusiveAccessSync(fn) {
    this.throwIfUnavailable();
    if (this.busy) {
      throw new Error("VM operation already in progress");
    }
    this.busy = true;
    try {
      return fn();
    } finally {
      this.busy = false;
    }
  }
  throwIfUnavailable() {
    if (this.disposed) {
      throw new Error("VM has been disposed");
    }
  }
};

// src/index.ts
async function createForkableVm(options = {}) {
  return QuickJsForkableVm.create(options);
}
async function createPreloadedVm(bootstrapCode, options = {}) {
  const vm = await createForkableVm(options);
  try {
    vm.eval(bootstrapCode);
    return vm;
  } catch (error) {
    vm.dispose();
    throw error;
  }
}
export {
  QuickJsWasmRuntime,
  createForkableVm,
  createPreloadedVm
};
//# sourceMappingURL=index.js.map