import { Injectable } from '@nestjs/common';
import { PrismaService } from 'libs/prisma/Prisma.service';
import { TelegramService } from 'src/telegram/telegram.service';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';

@Injectable()
export class MailingService {

    constructor(
        private readonly prisma: PrismaService, 
        private readonly telegramService: TelegramService,
        private readonly whatsappService: WhatsappService
    ) {}
    
    async startMessageTelegram(clients: any, messages: string[]) {
        // Проверяем время - рассылка только с 9:00 до 21:00
        if (!this.isWithinWorkingHours()) {
            const nextWorkingTime = this.getNextWorkingTime();
            const now = new Date();
            const currentTime = now.toLocaleTimeString('ru-RU', { 
                hour: '2-digit', 
                minute: '2-digit',
                timeZone: 'Europe/Moscow'
            });
            console.log(`⏰ Telegram рассылка приостановлена. Текущее время: ${currentTime}. Следующее рабочее время: ${nextWorkingTime}. Ждем...`);
            
            // Ждем до следующего рабочего времени
            await this.waitUntilWorkingHours();
        }

        await this.sendMessageTelegram(messages, clients);
    }

    private async sendMessageTelegram(messages: string[], clients: any[]) {
        const randomMessage = messages[Math.floor(Math.random() * messages.length)];
        const userbots = await this.prisma.telegramsUserbots.findMany({
            where: {
                isBan: false,
            },
        });

        if (userbots.length === 0) {
            console.log('❌ Нет доступных Telegram ботов для рассылки');
            return;
        }

        let userbotCounter = 0;
        let successCount = 0;
        let errorCount = 0;

        for (const client of clients) {
            try {
                // Проверяем время перед каждым сообщением
                if (!this.isWithinWorkingHours()) {
                    const nextWorkingTime = this.getNextWorkingTime();
                    console.log(`⏰ Telegram рассылка приостановлена до ${nextWorkingTime}. Ждем...`);
                    await this.waitUntilWorkingHours();
                }

                if (userbotCounter >= userbots.length) {
                    userbotCounter = 0; // Циклически используем ботов
                }

                console.log(`📱 Отправляем сообщение клиенту ${client.phone} через бота ${userbotCounter + 1}`);
                
                await this.telegramService.sendMessage(
                    userbots[userbotCounter].session, 
                    randomMessage, 
                    client.phone
                );
                
                console.log(`✅ Сообщение отправлено клиенту ${client.phone}`);
                successCount++;
                
                userbotCounter++;
                await new Promise(resolve => setTimeout(resolve, this.getDelay())); 
                
            } catch (error) {
                console.error(`❌ Ошибка отправки сообщения клиенту ${client.phone}:`, error.message);
                errorCount++;
                
                // Пробуем следующего бота
                userbotCounter++;
                if (userbotCounter >= userbots.length) {
                    userbotCounter = 0;
                }
                
                // Продолжаем с следующим клиентом, не прерывая цикл
                continue;
            }
        }
        
        console.log(`📊 Telegram рассылка завершена. Успешно: ${successCount}, Ошибок: ${errorCount}`);
    }

    async startMessageWhatsapp(messages: string[], clients: any[]) {
        // Проверяем время - рассылка только с 9:00 до 21:00
        if (!this.isWithinWorkingHours()) {
            const nextWorkingTime = this.getNextWorkingTime();
            const now = new Date();
            const currentTime = now.toLocaleTimeString('ru-RU', { 
                hour: '2-digit', 
                minute: '2-digit',
                timeZone: 'Europe/Moscow'
            });
            console.log(`⏰ WhatsApp рассылка приостановлена. Текущее время: ${currentTime}. Следующее рабочее время: ${nextWorkingTime}. Ждем...`);
            
            // Ждем до следующего рабочего времени
            await this.waitUntilWorkingHours();
        }

        // Проверяем здоровье всех WhatsApp сессий перед началом рассылки
        console.log('🔍 Проверяем состояние WhatsApp сессий...');
        await this.whatsappService.healthCheckAllSessions();

        const userbots = await this.prisma.whatsappUserbots.findMany({
            where: {
                isBan: false,
            },
        });

        if(userbots.length === 0) {
            console.log('❌ Нет доступных WhatsApp ботов для рассылки');
            return;
        }

        console.log(`📱 Найдено ${userbots.length} WhatsApp ботов для рассылки`);

        let userbotCounter = 0;
        let successCount = 0;
        let errorCount = 0;

        for(const client of clients) {
            try {
                // Проверяем время перед каждым сообщением
                if (!this.isWithinWorkingHours()) {
                    const nextWorkingTime = this.getNextWorkingTime();
                    console.log(`⏰ WhatsApp рассылка приостановлена до ${nextWorkingTime}. Ждем...`);
                    await this.waitUntilWorkingHours();
                }

                if (userbotCounter >= userbots.length) {
                    userbotCounter = 0; // Циклически используем ботов
                }

                const currentUserbot = userbots[userbotCounter];
                console.log(`📱 Отправляем сообщение клиенту ${client.phone} через WhatsApp бота ${userbotCounter + 1} (сессия: ${currentUserbot.session})`);
                
                await this.sendMessageWhatsapp(currentUserbot, messages, client);
                console.log(`✅ WhatsApp сообщение отправлено клиенту ${client.phone}`);
                successCount++;
                
                userbotCounter++;
                await new Promise(resolve => setTimeout(resolve, this.getDelay())); // Задержка 20 секунд
                
            } catch (error) {
                console.error(`❌ Ошибка отправки WhatsApp сообщения клиенту ${client.phone}:`, error.message);
                errorCount++;
                
                // Пробуем следующего бота
                userbotCounter++;
                if (userbotCounter >= userbots.length) {
                    userbotCounter = 0;
                }
                
                // Продолжаем с следующим клиентом, не прерывая цикл
                continue;
            }
        }
        
        console.log(`📊 WhatsApp рассылка завершена. Успешно: ${successCount}, Ошибок: ${errorCount}`);
    }

