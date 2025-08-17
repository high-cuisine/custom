import { Injectable } from '@nestjs/common';
import { Context, Markup } from 'telegraf';
import { PrismaService } from 'libs/prisma/Prisma.service';
import { RedisService } from 'libs/redis/redis.service';
import { SceneContext } from 'telegraf/typings/scenes';
import { ExelService } from 'src/Exel-Module/exelModule.service';
import axios from 'axios';
import { UsersService } from 'src/users/users.service';
import { MailingService } from 'src/mailing/mailing.service';

@Injectable()
export class BotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly exelService: ExelService,
    private readonly userService: UsersService,
    private readonly mailingService: MailingService,
  ) {}

  async startBot(ctx: Context) {
    const id = ctx.from?.id;

    if (!id) {
      await ctx.reply('You are not registered');
      return;
    }

    const user = await this.getUser(id.toString());

    if (!user) {
      await ctx.reply('You are not registered');
      return;
    }

    await this.sendMenu(ctx);
  }

  private async getUser(id: string) {
    const userCache = await this.redisService.get(`user:${id}`);

    if (userCache) {
      return JSON.parse(userCache);
    }

    return await this.prisma.users.findFirst({
      where: {
        telegramId: id,
      },
    });
  }

  private async sendMenu(ctx: Context) {
    const user = await this.getUser(ctx.from?.id.toString() || '');

    if (!user) {
      await ctx.reply('You are not registered');
      return;
    }

    const menu = [
      [
        {text: 'Загрузить лидов', callback_data: 'upload_leads'},
        {text: 'Получить exel', callback_data: 'get_exel'},
        
      ],
      [
        { text: 'Создать бот whatsapp', callback_data: 'create_bot_whatsapp' }
      ],
      [
        { text: 'Создать бот telegram', callback_data: 'create_bot_telegram' }
      ],
      
    ];

    await ctx.reply('Menu', Markup.inlineKeyboard(menu));
  }

  async createWhatsappBot(ctx: Context & SceneContext) {
    const user = await this.getUser(ctx.from?.id.toString() || '');

    if (!user) {
      await ctx.reply('You are not registered');
      return;
    }

    try {
      await ctx.scene.enter('whatsapp_create_bot');
    } catch (error) {
      console.error('Error entering scene:', error);
      await ctx.reply('Ошибка при создании WhatsApp бота. Попробуйте позже.');
    }
  }

  async createTelegramBot(ctx: Context & SceneContext) {
    const user = await this.getUser(ctx.from?.id.toString() || '');

    if (!user) {
      await ctx.reply('You are not registered');
      return;
    }

    try {
      await ctx.scene.enter('telegram_login');
    } catch (error) {
      console.error('Error entering scene:', error);
      await ctx.reply('Ошибка при создании Telegram бота. Попробуйте позже.');
    }
  }

  async getExelData(ctx: Context) {
    const user = await this.getUser(ctx.from?.id.toString() || '');

    if (!user) {
      await ctx.reply('You are not registered');
      return;
    }

    const clients = await this.prisma.clients.findMany();

    const buffer = await this.exelService.exportToExcelBuffer(clients);

    if(!buffer) {
      await ctx.reply('Ошибка при получении данных');
      return;
    }

    await ctx.replyWithDocument({
      source: buffer as any,
      filename: 'clients.xlsx',
    });

    await ctx.reply('Данные успешно получены');
  }

  async uploadLeads(ctx: Context) {
    const user = await this.getUser(ctx.from?.id.toString() || '');

        if (!user) {
        await ctx.reply('You are not registered');
        return;
        }
    
        const message = ctx.message as any;

        if (!message) {
            await ctx.reply('Пожалуйста, отправьте Excel файл.');
            return;
        }
      
        const document = message.document;
        const fileId = document.file_id;
        const fileLink = await ctx.telegram.getFileLink(fileId);
      
        const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
        const fileBuffer = Buffer.from(response.data);
      
        const clients = await this.exelService.readExcel(fileBuffer, ctx.from?.id || 0);

        await this.userService.saveClients(clients, ctx.from?.id || 0, true);

        const texts = await this.prisma.texts.findMany();


        if(texts.length > 0) {
            this.mailingService.startMessageTelegram(clients, texts.map(text => text.content));
            this.mailingService.startMessageWhatsapp(texts.map(t => t.content), clients);
        } else {
            await ctx.reply('Загрузите текста чтобы начать автоматическую рассылку');
        }

    
      
        await ctx.reply('Excel файл успешно обработан!');
    }

    async uploadLeadsTxt(ctx: Context) {
        const user = await this.getUser(ctx.from?.id.toString() || '');

        if (!user) {
            await ctx.reply('You are not registered');
            return;
        }

        const message = ctx.message as any;

        if (!message) {
            await ctx.reply('Пожалуйста, отправьте txt файл.');
            return;
        }
        
        const document = message.document;
        const fileId = document.file_id;
        const fileLink = await ctx.telegram.getFileLink(fileId);
      
        const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
        const fileBuffer = Buffer.from(response.data);
      
        const text = fileBuffer.toString();

        const texts = text.split('\n');

        const filteredTexts = texts.filter(text => text.trim() !== '');

        await this.prisma.texts.createMany({
            data: filteredTexts.map(text => ({
                content: text,
            })),
        });

        console.log(text);

        await ctx.reply('Текст успешно загружен');
    }
}
