import { QuickJSFFI } from "@jitl/quickjs-wasmfile-release-sync/ffi";
import { EvalFlags, GetOwnPropertyNamesFlags, IsEqualOp } from "@jitl/quickjs-ffi-types";

const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();

const METADATA_MAGIC = 0x46564d21; // "FVM!"
const METADATA_WORDS = 16;
const METADATA_BYTE_SIZE = METADATA_WORDS * 4;

const METADATA_INDEX = {
  magic: 0,
  selfPtr: 1,
  runtimePtr: 2,
  contextPtr: 3,
  lastResultPtr: 4,
  lastResultLen: 5,
};

const DETECT_MODULE_AUTO = 1;
const OWN_KEYS_FLAGS =
  GetOwnPropertyNamesFlags.JS_GPN_STRING_MASK |
  GetOwnPropertyNamesFlags.JS_GPN_ENUM_ONLY |
  GetOwnPropertyNamesFlags.QTS_STANDARD_COMPLIANT_NUMBER;
const HAS_ITERATOR_SYMBOL = typeof Symbol === "function" && typeof Symbol.iterator === "symbol";

function isNodeLikeEnvironment() {
  return (
    typeof process !== "undefined" &&
    !!process.versions?.node &&
    typeof window === "undefined"
  );
}

export default async function createModule(imports = {}) {
  const loadRaw = isNodeLikeEnvironment()
    ? (await import("./quickjs-core-node.mjs")).default
    : (await import("./quickjs-core-browser.mjs")).default;
  const module = await loadRaw(imports);
  augmentModule(module);
  return module;
}