    private async sendMessageWhatsapp(userbot: any, messages: string[], client: any) {
        const randomMessage = messages[Math.floor(Math.random() * messages.length)];
        
        try {
            console.log(`📤 Отправляем WhatsApp сообщение: "${randomMessage}" клиенту ${client.phone} через сессию ${userbot.session}`);
            
            const result = await this.whatsappService.sendMessage(
                userbot.session, // ID сессии
                randomMessage, 
                client.phone
            );
            
            if (result) {
                console.log(`✅ WhatsApp сообщение успешно отправлено клиенту ${client.phone}`);
            } else {
                console.log(`⚠️ WhatsApp сообщение не отправлено клиенту ${client.phone} - пользователь не найден или недоступен`);
            }
            
        } catch (error) {
            // Проверяем, является ли это ошибкой соединения
            const isConnectionError = this.isWhatsAppConnectionError(error);
            
            if (isConnectionError) {
                console.error(`🔌 Ошибка соединения WhatsApp для сессии ${userbot.session}: ${error.message}`);
                console.log(`🔄 Попытка переподключения сессии ${userbot.session}...`);
                
                // Пытаемся переподключить сессию
                try {
                    await this.whatsappService.healthCheckAllSessions();
                    console.log(`✅ Сессия ${userbot.session} переподключена`);
                } catch (reconnectError) {
                    console.error(`❌ Не удалось переподключить сессию ${userbot.session}:`, reconnectError.message);
                }
            } else {
                console.error(`❌ Ошибка при отправке WhatsApp сообщения клиенту ${client.phone}:`, error.message);
            }
            
            // Не пробрасываем ошибку, чтобы рассылка продолжалась
        }
    }

    /**
     * Проверяет, является ли ошибка связанной с соединением WhatsApp
     */
    private isWhatsAppConnectionError(error: any): boolean {
        if (!error) return false;
        
        const errorMessage = error.message?.toLowerCase() || '';
        const errorOutput = error.output || {};
        const statusCode = errorOutput.statusCode;
        
        // Ошибки соединения WhatsApp
        if (errorMessage.includes('connection closed') || 
            errorMessage.includes('connection lost') ||
            errorMessage.includes('socket closed') ||
            errorMessage.includes('disconnected') ||
            errorMessage.includes('precondition required') ||
            errorMessage.includes('timed out') ||
            errorMessage.includes('timeout')) {
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

    private getDelay() {
        const delayMinutes = Math.floor(Math.random() * 28) + 3;
        return delayMinutes * 60 * 1000; 
    }

    private isWithinWorkingHours(): boolean {
        const now = new Date();
        const currentHour = now.getHours();
        return currentHour >= 9 && currentHour < 21;
    }

    private getNextWorkingTime(): string {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();

        if (currentHour >= 21) {
            return '09:00';
        }

        let nextHour = currentHour + 1;
        let nextMinute = currentMinute;

        if (nextHour >= 21) {
            nextHour = 9;
        }

        return `${nextHour.toString().padStart(2, '0')}:${nextMinute.toString().padStart(2, '0')}`;
    }

    private async waitUntilWorkingHours(): Promise<void> {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();

        if (currentHour >= 21) {
            await new Promise(resolve => setTimeout(resolve, (9 * 60 * 60 * 1000) - (now.getTime() % (24 * 60 * 60 * 1000))));
        } else {
            const targetTime = new Date(now);
            targetTime.setHours(9, 0, 0, 0);
            const timeDiff = targetTime.getTime() - now.getTime();
            if (timeDiff < 0) {
                targetTime.setDate(targetTime.getDate() + 1);
            }
            await new Promise(resolve => setTimeout(resolve, timeDiff));
        }
    }
}
