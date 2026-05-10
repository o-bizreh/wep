import type { Request, Response, NextFunction } from 'express';
import { problemDetails } from '@wep/domain-types';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error('Unhandled error:', err.message, err.stack);

  res.status(500).json(
    problemDetails(500, 'Internal Server Error', 'An unexpected error occurred'),
  );
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json(
    problemDetails(404, 'Not Found', 'The requested resource was not found'),
  );
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
