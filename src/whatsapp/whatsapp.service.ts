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
  private keepAliveIntervals: Map<string, NodeJS.Timeout> = new Map();
  private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();
  private sessionLastActivity: Map<string, number> = new Map();
  private reconnectionAttempts: Map<string, number> = new Map();
  private readonly KEEP_ALIVE_INTERVAL = 5 * 60 * 1000; // 5 минут
  private readonly HEARTBEAT_INTERVAL = 2 * 60 * 1000; // 2 минуты
  private readonly MAX_RECONNECTION_ATTEMPTS = 10;
  private readonly RECONNECTION_DELAY_BASE = 5000; // 5 секунд

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    this.logger.log('WhatsApp Service initialized');
    // Убираем автоматическую загрузку сессий при старте
    // await this.loadExistingSessions();
  }

  async onModuleDestroy() {
    this.logger.log('WhatsApp Service shutting down');
    
    // Останавливаем все интервалы
    for (const [sessionId, interval] of this.keepAliveIntervals) {
      clearInterval(interval);
    }
    for (const [sessionId, interval] of this.heartbeatIntervals) {
      clearInterval(interval);
    }
    
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
          // Запускаем механизмы поддержания жизни сессии
          this.startKeepAlive(sessionFolderName);
          this.startHeartbeat(sessionFolderName);
          this.resetReconnectionAttempts(sessionFolderName);
        }

        if (connection === 'close') {
          const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
          if (shouldReconnect) {
            this.logger.log(`Connection closed for session ${sessionFolderName}, handling failure...`);
            await this.handleSessionFailure(sessionFolderName);
          } else {
            this.logger.log(`Session ${sessionFolderName} logged out, stopping maintenance`);
            // Останавливаем интервалы для отключенной сессии
            const keepAliveInterval = this.keepAliveIntervals.get(sessionFolderName);
            if (keepAliveInterval) {
              clearInterval(keepAliveInterval);
              this.keepAliveIntervals.delete(sessionFolderName);
            }
            const heartbeatInterval = this.heartbeatIntervals.get(sessionFolderName);
            if (heartbeatInterval) {
              clearInterval(heartbeatInterval);
              this.heartbeatIntervals.delete(sessionFolderName);
            }
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
      this.authFolders.set(sessionFolderName, authFolder);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
          this.logger.log(`WhatsApp session ${sessionFolderName} reconnected successfully`);
          // Запускаем механизмы поддержания жизни сессии
          this.startKeepAlive(sessionFolderName);
          this.startHeartbeat(sessionFolderName);
          this.resetReconnectionAttempts(sessionFolderName);
        }

        if (connection === 'close') {
          const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
          if (shouldReconnect) {
            this.logger.log(`Connection closed for session ${sessionFolderName}, handling failure...`);
            await this.handleSessionFailure(sessionFolderName);
          } else {
            this.logger.log(`Session ${sessionFolderName} logged out, stopping maintenance`);
            // Останавливаем интервалы для отключенной сессии
            const keepAliveInterval = this.keepAliveIntervals.get(sessionFolderName);
            if (keepAliveInterval) {
              clearInterval(keepAliveInterval);
              this.keepAliveIntervals.delete(sessionFolderName);
            }
            const heartbeatInterval = this.heartbeatIntervals.get(sessionFolderName);
            if (heartbeatInterval) {
              clearInterval(heartbeatInterval);
              this.heartbeatIntervals.delete(sessionFolderName);
            }
          }
        }
      });

      sock.ev.on('creds.update', saveCreds);

      this.logger.log(`Session ${sessionFolderName} loaded and connected successfully`);
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
      let session = this.sessions.get(sessionFolderName);
      
      // Если сессия не найдена в памяти, пытаемся загрузить её
      if (!session) {
        this.logger.log(`Session ${sessionFolderName} not found in memory, attempting to load...`);
        const loaded = await this.connectSession(sessionFolderName, phone);
        if (loaded) {
          session = this.sessions.get(sessionFolderName);
        }
      }
      
      if (!session) {
        throw new Error(`Session ${sessionFolderName} not found and could not be loaded`);
      }

      // Проверяем статус соединения перед отправкой
      if (!session.user?.id) {
        this.logger.warn(`Session ${sessionFolderName} is not connected, attempting to reconnect...`);
        const reconnected = await this.reconnectSession(sessionFolderName, phone);
        if (!reconnected) {
          throw new Error(`Session ${sessionFolderName} is not connected and reconnection failed`);
        }
        session = this.sessions.get(sessionFolderName);
      }

      // Дополнительная проверка соединения
      if (!session || !session.user?.id) {
        throw new Error('WhatsApp session is not properly connected');
      }

      // Форматируем номер телефона для WhatsApp
      const formattedPhone = this.formatPhoneNumber(phone);
      
      try {
        await session.sendMessage(formattedPhone, { text: message });
        this.logger.log(`Message sent to ${phone} via session ${sessionFolderName}`);
        
        // Обновляем время последней активности
        this.sessionLastActivity.set(sessionFolderName, Date.now());
        
        // Увеличиваем счетчик сообщений
        await this.incrementDailyCount(sessionFolderName);
        
        return true;
      } catch (sendError) {
        // Если ошибка связана с соединением, пытаемся переподключиться
        if (this.isConnectionError(sendError)) {
          this.logger.warn(`Connection error detected for session ${sessionFolderName}, attempting to reconnect...`);
          const reconnected = await this.reconnectSession(sessionFolderName, phone);
          if (reconnected) {
            // Повторная попытка отправки после переподключения
            session = this.sessions.get(sessionFolderName);
            if (session && session.user?.id) {
              await session.sendMessage(formattedPhone, { text: message });
              this.logger.log(`Message sent to ${phone} via reconnected session ${sessionFolderName}`);
              // Обновляем время последней активности
              this.sessionLastActivity.set(sessionFolderName, Date.now());
              await this.incrementDailyCount(sessionFolderName);
              return true;
            }
          }
        }
        throw sendError;
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

  /**
   * Переподключает сессию
   */
  private async reconnectSession(sessionFolderName: string, phone: string): Promise<boolean> {
    try {
      this.logger.log(`Attempting to reconnect session ${sessionFolderName}...`);
      
      // Останавливаем интервалы для старой сессии
      const keepAliveInterval = this.keepAliveIntervals.get(sessionFolderName);
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        this.keepAliveIntervals.delete(sessionFolderName);
      }

      const heartbeatInterval = this.heartbeatIntervals.get(sessionFolderName);
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        this.heartbeatIntervals.delete(sessionFolderName);
      }
      
      // Удаляем старую сессию из памяти
      const oldSession = this.sessions.get(sessionFolderName);
      if (oldSession) {
        try {
          await oldSession.logout();
        } catch (error) {
          this.logger.warn(`Error logging out old session: ${error.message}`);
        }
        this.sessions.delete(sessionFolderName);
      }

      // Очищаем состояние сессии
      this.sessionStates.delete(sessionFolderName);

      // Подключаем заново
      const connected = await this.connectSession(sessionFolderName, phone);
      
      if (connected) {
        this.logger.log(`Session ${sessionFolderName} reconnected successfully`);
        // Сбрасываем счетчик попыток переподключения при успешном подключении
        this.resetReconnectionAttempts(sessionFolderName);
        return true;
      } else {
        this.logger.error(`Failed to reconnect session ${sessionFolderName}`);
        // Если не удалось подключиться, обрабатываем как сбой
        await this.handleSessionFailure(sessionFolderName);
        return false;
      }
    } catch (error) {
      this.logger.error(`Error reconnecting session ${sessionFolderName}:`, error);
      // Обрабатываем ошибку как сбой сессии
      await this.handleSessionFailure(sessionFolderName);
      return false;
    }
  }

  /**
   * Проверяет, является ли ошибка связанной с соединением
   */
  private isConnectionError(error: any): boolean {
    if (!error) return false;
    
    // Проверяем различные типы ошибок соединения
    const errorMessage = error.message?.toLowerCase() || '';
    const errorOutput = error.output || {};
    const statusCode = errorOutput.statusCode;
    
    // Ошибки соединения WhatsApp
    if (errorMessage.includes('connection closed') || 
        errorMessage.includes('connection lost') ||
        errorMessage.includes('socket closed') ||
        errorMessage.includes('disconnected')) {
      return true;
    }
    
    // HTTP статус коды, указывающие на проблемы с соединением
    if (statusCode === 428 || // Precondition Required
        statusCode === 408 || // Request Timeout
        statusCode === 503 || // Service Unavailable
        statusCode === 502 || // Bad Gateway
        statusCode === 504) { // Gateway Timeout
      return true;
    }
    
    // Проверяем специфичные ошибки Baileys
    if (error.isBoom && error.output?.payload?.message?.includes('Connection Closed')) {
      return true;
    }
    
    return false;
  }

  /**
   * Проверяет здоровье всех сессий и переподключает неактивные
   */
  async healthCheckAllSessions(): Promise<void> {
    this.logger.log('Starting health check for all WhatsApp sessions...');
    
    const sessions = await this.getActiveSessions();
    for (const session of sessions) {
      try {
        const isConnected = await this.checkConnection(session.session);
        if (!isConnected) {
          this.logger.warn(`Session ${session.session} is not connected, attempting to reconnect...`);
          await this.reconnectSession(session.session, session.phone);
        }
      } catch (error) {
        this.logger.error(`Error during health check for session ${session.session}:`, error);
      }
    }
    
    this.logger.log('Health check completed for all WhatsApp sessions');
  }

  /**
   * Запускает keep-alive механизм для сессии
   */
  private startKeepAlive(sessionFolderName: string): void {
    // Останавливаем предыдущий интервал, если он есть
    const existingInterval = this.keepAliveIntervals.get(sessionFolderName);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    const interval = setInterval(async () => {
      try {
        const session = this.sessions.get(sessionFolderName);
        if (session && session.user?.id) {
          // Отправляем ping для поддержания соединения
          await session.sendPresenceUpdate('available');
          this.sessionLastActivity.set(sessionFolderName, Date.now());
          this.logger.debug(`Keep-alive ping sent for session ${sessionFolderName}`);
        }
      } catch (error) {
        this.logger.warn(`Keep-alive failed for session ${sessionFolderName}:`, error.message);
        // Если keep-alive не удался, пытаемся переподключиться
        await this.handleSessionFailure(sessionFolderName);
      }
    }, this.KEEP_ALIVE_INTERVAL);

    this.keepAliveIntervals.set(sessionFolderName, interval);
    this.logger.log(`Keep-alive started for session ${sessionFolderName}`);
  }

  /**
   * Запускает heartbeat проверку для сессии
   */
  private startHeartbeat(sessionFolderName: string): void {
    // Останавливаем предыдущий интервал, если он есть
    const existingInterval = this.heartbeatIntervals.get(sessionFolderName);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    const interval = setInterval(async () => {
      try {
        const session = this.sessions.get(sessionFolderName);
        if (!session || !session.user?.id) {
          this.logger.warn(`Session ${sessionFolderName} is not connected, attempting to reconnect...`);
          await this.handleSessionFailure(sessionFolderName);
          return;
        }

        // Проверяем, когда была последняя активность
        const lastActivity = this.sessionLastActivity.get(sessionFolderName) || 0;
        const timeSinceLastActivity = Date.now() - lastActivity;
        
        // Если прошло больше 10 минут без активности, отправляем ping
        if (timeSinceLastActivity > 10 * 60 * 1000) {
          await session.sendPresenceUpdate('available');
          this.sessionLastActivity.set(sessionFolderName, Date.now());
          this.logger.debug(`Heartbeat ping sent for session ${sessionFolderName}`);
        }
      } catch (error) {
        this.logger.warn(`Heartbeat failed for session ${sessionFolderName}:`, error.message);
        await this.handleSessionFailure(sessionFolderName);
      }
    }, this.HEARTBEAT_INTERVAL);

    this.heartbeatIntervals.set(sessionFolderName, interval);
    this.logger.log(`Heartbeat started for session ${sessionFolderName}`);
  }

  /**
   * Обрабатывает сбой сессии с экспоненциальной задержкой
   */
  private async handleSessionFailure(sessionFolderName: string): Promise<void> {
    const attempts = this.reconnectionAttempts.get(sessionFolderName) || 0;
    
    if (attempts >= this.MAX_RECONNECTION_ATTEMPTS) {
      this.logger.error(`Session ${sessionFolderName} has exceeded maximum reconnection attempts, marking as failed`);
      await this.markSessionAsFailed(sessionFolderName);
      return;
    }

    // Экспоненциальная задержка: 5s, 10s, 20s, 40s, 80s, etc.
    const delay = this.RECONNECTION_DELAY_BASE * Math.pow(2, attempts);
    this.reconnectionAttempts.set(sessionFolderName, attempts + 1);
    
    this.logger.log(`Scheduling reconnection for session ${sessionFolderName} in ${delay}ms (attempt ${attempts + 1})`);
    
    setTimeout(async () => {
      try {
        const session = await this.prisma.whatsappUserbots.findFirst({
          where: { session: sessionFolderName }
        });
        
        if (session) {
          await this.reconnectSession(sessionFolderName, session.phone);
        }
      } catch (error) {
        this.logger.error(`Error during scheduled reconnection for session ${sessionFolderName}:`, error);
      }
    }, delay);
  }

  /**
   * Помечает сессию как неудачную и останавливает её обслуживание
   */
  private async markSessionAsFailed(sessionFolderName: string): Promise<void> {
    try {
      // Останавливаем интервалы
      const keepAliveInterval = this.keepAliveIntervals.get(sessionFolderName);
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        this.keepAliveIntervals.delete(sessionFolderName);
      }

      const heartbeatInterval = this.heartbeatIntervals.get(sessionFolderName);
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        this.heartbeatIntervals.delete(sessionFolderName);
      }

      // Удаляем сессию из памяти
      const session = this.sessions.get(sessionFolderName);
      if (session) {
        try {
          await session.logout();
        } catch (error) {
          this.logger.warn(`Error logging out failed session ${sessionFolderName}:`, error.message);
        }
        this.sessions.delete(sessionFolderName);
      }

      // Помечаем в базе данных как заблокированную
      await this.prisma.whatsappUserbots.updateMany({
        where: { session: sessionFolderName },
        data: { isBan: true }
      });

      // Очищаем счетчики
      this.reconnectionAttempts.delete(sessionFolderName);
      this.sessionLastActivity.delete(sessionFolderName);

      this.logger.log(`Session ${sessionFolderName} marked as failed and removed from active sessions`);
    } catch (error) {
      this.logger.error(`Error marking session ${sessionFolderName} as failed:`, error);
    }
  }

  /**
   * Сбрасывает счетчик попыток переподключения для сессии
   */
  private resetReconnectionAttempts(sessionFolderName: string): void {
    this.reconnectionAttempts.set(sessionFolderName, 0);
    this.sessionLastActivity.set(sessionFolderName, Date.now());
  }
}
