// ─────────────────────────────────────────────────────────────────────────────
// Structured server-side logger.
// Emits one JSON object per line (timestamp + level + message + context) so logs
// are machine-parseable in production (Vercel, Datadog, etc.) instead of free
// text. Server-only — never import into a Client Component.
// ─────────────────────────────────────────────────────────────────────────────

type LogLevel = 'error' | 'warn' | 'info';

/** Arbitrary structured context. Keep values JSON-serializable. */
export interface LogContext {
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, context: LogContext = {}): void {
  const line = JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  error: (message: string, context?: LogContext) => emit('error', message, context),
  warn: (message: string, context?: LogContext) => emit('warn', message, context),
  info: (message: string, context?: LogContext) => emit('info', message, context),
};
