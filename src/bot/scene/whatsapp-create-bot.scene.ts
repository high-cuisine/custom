import { Injectable } from '@nestjs/common';
import { Ctx, Scene, SceneEnter, Hears, On } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { SceneContext } from 'telegraf/typings/scenes';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';

interface WhatsappBotSession {
  step: 'phone_input' | 'message_input' | 'confirmation';
  phoneNumber?: string;
  message?: string;
  user?: any;
}

@Injectable()
@Scene('whatsapp_create_bot')
export class WhatsappCreateBotScene {
  constructor(private readonly whatsappService: WhatsappService) {}

  @SceneEnter()
  async onSceneEnter(@Ctx() ctx: SceneContext) {
    if (!ctx.session['whatsappBot']) {
      ctx.session['whatsappBot'] = {} as WhatsappBotSession;
    }
    
    const session = ctx.session['whatsappBot'] as WhatsappBotSession;
    session.step = 'phone_input';
    
    // Получаем данные пользователя из сцены
    if (ctx.scene.session && (ctx.scene.session as any).user) {
      session.user = (ctx.scene.session as any).user;
    }
    
    await ctx.reply(`
🤖 <b>Создание WhatsApp бота</b>

Для создания WhatsApp бота нужно:
1. Ввести номер телефона в формате +79XXXXXXXXX
2. Ввести сообщение для тестирования
3. Подтвердить создание

<b>Шаг 1: Введите номер телефона для WhatsApp:</b>`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Отменить', 'cancel_whatsapp_bot')]
      ])
    );
  }

  @On('text')
  async onText(@Ctx() ctx: SceneContext) {
    console.log('onText');

    if((ctx.message as any)?.text === '/start') {
      await ctx.reply('Выход из создания WhatsApp бота');
      await ctx.scene.leave();
      return;
    }

    const session = ctx.session['whatsappBot'] as WhatsappBotSession;
    const text = (ctx.message as any).text;

    if (
      text.toLowerCase().includes('отмена') ||
      text.toLowerCase().includes('cancel')
    ) {
      await ctx.reply('Создание WhatsApp бота отменено');
      await ctx.scene.leave();
      return;
    }

    switch (session.step) {
      case 'phone_input':
        if (text.startsWith('+7') && text.length === 12) {
          session.phoneNumber = text;
          session.step = 'message_input';
          await ctx.reply(
            '✅ Номер телефона принят!\n\n' +
              '<b>Шаг 2: Введите тестовое сообщение:</b>',
            Markup.inlineKeyboard([
              [Markup.button.callback('Отменить', 'cancel_whatsapp_bot')],
            ]),
          );
        } else {
          await ctx.reply(
            '❌ Неверный формат номера. Используйте формат +79XXXXXXXXX',
          );
        }
        break;

      case 'message_input':
        session.message = text;
        session.step = 'confirmation';
        await ctx.reply(
          `✅ Сообщение принято!\n\n` +
            `<b>Подтвердите создание WhatsApp бота:</b>\n\n` +
            `📱 Номер: ${session.phoneNumber}\n` +
            `💬 Сообщение: ${session.message}\n\n` +
            `Всё верно?`,
          Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Создать', 'confirm_whatsapp_bot'),
              Markup.button.callback('❌ Отменить', 'cancel_whatsapp_bot'),
            ],
          ]),
        );
        break;
    }
  }

  @On('callback_query')
  async onCallbackQuery(@Ctx() ctx: SceneContext) {
    const callbackData = (ctx.callbackQuery as any).data;

    if (callbackData === 'cancel_whatsapp_bot') {
      await ctx.reply('Создание WhatsApp бота отменено');
      await ctx.scene.leave();
      return;
    }

    if (callbackData === 'confirm_whatsapp_bot') {
      const session = ctx.session['whatsappBot'] as WhatsappBotSession;

      if (session.phoneNumber && session.message) {
        await ctx.reply('🔄 Создаю WhatsApp бота...');

        try {
          await this.whatsappService.sendMessageWithQR(session.phoneNumber, session.message, ctx);
          //выведи сессию ватсапп в консоль
          await ctx.reply('✅ WhatsApp бот успешно создан и протестирован!');
          await ctx.reply('Теперь вы можете использовать этот номер для рассылок.');
        } catch (error) {
          await ctx.reply(
            `❌ Ошибка при создании WhatsApp бота: ${error.message}`,
          );
          await ctx.reply('Попробуйте позже или проверьте номер телефона.');
        }

        await ctx.scene.leave();
      } else {
        await ctx.reply('❌ Недостаточно данных для создания бота');
        await ctx.scene.leave();
      }
    }
  }

  @Hears('/start')
  async onStart(@Ctx() ctx: SceneContext) {
    await ctx.reply('Выход из создания WhatsApp бота');
    await ctx.scene.leave();
    await ctx.reply('/start');
  }
}
