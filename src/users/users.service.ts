import { Injectable } from '@nestjs/common';
import { PrismaService } from 'libs/prisma/Prisma.service';

@Injectable()
export class UsersService {

    constructor(
        private readonly prisma: PrismaService,
    ) {}

    async saveClients(clients: any[], userId: number, proccesed?: boolean) {
        console.log('Raw clients data:', clients);
        console.log('User ID:', userId);
        
        // Обрабатываем каждого клиента: добавляем userId, заполняем пустые поля, отрезаем лишние
        const processedClients = clients.map((client, index) => {
            console.log(`Processing client ${index}:`, client);
            console.log(`Client phone type:`, typeof client.phone, 'Value:', client.phone);
            
            let phone = String(client.phone || "");
            console.log(`Phone after String():`, phone, 'Type:', typeof phone);
            
            // Добавляем + перед номером, если его нет и номер не пустой
            if (phone && !phone.startsWith('+')) {
                phone = '+' + phone;
            }
            console.log(`Final phone:`, phone);
            
            const processedClient = {
                userId: userId,                    // Обязательное поле
                phone: phone,                      // Телефон (обязательное)
                telegramId: String(client.telegramId || ""), // Telegram ID
                email: String(client.email || ""),         // Email
                name: String(client.name || ""),           // Имя
                proccesed: proccesed || false     // Статус обработки
            };
            
            console.log(`Processed client ${index}:`, processedClient);
            return processedClient;
        });

        console.log('Final processed clients:', processedClients);
        
        // Дополнительная проверка типов перед сохранением
        const validatedClients = processedClients.map(client => ({
            ...client,
            phone: String(client.phone),
            telegramId: String(client.telegramId),
            email: String(client.email),
            name: String(client.name)
        }));
        
        console.log('Validated clients:', validatedClients);

        await this.prisma.clients.createMany({
            data: validatedClients
        });
    }
}
