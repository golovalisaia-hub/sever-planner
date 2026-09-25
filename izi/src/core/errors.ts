// Public error model for IZI.
//
// Every failure that can reach a user or a client is an AppError carrying a
// stable machine code. Human-readable text lives in `src/locales/*`, never here,
// and never comes from a database driver: driver messages can contain SQL,
// parameter values (personal text) or schema details.

export const ERROR_CODES = [
  'VALIDATION',
  'UNKNOWN_FIELD',
  'FORBIDDEN_FIELD',
  'INVALID_TIMEZONE',
  'TIMEZONE_REQUIRED',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'UNDO_CONFLICT',
  'ACTION_EXPIRED',
  'UNDO_EXPIRED',
  'INVALID_STATE',
  'INVALID_REFERENCE',
  'DUPLICATE',
  'IDENTITY_TAKEN',
  'IMMUTABLE_FIELD',
  'CONTEXT_REQUIRED',
  'IDENTITY_UNVERIFIED',
  'DATABASE_ERROR',
  'INTERNAL',
] as const;

export type ErrorCode = typeof ERROR_CODES[number];

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 422,
  UNKNOWN_FIELD: 422,
  FORBIDDEN_FIELD: 422,
  INVALID_TIMEZONE: 422,
  TIMEZONE_REQUIRED: 422,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  UNDO_CONFLICT: 409,
  ACTION_EXPIRED: 410,
  UNDO_EXPIRED: 410,
  INVALID_STATE: 409,
  INVALID_REFERENCE: 422,
  DUPLICATE: 409,
  IDENTITY_TAKEN: 409,
  IMMUTABLE_FIELD: 422,
  CONTEXT_REQUIRED: 500,
  IDENTITY_UNVERIFIED: 401,
  DATABASE_ERROR: 503,
  INTERNAL: 500,
};

/** Diagnostic data that is safe to log: codes and schema names only, never values. */
export type SafeDiagnostic = { sqlstate?: string; constraint?: string };

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Schema field name (e.g. "plan_time"), never a user value. */
  readonly field: string | null;
  readonly diagnostic: SafeDiagnostic;

  constructor(code: ErrorCode, options: { field?: string | null; diagnostic?: SafeDiagnostic } = {}) {
    super(code);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.field = options.field ?? null;
    this.diagnostic = options.diagnostic ?? {};
  }
}

export function fail(code: ErrorCode, field?: string | null): never {
  throw new AppError(code, { field: field ?? null });
}

export const isAppError = (value: unknown): value is AppError => value instanceof AppError;

/** What a client may see. Deliberately excludes the diagnostic. */
export function publicError(error: unknown): { code: ErrorCode; status: number; field: string | null } {
  if (error instanceof AppError) return { code: error.code, status: error.status, field: error.field };
  return { code: 'INTERNAL', status: 500, field: null };
}

// Codes raised by IZI's own SQL functions: SQLSTATE class "IZ", message = code.
const IZI_SQLSTATE: Record<string, readonly ErrorCode[]> = {
  IZ404: ['NOT_FOUND'],
  IZ409: ['VERSION_CONFLICT', 'UNDO_CONFLICT', 'IDENTITY_TAKEN'],
  IZ410: ['ACTION_EXPIRED', 'UNDO_EXPIRED'],
  IZ422: ['VALIDATION', 'UNKNOWN_FIELD', 'FORBIDDEN_FIELD', 'INVALID_TIMEZONE', 'TIMEZONE_REQUIRED', 'IMMUTABLE_FIELD'],
  IZ423: ['INVALID_STATE'],
};

const POSTGRES_VALIDATION_STATES = new Set([
  '22001', // string_data_right_truncation
  '22003', // numeric_value_out_of_range
  '22007', // invalid_datetime_format
  '22008', // datetime_field_overflow
  '22023', // invalid_parameter_value
  '22P02', // invalid_text_representation
  '23502', // not_null_violation
  '23514', // check_violation
]);

const safeName = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[a-z0-9_]{1,63}$/.test(value) ? value : undefined;

/**
 * Converts any database driver error into an AppError without copying the
 * driver's message, detail, query or parameters.
 */
export function fromDbError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const raw = (error && typeof error === 'object') ? error as Record<string, unknown> : {};
  const sqlstate = typeof raw.code === 'string' && /^[0-9A-Z]{5}$/.test(raw.code) ? raw.code : undefined;
  const diagnostic: SafeDiagnostic = {};
  if (sqlstate) diagnostic.sqlstate = sqlstate;
  const constraint = safeName(raw.constraint);
  if (constraint) diagnostic.constraint = constraint;

  if (sqlstate && IZI_SQLSTATE[sqlstate]) {
    const allowed = IZI_SQLSTATE[sqlstate]!;
    const message = typeof raw.message === 'string' ? raw.message : '';
    const code = (allowed as readonly string[]).includes(message) ? message as ErrorCode : allowed[0]!;
    return new AppError(code, { diagnostic });
  }
  if (sqlstate === '23505') return new AppError('DUPLICATE', { diagnostic });
  if (sqlstate === '23503') return new AppError('INVALID_REFERENCE', { diagnostic });
  if (sqlstate && POSTGRES_VALIDATION_STATES.has(sqlstate)) return new AppError('VALIDATION', { diagnostic });
  return new AppError('DATABASE_ERROR', { diagnostic });
}
