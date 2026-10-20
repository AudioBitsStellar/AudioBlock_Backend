export type BatchOperation = 'bulkGenreUpdate';

export interface BatchRequestItem {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path?: string;
  body?: unknown;
  /** Native batch operation (artist catalog bulk actions). When set, `method`/
   *  `path` are omitted and the controller handles the operation natively. */
  operation?: BatchOperation;
  songIds?: string[];
  genre?: string;
}

export interface BatchResponseItem {
  status: number;
  body: unknown;
}
