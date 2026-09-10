import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/** Menyeragamkan bentuk error yang keluar dari API. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      res.status(status).json(
        typeof body === 'object'
          ? body
          : { statusCode: status, error: exception.name, message: String(body) },
      );
      return;
    }

    // Error tak terduga: catat lengkap di log, tapi jangan bocorkan ke client.
    this.logger.error(
      `${req.method} ${req.url} gagal`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      error: 'InternalServerError',
      message: 'Terjadi kesalahan pada server',
    });
  }
}
