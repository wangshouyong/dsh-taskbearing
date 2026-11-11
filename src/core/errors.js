/**
 * 统一错误类型与错误码。
 * 设计契约：docs/schema-v2.md §5.1 错误码表。
 */

export class CompassError extends Error {
  /**
   * @param {string} code 错误码（E_*）
   * @param {string} message 一句中文：怎么了、怎么改
   * @param {unknown} [details] 结构化细节（如缺失 id 列表）
   */
  constructor(code, message, details) {
    super(message);
    this.name = "CompassError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  toJSON() {
    const out = { code: this.code, message: this.message };
    if (this.details !== undefined) out.details = this.details;
    return out;
  }
}

export const CODES = Object.freeze({
  INVALID_ARG: "E_INVALID_ARG",
  NOT_INITIALIZED: "E_NOT_INITIALIZED",
  WORKSPACE_MISMATCH: "E_WORKSPACE_MISMATCH",
  PARENT_REQUIRED: "E_PARENT_REQUIRED",
  PARENT_NOT_FOUND: "E_PARENT_NOT_FOUND",
  TASK_NOT_FOUND: "E_TASK_NOT_FOUND",
  POINTER_NOTE_REQUIRED: "E_POINTER_NOTE_REQUIRED",
  INVALID_TRANSITION: "E_INVALID_TRANSITION",
  SUBTREE_INCOMPLETE: "E_SUBTREE_INCOMPLETE",
  DEAD_REASON_REQUIRED: "E_DEAD_REASON_REQUIRED",
  SELF_MERGE: "E_SELF_MERGE",
  REQUIREMENT_NOT_FOUND: "E_REQUIREMENT_NOT_FOUND",
  PATH_INVALID: "E_PATH_INVALID",
  SCHEMA_VERSION: "E_SCHEMA_VERSION",
  STORE_CORRUPT: "E_STORE_CORRUPT",
  WRITE_FAILED: "E_WRITE_FAILED",
  BUSY: "E_BUSY",
  ORIGINAL_UNRESOLVED: "E_ORIGINAL_UNRESOLVED",
  ORIGINAL_MISMATCH: "E_ORIGINAL_MISMATCH",
  DETAIL_PATH_NOT_FOUND: "E_DETAIL_PATH_NOT_FOUND",
  DETAIL_REQUIRED: "E_DETAIL_REQUIRED",
  BATCH_DETAIL_REQUIRED: "E_BATCH_DETAIL_REQUIRED",
  DETAIL_CONTENT_INVALID: "E_DETAIL_CONTENT_INVALID",
  REQUIREMENT_DETAIL_REQUIRED: "E_REQUIREMENT_DETAIL_REQUIRED",
  ANCESTOR_DETAIL_REQUIRED: "E_ANCESTOR_DETAIL_REQUIRED",
  HISTORY_NOT_FOUND: "E_HISTORY_NOT_FOUND",
  HISTORY_REF_INVALID: "E_HISTORY_REF_INVALID",
  IMPORT_LIMIT: "E_IMPORT_LIMIT",
  IMPORT_ITEM_INVALID: "E_IMPORT_ITEM_INVALID",
  SIBLING_NOT_FOUND: "E_SIBLING_NOT_FOUND",
  POSITION_CONFLICT: "E_POSITION_CONFLICT",
  LOCK_BUSY: "E_LOCK_BUSY",
  CONFLICT: "E_CONFLICT",
  MIGRATE_SOURCE: "E_MIGRATE_SOURCE",
  MIGRATE_REF: "E_MIGRATE_REF",
  MIGRATE_ITEM_INVALID: "E_MIGRATE_ITEM_INVALID",
  MIGRATE_ARCHIVE: "E_MIGRATE_ARCHIVE"
});

/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [details]
 * @returns {never}
 */
export function fail(code, message, details) {
  throw new CompassError(code, message, details);
}

/** @param {unknown} err */
export function toCompassError(err) {
  if (err instanceof CompassError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new CompassError(CODES.INVALID_ARG, message);
}
