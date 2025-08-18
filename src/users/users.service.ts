import { Injectable } from '@nestjs/common';
import { PrismaService } from 'libs/prisma/Prisma.service';

@Injectable()
export class UsersService {

    constructor(
        private readonly prisma: PrismaService,
    ) {}

    async saveClients(clients: any[], userId: number, proccesed?: boolean) {
        // Обрабатываем каждого клиента: добавляем userId, заполняем пустые поля, отрезаем лишние
        const processedClients = clients.map(client => {
            let phone = String(client.phone || "");
            
            // Добавляем + перед номером, если его нет и номер не пустой
            if (phone && !phone.startsWith('+')) {
                phone = '+' + phone;
            }
            
            return {
                userId: userId,                    // Обязательное поле
                phone: phone,                      // Телефон (обязательное)
                telegramId: String(client.telegramId || ""), // Telegram ID
                email: String(client.email || ""),         // Email
                name: String(client.name || ""),           // Имя
                proccesed: proccesed || false     // Статус обработки
            };
        });

        await this.prisma.clients.createMany({
            data: processedClients
        });
    }
}
