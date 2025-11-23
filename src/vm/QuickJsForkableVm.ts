import { QuickJsWasmRuntime } from "../runtime/QuickJsWasmRuntime.ts";
import type { CreateVmOptions, ForkableVm, QuickJsObject, QuickJsValue } from "../types.ts";

export class QuickJsForkableVm implements ForkableVm {
  private busy = false;
  private disposed = false;
  private readonly runtime: QuickJsWasmRuntime;
  private readonly options: CreateVmOptions;

  constructor(runtime: QuickJsWasmRuntime, options: CreateVmOptions = {}) {
    this.runtime = runtime;
    this.options = options;
  }

  static async create(options: CreateVmOptions = {}): Promise<QuickJsForkableVm> {
    const runtime = await QuickJsWasmRuntime.create();
    return new QuickJsForkableVm(runtime, options);
  }

  get globalThis(): QuickJsObject {
    return this.withExclusiveAccessSync(() => this.runtime.evalUtf8("globalThis") as QuickJsObject);
  }

  eval(code: string): QuickJsValue {
    return this.withExclusiveAccessSync(() => this.runtime.evalUtf8(code));
  }

  callFunction(name: string, ...args: QuickJsValue[]): QuickJsValue {
    return this.withExclusiveAccessSync(() => this.runtime.callFunctionUtf8(name, args));
  }

  async fork(): Promise<ForkableVm> {
    return this.withExclusiveAccessAsync(async () => {
      const snapshot = this.runtime.takeSnapshot();
      const childRuntime = await QuickJsWasmRuntime.create({ initializeRuntime: false });
      childRuntime.restoreSnapshot(snapshot);
      return new QuickJsForkableVm(childRuntime, this.options);
    });
  }

  dispose(): void {
    this.withExclusiveAccessSync(() => {
      this.disposed = true;
    });
  }

  private async withExclusiveAccessAsync<T>(fn: () => Promise<T>): Promise<T> {
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

  private withExclusiveAccessSync<T>(fn: () => T): T {
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

  private throwIfUnavailable(): void {
    if (this.disposed) {
      throw new Error("VM has been disposed");
    }
  }

}

