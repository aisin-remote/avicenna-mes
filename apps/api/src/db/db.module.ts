import { Global, Module, Inject } from '@nestjs/common';
import { getDb, closeDb, type Database } from '@avicenna/db';

export const DB = Symbol('DB');

/** Menyediakan koneksi Drizzle ke seluruh aplikasi lewat DI. */
@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: (): Database => getDb(),
    },
  ],
  exports: [DB],
})
export class DbModule {
  async onModuleDestroy(): Promise<void> {
    await closeDb();
  }
}

/** Dekorator singkat: `constructor(@InjectDb() private db: Database) {}` */
export const InjectDb = () => Inject(DB);
