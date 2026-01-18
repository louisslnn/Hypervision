export function logInfo(message: string, meta: Record<string, unknown> = {}) {
  console.info(JSON.stringify({ level: "info", message, ...meta }));
}

export function logError(message: string, meta: Record<string, unknown> = {}) {
  console.error(JSON.stringify({ level: "error", message, ...meta }));
}
