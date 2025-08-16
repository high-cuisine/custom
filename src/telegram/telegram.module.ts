import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { PrismaModule } from 'libs/prisma/prisma.module';
import { ExelModule } from 'src/Exel-Module/exelModule.module';

@Module({
  providers: [TelegramService],
  exports: [TelegramService],
  imports: [PrismaModule, ExelModule],
})
export class TelegramModule {}
