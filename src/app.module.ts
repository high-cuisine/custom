import { Module } from '@nestjs/common';
import { TelegramModule } from './telegram/telegram.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { MailingModule } from './mailing/mailing.module';
import { BotModule } from './bot/bot.module';
import { TelegrafModule } from 'nestjs-telegraf';
import { UsersModule } from './users/users.module';

@Module({
  imports: [

    TelegramModule, 
    WhatsappModule, 
    MailingModule, 
    BotModule, UsersModule
  ],
})
export class AppModule {}
