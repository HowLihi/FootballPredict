---
name: 'intelligence-quantifier'
description: 'Converts gathered match intelligence into quantified prediction parameters via LLM. Invoke when user wants to auto-fill match params from intelligence or asks to quantify/parameterize intelligence data.'
---

# Intelligence Quantifier

This skill converts qualitative match intelligence (gathered by the "搜集情报" feature) into quantified prediction parameters for the match prediction system.

## When to Invoke

- User clicks "📊 量化参数" button in the PredictAdvanced page
- User asks to convert/quantify intelligence into parameters
- User wants to auto-fill match params based on gathered intelligence
- User wants to tune the prediction workflow using completed matches

## How It Works

### Flow

1. **Gather Intelligence** (🔍 搜集情报) → calls DeepSeek LLM with match data → returns `MatchSummaryData` (highlights, keyEvents, refereeNote, venueNote, generalNote)
2. **Quantify Intelligence** (📊 量化参数) → sends the gathered intelligence to LLM → returns quantified params + reasoning
3. **Tune Workflow** (🎯 调优工作流) → processes all completed matches end-to-end, compares predictions with actual results, and adjusts parameter weights

### API Endpoints

```
POST /wc/gather-intelligence/:id
POST /wc/quantify-intelligence/:id
Body: { summary: MatchSummaryData }
Response: { params: QuantifiedParams, reasoning: string }

POST /wc/tune-workflow
Body: { customWeights?: { formWeight?, starPowerWeight?, ... } }
Response: { matches: [...], summary: { baseMAE, tunedMAE, improvement, ... } }
```

### Quantified Parameters

| Parameter                           | Type | Range                                              | Description                                  |
| ----------------------------------- | ---- | -------------------------------------------------- | -------------------------------------------- |
| homeForm / awayForm                 | int  | 1-10                                               | Recent form (1=极差, 5=一般, 9=极佳)         |
| homeStarPower / awayStarPower       | int  | 1-10                                               | Star player influence (1=无球星, 9=超级巨星) |
| homeTactics / awayTactics           | enum | balanced/attacking/defensive/possession/high_press | Tactical style                               |
| homeFatigue / awayFatigue           | int  | 1-10                                               | Fatigue level (1=充沛, 9=体能枯竭)           |
| homePressure / awayPressure         | int  | 1-10                                               | Psychological pressure (1=轻松, 9=极端高压)  |
| homeInjuryImpact / awayInjuryImpact | int  | 1-10                                               | Injury impact (1=轻微, 9=灾难性)             |
| homeStakes / awayStakes             | int  | 1-10                                               | Match importance (1=低, 9=生死战)            |
| refereeStrictness                   | enum | lenient/average/strict/very_strict                 | Referee strictness                           |
| weatherCondition                    | enum | sunny/cloudy/rainy/snowy/windy/hot                 | Weather condition                            |

### Quantification Rules (量化规则)

#### 1. homeForm / awayForm (近期状态)

- 基准：ELO分差>100的一方+1，分差>200的+2
- 情报中明确提到"连胜""状态火热"→ 7-9
- "连败""状态低迷"→ 1-3
- 无明确状态信息 → 5-6（默认一般）
- 注意：不要仅凭ELO高低断定状态

#### 2. homeStarPower / awayStarPower (球星影响力)

- 有超级巨星（OVR>88）→ 8-9
- 有核心球星（OVR>83）→ 6-7
- 有实力球员 → 4-5
- 无突出球星 → 1-3
- 情报中若提到球星缺阵或状态不佳，应降低评分

#### 3. homeTactics / awayTactics (战术风格)

- 强队对弱队 → attacking 或 possession
- 弱队对强队 → defensive
- 实力接近 → balanced 或 high_press

#### 4. homeFatigue / awayFatigue (疲劳程度)

- 小组赛第1轮 → 默认3（正常）
- 小组赛第2轮 → 默认4-5
- 小组赛第3轮 → 默认5-6
- 淘汰赛 → 默认6-7
- "密集赛程""长途跋涉"→ +1-2
- "轮换阵容""充分休息"→ -1-2

