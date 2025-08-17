import { Injectable } from '@nestjs/common';
import { PrismaService } from 'libs/prisma/Prisma.service';

@Injectable()
export class UsersService {

    constructor(
        private readonly prisma: PrismaService,
    ) {}

    async saveClients(clients: any[], userId: number, proccesed?: boolean) {
        console.log(clients, userId);
        
        // Обрабатываем каждого клиента: добавляем userId, заполняем пустые поля, отрезаем лишние
        const processedClients = clients.map(client => ({
            userId: userId,                    // Обязательное поле
            phone: client.phone || "",         // Телефон (обязательное)
            telegramId: client.telegramId || "", // Telegram ID
            email: client.email || "",         // Email
            name: client.name || "",           // Имя
            proccesed: proccesed || false     // Статус обработки
        }));

        await this.prisma.clients.createMany({
            data: processedClients
        });
    }
}
