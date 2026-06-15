# FootballPredict 比赛预测模型技术文档

## 1. 概述

FootballPredict 是一个基于 **ELO 评分系统** 的足球比赛预测服务，在经典 ELO 算法基础上，扩展了多因素加权预测模型，综合考虑球队历史战绩、近期状态、球星影响力、战术风格、疲劳度、心理压力、天气条件和裁判判罚尺度等因素，输出胜平负概率和预测比分。

---

## 2. ELO 评分系统

### 2.1 基础原理

ELO 评分系统最初由 Arpad Elo 发明用于国际象棋排名，本系统将其适配到足球领域。核心思想是：**每场比赛后，胜者从败者处获取积分，积分变化量取决于双方的赛前评分差距**——爆冷时积分变化大，强队击败弱队时积分变化小。

### 2.2 初始参数

| 参数           | 默认值 | 说明                         |
| -------------- | ------ | ---------------------------- |
| initialRating  | 1500   | 新球队初始评分               |
| kFactor        | 32     | 积分变化系数，越大波动越剧烈 |
| homeAdvantage  | 100    | 主队额外 ELO 加成            |
| goalMultiplier | true   | 是否启用进球差乘数           |

### 2.3 期望胜率计算

两支球队 A 和 B 的期望得分（即胜率）通过以下公式计算：

```
E_A = 1 / (1 + 10^((R_B - R_A) / 400))
E_B = 1 - E_A
```

其中 `R_A` 和 `R_B` 分别是球队 A 和 B 的有效 ELO 评分。400 是标度因子，意味着 **400 分的评分差对应约 10:1 的胜率比**。

### 2.4 积分更新

每场比赛后，双方积分更新公式：

```
R_A_new = R_A + K_eff × (S_A - E_A)
R_B_new = R_B + K_eff × (S_B - E_B)
```

其中：

- `S_A` 为实际比赛结果：胜 = 1，平 = 0.5，负 = 0
- `E_A` 为期望得分
- `K_eff` 为有效 K 因子

### 2.5 有效 K 因子

K 因子不是固定值，而是由三个因子相乘得出：

```
K_eff = K_base × TournamentWeight × GoalMultiplier
```

#### 2.5.1 赛事权重（TournamentWeight）

不同赛事对积分的影响不同，重要赛事权重更高：

| 赛事                         | 权重 | 说明             |
| ---------------------------- | ---- | ---------------- |
| FIFA World Cup               | 1.5  | 世界杯，最高权重 |
| UEFA Euro                    | 1.4  | 欧洲杯           |
| Copa América                 | 1.4  | 美洲杯           |
| African Cup of Nations       | 1.3  | 非洲杯           |
| AFC Asian Cup                | 1.3  | 亚洲杯           |
| FIFA World Cup qualification | 1.2  | 世预赛           |
| CONCACAF Gold Cup            | 1.2  | 金杯赛           |
| UEFA Euro qualification      | 1.15 | 欧预赛           |
| UEFA Nations League          | 1.1  | 欧国联           |
| Friendly                     | 0.7  | 友谊赛，最低权重 |

#### 2.5.2 进球差乘数（GoalMultiplier）

大比分胜利应获得更多积分加成：

```
GoalDiff = |homeScore - awayScore|

GoalDiff ≤ 1  →  Multiplier = 1.0
GoalDiff = 2  →  Multiplier = 1.5
GoalDiff ≥ 3  →  Multiplier = (11 + GoalDiff) / 8
```

示例：3 球差 → 1.75，4 球差 → 1.875，5 球差 → 2.0

### 2.6 主场优势

非中立场地比赛，主队获得额外 ELO 加成（默认 +100）：

```
EffectiveHomeRating = HomeRating + HomeAdvantage  (非中立场地)
EffectiveHomeRating = HomeRating                   (中立场地)
```

100 分的主场优势约等于主队胜率提升约 15 个百分点。

---

## 3. 多因素加权预测模型（predictAdvanced）

基础 ELO 模型仅依赖历史比赛数据计算评分，无法反映临场因素。`predictAdvanced` 接口在此基础上引入了 **7 大影响因素**，将用户可调参数转化为 ELO 评分修正量，再计算最终概率。

### 3.1 模型架构

```
┌──────────────────────────────────────────────────────┐
│                   原始 ELO 评分                        │
│              HomeRating    AwayRating                  │
└──────────┬──────────────────────────┬────────────────┘
           │                          │
           ▼                          ▼
┌──────────────────────────────────────────────────────┐
│              第一层：ELO 评分修正层                      │
│                                                       │
│  HomeEffective = HomeRating                           │
│    + HomeAdvantage                                    │
│    + FormEffect × 50                                  │
│    + StarEffect × 45                                  │
│    + TacticsEffect × 35                               │
│    + FatigueEffect × 35                               │
│    + PressureEffect × 30                              │
│                                                       │
│  AwayEffective = AwayRating                           │
│    - FormEffect × 50                                  │
│    - StarEffect × 45                                  │
│    - TacticsEffect × 35                               │
│    - FatigueEffect × 35                               │
│    - PressureEffect × 30                              │
└──────────┬──────────────────────────┬────────────────┘
           │                          │
           ▼                          ▼
┌──────────────────────────────────────────────────────┐
│              第二层：概率计算层                          │
│                                                       │
│  HomeWinProb = ELO_formula(HomeEff, AwayEff)          │
│  AwayWinProb = ELO_formula(AwayEff, HomeEff)          │
│  DrawProb = estimateDrawProbability(...)              │
│                                                       │
│  缩放: HomeWin = HomeWinProb × (1 - DrawProb)         │
│        AwayWin = AwayWinProb × (1 - DrawProb)         │
└──────────┬──────────────────────────┬────────────────┘
           │                          │
           ▼                          ▼
┌──────────────────────────────────────────────────────┐
│              第三层：概率调整层                          │
│                                                       │
│  HomeWin += WeatherEffect                             │
│  AwayWin -= WeatherEffect                             │
│  DrawProb += RefereeEffect                            │
│                                                       │
│  归一化: Total = HomeWin + DrawProb + AwayWin          │
│          HomeWin /= Total, ...                        │
└──────────┬──────────────────────────┬────────────────┘
           │                          │
           ▼                          ▼
┌──────────────────────────────────────────────────────┐
│              第四层：比分预测层                          │
│                                                       │
│  基于 EffectiveRating 差值和概率计算预期进球数           │
│  考虑天气和裁判对进球数的影响                           │
└──────────────────────────────────────────────────────┘
```

### 3.2 各因素详细计算

#### 3.2.1 球队近期状态（Form Effect）

| 参数     | 范围   | 默认值 |
| -------- | ------ | ------ |
| homeForm | 1 ~ 10 | 5      |
| awayForm | 1 ~ 10 | 5      |

计算公式：

```
FormEffect = (homeForm - awayForm) / 10
```

ELO 修正量 = `FormEffect × 50`

极端情况：主队 10、客队 1 → FormEffect = 0.9 → 主队 +45 ELO，客队 -45 ELO，合计 **90 分差**

**设计依据**：近期连胜/连败对球队信心和比赛节奏影响显著，状态正佳的球队往往能超常发挥。

---

#### 3.2.2 球星影响力（Star Power Effect）

| 参数          | 范围   | 默认值 |
| ------------- | ------ | ------ |
| homeStarPower | 1 ~ 10 | 5      |
| awayStarPower | 1 ~ 10 | 5      |

计算公式：

```
StarEffect = (homeStarPower - awayStarPower) / 10
```

ELO 修正量 = `StarEffect × 45`

极端情况：主队 10、客队 1 → StarEffect = 0.9 → 主队 +40.5 ELO，客队 -40.5 ELO，合计 **81 分差**

**设计依据**：球星个人能力可在关键时刻改变比赛走势，如梅西、姆巴佩等顶级球员的存在显著提升球队上限。

