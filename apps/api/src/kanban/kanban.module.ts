import { Module } from '@nestjs/common';
import { KanbanController } from './kanban.controller';
import { KanbanCetakService } from './kanban-cetak.service';

@Module({
  controllers: [KanbanController],
  providers: [KanbanCetakService],
  exports: [KanbanCetakService],
})
export class KanbanModule {}
