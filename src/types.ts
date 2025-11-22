export type QuickJsValue =
  | null
  | boolean
  | number
  | string
  | QuickJsValue[]
  | { [key: string]: QuickJsValue };

export interface ForkableVm {
  eval(code: string): QuickJsValue;
  callFunction(name: string, ...args: QuickJsValue[]): QuickJsValue;
  fork(): Promise<ForkableVm>;
  dispose(): void;
}

export type CreateVmOptions = Record<string, never>;

