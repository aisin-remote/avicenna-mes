import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3000').split(','),
    credentials: true,
  });

  // SIGTERM dari Docker/systemd harus menutup koneksi DB, Redis, MQTT dengan
  // rapi. Tanpa ini, deploy ulang bisa memutus scan yang sedang diproses.
  app.enableShutdownHooks();

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port, '0.0.0.0');

  logger.log(`API siap di http://0.0.0.0:${port}`);
  logger.log(`SSE  : GET /realtime/line:DC-01`);
  logger.log(`Health: GET /health/ready`);
}

void bootstrap();
