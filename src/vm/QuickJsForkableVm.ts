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

  async eval(code: string): Promise<QuickJsValue> {
    return this.withExclusiveAccess(async () => {
      const json = await this.runtime.evalUtf8(code);
      return this.parseQuickJsValue(json);
    });
  }

  async callFunction(name: string, ...args: QuickJsValue[]): Promise<QuickJsValue> {
    return this.withExclusiveAccess(async () => {
      const argsJson = JSON.stringify(args);
      const json = await this.runtime.callFunctionUtf8(name, argsJson);
      return this.parseQuickJsValue(json);
    });
  }

  async fork(): Promise<ForkableVm> {
    return this.withExclusiveAccess(async () => {
      const snapshot = this.runtime.takeSnapshot();
      const childRuntime = await QuickJsWasmRuntime.create({ initializeRuntime: false });
      childRuntime.restoreSnapshot(snapshot);
      return new QuickJsForkableVm(childRuntime, this.options);
    });
  }

  async dispose(): Promise<void> {
    await this.withExclusiveAccess(async () => {
      this.disposed = true;
    });
  }

  private async withExclusiveAccess<T>(fn: () => Promise<T>): Promise<T> {
    if (this.disposed) {
      throw new Error("VM has been disposed");
    }
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

  private parseQuickJsValue(json: string): QuickJsValue {
    if (!json) {
      return null;
    }
    return JSON.parse(json) as QuickJsValue;
  }
}

