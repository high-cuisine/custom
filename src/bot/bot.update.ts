import { Update, Start, Ctx, Action, On } from "nestjs-telegraf";
import { Context, Telegraf } from 'telegraf';
import { BotService } from "./bot.service";
import { SceneContext } from "telegraf/typings/scenes";

@Update()
export class BotUpdate {
    constructor(private readonly botService: BotService) {}

    async onModuleInit() {
        
    }

    @Action('start')
    @Start()
    async onStart(@Ctx() ctx: Context) {
        const user = await this.botService.startBot(ctx);
    }
    
    @Action('create_bot_whatsapp')
    async onCreateBotWhatsapp(@Ctx() ctx: Context & SceneContext) {
        await this.botService.createWhatsappBot(ctx);
    }

    @Action('create_bot_telegram')
    async onCreateBotTelegram(@Ctx() ctx: Context & SceneContext) {
        await this.botService.createTelegramBot(ctx);
    }

    @Action('test_scene')
    async onTestScene(@Ctx() ctx: Context & SceneContext) {
        console.log('Test scene action called');
        console.log('ctx.scene available:', !!ctx.scene);
        
        if (!ctx.scene) {
            await ctx.reply('Сцены недоступны. Попробуйте позже.');
            return;
        }

        try {
            await ctx.scene.enter('test_scene');
            console.log('Test scene entered successfully');
        } catch (error) {
            console.error('Error entering test scene:', error);
            await ctx.reply('Ошибка при входе в тестовую сцену');
        }
    }

    @Action('get_exel')
    async onGetExel(@Ctx() ctx: Context) {
        await this.botService.getExelData(ctx);
    }

    @On('document')
    async onUploadLeads(@Ctx() ctx: Context) {
        const message = ctx.message as any;

    if(message && message?.document) {
      // Проверяем, что файл имеет расширение .xml
      const fileName = message.document.file_name;
      if (fileName && fileName.toLowerCase().endsWith('.xml') || fileName.toLowerCase().endsWith('.xlsx')) {
        await this.botService.uploadLeads(ctx);
      } 
      if(fileName && fileName.toLowerCase().endsWith('.txt')) {
        await this.botService.uploadLeadsTxt(ctx);
      }
    }   
    }
}
