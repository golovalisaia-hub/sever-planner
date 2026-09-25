// Contract every record module fulfils. The SQL side mirrors the writable
// field list in izi.entity_writable_columns(); a test keeps both in sync.

export const ENTITY_TYPES = ['task', 'event', 'note', 'inbox_item'] as const;
export type EntityType = typeof ENTITY_TYPES[number];

export const RECORD_CHANNELS = ['telegram', 'miniapp', 'quick_capture', 'import', 'system'] as const;
export type RecordChannel = typeof RECORD_CHANNELS[number];

export type FieldSpec =
  | { type: 'text'; max: number; nullable: boolean; multiline?: boolean }
  | { type: 'enum'; values: readonly string[]; nullable: boolean }
  | { type: 'date'; nullable: boolean }
  | { type: 'time'; nullable: boolean }
  | { type: 'int'; min: number; max: number; nullable: boolean }
  | { type: 'timezone'; nullable: boolean }
  | { type: 'textArray'; maxItems: number; maxLength: number };

export type EntityModule = {
  readonly entity: EntityType;
  /** Table inside the izi schema; a closed set, never user input. */
  readonly table: string;
  /** Fields a confirmed operation may set. Everything else is server-owned. */
  readonly writable: Readonly<Record<string, FieldSpec>>;
  readonly requiredOnCreate: readonly string[];
  /** Columns returned by read methods (no account_id, no search vectors). */
  readonly readColumns: readonly string[];
};

export const COMMON_READ_COLUMNS = ['id', 'source', 'capture_id', 'version', 'created_at', 'updated_at'] as const;
