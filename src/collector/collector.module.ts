import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { CollectorService } from './collector.service';
import { CollectorController } from './collector.controller';
import { CollectorScheduler } from './scheduler/collector.scheduler';
import { FootballDataApiDataSource } from './api/football-data.source';
import { CsvDataSource } from './csv/csv-data.source';
import { Match } from '../match/match.entity';
import { Odds } from '../odds/odds.entity';

/**
 * 数据采集模块
 *
 * NestJS 模块是组织代码的基本单元，类似于 Angular 的模块概念
 * 模块中声明了:
 * - imports: 依赖的其他模块
 * - controllers: 处理 HTTP 请求的控制器
 * - providers: 可注入的服务 (即依赖注入的提供者)
 * - exports: 对外暴露的服务
 *
 * 本模块的依赖关系:
 * CollectorModule
 * ├── TypeOrmModule (数据库操作)
 * │   ├── Match 实体
 * │   └── Odds 实体
 * ├── ScheduleModule (定时任务)
 * ├── FootballDataApiDataSource (API数据源)
 * └── CsvDataSource (CSV数据源)
 */
@Module({
  imports: [
    // 注册 Match 和 Odds 实体到 TypeORM
    // 这样就可以在服务中通过 @InjectRepository 注入对应的 Repository
    TypeOrmModule.forFeature([Match, Odds]),

    // 注册定时任务模块
    // isolate: true 表示每个模块有独立的调度器
    ScheduleModule.forRoot(),
  ],
  controllers: [
    // HTTP 接口控制器
    CollectorController,
  ],
  providers: [
    // 数据采集核心服务
    CollectorService,
    // 定时任务调度器
    CollectorScheduler,
    // API 数据源 (football-data.org)
    FootballDataApiDataSource,
    // CSV 数据源 (football-data.co.uk)
    CsvDataSource,
  ],
  // 对外暴露的服务，其他模块可以注入使用
  exports: [CollectorService, FootballDataApiDataSource],
})
export class CollectorModule {}
