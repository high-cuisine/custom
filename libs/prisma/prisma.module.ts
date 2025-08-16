import { Module } from '@nestjs/common';
import { PrismaService } from './Prisma.service';

@Module({
  providers: [PrismaService],
  imports: [],
  exports: [PrismaService],
})
export class PrismaModule {}
