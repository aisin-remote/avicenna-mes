import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { ZodSchema, ZodError } from 'zod';

/**
 * Memvalidasi body/query memakai schema Zod dari @avicenna/contracts.
 *
 * Schema yang sama dipakai frontend, jadi aturan validasi hanya ditulis
 * sekali dan tidak bisa melenceng antara web dan API.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    try {
      return this.schema.parse(value);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'ValidationError',
          message: 'Data yang dikirim tidak valid',
          details: err.issues.map((i) => ({
            field: i.path.join('.'),
            message: i.message,
          })),
        });
      }
      throw err;
    }
  }
}
