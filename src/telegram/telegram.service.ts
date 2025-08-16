import { Injectable, Logger } from '@nestjs/common';
import { TelegramClient } from 'telegram/client/TelegramClient.js';
import { StringSession } from 'telegram/sessions/index.js';
import { SceneContext } from 'telegraf/typings/scenes';
import { PrismaService } from 'libs/prisma/Prisma.service';
import * as api from './api.js';
import { ExelService } from 'src/Exel-Module/exelModule.service';
import { Context } from 'telegraf';
import { Api } from 'telegram/tl/api.js';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private client: TelegramClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly exelService: ExelService) {}


    async resolveEntity(client: TelegramClient, phoneOrUsername: string) {
        if (!phoneOrUsername) throw new Error("phone/username is required");
      
        // Если начинается с '@' — это username
        if (phoneOrUsername.startsWith("@")) {
          const username = phoneOrUsername.slice(1).trim();
          if (!username) throw new Error("Username is empty");
          return client.getEntity(username);
        }
      
        // Если содержит буквы — тоже трактуем как username
        if (/[a-zA-Z_]/.test(phoneOrUsername)) {
          return client.getEntity(phoneOrUsername.trim());
        }
      
        // Иначе — номер телефона
        const phone = this.normalizePhone(phoneOrUsername);
        return this.resolveEntityByPhone(client, phone);
      }
      
    normalizePhone(raw: string): string {
        // Оставляем только цифры, добавляем +
        const digits = (raw || "").replace(/[^\d]/g, "");
        if (!digits) throw new Error("Phone is empty or invalid");
        return digits.startsWith("+" ) ? digits : `+${digits}`;
      }
      
      async resolveEntityByPhone(client: TelegramClient, phone: string) {
        // Импортируем контакт, чтобы получить user entity по номеру
        const res = await client.invoke(
          new Api.contacts.ImportContacts({
            contacts: [
              new Api.InputPhoneContact({
                clientId: BigInt(Date.now()) as any,
                phone,
                firstName: "Temp",
                lastName: "",
              }),
            ],
          })
        );
      
        // В ответе могут быть и отвеченные пользователи, и просто сохранённые
        const user =
          (res.users && res.users.length > 0 && res.users[0]) ||
          (res.imported && res.imported.length > 0
            ? res.users.find(u => u.id.eq(res.imported[0].userId))
            : undefined);
      
        if (!user) {
          throw new Error(
            "Пользователь с таким номером не найден или скрыт настройками приватности."
          );
        }
      
        return user;
      }
 
    async sendMessage(
        session: string,
        message: string,
        phoneOrUsername: string,
        logger: { log: Function; warn: Function; error: Function } = console
      ) {
        const apiId = parseInt(process.env.API_ID || "", 10);
        const apiHash = process.env.API_HASH || "";
      
        if (!apiId || !apiHash) {
          throw new Error("API_ID/API_HASH не заданы в окружении");
        }
        if (!message?.trim()) {
          throw new Error("Пустое message");
        }
      
        const client = new TelegramClient(
          new StringSession(session),
          apiId,
          apiHash,
          { connectionRetries: 5 }
        );
      
        try {
          await client.connect();
      
          // Если нужно — можно проверить авторизацию:
          // const authed = await client.isUserAuthorized();
          // if (!authed) throw new Error("Сессия не авторизована");
      
          let entity;
          try {
            entity = await this.resolveEntity(client, phoneOrUsername);
          } catch (e: any) {
            logger.warn(
              `Не удалось получить entity для "${phoneOrUsername}": ${e?.message}`
            );
            throw new Error(
              `Не удалось найти пользователя "${phoneOrUsername}". Проверь номер/username и настройки приватности.`
            );
          }
      
          await client.sendMessage(entity, { message });
          logger.log(
            `Сообщение отправлено ${phoneOrUsername} (${(entity as any)?.className || "User"}): ${message}`
          );
      
          // Если добавляли по номеру телефон в контакты и хотите чистоту — можно удалить:
          // try { await client.invoke(new Api.contacts.DeleteContacts({ id: [entity] })); } catch {}
        } catch (error: any) {
          logger.error(
            `Ошибка отправки сообщения в Telegram для "${phoneOrUsername}": ${error?.message}`
          );
          throw error;
        } finally {
          await client.disconnect();
        }
      }

  async saveTelegramSession(session: string) {
    const userBot = await this.prisma.telegramsUserbots.create({
      data: {
        session: session,
        isBan: false,
        dailyCount: 0,
      },
    });

    return userBot;
  }

  async sendCode(phone) {
    return api.call('auth.sendCode', {
      phone_number: phone,
      settings: {
        _: 'codeSettings',
      },
    });
  }
  
  async signIn({ code, phone, phone_code_hash }) {
    return api.call('auth.signIn', {
      phone_code: code,
      phone_number: phone,
      phone_code_hash,
    });
  }

  getSessionString(): string {
    return api.getSessionString();
  }

  

}
