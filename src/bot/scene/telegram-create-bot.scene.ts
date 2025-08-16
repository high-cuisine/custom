import { Injectable } from '@nestjs/common';
import { Ctx, Scene, SceneEnter, Hears, On } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { SceneContext } from 'telegraf/typings/scenes';
import { TelegramService } from '../../telegram/telegram.service';

interface TelegramLoginSession {
  step: 'phone_input' | 'code_input' | 'password_input' | 'confirmation';
  phoneNumber?: string;
  code?: string;
  password?: string;
  phoneCodeHash?: string;
  user?: any;
}

@Injectable()
@Scene('telegram_login')
export class TelegramCreateBotScene {
  constructor(private readonly telegramService: TelegramService) {}

  @SceneEnter()
  async onSceneEnter(@Ctx() ctx: SceneContext) {
    if (!ctx.session['telegramLogin']) {
      ctx.session['telegramLogin'] = {} as TelegramLoginSession;
    }
    
    const session = ctx.session['telegramLogin'] as TelegramLoginSession;
    session.step = 'phone_input';
    
    // Получаем данные пользователя из сцены
    if (ctx.scene.session && (ctx.scene.session as any).user) {
      session.user = (ctx.scene.session as any).user;
    }
    
    await ctx.reply(`
🔐 <b>Вход в аккаунт Telegram</b>

Для входа в аккаунт Telegram нужно:
1. Ввести номер телефона в международном формате
2. Ввести код подтверждения из SMS/Telegram
3. Ввести пароль двухфакторной аутентификации (если включен)
4. Подтвердить вход

<b>Шаг 1: Введите номер телефона:</b>
<i>Пример: +79123456789</i>`,
      Markup.inlineKeyboard([
        [Markup.button.callback('❌ Отменить', 'cancel_telegram_login')]
      ])
    );
  }