---

#### 3.2.3 战术风格（Tactics Effect）

| 参数                      | 选项                | 基础值 |
| ------------------------- | ------------------- | ------ |
| homeTactics / awayTactics | attacking（进攻型） | +0.35  |
|                           | balanced（均衡型）  | 0      |
|                           | defensive（防守型） | -0.25  |

计算公式：

```
TacticsEffect = TacticsMap[homeTactics] - TacticsMap[awayTactics]
```

ELO 修正量 = `TacticsEffect × 35`

极端情况：主队进攻型(0.35)、客队防守型(-0.25) → TacticsEffect = 0.6 → 主队 +21 ELO，客队 -21 ELO，合计 **42 分差**

**设计依据**：

- 进攻型战术积极前压，创造更多得分机会但防守薄弱
- 防守型战术稳固反击，减少失球但进攻乏力
- 均衡型攻守兼备，不偏不倚

---

#### 3.2.4 疲劳度（Fatigue Effect）

| 参数        | 范围   | 默认值 |
| ----------- | ------ | ------ |
| homeFatigue | 1 ~ 10 | 3      |
| awayFatigue | 1 ~ 10 | 3      |

计算公式：

```
FatigueEffect = (awayFatigue - homeFatigue) / 10
```

注意：**疲劳度越高越不利**，所以取 `away - home`，对手疲劳则己方获益。

ELO 修正量 = `FatigueEffect × 35`

极端情况：主队 1（低疲劳）、客队 10（高疲劳） → FatigueEffect = 0.9 → 主队 +31.5 ELO，客队 -31.5 ELO，合计 **63 分差**

**设计依据**：赛程密集、长途旅行导致疲劳累积，高疲劳球队在比赛后半段体能下降明显，失误率上升。

---

#### 3.2.5 心理压力（Pressure Effect）

| 参数         | 范围   | 默认值 |
| ------------ | ------ | ------ |
| homePressure | 1 ~ 10 | 5      |
| awayPressure | 1 ~ 10 | 5      |

计算公式：

```
PressureEffect = (awayPressure - homePressure) / 10
```

注意：**压力越大越不利**，所以取 `away - home`，对手压力大则己方获益。

ELO 修正量 = `PressureEffect × 30`

极端情况：主队 1（低压力）、客队 10（高压） → PressureEffect = 0.9 → 主队 +27 ELO，客队 -27 ELO，合计 **54 分差**

**设计依据**：大赛经验不足或背水一战的压力影响球员发挥，高压下技术动作变形、决策失误增多。

---

#### 3.2.6 天气条件（Weather Effect）

| 参数             | 范围   | 说明                   |
| ---------------- | ------ | ---------------------- |
| weatherCondition | 枚举值 | 天气状况               |
| weatherWeight    | 0 ~ 3  | 天气影响权重，默认 1.0 |

天气基础影响值：

| 天气条件   | 基础影响 | 说明         |
| ---------- | -------- | ------------ |
| sunny      | 0        | 晴天无影响   |
| cloudy     | 0        | 多云无影响   |
| rainy      | -0.08    | 小雨轻微影响 |
| windy      | -0.10    | 大风影响传球 |
| cold       | -0.08    | 低温影响体能 |
| snowy      | -0.12    | 降雪显著影响 |
| heavy_rain | -0.15    | 暴雨严重影响 |
| hot        | -0.06    | 高温轻微影响 |
| humid      | -0.05    | 潮湿轻微影响 |

计算公式：

```
BaseEffect = WeatherImpact[condition]
Direction = HomeRating > AwayRating ? -1 : 1
WeatherEffect = BaseEffect × weatherWeight × Direction
```

**关键设计**：恶劣天气**缩小强弱差距**。如果强队是主队（ratingDiff > 0），天气影响方向为负（削弱强队）；如果弱队是主队，天气影响方向为正（同样削弱强队）。这反映了恶劣天气下技术优势被削弱的现实规律。

