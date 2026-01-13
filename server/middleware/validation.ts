/**
 * Validation Middleware Layer
 * 
 * Provides consistent request validation with standardized error responses.
 * Pattern: Fail-fast validation with clear error messages.
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { z, ZodSchema, ZodError } from 'zod';

/**
 * Standard API error response format
 */
export interface ApiErrorResponse {
  error: string;
  code: string;
  details?: Record<string, string[]>;
  correlationId?: string;
}

/**
 * Format Zod validation errors into a consistent structure
 */
function formatZodErrors(error: ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  
  for (const issue of error.issues) {
    const path = issue.path.join('.') || 'root';
    if (!errors[path]) {
      errors[path] = [];
    }
    errors[path].push(issue.message);
  }
  
  return errors;
}

/**
 * Create validation middleware for request body
 */
export function validateBody<T>(schema: ZodSchema<T>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    
    if (!result.success) {
      const response: ApiErrorResponse = {
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: formatZodErrors(result.error),
        correlationId: req.correlationId,
      };
      return res.status(400).json(response);
    }
    
    // Attach validated data to request for downstream use
    (req as any).validatedBody = result.data;
    next();
  };
}

/**
 * Create validation middleware for query parameters
 */
export function validateQuery<T>(schema: ZodSchema<T>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    
    if (!result.success) {
      const response: ApiErrorResponse = {
        error: 'Invalid query parameters',
        code: 'INVALID_QUERY',
        details: formatZodErrors(result.error),
        correlationId: req.correlationId,
      };
      return res.status(400).json(response);
    }
    
    (req as any).validatedQuery = result.data;
    next();
  };
}

/**
 * Create validation middleware for URL parameters
 */
export function validateParams<T>(schema: ZodSchema<T>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    
    if (!result.success) {
      const response: ApiErrorResponse = {
        error: 'Invalid URL parameters',
        code: 'INVALID_PARAMS',
        details: formatZodErrors(result.error),
        correlationId: req.correlationId,
      };
      return res.status(400).json(response);
    }
    
    (req as any).validatedParams = result.data;
    next();
  };
}

/**
 * Common validation schemas
 */
export const commonSchemas = {
  uuid: z.string().uuid('Invalid UUID format'),
  
  paginationQuery: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
  
  dateRangeQuery: z.object({
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
  }),
  
  botIdParam: z.object({
    id: z.string().uuid('Invalid bot ID'),
  }),
  
  userIdQuery: z.object({
    user_id: z.string().uuid('Invalid user ID').optional(),
  }),
};

/**
 * Async handler wrapper to catch errors and pass to error middleware
 */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Standard success response helper
 */
export function successResponse<T>(res: Response, data: T, statusCode: number = 200): void {
  res.status(statusCode).json({
    success: true,
    data,
  });
}

/**
 * Standard error response helper
 */
export function errorResponse(
  res: Response, 
  message: string, 
  code: string, 
  statusCode: number = 400,
  details?: Record<string, string[]>
): void {
  const response: ApiErrorResponse = {
    error: message,
    code,
    details,
  };
  res.status(statusCode).json(response);
}
