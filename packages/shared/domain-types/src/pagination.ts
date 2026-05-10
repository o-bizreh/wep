export interface PaginatedRequest {
  limit: number;
  cursor?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor?: string;
  totalCount?: number;
}
