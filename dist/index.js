// src/runtime/loadQuickJsModule.ts
var cachedFactoryPromise = null;
async function loadQuickJsModule() {
  if (!cachedFactoryPromise) {
    cachedFactoryPromise = importQuickJsModuleFactory();
  }
  const factory = await cachedFactoryPromise;
  return factory();
}
async function importQuickJsModuleFactory() {
  const quickJsUrl = new URL("../../wasm/quickjs.mjs", import.meta.url);
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
  constructor(module) {
    this.module = module;
  }
  static async create(options = {}) {
    const quickJsModule = await loadQuickJsModule();
    if (options.initializeRuntime !== false) {
      quickJsModule._qjs_init_runtime();
    }
    return new _QuickJsWasmRuntime(quickJsModule);
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
  evalUtf8(source) {
    return this.invokeWithString(source, (ptr, len) => {
      return this.module._qjs_eval_utf8(ptr, len);
    });
  }
  callFunctionUtf8(functionName, args) {
    return this.invokeWithString(
      functionName,
      (namePtr, nameLen) => this.module._qjs_call_function(namePtr, nameLen, args)
    );
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
    const runtime = await QuickJsWasmRuntime.create();
    return new _QuickJsForkableVm(runtime, options);
  }
  get globalThis() {
    return this.withExclusiveAccessSync(() => this.runtime.evalUtf8("globalThis"));
  }
  eval(code) {
    return this.withExclusiveAccessSync(() => this.runtime.evalUtf8(code));
  }
  callFunction(name, ...args) {
    return this.withExclusiveAccessSync(() => this.runtime.callFunctionUtf8(name, args));
  }
  async fork() {
    return this.withExclusiveAccessAsync(async () => {
      const snapshot = this.runtime.takeSnapshot();
      const childRuntime = await QuickJsWasmRuntime.create({ initializeRuntime: false });
      childRuntime.restoreSnapshot(snapshot);
      return new _QuickJsForkableVm(childRuntime, this.options);
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