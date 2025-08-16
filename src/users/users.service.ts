import { Injectable } from '@nestjs/common';
import { PrismaService } from 'libs/prisma/Prisma.service';

@Injectable()
export class UsersService {

    constructor(
        private readonly prisma: PrismaService,
    ) {}

    async saveClients(clients: any[], userId: number, proccesed?: boolean) {
        console.log(clients, userId);
        await this.prisma.clients.createMany({
            data: clients.map(client => ({
                ...client,
                proccesed: proccesed,
            }))
        });
    }
}
