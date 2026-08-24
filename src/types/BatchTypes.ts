export interface BatchRequestItem {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
}

export interface BatchResponseItem {
  status: number;
  body: unknown;
}
