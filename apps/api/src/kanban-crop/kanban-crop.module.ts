import { Module } from '@nestjs/common';
import { KanbanCropController } from './kanban-crop.controller';
import { KanbanCropService } from './kanban-crop.service';

@Module({ controllers: [KanbanCropController], providers: [KanbanCropService] })
export class KanbanCropModule {}
