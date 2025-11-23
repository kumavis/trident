export type QuickJsFunction = (...args: QuickJsValue[]) => QuickJsValue;

export type QuickJsObject = {
  [key: string]: QuickJsValue | QuickJsFunction;
  [key: symbol]: QuickJsValue | QuickJsFunction;
};

export type QuickJsValue =
  | null
  | undefined
  | boolean
  | number
  | string
  | QuickJsValue[]
  | QuickJsObject
  | QuickJsFunction;

export interface ForkableVm {
  eval(code: string): QuickJsValue;
  callFunction(name: string, ...args: QuickJsValue[]): QuickJsValue;
  fork(): Promise<ForkableVm>;
  dispose(): void;
}

export type CreateVmOptions = Record<string, never>;