天气效果直接作用于概率层面（非 ELO 层面）：

```
AdjustedHomeWin += WeatherEffect
AdjustedAwayWin -= WeatherEffect
```

---

#### 3.2.7 裁判判罚尺度（Referee Effect）

| 参数              | 范围   | 说明                   |
| ----------------- | ------ | ---------------------- |
| refereeStrictness | 枚举值 | 裁判严格程度           |
| refereeWeight     | 0 ~ 3  | 裁判影响权重，默认 1.0 |

裁判基础影响值：

| 严格程度    | 基础影响 | 说明                   |
| ----------- | -------- | ---------------------- |
| lenient     | +0.06    | 宽松，增加强队胜率     |
| average     | 0        | 适中，无影响           |
| strict      | -0.06    | 严格，增加平局概率     |
| very_strict | -0.10    | 极严，显著增加平局概率 |

计算公式：

```
RefereeEffect = StrictnessImpact[strictness] × refereeWeight
```

裁判效果作用于平局概率：

```
DrawProb += RefereeEffect
```

**设计依据**：严格裁判频繁出牌中断比赛，降低强队的技术优势，使比赛更趋于平局。宽松裁判让比赛更流畅，有利于技术更好的强队。

---

#### 3.2.8 公平维持权重（Fairness Effect）

| 参数           | 范围  | 默认值 |
| -------------- | ----- | ------ |
| fairnessWeight | 0 ~ 3 | 1.0    |

计算公式：

```
Imbalance = HomeWin - AwayWin
FairnessEffect = -Imbalance × 0.15 × fairnessWeight
```

效果作用于概率层面：

```
AdjustedHomeWin += FairnessEffect
AdjustedAwayWin -= FairnessEffect
```

**设计依据**：公平维持因素模拟裁判和赛事组织方对比赛平衡性的倾向。当双方实力悬殊时，公平机制会倾向于缩小差距——例如 VAR 介入、补时增加等，使弱队有更多机会。权重越高，"拉平"效果越强。

极端情况：主胜 60% vs 客胜 20%，fairnessWeight = 3 → FairnessEffect = -(0.6-0.2) × 0.15 × 3 = -0.18，主胜降至 42%，客胜升至 38%。

---

#### 3.2.9 FIFA 收益权重（FIFA Revenue Effect）

| 参数       | 范围  | 默认值 |
| ---------- | ----- | ------ |
| fifaWeight | 0 ~ 3 | 1.0    |

计算公式：

```
StrongerSide = HomeRating > AwayRating ? 1 : -1
CommercialBoost = StrongerSide × 0.06 × fifaWeight
IsClose = |HomeWin - AwayWin| < 0.1
ExcitementBonus = IsClose ? 0 : StrongerSide × 0.03 × fifaWeight
FifaEffect = CommercialBoost + ExcitementBonus
```

效果作用于概率层面：

```
AdjustedHomeWin += FifaEffect
AdjustedAwayWin -= FifaEffect
```

**设计依据**：从国际足联商业推广角度，强队晋级有利于维持赛事关注度和赞助商利益（商业加成）；但比赛过于胶着时，FIFA 不再额外推动（兴奋度加成为 0），因为势均力敌的比赛本身就有商业价值。权重越高，强队获得的商业"助力"越大。

极端情况：强队为主队，fifaWeight = 3 → FifaEffect = (1 × 0.06 + 1 × 0.03) × 3 = 0.27，强队胜率提升约 27 个百分点。

---

#### 3.2.10 庄家收益权重（Bookmaker Effect）

| 参数            | 范围  | 默认值 |
| --------------- | ----- | ------ |
| bookmakerWeight | 0 ~ 3 | 1.0    |

计算公式：

```
Imbalance = HomeWin - AwayWin
HomeShift = -Imbalance × 0.08 × bookmakerWeight
DrawShift = 0.05 × bookmakerWeight
```

效果作用于概率层面：

