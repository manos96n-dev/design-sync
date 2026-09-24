export class DesignSyncError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "DesignSyncError";
  }
}
export function errorInfo(error: unknown) {
  if (error instanceof DesignSyncError)
    return { code: error.code, message: error.message, details: error.details };
  return {
    code: "TOOL_FAILURE",
    message: error instanceof Error ? error.message : String(error),
    details: {},
  };
}
