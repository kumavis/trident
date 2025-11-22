import { QuickJsWasmRuntime } from "../runtime/QuickJsWasmRuntime.ts";
import type { CreateVmOptions, ForkableVm, QuickJsValue } from "../types.ts";

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

  eval(code: string): QuickJsValue {
    return this.withExclusiveAccessSync(() => {
      const json = this.runtime.evalUtf8(code);
      return this.parseQuickJsValue(json);
    });
  }

  callFunction(name: string, ...args: QuickJsValue[]): QuickJsValue {
    return this.withExclusiveAccessSync(() => {
      const argsJson = JSON.stringify(args);
      const json = this.runtime.callFunctionUtf8(name, argsJson);
      return this.parseQuickJsValue(json);
    });
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
    if (this.disposed) {
      return;
    }
    this.withExclusiveAccessSync(() => {
      if (this.disposed) {
        return;
      }
      this.disposed = true;
      this.runtime.dispose();
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

  private parseQuickJsValue(json: string): QuickJsValue {
    if (!json) {
      return null;
    }
    return JSON.parse(json) as QuickJsValue;
  }
}

