import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CollectorModule } from './collector/collector.module';
import { EloModule } from './elo/elo.module';
import { Match } from './match/match.entity';
import { Odds } from './odds/odds.entity';
import { EloRating } from './elo/elo-rating.entity';
import { EloHistory } from './elo/elo-history.entity';
import { WcPrediction } from './elo/wc-prediction.entity';

/**
 * 根模块 - NestJS 应用的入口模块
 *
 * 这里配置了:
 * 1. TypeORM 数据库连接 (使用 SQLite，轻量级，无需安装数据库服务)
 * 2. 导入数据采集模块
 *
 * 数据库选择说明:
 * - 开发阶段使用 SQLite (文件数据库，零配置)
 * - 生产环境可切换为 PostgreSQL (只需修改配置)
 */
@Module({
  imports: [
    // 配置 TypeORM 数据库连接
    TypeOrmModule.forRoot({
      // 使用 SQLite 数据库，数据存储在项目根目录的 data/football.db 文件中
      type: 'better-sqlite3',
      database: 'data/football.db',

      // 自动加载实体类，TypeORM 会根据实体定义自动创建/更新表结构
      entities: [Match, Odds, EloRating, EloHistory, WcPrediction],

      // synchronize: true 会自动同步实体定义到数据库表结构
      // ⚠️ 生产环境应设为 false，使用 migration 管理数据库变更
      synchronize: true,

      // 打印 SQL 日志，开发阶段方便调试
      logging: false,
    }),

    // 导入数据采集模块
    CollectorModule,

    // 导入 ELO 评分模块
    EloModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
