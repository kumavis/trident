export type QuickJsValue =
  | null
  | boolean
  | number
  | string
  | QuickJsValue[]
  | { [key: string]: QuickJsValue };

export interface ForkableVm {
  eval(code: string): Promise<QuickJsValue>;
  callFunction(name: string, ...args: QuickJsValue[]): Promise<QuickJsValue>;
  fork(): Promise<ForkableVm>;
  dispose(): Promise<void>;
}

export interface CreateVmOptions {
  // Placeholder for future configuration (stdlib toggles, preload scripts, etc.)
}

