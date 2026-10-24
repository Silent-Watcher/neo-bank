import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HealthController } from './health.controller.js';
import { configModule } from './shared/config/config.js';

@Module({
  imports: [configModule, TerminusModule],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule { }
