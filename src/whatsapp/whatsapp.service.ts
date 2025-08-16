import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  WASocket,
  proto,
} from '@whiskeysockets/baileys';
import * as qrcode from 'qrcode';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { SceneContext } from 'telegraf/typings/scenes';
import { PrismaService } from 'libs/prisma/Prisma.service';

interface WhatsAppSession {
  id: number;
  session: string;
  phone: string;
  isBan: boolean;
  dailyCount: number;
}

@Injectable()
export class WhatsappService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappService.name);
  private sessions: Map<string, WASocket> = new Map();
  private sessionStates: Map<string, any> = new Map();
  private authFolders: Map<string, string> = new Map();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    this.logger.log('WhatsApp Service initialized');
    // Убираем автоматическую загрузку сессий при старте
    // await this.loadExistingSessions();
  }

  async onModuleDestroy() {
    this.logger.log('WhatsApp Service shutting down');
    // Закрываем все активные соединения
    for (const [sessionId, sock] of this.sessions) {
      try {
        await sock.logout();
      } catch (error) {
        this.logger.error(`Error logging out session ${sessionId}:`, error);
      }
    }
  }

  /**
   * Загружает существующие сессии из базы данных
   */
  private async loadExistingSessions() {
    try {
      const sessions = await this.prisma.whatsappUserbots.findMany({
        where: { isBan: false }
      });

      for (const session of sessions) {
        // session.session теперь содержит имя папки сессии
        await this.connectSession(session.session, session.phone);
      }
    } catch (error) {
      this.logger.error('Error loading existing sessions:', error);
    }
  }

  /**
   * Создает новую сессию WhatsApp
   */
  async createNewSession(phone: string): Promise<{ qrCode: string; sessionId: string }> {
    // Создаем уникальное имя папки для сессии на основе телефона
    const sessionFolderName = `whatsapp_${phone.replace(/\D/g, '')}_${Date.now()}`;
    const authFolder = path.join(process.cwd(), 'whatsapp_sessions', sessionFolderName);
    
    // Создаем папку для сессии
    if (!fs.existsSync(authFolder)) {
      fs.mkdirSync(authFolder, { recursive: true });
    }

    this.authFolders.set(sessionFolderName, authFolder);
    
    try {
      const { state, saveCreds } = await useMultiFileAuthState(authFolder);
      this.sessionStates.set(sessionFolderName, { state, saveCreds });

      const sock = makeWASocket({
        printQRInTerminal: false,
        auth: state
      });

      this.sessions.set(sessionFolderName, sock);

      // Обработчики событий
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          // Генерируем QR код
          const qrCode = await qrcode.toDataURL(qr);
          this.logger.log(`QR code generated for session ${sessionFolderName}`);
        }

        if (connection === 'open') {
          this.logger.log(`WhatsApp session ${sessionFolderName} connected successfully`);
          // Сохраняем сессию в базу данных
          await this.saveWhatsappSession(sessionFolderName, phone);
        }

        if (connection === 'close') {
          const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
          if (shouldReconnect) {
            this.logger.log(`Reconnecting session ${sessionFolderName}...`);
            setTimeout(() => this.connectSession(sessionFolderName, phone), 5000);
          }
        }
      });

      sock.ev.on('creds.update', saveCreds);

      // Ждем QR код
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('QR code generation timeout'));
        }, 30000);

        sock.ev.on('connection.update', async (update) => {
          if (update.qr) {
            clearTimeout(timeout);
            const qrCode = await qrcode.toDataURL(update.qr);
            resolve({ qrCode, sessionId: sessionFolderName });
          }
        });
      });

    } catch (error) {
      this.logger.error(`Error creating session for ${phone}:`, error);
      throw error;
    }
  }

  /**
   * Подключает существующую сессию
   */
  async connectSession(sessionFolderName: string, phone: string): Promise<boolean> {
    try {
      const authFolder = this.authFolders.get(sessionFolderName) || 
                        path.join(process.cwd(), 'whatsapp_sessions', sessionFolderName);

      if (!fs.existsSync(authFolder)) {
        this.logger.warn(`Auth folder not found for session ${sessionFolderName}`);
        return false;
      }

      const { state, saveCreds } = await useMultiFileAuthState(authFolder);
      this.sessionStates.set(sessionFolderName, { state, saveCreds });

      const sock = makeWASocket({
        printQRInTerminal: false,
        auth: state
      });

      this.sessions.set(sessionFolderName, sock);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
          this.logger.log(`WhatsApp session ${sessionFolderName} reconnected successfully`);
        }

        if (connection === 'close') {
          const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
          if (shouldReconnect) {
            this.logger.log(`Reconnecting session ${sessionFolderName}...`);
            setTimeout(() => this.connectSession(sessionFolderName, phone), 5000);
          }
        }
      });

      sock.ev.on('creds.update', saveCreds);

      return true;
    } catch (error) {
      this.logger.error(`Error connecting session ${sessionFolderName}:`, error);
      return false;
    }
  }

  /**
   * Отправляет сообщение через указанную сессию
   */
  async sendMessage(sessionFolderName: string, message: string, phone: string): Promise<boolean> {
    try {
      //get session from folder
      const session = this.sessions.get(sessionFolderName);
      if (!session) {
        throw new Error(`Session ${sessionFolderName} not found`);
      }

      // Форматируем номер телефона для WhatsApp
      const formattedPhone = this.formatPhoneNumber(phone);
      
      // Проверяем статус соединения
      if (session.user?.id) {
        await session.sendMessage(formattedPhone, { text: message });
        this.logger.log(`Message sent to ${phone} via session ${sessionFolderName}`);
        
        // Увеличиваем счетчик сообщений
        await this.incrementDailyCount(sessionFolderName);
        
        return true;
      } else {
        throw new Error('WhatsApp not connected');
      }
    } catch (error) {
      this.logger.error(`Error sending message via session ${sessionFolderName}:`, error);
      return false;
    }
  }

  /**
   * Отправляет сообщение с QR кодом (для новых сессий)
   */
  async sendMessageWithQR(
    phoneNumber: string,
    message: string,
    ctx: SceneContext
  ): Promise<{ qrCode: string; sessionId: string }> {
    try {
      // Создаем новую сессию
      const { qrCode, sessionId } = await this.createNewSession(phoneNumber);
      
      // Отправляем QR код в Telegram
      await ctx.reply('🔐 Создайте новую сессию WhatsApp, отсканировав QR код:');
      await ctx.replyWithPhoto({ source: Buffer.from(qrCode.split(',')[1], 'base64') });
      
      // Ждем подключения и отправляем сообщение
     
      //save session to db
      await this.saveWhatsappSession(sessionId, phoneNumber);

      return { qrCode, sessionId };
    } catch (error) {
      this.logger.error('Error in sendMessageWithQR:', error);
      throw error;
    }
  }

  /**
   * Форматирует номер телефона для WhatsApp
   */
  private formatPhoneNumber(phone: string): string {
    // Убираем все нецифровые символы
    let cleanPhone = phone.replace(/\D/g, '');
    
    // Добавляем код страны если его нет
    if (!cleanPhone.startsWith('7') && !cleanPhone.startsWith('8')) {
      cleanPhone = '7' + cleanPhone;
    }
    
    // Заменяем 8 на 7
    if (cleanPhone.startsWith('8')) {
      cleanPhone = '7' + cleanPhone.substring(1);
    }
    
    return cleanPhone + '@c.us';
  }

  /**
   * Сохраняет сессию WhatsApp в базу данных
   */
  async saveWhatsappSession(sessionFolderName: string, phone: string) {
    try {
      return await this.prisma.whatsappUserbots.create({
        data: {
          session: sessionFolderName, // Теперь сохраняем имя папки сессии
          phone: phone,
          isBan: false,
          dailyCount: 0,
        },
      });
    } catch (error) {
      this.logger.error('Error saving WhatsApp session:', error);
      throw error;
    }
  }

  /**
   * Увеличивает счетчик ежедневных сообщений
   */
  private async incrementDailyCount(sessionFolderName: string) {
    try {
      await this.prisma.whatsappUserbots.updateMany({
        where: { session: sessionFolderName },
        data: { dailyCount: { increment: 1 } }
      });
    } catch (error) {
      this.logger.error('Error incrementing daily count:', error);
    }
  }

  /**
   * Получает статус сессии
   */
  async getSessionStatus(sessionFolderName: string): Promise<{ connected: boolean; phone?: string }> {
    const sock = this.sessions.get(sessionFolderName);
    if (!sock) {
      return { connected: false };
    }

    return {
      connected: !!sock.user?.id,
      phone: sock.user?.id
    };
  }

  /**
   * Получает список всех активных сессий
   */
  async getActiveSessions(): Promise<WhatsAppSession[]> {
    try {
      return await this.prisma.whatsappUserbots.findMany({
        where: { isBan: false }
      });
    } catch (error) {
      this.logger.error('Error getting active sessions:', error);
      return [];
    }
  }

  /**
   * Удаляет сессию
   */
  async deleteSession(sessionFolderName: string): Promise<boolean> {
    try {
      const sock = this.sessions.get(sessionFolderName);
      if (sock) {
        await sock.logout();
        this.sessions.delete(sessionFolderName);
      }

      const authFolder = this.authFolders.get(sessionFolderName);
      if (authFolder && fs.existsSync(authFolder)) {
        fs.rmSync(authFolder, { recursive: true, force: true });
        this.authFolders.delete(sessionFolderName);
      }

      await this.prisma.whatsappUserbots.deleteMany({
        where: { session: sessionFolderName }
      });

      this.logger.log(`Session ${sessionFolderName} deleted successfully`);
      return true;
    } catch (error) {
      this.logger.error(`Error deleting session ${sessionFolderName}:`, error);
      return false;
    }
  }

  /**
   * Проверяет подключение к WhatsApp
   */
  async checkConnection(sessionFolderName: string): Promise<boolean> {
    const sock = this.sessions.get(sessionFolderName);
    return !!(sock && sock.user?.id);
  }
}
