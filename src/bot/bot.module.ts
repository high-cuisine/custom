import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';
import { TelegramModule } from 'src/telegram/telegram.module';
import { RedisModule } from 'libs/redis/redis.module';
import { PrismaModule } from 'libs/prisma/prisma.module';
import { BotUpdate } from './bot.update';
import { WhatsappCreateBotScene } from './scene/whatsapp-create-bot.scene';
import { TelegramCreateBotScene } from './scene/telegram-create-bot.scene';
import { TelegrafModule } from 'nestjs-telegraf';
import * as LocalSession from 'telegraf-session-local';
import { ExelModule } from 'src/Exel-Module/exelModule.module';
import { UsersModule } from 'src/users/users.module';
import { MailingModule } from 'src/mailing/mailing.module';

const session = new LocalSession();

@Module({
  imports: [
    TelegrafModule.forRoot({
      token: process.env.BOT_TOKEN || '',
      include: [],
      middlewares: [session.middleware()],
    }),
    TelegramModule,
    WhatsappModule,
    PrismaModule,
    RedisModule,
    ExelModule,
    UsersModule,
    MailingModule,
  ],
  providers: [
    BotService, 
    BotUpdate, 
    WhatsappCreateBotScene, 
    TelegramCreateBotScene
  ],
  exports: [WhatsappCreateBotScene, TelegramCreateBotScene],
})
export class BotModule {}
