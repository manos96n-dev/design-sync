import { SCHEMA_VERSION, TOOL_VERSION } from "../core/types.js";
import { errorInfo } from "../core/errors.js";
export function successEnvelope(command: string, result: unknown) {
  return {
    schemaVersion: SCHEMA_VERSION,
    toolVersion: TOOL_VERSION,
    command,
    ok: true,
    result,
  };
}
export function errorEnvelope(command: string, error: unknown) {
  return {
    schemaVersion: SCHEMA_VERSION,
    toolVersion: TOOL_VERSION,
    command,
    ok: false,
    error: errorInfo(error),
  };
}
