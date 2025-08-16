import { Injectable } from '@nestjs/common';
import { PrismaService } from 'libs/prisma/Prisma.service';
import * as ExcelJS from 'exceljs';
import { PHONE_EXAMPLE, EMAIL_EXAMPLE, TELEGRAM_ID_EXAMPLE, TELEGRAM_USERNAME, PROJECT_EXAMPLE, SOURCE_EXAMPLE, SUB2_EXAMPLE } from './constant/exelData'
import { LeadsSignal } from './dto/leads.dto';

@Injectable()
export class ExelService {
    constructor(
        private readonly prisma: PrismaService,
    ) {}

    async readExcel(buffer: Buffer, userId:number): Promise<any[]> {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer as any);   
    
        const worksheet = workbook.worksheets[0];
        const data: any[] = [];
        worksheet.eachRow((row) => {
            data.push(row.values);
        });

        
        let phoneIndex = Infinity;
        let emailIndex = Infinity;
        let telegramIndex = Infinity;
        let telegramUsernameIndex = Infinity;
        
        const usersData:any[] = [];

        data[0].map((exelItem, index) => {
            if(PHONE_EXAMPLE.includes(exelItem)) {
                phoneIndex = index;
            }

            if(EMAIL_EXAMPLE.includes(exelItem)) {
                emailIndex = index;
            }

            if(TELEGRAM_ID_EXAMPLE.includes(exelItem)) {
                telegramIndex = index;
            }

            if(TELEGRAM_USERNAME.includes(exelItem)) {
                telegramUsernameIndex = index;
            }
        });

        data.slice(1).map(el => {
            const usersItem:any = {
                telegramId: telegramIndex !== Infinity ? el[telegramIndex] : 0,
                userId,
                phone: phoneIndex !== Infinity ? el[phoneIndex] : 0,
                email: emailIndex !== Infinity ? el[emailIndex] : '',
                name: telegramUsernameIndex !== Infinity ? el[telegramUsernameIndex] : ''
            }

            usersData.push(usersItem);
        })
    
        return usersData;
    }

    async  exportToExcelBuffer(data:any[]) {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Данные');

        if (!data.length) return null;

        const columns = Object.keys(data[0]).map(key => ({ header: key, key }));
        worksheet.columns = columns;

        data.forEach(item => {
            const rowData = {};
            Object.keys(item).forEach(key => {
                rowData[key] = String(item[key]);
            });
            worksheet.addRow(rowData);
        });

        const buffer = await workbook.xlsx.writeBuffer();
        return buffer;
    }

    async readExelByOneColumn(buffer: Buffer):Promise<string[]> {
        console.log('work');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer as any);   

        const worksheet = workbook.worksheets[0];
        const data: any[] = [];
        worksheet.eachRow((row) => {
            data.push(row.values);
        });

        console.log(data);

        const res = data.map(el => String(el[1]));

        console.log(res);

        return res;
    }

    async readLeadsSignalExcel(buffer: Buffer): Promise<LeadsSignal[]> {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer as any);   
    
        const worksheet = workbook.worksheets[0];
        const data: any[] = [];
        worksheet.eachRow((row) => {
            data.push(row.values);
        });

        let phoneIndex = Infinity;
        let projectIndex = Infinity;
        let sourceIndex = Infinity;
        let sub2Index = Infinity;
        
        const leadsData: LeadsSignal[] = [];

        // Определяем индексы колонок по заголовкам
        data[0].map((exelItem, index) => {
            if(PHONE_EXAMPLE.includes(exelItem.toLowerCase())) {
                phoneIndex = index;
            }

            if(PROJECT_EXAMPLE.includes(exelItem.toLowerCase())) {
                projectIndex = index;
            }

            if(SOURCE_EXAMPLE.includes(exelItem.toLowerCase())) {
                sourceIndex = index;
            }

            if(SUB2_EXAMPLE.includes(exelItem.toLowerCase())) {
                sub2Index = index;
            }
        });

        // Обрабатываем данные, начиная со второй строки (пропускаем заголовки)
        data.slice(1).map(el => {
            const leadItem: LeadsSignal = {
                phone: phoneIndex !== Infinity ? String(el[phoneIndex] || '') : '',
                project: projectIndex !== Infinity ? String(el[projectIndex] || '') : '',
                source: sourceIndex !== Infinity ? String(el[sourceIndex] || '') : '',
                sub2: sub2Index !== Infinity ? String(el[sub2Index] || '') : ''
            }

            leadsData.push(leadItem);
        })
    
        return leadsData;
    }
}
