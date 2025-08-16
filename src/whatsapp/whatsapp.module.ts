import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { PrismaModule } from 'libs/prisma/prisma.module';

@Module({
  providers: [WhatsappService],
  exports: [WhatsappService],
  imports: [PrismaModule],
})
export class WhatsappModule {}
