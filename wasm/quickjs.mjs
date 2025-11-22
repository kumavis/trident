import { QuickJSFFI } from "@jitl/quickjs-wasmfile-release-sync/ffi";
import { EvalFlags } from "@jitl/quickjs-ffi-types";

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
  let lastResultPtr = 0;
  let lastResultLen = 0;
  let globalObjectPtr = 0;
  let jsonObjectPtr = 0;
  let stringifyFuncPtr = 0;

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
    jsonObjectPtr = 0;
    stringifyFuncPtr = 0;
    globalObjectPtr = 0;
  }

  function releaseCachedHandles() {
    if (!ffi || !contextPtr) {
      resetCachedHandles();
      return;
    }
    if (globalObjectPtr) {
      ffi.QTS_FreeValuePointer(contextPtr, globalObjectPtr);
    }
    if (jsonObjectPtr) {
      ffi.QTS_FreeValuePointer(contextPtr, jsonObjectPtr);
    }
    if (stringifyFuncPtr) {
      ffi.QTS_FreeValuePointer(contextPtr, stringifyFuncPtr);
    }
    resetCachedHandles();
  }

  function disposeLastResultBuffer() {
    if (!lastResultPtr) {
      return;
    }
    module._free(lastResultPtr);
    lastResultPtr = 0;
    lastResultLen = 0;
    updateMetadata(METADATA_INDEX.lastResultPtr, 0);
    updateMetadata(METADATA_INDEX.lastResultLen, 0);
  }

  function setLastResultPointer(ptr, len) {
    disposeLastResultBuffer();
    lastResultPtr = ptr >>> 0;
    lastResultLen = len >>> 0;
    updateMetadata(METADATA_INDEX.lastResultPtr, lastResultPtr);
    updateMetadata(METADATA_INDEX.lastResultLen, lastResultLen);
  }

  function storeLastResultString(value) {
    const bytes = TEXT_ENCODER.encode(value);
    const buffer = module._malloc(bytes.length);
    heapU8().set(bytes, buffer);
    setLastResultPointer(buffer, bytes.length);
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

  function getJsonObject() {
    if (!jsonObjectPtr) {
      const globalPtr = getGlobalObject();
      const keyPtr = allocJsString("JSON");
      const jsonPtr = ffi.QTS_GetProp(contextPtr, globalPtr, keyPtr);
      ffi.QTS_FreeValuePointer(contextPtr, keyPtr);
      if (!jsonPtr) {
        throw new Error("JSON global is not available inside QuickJS runtime");
      }
      jsonObjectPtr = jsonPtr;
    }
    return jsonObjectPtr;
  }

  function getJsonStringify() {
    if (!stringifyFuncPtr) {
      const jsonPtr = getJsonObject();
      const keyPtr = allocJsString("stringify");
      const fnPtr = ffi.QTS_GetProp(contextPtr, jsonPtr, keyPtr);
      ffi.QTS_FreeValuePointer(contextPtr, keyPtr);
      if (!fnPtr) {
        throw new Error("JSON.stringify not available in QuickJS runtime");
      }
      stringifyFuncPtr = fnPtr;
    }
    return stringifyFuncPtr;
  }

  function allocArgsPointer(args) {
    const ptr = module._malloc(args.length * 4);
    const view = heapU32();
    const base = ptr >> 2;
    for (let i = 0; i < args.length; i += 1) {
      view[base + i] = args[i] >>> 0;
    }
    return ptr;
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

  function stringifyQuickJsValue(valuePtr) {
    const stringifyPtr = getJsonStringify();
    const argsPtr = allocArgsPointer([valuePtr]);
    const resultPtr = ffi.QTS_Call(contextPtr, stringifyPtr, getJsonObject(), 1, argsPtr);
    module._free(argsPtr);
    const errorMessage = resolveException(resultPtr);
    if (errorMessage) {
      ffi.QTS_FreeValuePointer(contextPtr, resultPtr);
      throw new Error(errorMessage);
    }
    const resultTypePtr = ffi.QTS_Typeof(contextPtr, resultPtr);
    const resultType = module.UTF8ToString(resultTypePtr);
    ffi.QTS_FreeCString(contextPtr, resultTypePtr);
    if (resultType === "undefined") {
      ffi.QTS_FreeValuePointer(contextPtr, resultPtr);
      return "null";
    }
    const cStringPtr = ffi.QTS_GetString(contextPtr, resultPtr);
    const jsonString = module.UTF8ToString(cStringPtr);
    ffi.QTS_FreeCString(contextPtr, cStringPtr);
    ffi.QTS_FreeValuePointer(contextPtr, resultPtr);
    return jsonString;
  }

  function toQuickJsValue(value) {
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
      const jsString = allocJsString(value);
      return jsString;
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
    if (exception) {
      ffi.QTS_FreeValuePointer(contextPtr, resultPtr);
      storeLastResultString(JSON.stringify({ error: exception }));
      return 1;
    }
    try {
      const jsonString = stringifyQuickJsValue(resultPtr);
      storeLastResultString(jsonString);
      return 0;
    } catch (error) {
      storeLastResultString(JSON.stringify({ error: `${label}: ${String(error?.message ?? error)}` }));
      return 1;
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

  module._qjs_dispose_runtime = function disposeRuntime() {
    releaseCachedHandles();
    contextPtr = 0;
    runtimePtr = 0;
    updateMetadata(METADATA_INDEX.contextPtr, 0);
    updateMetadata(METADATA_INDEX.runtimePtr, 0);
    disposeLastResultBuffer();
    return 0;
  };

  module._qjs_eval_utf8 = function evalUtf8(codePtr, codeLen) {
    try {
      module._qjs_init_runtime();
      const localPtr = cloneInputBuffer(codePtr, codeLen);
      const resultPtr = ffi.QTS_Eval(
        contextPtr,
        localPtr,
        codeLen,
        "eval.js",
        DETECT_MODULE_AUTO,
        EvalFlags.JS_EVAL_TYPE_GLOBAL
      );
      module._free(localPtr);
      return handleQuickJsResult(resultPtr, "eval");
    } catch (error) {
      storeLastResultString(JSON.stringify({ error: String(error?.message ?? error) }));
      return 1;
    }
  };

  module._qjs_call_function = function callFunction(namePtr, nameLen, argsPtr, argsLen) {
    try {
      module._qjs_init_runtime();
      const functionName = decodeUtf8(namePtr, nameLen);
      const argsJson = decodeUtf8(argsPtr, argsLen);
      const parsedArgs = JSON.parse(argsJson || "[]");
      if (!Array.isArray(parsedArgs)) {
        throw new Error("callFunction expects JSON array arguments");
      }
      const globalPtr = getGlobalObject();
      const nameHandle = allocJsString(functionName);
      const functionPtr = ffi.QTS_GetProp(contextPtr, globalPtr, nameHandle);
      ffi.QTS_FreeValuePointer(contextPtr, nameHandle);
      if (!functionPtr) {
        throw new Error(`Function "${functionName}" is not defined in QuickJS global scope`);
      }
      const argHandles = parsedArgs.map((value) => toQuickJsValue(value));
      const argsBuffer = allocArgsPointer(argHandles);
      const resultPtr = ffi.QTS_Call(contextPtr, functionPtr, globalPtr, argHandles.length, argsBuffer);
      module._free(argsBuffer);
      argHandles.forEach((handle) => ffi.QTS_FreeValuePointer(contextPtr, handle));
      ffi.QTS_FreeValuePointer(contextPtr, functionPtr);
      return handleQuickJsResult(resultPtr, `callFunction(${functionName})`);
    } catch (error) {
      storeLastResultString(JSON.stringify({ error: String(error?.message ?? error) }));
      return 1;
    }
  };

  module._qjs_get_last_result_ptr = function getLastResultPtr() {
    return readMetadata(METADATA_INDEX.lastResultPtr);
  };

  module._qjs_get_last_result_len = function getLastResultLen() {
    return readMetadata(METADATA_INDEX.lastResultLen);
  };

  module._qjs_post_restore = function postRestore() {
    ensureFFI();
    locateMetadata();
    runtimePtr = readMetadata(METADATA_INDEX.runtimePtr);
    contextPtr = readMetadata(METADATA_INDEX.contextPtr);
    lastResultPtr = readMetadata(METADATA_INDEX.lastResultPtr);
    lastResultLen = readMetadata(METADATA_INDEX.lastResultLen);
    resetCachedHandles();
    return 0;
  };
}

