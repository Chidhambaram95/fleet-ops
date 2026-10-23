export type HistoryAction = "insert" | "update" | "delete";

/** One saved change to a money record. */
export type HistoryRow = {
  id: number;
  table: string;
  rowId: string | null;
  action: HistoryAction;
  busId: string | null;
  module: string | null;
  changedBy: string | null;
  /** Empty when the name is not known (for example, Fleet Ops support). */
  changedByName: string;
  changedAt: string;
  /** The comment given when a closed day was opened. */
  reason: string;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
};