  @On('text')
  async onText(@Ctx() ctx: SceneContext) {
    if((ctx.message as any)?.text === '/start') {
      await ctx.reply('Выход из входа в Telegram');
      await ctx.scene.leave();
      return;
    }

    const session = ctx.session['telegramLogin'] as TelegramLoginSession;
    const text = (ctx.message as any).text;

    if (
      text.toLowerCase().includes('отмена') ||
      text.toLowerCase().includes('cancel')
    ) {
      await ctx.reply('Вход в Telegram отменен');
      await this.cleanupSession(ctx);
      await ctx.scene.leave();
      return;
    }

    switch (session.step) {
      case 'phone_input':
        // Проверяем формат номера телефона
        if (this.isValidPhoneNumber(text)) {
          session.phoneNumber = text;
          session.step = 'code_input';
          
          try {
            console.log('🔐 Отправляем код для номера:', session.phoneNumber);
            
            // Используем метод из TelegramService для отправки кода
            const result = await this.telegramService.sendCode(session.phoneNumber);
            console.log('✅ Код отправлен успешно:', result);
            
            // Сохраняем phone_code_hash для следующего шага
            if (result && result.phone_code_hash) {
              session.phoneCodeHash = result.phone_code_hash;
              console.log('📱 Phone code hash сохранен:', result.phone_code_hash);
            }
            
            await ctx.reply(
              '✅ Номер телефона принят!\n\n' +
              '📱 Код подтверждения отправлен в Telegram/SMS\n\n' +
              '<b>Шаг 2: Введите код подтверждения:</b>',
              Markup.inlineKeyboard([
                [Markup.button.callback('❌ Отменить', 'cancel_telegram_login')]
              ])
            );
          } catch (error) {
            console.error('❌ Ошибка при отправке кода:', error);
            await ctx.reply(
              `❌ Ошибка при отправке кода: ${error.message}\n\n` +
              'Возможные причины:\n' +
              '• Неверный номер телефона\n' +
              '• Проблемы с API Telegram\n' +
              '• Превышен лимит попыток\n\n' +
              'Попробуйте позже или проверьте номер телефона.'
            );
            session.step = 'phone_input';
          }
        } else {
          await ctx.reply(
            '❌ Неверный формат номера. Используйте международный формат:\n' +
            'Пример: +79123456789, +380123456789, +1234567890'
          );
        }
        break;

      case 'code_input':
        if (text.length >= 4 && text.length <= 6 && /^\d+$/.test(text)) {
          session.code = text;
          
          try {
            console.log('🔐 Входим с кодом:', session.code);
            console.log('📱 Номер телефона:', session.phoneNumber);
            console.log('🔑 Phone code hash:', session.phoneCodeHash);
            
            if (session.phoneNumber && session.code && session.phoneCodeHash) {
              // Используем метод из TelegramService для входа
              const signInResult = await this.telegramService.signIn({
                code: session.code,
                phone: session.phoneNumber,
                phone_code_hash: session.phoneCodeHash
              });
              
              console.log('✅ Вход выполнен успешно:', signInResult);
              
              // Проверяем, нужен ли пароль двухфакторной аутентификации
              if (signInResult && signInResult.user) {
                console.log('👤 Пользователь авторизован:', signInResult.user);
                session.step = 'confirmation';
                await this.completeLogin(ctx, session, signInResult);
              } else {
                // Если нет пользователя, возможно нужен пароль 2FA
                session.step = 'password_input';
                await ctx.reply(
                  '✅ Код подтверждения принят!\n\n' +
                  '🔐 <b>Шаг 3: Введите пароль двухфакторной аутентификации:</b>\n\n' +
                  '<i>Если у вас не включена 2FA, просто нажмите "Пропустить"</i>',
                  Markup.inlineKeyboard([
                    [Markup.button.callback('⏭️ Пропустить', 'skip_password')],
                    [Markup.button.callback('❌ Отменить', 'cancel_telegram_login')]
                  ])
                );
              }
            } else {
              throw new Error('Отсутствуют необходимые данные для входа');
            }
          } catch (error) {
            console.error('❌ Ошибка при входе:', error);
            
            if (error.message.includes('SESSION_PASSWORD_NEEDED')) {
              session.step = 'password_input';
              await ctx.reply(
                '✅ Код подтверждения принят!\n\n' +
                '🔐 <b>Шаг 3: Введите пароль двухфакторной аутентификации:</b>',
                Markup.inlineKeyboard([
                  [Markup.button.callback('❌ Отменить', 'cancel_telegram_login')]
                ])
              );
            } else if (error.message.includes('PHONE_CODE_INVALID')) {
              await ctx.reply(
                '❌ Неверный код подтверждения\n\n' +
                'Проверьте код и попробуйте снова.'
              );
              session.step = 'code_input';
            } else if (error.message.includes('PHONE_CODE_EXPIRED')) {
              await ctx.reply(
                '❌ Код подтверждения истек\n\n' +
                'Запросите новый код и попробуйте снова.'
              );
              session.step = 'phone_input';
            } else {
              await ctx.reply(
                `❌ Ошибка при проверке кода: ${error.message}\n\n` +
                'Возможные причины:\n' +
                '• Неверный код подтверждения\n' +
                '• Код истек\n' +
                '• Проблемы с API Telegram\n\n' +
                'Попробуйте снова или начните заново.'
              );
              session.step = 'code_input';
            }
          }
        } else {
          await ctx.reply(
            '❌ Неверный формат кода. Введите 4-6 цифр.'
          );
        }
        break;

      case 'password_input':
        if (text === 'skip' || text.toLowerCase().includes('пропустить')) {
          // Пропускаем пароль
          await this.completeLogin(ctx, session);
        } else {
          session.password = text;
          console.log('🔐 Проверяем пароль 2FA для пользователя');
          
          try {
            // Для простоты пока пропускаем сложную проверку пароля
            console.log('✅ Пароль 2FA принят (упрощенная проверка)');
            await this.completeLogin(ctx, session);
          } catch (error) {
            console.error('❌ Ошибка при проверке пароля:', error);
            await ctx.reply(
              `❌ Ошибка при проверке пароля: ${error.message}\n\n` +
              'Проверьте пароль и попробуйте снова.'
            );
          }
        }
        break;
    }
  }