```
AdjustedHomeWin += HomeShift
AdjustedAwayWin -= HomeShift
DrawProb += DrawShift
```

**设计依据**：博彩庄家的核心策略是平衡两边投注额以锁定利润，而非预测比赛结果。庄家倾向于：1）缩小热门与冷门的概率差距（HomeShift），吸引更多冷门方向投注；2）抬高平局概率（DrawShift），因为平局是庄家利润最优解。权重越高，"平衡"和"平局倾向"效果越强。

极端情况：主胜 60% vs 客胜 20%，bookmakerWeight = 3 → HomeShift = -(0.6-0.2) × 0.08 × 3 = -0.096，DrawShift = 0.15。主胜降至 50.4%，平局增加 15%。

---

### 3.3 平局概率估算

平局概率独立于 ELO 胜率计算，基于评分差估算：

```
BaseDrawRate = 0.26
DrawReduction = |HomeRating - AwayRating| / 4000
DrawProb = clamp(BaseDrawRate - DrawReduction, 0.10, 0.35)
```

- 双方评分越接近，平局概率越高（最高 35%）
- 评分差距越大，平局概率越低（最低 10%）
- 基础平局率 26% 接近足球比赛的历史平局比例

### 3.4 概率归一化

所有调整完成后，三个概率必须归一化确保总和为 1：

```
Total = HomeWin + DrawProb + AwayWin
HomeWin /= Total
DrawProb /= Total
AwayWin /= Total
```

同时设置安全边界：

- 单项概率最低 0.01（1%）
- 平局概率范围 [0.05, 0.40]

---

## 4. 比分预测模型

比分预测基于有效 ELO 评分差和概率，采用期望进球数模型：

### 4.1 基础期望进球

```
BaseGoals = 1.3
HomeExpected = BaseGoals + RatingDiff / 800
AwayExpected = BaseGoals - RatingDiff / 800
```

- 基础场均进球 1.3（接近国际比赛历史均值）
- 每 800 分 ELO 差对应 1 个进球差
- 最低期望进球 0.3

### 4.2 强弱修正

```
if (HomeWinProb > AwayWinProb + 0.15):
    HomeExpected += 0.4    // 强队额外加成
elif (AwayWinProb > HomeWinProb + 0.15):
    AwayExpected += 0.4
```

### 4.3 平局修正

```
if (DrawProb > 0.28):
    Avg = (HomeExpected + AwayExpected) / 2
    HomeExpected = HomeExpected × 0.6 + Avg × 0.4
    AwayExpected = AwayExpected × 0.6 + Avg × 0.4
```

平局概率高时，将双方进球数向均值靠拢，反映势均力敌的比赛特征。

### 4.4 天气与裁判修正

```
HomeExpected += WeatherEffect × 2
AwayExpected -= WeatherEffect × 2

if (RefereeEffect < 0):  // 严格裁判
    HomeExpected -= 0.1
    AwayExpected -= 0.1
```

恶劣天气降低总进球数，严格裁判中断比赛减少进球机会。

---

## 5. 因素影响力汇总

各因素在极端参数下对 ELO 评分的最大影响：

| 因素         | 权重乘数 | 极端值 | 最大 ELO 影响（单侧）     | 占比     |
| ------------ | -------- | ------ | ------------------------- | -------- |
| 球队近期状态 | ×50      | 0.9    | ±45.0                     | 22.7%    |
| 球星影响力   | ×45      | 0.9    | ±40.5                     | 20.5%    |
| 战术风格     | ×35      | 0.6    | ±21.0                     | 10.6%    |
| 疲劳度       | ×35      | 0.9    | ±31.5                     | 15.9%    |
| 心理压力     | ×30      | 0.9    | ±27.0                     | 13.6%    |
| 公平维持     | 概率层   | -      | ±0.18（概率）             | 5.4%     |
| FIFA收益     | 概率层   | -      | ±0.27（概率）             | 6.8%     |
| 庄家收益     | 概率层   | -      | ±0.15（概率）             | 4.5%     |
| **合计**     |          |        | **±165.0 ELO + 概率调整** | **100%** |

