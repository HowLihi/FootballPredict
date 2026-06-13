import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

/**
 * NestJS 应用启动入口
 *
 * 这里做了以下配置:
 * 1. 创建 NestJS 应用实例
 * 2. 启用全局数据验证管道
 * 3. 启动 HTTP 服务监听
 */
async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // 创建 NestJS 应用实例
  const app = await NestFactory.create(AppModule);

  // 启用全局验证管道
  // 当请求参数使用了 class-validator 装饰器时，会自动验证
  // whitelist: true 会自动去除未定义的属性，防止注入多余数据
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // 监听端口，默认 3000，可通过环境变量 PORT 自定义
  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  logger.log(`🚀 足球比赛预测系统已启动: http://localhost:${port}`);
  logger.log(`📊 数据采集接口: http://localhost:${port}/collector/status`);
}

bootstrap();
