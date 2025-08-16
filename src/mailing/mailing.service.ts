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

        for (const client of clients) {
            try {
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
                
                userbotCounter++;
                await new Promise(resolve => setTimeout(resolve, 1000 * 20)); // Задержка 20 секунд
                
            } catch (error) {
                console.error(`❌ Ошибка отправки сообщения клиенту ${client.phone}:`, error.message);
                
                // Пробуем следующего бота
                userbotCounter++;
                if (userbotCounter >= userbots.length) {
                    userbotCounter = 0;
                }
            }
        }
    }

    async startMessageWhatsapp(messages: string[], clients: any[]) {
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

        for(const client of clients) {
            try {
                if (userbotCounter >= userbots.length) {
                    userbotCounter = 0; // Циклически используем ботов
                }

                const currentUserbot = userbots[userbotCounter];
                console.log(`📱 Отправляем сообщение клиенту ${client.phone} через WhatsApp бота ${userbotCounter + 1} (сессия: ${currentUserbot.session})`);
                
                await this.sendMessageWhatsapp(currentUserbot, messages, client);
                
                console.log(`✅ WhatsApp сообщение отправлено клиенту ${client.phone}`);
                
                userbotCounter++;
                await new Promise(resolve => setTimeout(resolve, 1000 * 20)); // Задержка 20 секунд
                
            } catch (error) {
                console.error(`❌ Ошибка отправки WhatsApp сообщения клиенту ${client.phone}:`, error.message);
                
                // Пробуем следующего бота
                userbotCounter++;
                if (userbotCounter >= userbots.length) {
                    userbotCounter = 0;
                }
            }
        }
    }

    private async sendMessageWhatsapp(userbot: any, messages: string[], client: any) {
        const randomMessage = messages[Math.floor(Math.random() * messages.length)];
        
        try {
            console.log(`📤 Отправляем WhatsApp сообщение: "${randomMessage}" клиенту ${client.phone} через сессию ${userbot.session}`);
            
            await this.whatsappService.sendMessage(
                userbot.session, // ID сессии
                randomMessage, 
                client.phone
            );
            
            console.log(`✅ WhatsApp сообщение успешно отправлено клиенту ${client.phone}`);
            
        } catch (error) {
            console.error(`❌ Ошибка при отправке WhatsApp сообщения клиенту ${client.phone}:`, error);
            throw error; // Пробрасываем ошибку для обработки в вызывающем методе
        }
    }
}
