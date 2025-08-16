import { Module } from '@nestjs/common';
import { PrismaModule } from 'libs/prisma/prisma.module';
import { ExelService } from './exelModule.service';

@Module({
    imports:[PrismaModule],
    providers: [ExelService],
    controllers: [],
    exports:[ExelService]
})
export class ExelModule {}
 