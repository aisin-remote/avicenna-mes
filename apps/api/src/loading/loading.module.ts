import { Module } from '@nestjs/common';
import { LoadingService } from './loading.service';
import { LoadingController } from './loading.controller';
import { DeliveryDocumentsController } from './delivery-documents.controller';
import { DeliveryDocumentsService } from './delivery-documents.service';
import { DriverAttendanceController } from './driver-attendance.controller';
import { DriverAttendanceService } from './driver-attendance.service';
import { FotoService } from '../master/foto.service';

@Module({
  controllers: [LoadingController, DeliveryDocumentsController, DriverAttendanceController],
  providers: [LoadingService, DeliveryDocumentsService, DriverAttendanceService, FotoService],
  exports: [LoadingService],
})
export class LoadingModule {}