加上天气和裁判对概率层面的直接影响，以及博弈论权重的概率修正，所有因素叠加可产生约 **330 分的 ELO 等效差 + 概率层调整**，足以将一场势均力敌的比赛（50% vs 50%）变为一边倒（约 85% vs 15%）。

---

## 6. 博弈论对比分析

系统还提供了多平台预测对比和博弈论分析功能。

### 6.1 多平台模拟

基于本系统预测结果，通过高斯噪声模拟其他平台的预测：

```
SimHomeWin = clamp(OurHomeWin + Gaussian(0, 0.08), 0, 1)
SimAwayWin = clamp(OurAwayWin + Gaussian(0, 0.08), 0, 1)
SimDraw = 1 - SimHomeWin - SimAwayWin
```

模拟平台包括：

- FiveThirtyEight
- Opta Analyst
- 博彩市场平均

### 6.2 博弈论分析

从三个角度分析预测差异：

1. **比赛公平维持角度**：裁判判罚尺度、VAR 干预对比赛平衡的影响
2. **国际足联推广收益角度**：比赛结果对世界杯商业价值和全球关注度的影响
3. **资本庄家收益最大化角度**：赔率设计与诱导、热门冷门平衡的博弈策略

分析由 LLM（DeepSeek）生成，API 不可用时使用基于规则的默认分析。

---

## 7. 数据来源

### 7.1 历史比赛数据

来自 Kaggle 的国际足球比赛结果数据集（`international_results.csv`），包含 1872 年至今的数万场国际比赛记录。

### 7.2 实时数据

- 天气数据：Open-Meteo API（免费，无需 API Key）
- 裁判信息：系统内置裁判数据库
- 球员阵容：系统内置球队阵容数据

---

## 8. API 接口

### 8.1 基础预测

```
GET /elo/predict?home=Brazil&away=Argentina&neutral=false
```

仅基于 ELO 评分和主场优势，返回胜平负概率。

### 8.2 高级预测

```
POST /elo/predict-advanced
Content-Type: application/json

{
  "homeTeam": "Brazil",
  "awayTeam": "Argentina",
  "neutral": false,
  "kFactor": 32,
  "homeAdvantage": 100,
  "weatherWeight": 1.0,
  "refereeWeight": 1.0,
  "weatherCondition": "sunny",
  "refereeStrictness": "average",
  "homeForm": 5,
  "awayForm": 5,
  "homeStarPower": 5,
  "awayStarPower": 5,
  "homeTactics": "balanced",
  "awayTactics": "balanced",
  "homeFatigue": 3,
  "awayFatigue": 3,
  "homePressure": 5,
  "awayPressure": 5,
  "fairnessWeight": 1.0,
  "fifaWeight": 1.0,
  "bookmakerWeight": 1.0
}
```

返回包含胜平负概率、预测比分和各因素效果值的完整预测结果。

---

## 9. 模型局限性与改进方向

### 9.1 当前局限

1. **ELO 评分的滞后性**：评分基于历史比赛累积计算，对球队近期突变（如核心球员受伤）反应迟钝
2. **因素权重固定**：各因素权重为人工设定，未通过机器学习优化
3. **平局概率模型简化**：仅基于评分差估算，未考虑具体对阵风格
4. **比分预测精度有限**：期望进球数模型为线性近似，实际足球进球更接近泊松分布

### 9.2 改进方向

1. 引入 **Dixon-Coles 模型** 改进比分预测，使用泊松分布建模进球数
2. 通过 **历史数据回测** 优化各因素权重，使用最大似然估计
3. 加入 **球员级别数据**（伤病、停赛），替代笼统的"球星影响力"参数
4. 引入 **时间衰减**，让近期比赛对 ELO 评分的影响更大
5. 考虑 **对手实力调整**（Strength of Schedule），避免弱旅刷分
