# 世界杯小组赛预测

基于多模型集成的 2026 美加墨世界杯小组赛预测系统，融合 ELO 评分、赔率分析和泊松分布三大模型，通过动态权重 Stacking 集成，提供高精度比赛预测。

## 技术栈

### 后端

| 技术                                                                   | 用途                               |
| ---------------------------------------------------------------------- | ---------------------------------- |
| [NestJS](https://nestjs.com/) 11                                       | 服务端框架，模块化架构 + 依赖注入  |
| [TypeScript](https://www.typescriptlang.org/)                          | 类型安全                           |
| [TypeORM](https://typeorm.io/)                                         | ORM，实体管理 + 数据库迁移         |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)           | 嵌入式数据库，零配置               |
| [@nestjs/schedule](https://docs.nestjs.com/techniques/task-scheduling) | 定时任务（数据采集、每日自动调优） |
| [Axios](https://axios-http.com/)                                       | HTTP 请求（API 数据源调用）        |
| [DeepSeek API](https://api.deepseek.com/)                              | LLM 智能量化（情报参数化）         |

### 前端

| 技术                                          | 用途                                       |
| --------------------------------------------- | ------------------------------------------ |
| [React](https://react.dev/) 19                | UI 框架                                    |
| [TypeScript](https://www.typescriptlang.org/) | 类型安全                                   |
| [React Router](https://reactrouter.com/) v7   | 客户端路由                                 |
| [Vite](https://vitejs.dev/) 8                 | 构建工具 + 开发服务器                      |
| CSS（原生）                                   | 响应式样式，768px / 480px 双断点适配移动端 |

### 数据源

| 数据源                                              | 用途                         |
| --------------------------------------------------- | ---------------------------- |
| [football-data.org](https://www.football-data.org/) | 球队阵容、球员数据、比赛结果 |
| [TheSportsDB](https://www.thesportsdb.com/)         | 备用比分数据源               |
| football-data.co.uk CSV                             | 历史赔率数据                 |
| DeepSeek LLM                                        | 情报搜索与量化               |

## 核心功能

### 预测模型

- **ELO 评分模型**：基于历史战绩的国际足联排名变体，计算球队实力差距
- **赔率推测模型**：通过博彩市场赔率反推胜平负概率
- **泊松进球模型**：基于攻防数据建模预期进球数，推导最可能比分
- **Stacking 集成**：通过元学习器动态分配三模型权重，输出最终预测
- **多因素修正**：战术风格、天气、裁判、疲劳度、伤病、战意等因子实时调整

### 智能调优

- **自动权重搜索**：网格搜索 + 随机搜索，基于已完成比赛验证集寻找最优权重
- **交叉验证**：时间序列分割训练集/验证集，防止过拟合
- **每日自动调优**：所有世界杯比赛结束后一小时自动触发，持续优化预测精度
- **LLM 情报量化**：将比赛情报文本转化为结构化参数，辅助预测

### 数据管理

- **多源数据采集**：定时从 football-data.org 获取球队、球员、比赛数据
- **比分兜底**：football-data.org 缺失时自动切换 TheSportsDB 获取
- **球队阵容生成**：基于真实球员数据 + 市场价值构建模拟阵容
- **战力评估**：综合球员能力、身价、位置分布计算球队战力指数

### 前端页面

| 页面     | 功能                                                                         |
| -------- | ---------------------------------------------------------------------------- |
| 近期比赛 | 查看所有世界杯比赛，点击卡片展开集成预测详情（三模型对比、概率分布、贡献度） |
| 高级预测 | 自定义比赛参数（天气、裁判、战术等），获取精细预测结果                       |
| 球队排名 | ELO 排名列表，支持搜索过滤                                                   |
| 球员数据 | 各队球员详情、战力指数、阵容分析                                             |
| 球队详情 | 单队历史战绩、统计数据                                                       |
| 集成预测 | 快速选择两队进行集成预测                                                     |

### 移动端适配

- 768px / 480px 双断点响应式布局
- 比赛卡片单选展开，详情与卡片视觉融合
- 选中新卡片自动平滑滚动，避免焦点丢失
- 消除 300ms 点击延迟，支持 PWA 元标签

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 安装依赖

```bash
# 后端依赖
npm install

# 前端依赖
cd web && npm install && cd ..
```

### 配置环境变量

项目根目录 `.env` 文件：

```env
FOOTBALL_DATA_API_KEY=your_api_key    # football-data.org API Key
LLM_API_KEY=your_deepseek_key         # DeepSeek API Key
LLM_API_URL=https://api.deepseek.com/v1/chat/completions
LLM_MODEL=deepseek-chat
```

> football-data.org 免费 API Key 可在 [football-data.org](https://www.football-data.org/) 注册获取。

### 启动开发服务器

```bash
# 启动后端（端口 3000）
npm run start:dev

# 新终端，启动前端（端口 5173）
cd web && npm run dev
```

访问 `http://localhost:5173` 查看前端页面。

### 公网访问（移动端测试）

使用 Cloudflare Tunnel 暴露本地服务：

```bash
cloudflared tunnel --url http://localhost:5173
```

## 项目结构

```
nest/
├── src/
│   ├── collector/               # 数据采集模块
│   │   ├── api/                 # football-data.org API 数据源
│   │   ├── csv/                 # CSV 数据源
│   │   ├── scheduler/           # 定时采集调度
│   │   ├── collector.service.ts # 采集核心逻辑
│   │   └── collector.module.ts
│   ├── elo/                     # ELO 评分 & 预测模块
│   │   ├── elo.service.ts       # ELO 评分计算
│   │   ├── elo.controller.ts    # ELO API 接口
│   │   ├── ensemble.service.ts  # 多模型集成预测
│   │   ├── ensemble.controller.ts
│   │   ├── stacking.service.ts  # Stacking 元学习器
│   │   ├── odds.service.ts      # 赔率分析
│   │   ├── poisson.service.ts   # 泊松进球模型
│   │   ├── squad.service.ts     # 球队阵容管理
│   │   ├── wc-prediction.service.ts  # 世界杯预测核心
│   │   ├── wc-prediction.controller.ts
│   │   ├── wc-scheduler.ts      # 世界杯定时任务 + 每日自动调优
│   │   └── *.entity.ts          # TypeORM 实体定义
│   ├── match/                   # 比赛实体
│   ├── odds/                    # 赔率实体
│   ├── app.module.ts            # 根模块
│   └── main.ts                  # 应用入口
├── web/                         # 前端（React + Vite）
│   ├── src/
│   │   ├── components/          # 公共组件
│   │   │   └── Layout.tsx       # 布局 + 导航
│   │   ├── pages/               # 页面组件
│   │   │   ├── RecentMatches.tsx  # 近期比赛
│   │   │   ├── PredictAdvanced.tsx# 高级预测
│   │   │   ├── Rankings.tsx       # 球队排名
│   │   │   ├── Players.tsx        # 球员数据
│   │   │   ├── TeamDetail.tsx     # 球队详情
│   │   │   └── EnsemblePredict.tsx# 集成预测
│   │   ├── api.ts               # API 请求封装
│   │   ├── utils/               # 工具函数（i18n、时区等）
│   │   └── App.tsx              # 路由配置
│   ├── index.html
│   └── vite.config.ts
├── data/                        # SQLite 数据库文件
└── .env                         # 环境变量
```

## API 接口

| 端点                    | 方法 | 说明                   |
| ----------------------- | ---- | ---------------------- |
| `/elo/rankings`         | GET  | 获取 ELO 排名列表      |
| `/elo/team/:name`       | GET  | 获取球队详情           |
| `/elo/snapshot`         | GET  | 获取所有球队 ELO 快照  |
| `/elo/predict`          | POST | 高级预测（自定义参数） |
| `/elo/tune-result`      | GET  | 查看调优结果           |
| `/elo/auto-tune`        | POST | 手动触发自动调优       |
| `/elo/recent-matches`   | GET  | 近期比赛列表           |
| `/wc/recent`            | GET  | 世界杯预测列表         |
| `/wc/generate`          | POST | 生成世界杯预测         |
| `/wc/players/:team`     | GET  | 球队球员数据           |
| `/api/ensemble/predict` | GET  | 集成预测               |
| `/collector/fetch`      | POST | 手动触发数据采集       |
| `/collector/status`     | GET  | 采集状态查询           |

## License

MIT