#### 5. homePressure / awayPressure (心理压力)

- 东道主/卫冕冠军 → 7-9
- 传统强队但近期表现不佳 → 6-8
- 弱队无心理负担 → 2-4
- 中立场地 → 双方压力均略降

#### 6. homeInjuryImpact / awayInjuryImpact (伤病影响)

- 无伤病信息 → 默认1（轻微）
- 个别替补受伤 → 2-3
- 主力轮换受伤 → 4-5
- 核心球员受伤 → 6-7
- 多名核心缺阵 → 8-9

#### 7. homeStakes / awayStakes (比赛重要性)

- 小组赛第1轮 → 默认5
- 小组赛第2轮 → 默认6
- 小组赛第3轮（出线关键战）→ 8-9
- 淘汰赛 → 9-10

#### 8. refereeStrictness

- 根据裁判情报中的风格描述选择
- 无明确风格信息 → average

#### 9. weatherCondition

- 根据天气情报中的实际天气状况选择
- 无天气数据 → sunny

### Parameter-to-Score Weight Configuration

These weights control how much each quantified parameter affects the predicted score. They can be tuned via the `POST /wc/tune-workflow` endpoint.

| Weight          | Default | Description                                    |
| --------------- | ------- | ---------------------------------------------- |
| formWeight      | 0.12    | Impact of recent form on expected goals        |
| starPowerWeight | 0.10    | Impact of star players on expected goals       |
| tacticsWeight   | 0.15    | Impact of tactical style on expected goals     |
| fatigueWeight   | 0.10    | Impact of fatigue on expected goals            |
| pressureWeight  | 0.06    | Impact of psychological pressure on goals      |
| injuryWeight    | 0.12    | Impact of injuries on expected goals           |
| stakesWeight    | 0.05    | Impact of match importance on expected goals   |
| weatherWeight   | 0.08    | Impact of weather conditions on expected goals |
| refereeWeight   | 0.06    | Impact of referee strictness on expected goals |

### Tuning Workflow

The `POST /wc/tune-workflow` endpoint processes all completed matches:

1. For each completed match, calls `gatherIntelligence` + `quantifyIntelligence`
2. Saves the quantified params as `MatchParams` in the database
3. Runs `predictWithParams` to get the tuned prediction
4. Compares base prediction vs tuned prediction vs actual score
5. Returns MAE, RMSE, result accuracy, and per-match analysis

The endpoint accepts optional `customWeights` to test different weight configurations.

### LLM Prompt Strategy

- Temperature: 0.3 (low, for consistent quantification)
- The prompt includes all intelligence highlights, key events, referee/venue notes, and general summary
- Each parameter has explicit range definitions and semantic labels
- LLM is instructed to base analysis on actual intelligence data, not fabricate information
- Output validation: all numeric params are clamped to valid ranges, enums are validated against allowed values

### Frontend Integration

- Button "📊 量化参数" appears next to "🔍 搜集情报" only when `matchSummary` exists
- On click, calls API and auto-fills all parameter sliders/selects in the form
- Shows reasoning in a green banner below the intelligence summary
- User can still manually adjust any parameter after quantification

### Key Files

- Backend service: `src/elo/wc-prediction.service.ts` → `gatherIntelligence()`, `quantifyIntelligence()`, `tunePredictionWorkflow()`
- Backend controller: `src/elo/wc-prediction.controller.ts` → `POST /wc/tune-workflow`
- Ensemble service: `src/elo/ensemble.service.ts` → `predictWithParams()`, `paramWeights`
- Frontend API: `web/src/api/index.ts` → `api.wc.quantifyIntelligence()`
- Frontend component: `web/src/pages/PredictAdvanced.tsx` → `handleQuantifyIntelligence()`
- Frontend styles: `web/src/pages/PredictAdvanced.css` → `.btn-quantify-intel`, `.quantify-reasoning`
