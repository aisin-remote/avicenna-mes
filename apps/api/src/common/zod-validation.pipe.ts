import { PipeTransform, Injectable } from '@nestjs/common';
import { ZodSchema, ZodError } from 'zod';
import { validationError } from './validation-error';

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
      // Bentuknya ditulis sekali di validation-error.ts — sisi web membaca
      // `details` untuk menempatkan pesan di bawah kolomnya masing-masing.
      if (err instanceof ZodError) throw validationError(err);
      throw err;
    }
  }
}