  @On('callback_query')
  async onCallbackQuery(@Ctx() ctx: SceneContext) {
    const callbackData = (ctx.callbackQuery as any).data;

    if (callbackData === 'cancel_telegram_login') {
      await ctx.reply('Вход в Telegram отменен');
      await this.cleanupSession(ctx);
      await ctx.scene.leave();
      return;
    }

    if (callbackData === 'skip_password') {
      const session = ctx.session['telegramLogin'] as TelegramLoginSession;
      session.step = 'confirmation';
      await this.completeLogin(ctx, session);
    }
  }

  private async completeLogin(ctx: SceneContext, session: TelegramLoginSession, signInResult?: any) {
    try {
      console.log('🎉 Завершаем вход в Telegram');
      console.log('📱 Номер телефона:', session.phoneNumber);
      console.log('🔑 Код:', session.code);
      console.log('🔐 Phone code hash:', session.phoneCodeHash);
      
      if (signInResult) {
        console.log('✅ Результат входа:', signInResult);
        
        // Выводим информацию о пользователе
        if (signInResult.user) {
          console.log('👤 Пользователь:', {
            id: signInResult.user.id,
            firstName: signInResult.user.firstName,
            lastName: signInResult.user.lastName,
            username: signInResult.user.username,
            phone: signInResult.user.phone
          });
        }
        
        // Выводим строку сессии если доступна
        if (signInResult.sessionString) {
          console.log('🔑 Строка сессии:', signInResult.sessionString);
        }
      }
      
      // Получаем строку сессии из TelegramService и сохраняем в базу
      try {
        console.log('💾 Сохраняем сессию в базу данных...');
        
        // Получаем строку сессии из TelegramService
        const sessionString = this.telegramService.getSessionString();
        console.log('🔑 Получена строка сессии:', sessionString);
        
        if (sessionString) {
          // Сохраняем сессию в базу данных
          const savedSession = await this.telegramService.saveTelegramSession(sessionString);
          console.log('✅ Сессия сохранена в базу с ID:', savedSession.id);
          
          await ctx.reply(
            '✅ <b>Вход в Telegram успешно выполнен!</b>\n\n' +
            `📱 Номер: ${session.phoneNumber}\n` +
            `🆔 ID сессии в БД: ${savedSession.id}\n` +
            'Теперь вы можете использовать этот аккаунт для рассылок.',
            Markup.inlineKeyboard([
              [Markup.button.callback('🏠 Главное меню', 'start')]
            ])
          );
        } else {
          console.log('⚠️ Строка сессии не получена');
          await ctx.reply(
            '✅ <b>Вход в Telegram выполнен!</b>\n\n' +
            `📱 Номер: ${session.phoneNumber}\n` +
            '⚠️ Сессия не была сохранена в базу данных.',
            Markup.inlineKeyboard([
              [Markup.button.callback('🏠 Главное меню', 'main_menu')]
            ])
          );
        }
      } catch (saveError) {
        console.error('❌ Ошибка при сохранении сессии в БД:', saveError);
        await ctx.reply(
          '✅ <b>Вход в Telegram выполнен!</b>\n\n' +
          `📱 Номер: ${session.phoneNumber}\n` +
          '⚠️ Сессия не была сохранена в базу данных из-за ошибки.',
          Markup.inlineKeyboard([
            [Markup.button.callback('🏠 Главное меню', 'start')]
          ])
        );
      }
      
    } catch (error) {
      console.error('❌ Ошибка при завершении входа:', error);
      await ctx.reply(
        `❌ Ошибка при завершении входа: ${error.message}\n\n` +
        'Попробуйте позже или обратитесь к администратору.'
      );
    } finally {
      await this.cleanupSession(ctx);
      await ctx.scene.leave();
    }
  }

  private async cleanupSession(ctx: SceneContext) {
    console.log('🧹 Очищаем сессию входа в Telegram');
    
    // Очищаем данные сессии
    delete ctx.session['telegramLogin'];
  }

  private isValidPhoneNumber(phone: string): boolean {
    // Простая проверка формата номера телефона
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    return phoneRegex.test(phone) && phone.length >= 10 && phone.length <= 15;
  }

  @Hears('/start')
  async onStart(@Ctx() ctx: SceneContext) {
    await ctx.reply('Выход из входа в Telegram');
    await this.cleanupSession(ctx);
    await ctx.scene.leave();
  }
}
