import { Module } from '@nestjs/common';
import { MailingService } from './mailing.service';
import { MailingController } from './mailing.controller';
import { PrismaModule } from 'libs/prisma/prisma.module';
import { TelegramModule } from 'src/telegram/telegram.module';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';

@Module({
  imports: [PrismaModule, TelegramModule, WhatsappModule],
  providers: [MailingService],
  controllers: [MailingController],
  exports: [MailingService],  
})
export class MailingModule {}