function augmentModule(module) {
  const heapU8 = () => module.HEAPU8;
  const heapU32 = () => module.HEAPU32;
  let ffi = null;
  let metadataPtr = 0;
  let runtimePtr = 0;
  let contextPtr = 0;
  let globalObjectPtr = 0;
  const proxyHandleMetadata = new WeakMap();
  const proxyFinalizationRegistry =
    typeof FinalizationRegistry === "undefined"
      ? null
      : new FinalizationRegistry((handle) => {
          if (!handle?.ptr || !ffi || !contextPtr) {
            return;
          }
          try {
            ffi.QTS_FreeValuePointer(contextPtr, handle.ptr);
          } catch {
            // ignore cleanup failures
          } finally {
            handle.ptr = 0;
          }
        });

  function ensureFFI() {
    if (!ffi) {
      ffi = new QuickJSFFI(module);
    }
  }

  function ensureMetadata() {
    if (metadataPtr) {
      return;
    }
    const ptr = module._malloc(METADATA_BYTE_SIZE);
    heapU32().fill(0, ptr >> 2, (ptr + METADATA_BYTE_SIZE) >> 2);
    writeMetadata(ptr, METADATA_INDEX.magic, METADATA_MAGIC);
    writeMetadata(ptr, METADATA_INDEX.selfPtr, ptr);
    metadataPtr = ptr;
  }

  function locateMetadata() {
    const view = heapU32();
    for (let i = 0; i < view.length - 1; i += 1) {
      if (view[i] === METADATA_MAGIC) {
        const candidatePtr = view[i + 1];
        if ((candidatePtr >>> 0) === (i << 2)) {
          metadataPtr = candidatePtr;
          return;
        }
      }
    }
    throw new Error("Forkable VM metadata not found in memory snapshot");
  }

  function writeMetadata(basePtr, index, value) {
    module.HEAPU32[(basePtr >> 2) + index] = value >>> 0;
  }

  function readMetadata(index) {
    if (!metadataPtr) {
      return 0;
    }
    return module.HEAPU32[(metadataPtr >> 2) + index] >>> 0;
  }

  function updateMetadata(index, value) {
    if (!metadataPtr) {
      ensureMetadata();
    }
    writeMetadata(metadataPtr, index, value >>> 0);
  }

  function ensureRuntimePointers() {
    if (runtimePtr && contextPtr) {
      return;
    }
    runtimePtr = readMetadata(METADATA_INDEX.runtimePtr);
    contextPtr = readMetadata(METADATA_INDEX.contextPtr);
  }

  function resetCachedHandles() {
    globalObjectPtr = 0;
  }

  function retainQuickJsValueHandle(valuePtr) {
    return { ptr: ffi.QTS_DupValuePointer(contextPtr, valuePtr) };
  }

  function rememberProxy(target, handle) {
    proxyHandleMetadata.set(target, handle);
    proxyFinalizationRegistry?.register(target, handle);
  }

  function getProxyHandle(target) {
    return proxyHandleMetadata.get(target) ?? null;
  }

  function duplicateProxyPointer(target) {
    const handle = getProxyHandle(target);
    if (!handle?.ptr) {
      return null;
    }
    return ffi.QTS_DupValuePointer(contextPtr, handle.ptr);
  }

  function decodeUtf8(ptr, len) {
    return TEXT_DECODER.decode(heapU8().subarray(ptr, ptr + len));
  }

  function cloneInputBuffer(ptr, len) {
    const bufferPtr = module._malloc(len + 1);
    heapU8().set(heapU8().subarray(ptr, ptr + len), bufferPtr);
    heapU8()[bufferPtr + len] = 0;
    return bufferPtr;
  }

  function allocJsString(value) {
    const bytes = TEXT_ENCODER.encode(value);
    const ptr = module._malloc(bytes.length + 1);
    heapU8().set(bytes, ptr);
    heapU8()[ptr + bytes.length] = 0;
    const jsValuePtr = ffi.QTS_NewString(contextPtr, ptr);
    module._free(ptr);
    return jsValuePtr;
  }

  function getGlobalObject() {
    if (!globalObjectPtr) {
      ensureRuntimePointers();
      globalObjectPtr = ffi.QTS_GetGlobalObject(contextPtr);
    }
    return globalObjectPtr;
  }

  function allocArgsPointer(args) {
    if (args.length === 0) {
      return 0;
    }
    const ptr = module._malloc(args.length * 4);
    const view = heapU32();
    const base = ptr >> 2;
    for (let i = 0; i < args.length; i += 1) {
      view[base + i] = args[i] >>> 0;
    }
    return ptr;
  }

  function normalizePropertyKey(prop) {
    if (typeof prop === "string") {
      return prop;
    }
    if (typeof prop === "number") {
      return String(prop);
    }
    if (typeof prop === "symbol") {
      return null;
    }
    return null;
  }

  function getQuickJsPropertyValue(handle, key) {
    const keyPtr = allocJsString(key);
    try {
      const valuePtr = ffi.QTS_GetProp(contextPtr, handle.ptr, keyPtr);
      return handleQuickJsResult(valuePtr, `get property "${key}"`);
    } finally {
      ffi.QTS_FreeValuePointer(contextPtr, keyPtr);
    }
  }

  function collectQuickJsOwnKeys(handle) {
    const pointerBufferPtr = module._malloc(4);
    const lengthBufferPtr = module._malloc(4);
    let namesBufferPtr = 0;
    try {
      const resultPtr = ffi.QTS_GetOwnPropertyNames(
        contextPtr,
        pointerBufferPtr,
        lengthBufferPtr,
        handle.ptr,
        OWN_KEYS_FLAGS
      );
      handleQuickJsResult(resultPtr, "ownKeys");
      const pointerArrayPtr = module.HEAPU32[pointerBufferPtr >> 2];
      const length = module.HEAPU32[lengthBufferPtr >> 2];
      if (!pointerArrayPtr || length === 0) {
        return [];
      }
      namesBufferPtr = pointerArrayPtr;
      const keys = [];
      const heap32 = module.HEAPU32;
      const baseIndex = namesBufferPtr >> 2;
      for (let i = 0; i < length; i += 1) {
        const valuePtr = heap32[baseIndex + i];
        if (!valuePtr) {
          continue;
        }
        try {
          const keyValue = fromQuickJsValue(valuePtr);
          if (typeof keyValue === "string") {
            keys.push(keyValue);
          } else if (keyValue !== undefined && keyValue !== null) {
            keys.push(String(keyValue));
          }
        } finally {
          ffi.QTS_FreeValuePointer(contextPtr, valuePtr);
        }
      }
      return keys;
    } finally {
      if (namesBufferPtr) {
        module._free(namesBufferPtr);
      }
      module._free(pointerBufferPtr);
      module._free(lengthBufferPtr);
    }
  }

  function getQuickJsGlobalProperty(propertyName) {
    const keyPtr = allocJsString(propertyName);
    try {
      const valuePtr = ffi.QTS_GetProp(contextPtr, getGlobalObject(), keyPtr);
      if (!valuePtr) {
        throw new Error(`QuickJS global property "${propertyName}" is not defined`);
      }
      return valuePtr;
    } finally {
      ffi.QTS_FreeValuePointer(contextPtr, keyPtr);
    }
  }

  function getQuickJsObjectProperty(objectPtr, propertyName) {
    const keyPtr = allocJsString(propertyName);
    try {
      const valuePtr = ffi.QTS_GetProp(contextPtr, objectPtr, keyPtr);
      if (!valuePtr) {
        throw new Error(`QuickJS property "${propertyName}" is not defined`);
      }
      return valuePtr;
    } finally {
      ffi.QTS_FreeValuePointer(contextPtr, keyPtr);
    }
  }

  function defineQuickJsProperty(handle, key, descriptor) {
    if (descriptor === null || typeof descriptor !== "object") {
      throw new TypeError("property descriptor must be an object");
    }
    if ("get" in descriptor || "set" in descriptor) {
      throw new TypeError("QuickJS proxies do not support accessor descriptors");
    }
    const normalizedDescriptor = {
      configurable: Boolean(descriptor.configurable),
      enumerable: Boolean(descriptor.enumerable),
    };
    if ("value" in descriptor) {
      normalizedDescriptor.value = descriptor.value;
    }
    if ("writable" in descriptor || "value" in descriptor) {
      normalizedDescriptor.writable = Boolean(descriptor.writable);
    }
    const descriptorPtr = toQuickJsValue(normalizedDescriptor);
    const keyPtr = toQuickJsValue(key);
    const targetPtr = ffi.QTS_DupValuePointer(contextPtr, handle.ptr);
    const reflectPtr = getQuickJsGlobalProperty("Reflect");
    const definePtr = getQuickJsObjectProperty(reflectPtr, "defineProperty");
    const argHandles = [targetPtr, keyPtr, descriptorPtr];
    let argsBuffer = 0;
    try {
      argsBuffer = allocArgsPointer(argHandles);
      const resultPtr = ffi.QTS_Call(
        contextPtr,
        definePtr,
        reflectPtr,
        argHandles.length,
        argsBuffer
      );
      const result = handleQuickJsResult(resultPtr, `Reflect.defineProperty("${key}")`);
      if (result !== true) {
        throw new Error(`Reflect.defineProperty("${key}") returned ${String(result)}`);
      }
      return true;
    } finally {
      if (argsBuffer) {
        module._free(argsBuffer);
      }
      argHandles.forEach((handlePtr) => ffi.QTS_FreeValuePointer(contextPtr, handlePtr));
      ffi.QTS_FreeValuePointer(contextPtr, definePtr);
      ffi.QTS_FreeValuePointer(contextPtr, reflectPtr);
    }
  }

  function getQuickJsArrayLength(handle) {
    const lengthPtr = module._malloc(4);
    try {
      const result = ffi.QTS_GetLength(contextPtr, lengthPtr, handle.ptr);
      if (result !== 0) {
        return null;
      }
      return module.HEAPU32[lengthPtr >> 2];
    } finally {
      module._free(lengthPtr);
    }
  }

  function createArrayIteratorFactory(handle) {
    if (!HAS_ITERATOR_SYMBOL) {
      return null;
    }
    const length = getQuickJsArrayLength(handle);
    if (length === null) {
      return null;
    }
    return function arrayIteratorFactory() {
      let index = 0;
      const iterator = {
        next() {
          if (index >= length) {
            return { done: true, value: undefined };
          }
          const value = getQuickJsPropertyValue(handle, String(index));
          index += 1;
          return { done: false, value };
        },
      };
      iterator[Symbol.iterator] = () => iterator;
      return iterator;
    };
  }

  function createObjectProxy(valuePtr) {
    const handle = retainQuickJsValueHandle(valuePtr);
    const target = {};
    const handler = createObjectProxyHandler(handle);
    const proxy = new Proxy(target, handler);
    rememberProxy(proxy, handle);
    return proxy;
  }

  function createFunctionProxy(valuePtr) {
    const handle = retainQuickJsValueHandle(valuePtr);
    const target = function quickJsFunctionProxy() {};
    const objectHandler = createObjectProxyHandler(handle);
    const handler = {
      apply(_target, thisArg, argList) {
        return callQuickJsFunction(handle.ptr, thisArg, argList);
      },
      get: objectHandler.get,
      set: objectHandler.set,
      has: objectHandler.has,
      deleteProperty: objectHandler.deleteProperty,
      ownKeys: objectHandler.ownKeys,
      getOwnPropertyDescriptor: objectHandler.getOwnPropertyDescriptor,
    };
    const proxy = new Proxy(target, handler);
    rememberProxy(proxy, handle);
    return proxy;
  }

  function createObjectProxyHandler(handle) {
    return {
      get(_target, prop, receiver) {
        if (prop === Symbol.toStringTag) {
          return "QuickJsObject";
        }
        if (prop === Symbol.toPrimitive) {
          return () => "[object QuickJsObject]";
        }
        if (HAS_ITERATOR_SYMBOL && prop === Symbol.iterator) {
          return createArrayIteratorFactory(handle);
        }
        const key = normalizePropertyKey(prop);
        if (key === null) {
          return Reflect.get(_target, prop, receiver);
        }
        return getQuickJsPropertyValue(handle, key);
      },
      set(_target, prop, value) {
        const key = normalizePropertyKey(prop);
        if (key === null) {
          throw new TypeError("QuickJS proxies only support string or number property keys");
        }
        const keyPtr = allocJsString(key);
        const valuePtr = toQuickJsValue(value);
        try {
          ffi.QTS_SetProp(contextPtr, handle.ptr, keyPtr, valuePtr);
        } finally {
          ffi.QTS_FreeValuePointer(contextPtr, keyPtr);
          ffi.QTS_FreeValuePointer(contextPtr, valuePtr);
        }
        return true;
      },
      has(_target, prop) {
        const key = normalizePropertyKey(prop);
        if (key === null) {
          return false;
        }
        const keyPtr = allocJsString(key);
        try {
          const valuePtr = ffi.QTS_GetProp(contextPtr, handle.ptr, keyPtr);
          const result = handleQuickJsResult(valuePtr, `has property "${key}"`);
          return result !== undefined;
        } catch {
          return false;
        } finally {
          ffi.QTS_FreeValuePointer(contextPtr, keyPtr);
        }
      },
      deleteProperty() {
        return false;
      },
      ownKeys() {
        return collectQuickJsOwnKeys(handle);
      },
      getOwnPropertyDescriptor(_target, prop) {
        const key = normalizePropertyKey(prop);
        if (key === null) {
          return undefined;
        }
        const value = getQuickJsPropertyValue(handle, key);
        if (value === undefined) {
          return undefined;
        }
        return {
          configurable: true,
          enumerable: true,
          value,
          writable: true,
        };
      },
      defineProperty(_target, prop, descriptor) {
        const key = normalizePropertyKey(prop);
        if (key === null) {
          throw new TypeError("QuickJS proxies only support string or number property keys");
        }
        return defineQuickJsProperty(handle, key, descriptor);
      },
    };
  }

  function callQuickJsFunction(functionPtr, thisArg, argValues) {
    const argHandles = [];
    let argsBuffer = 0;
    let thisPtr = null;
    try {
      thisPtr = toQuickJsThis(thisArg);
      for (const value of argValues) {
        argHandles.push(toQuickJsValue(value));
      }
      argsBuffer = allocArgsPointer(argHandles);
      const resultPtr = ffi.QTS_Call(
        contextPtr,
        functionPtr,
        thisPtr ?? ffi.QTS_GetUndefined(),
        argHandles.length,
        argsBuffer
      );
      return handleQuickJsResult(resultPtr, "function call");
    } finally {
      if (argsBuffer) {
        module._free(argsBuffer);
      }
      argHandles.forEach((handlePtr) => ffi.QTS_FreeValuePointer(contextPtr, handlePtr));
      if (thisPtr) {
        ffi.QTS_FreeValuePointer(contextPtr, thisPtr);
      }
    }
  }

  function toQuickJsThis(thisArg) {
    if (thisArg === undefined) {
      return ffi.QTS_DupValuePointer(contextPtr, ffi.QTS_GetUndefined());
    }
    if (thisArg === null) {
      return ffi.QTS_DupValuePointer(contextPtr, ffi.QTS_GetNull());
    }
    if (typeof thisArg === "object" || typeof thisArg === "function") {
      const existingPtr = duplicateProxyPointer(thisArg);
      if (existingPtr) {
        return existingPtr;
      }
    }
    return toQuickJsValue(thisArg);
  }

  function getQuickJsType(valuePtr) {
    const typePtr = ffi.QTS_Typeof(contextPtr, valuePtr);
    const jsType = module.UTF8ToString(typePtr);
    ffi.QTS_FreeCString(contextPtr, typePtr);
    return jsType;
  }

  function isStrictlyEqual(valuePtr, otherPtr) {
    return ffi.QTS_IsEqual(contextPtr, valuePtr, otherPtr, IsEqualOp.IsStrictlyEqual) === 1;
  }

  function fromQuickJsValue(valuePtr) {
    const jsType = getQuickJsType(valuePtr);
    if (jsType === "undefined") {
      return undefined;
    }
    if (jsType === "boolean") {
      return isStrictlyEqual(valuePtr, ffi.QTS_GetTrue());
    }
    if (jsType === "number") {
      return ffi.QTS_GetFloat64(contextPtr, valuePtr);
    }
    if (jsType === "string") {
      const cStringPtr = ffi.QTS_GetString(contextPtr, valuePtr);
      const text = module.UTF8ToString(cStringPtr);
      ffi.QTS_FreeCString(contextPtr, cStringPtr);
      return text;
    }
    if (jsType === "object") {
      if (isStrictlyEqual(valuePtr, ffi.QTS_GetNull())) {
        return null;
      }
      return createObjectProxy(valuePtr);
    }
    if (jsType === "function") {
      return createFunctionProxy(valuePtr);
    }
    throw new Error(`Unsupported QuickJS value type: ${jsType}`);
  }

  function resolveException(valuePtr) {
    const exceptionPtr = ffi.QTS_ResolveException(contextPtr, valuePtr);
    if (!exceptionPtr) {
      return null;
    }
    const message = dumpQuickJsValue(exceptionPtr);
    ffi.QTS_FreeValuePointer(contextPtr, exceptionPtr);
    return message;
  }

  function dumpQuickJsValue(valuePtr) {
    const cStringPtr = ffi.QTS_Dump(contextPtr, valuePtr);
    const message = module.UTF8ToString(cStringPtr);
    ffi.QTS_FreeCString(contextPtr, cStringPtr);
    return message;
  }

  function toQuickJsValue(value) {
    if (value === undefined) {
      return ffi.QTS_DupValuePointer(contextPtr, ffi.QTS_GetUndefined());
    }
    if (value === null) {
      return ffi.QTS_DupValuePointer(contextPtr, ffi.QTS_GetNull());
    }
    const valueType = typeof value;
    if (valueType === "boolean") {
      return ffi.QTS_DupValuePointer(contextPtr, value ? ffi.QTS_GetTrue() : ffi.QTS_GetFalse());
    }
    if (valueType === "number") {
      return ffi.QTS_NewFloat64(contextPtr, value);
    }
    if (valueType === "string") {
      return allocJsString(value);
    }
    if (valueType === "function") {
      const proxyPtr = duplicateProxyPointer(value);
      if (proxyPtr) {
        return proxyPtr;
      }
      throw new Error("Passing host functions into QuickJS is not supported");
    }
    if (Array.isArray(value)) {
      const arrayPtr = ffi.QTS_NewArray(contextPtr);
      value.forEach((entry, index) => {
        const entryPtr = toQuickJsValue(entry);
        const keyPtr = allocJsString(String(index));
        ffi.QTS_SetProp(contextPtr, arrayPtr, keyPtr, entryPtr);
        ffi.QTS_FreeValuePointer(contextPtr, keyPtr);
        ffi.QTS_FreeValuePointer(contextPtr, entryPtr);
      });
      return arrayPtr;
    }
    if (valueType === "object") {
      const proxyPtr = duplicateProxyPointer(value);
      if (proxyPtr) {
        return proxyPtr;
      }
      const objectPtr = ffi.QTS_NewObject(contextPtr);
      Object.keys(value).forEach((key) => {
        const propertyPtr = toQuickJsValue(value[key]);
        const keyPtr = allocJsString(key);
        ffi.QTS_SetProp(contextPtr, objectPtr, keyPtr, propertyPtr);
        ffi.QTS_FreeValuePointer(contextPtr, keyPtr);
        ffi.QTS_FreeValuePointer(contextPtr, propertyPtr);
      });
      return objectPtr;
    }
    throw new Error(`Unsupported argument type: ${valueType}`);
  }

  function handleQuickJsResult(resultPtr, label) {
    const exception = resolveException(resultPtr);
    try {
      if (exception) {
        throw new Error(exception);
      }
      return fromQuickJsValue(resultPtr);
    } catch (error) {
      if (exception) {
        throw error;
      }
      throw new Error(`${label}: ${String(error?.message ?? error)}`);
    } finally {
      ffi.QTS_FreeValuePointer(contextPtr, resultPtr);
    }
  }

  module._qjs_init_runtime = function initRuntime() {
    ensureFFI();
    ensureMetadata();
    runtimePtr = readMetadata(METADATA_INDEX.runtimePtr);
    contextPtr = readMetadata(METADATA_INDEX.contextPtr);
    if (runtimePtr && contextPtr) {
      return 0;
    }
    runtimePtr = ffi.QTS_NewRuntime();
    contextPtr = ffi.QTS_NewContext(runtimePtr, 0);
    updateMetadata(METADATA_INDEX.runtimePtr, runtimePtr);
    updateMetadata(METADATA_INDEX.contextPtr, contextPtr);
    resetCachedHandles();
    return 0;
  };

  module._qjs_eval_utf8 = function evalUtf8(codePtr, codeLen) {
    module._qjs_init_runtime();
    const localPtr = cloneInputBuffer(codePtr, codeLen);
    try {
      const resultPtr = ffi.QTS_Eval(
        contextPtr,
        localPtr,
        codeLen,
        "eval.js",
        DETECT_MODULE_AUTO,
        EvalFlags.JS_EVAL_TYPE_GLOBAL
      );
      return handleQuickJsResult(resultPtr, "eval");
    } finally {
      module._free(localPtr);
    }
  };

  module._qjs_call_function = function callFunction(namePtr, nameLen, argValues = []) {
    module._qjs_init_runtime();
    const functionName = decodeUtf8(namePtr, nameLen);
    const globalPtr = getGlobalObject();
    const nameHandle = allocJsString(functionName);
    const functionPtr = ffi.QTS_GetProp(contextPtr, globalPtr, nameHandle);
    ffi.QTS_FreeValuePointer(contextPtr, nameHandle);
    if (!functionPtr) {
      throw new Error(`Function "${functionName}" is not defined in QuickJS global scope`);
    }
    const argHandles = [];
    try {
      for (const value of argValues ?? []) {
        argHandles.push(toQuickJsValue(value));
      }
      const argsBuffer = allocArgsPointer(argHandles);
      try {
        const resultPtr = ffi.QTS_Call(
          contextPtr,
          functionPtr,
          globalPtr,
          argHandles.length,
          argsBuffer
        );
        return handleQuickJsResult(resultPtr, `callFunction(${functionName})`);
      } finally {
        if (argsBuffer) {
          module._free(argsBuffer);
        }
      }
    } finally {
      argHandles.forEach((handle) => ffi.QTS_FreeValuePointer(contextPtr, handle));
      ffi.QTS_FreeValuePointer(contextPtr, functionPtr);
    }
  };

  module._qjs_post_restore = function postRestore() {
    ensureFFI();
    locateMetadata();
    runtimePtr = readMetadata(METADATA_INDEX.runtimePtr);
    contextPtr = readMetadata(METADATA_INDEX.contextPtr);
    resetCachedHandles();
    return 0;
  };
}

