import { useState, useEffect } from 'react';
import { api, type EnsemblePrediction, type WcPrediction } from '../api';
import { tTeam, tVenue } from '../utils/i18n';
import { parseBeijingParts } from '../utils/beijing-time';
import './EnsemblePredict.css';

const MODEL_LABELS: Record<string, string> = {
  elo: 'ELO 评分',
  odds: '赔率推测',
  poisson: '泊松进球',
};

const MODEL_COLORS: Record<string, string> = {
  elo: '#6366f1',
  odds: '#f59e0b',
  poisson: '#10b981',
};

const CONFIDENCE_LABELS: Record<string, { text: string; color: string }> = {
  high: { text: '高置信度', color: '#10b981' },
  medium: { text: '中等置信度', color: '#f59e0b' },
  low: { text: '低置信度', color: '#ef4444' },
};

export default function EnsemblePredict() {
  const [homeInput, setHomeInput] = useState('');
  const [awayInput, setAwayInput] = useState('');
  const [neutral, setNeutral] = useState(false);
  const [prediction, setPrediction] = useState<EnsemblePrediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [matches, setMatches] = useState<WcPrediction[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(true);

  useEffect(() => {
    api.wc
      .getRecentMatches()
      .then((data) => {
        const upcoming = data.filter(
          (m) => m.actualHomeScore === null && m.actualAwayScore === null,
        );
        setMatches(upcoming.slice(0, 20));
      })
      .catch(() => {})
      .finally(() => setLoadingMatches(false));
  }, []);

  const handlePredict = async (
    home: string,
    away: string,
    isNeutral: boolean = neutral,
  ) => {
    if (!home || !away) {
      setError('请输入主队和客队名称');
      return;
    }
    setLoading(true);
    setError('');
    setPrediction(null);
    try {
      const res = await api.ensemble.predict(home, away, isNeutral);
      if (res && 'error' in res) {
        setError(res.error as string);
      } else if (res) {
        setPrediction(res as EnsemblePrediction);
      } else {
        setError('未找到球队数据');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectMatch = (m: WcPrediction) => {
    setHomeInput(m.homeTeam);
    setAwayInput(m.awayTeam);
    setNeutral(m.neutral);
    handlePredict(m.homeTeam, m.awayTeam, m.neutral);
  };

  const formatTime = (dateStr: string) => {
    const b = parseBeijingParts(dateStr);
    return `${b.month}月${b.day}日 ${b.hours}:${b.minutes}`;
  };

  const maxProb = prediction
    ? Math.max(
        prediction.finalHomeWin,
        prediction.finalDraw,
        prediction.finalAwayWin,
      )
    : 0;

  const predictedLabel = prediction
    ? maxProb === prediction.finalHomeWin
      ? `${tTeam(prediction.homeTeam)} 胜`
      : maxProb === prediction.finalAwayWin
        ? `${tTeam(prediction.awayTeam)} 胜`
        : '平局'
    : '';

  return (
    <div className="ensemble-page">
      <h1>🧠 多模型集成预测</h1>
      <p className="page-desc">
        融合 ELO 评分、博彩赔率隐含概率、Dixon-Coles 泊松模型，通过 Stacking
        元模型动态加权，给出最可靠的预测结果
      </p>

      <div className="ensemble-layout">
        <div className="ensemble-input-panel">
          <h3>📝 输入队伍</h3>

          <div className="input-group">
            <label>主队</label>
            <input
              type="text"
              placeholder="例如: Argentina"
              value={homeInput}
              onChange={(e) => setHomeInput(e.target.value)}
            />
          </div>
          <div className="input-group">
            <label>客队</label>
            <input
              type="text"
              placeholder="例如: France"
              value={awayInput}
              onChange={(e) => setAwayInput(e.target.value)}
            />
          </div>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={neutral}
              onChange={(e) => setNeutral(e.target.checked)}
            />
            中立场地
          </label>

          <button
            className="btn btn-primary"
            onClick={() => handlePredict(homeInput, awayInput)}
            disabled={loading || !homeInput || !awayInput}
          >
            {loading ? '分析中...' : '🔮 集成预测'}
          </button>

          {error && <div className="error-msg">{error}</div>}

          <div className="divider" />

          <h3>📅 快速选择</h3>
          {loadingMatches && <div className="loading-small">加载中...</div>}
          <div className="match-list">
            {matches.map((m) => (
              <div
                key={m.id}
                className="match-chip"
                onClick={() => handleSelectMatch(m)}
              >
                <span className="chip-teams">
                  {tTeam(m.homeTeam)} vs {tTeam(m.awayTeam)}
                </span>
                <span className="chip-time">{formatTime(m.matchDate)}</span>
                {m.venue && (
                  <span className="chip-venue">{tVenue(m.venue)}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="ensemble-result-panel">
          {!prediction && !loading && !error && (
            <div className="result-placeholder">
              <div className="placeholder-icon">🧠</div>
              <p>输入两支球队名称，查看三模型集成预测结果</p>
              <p className="placeholder-hint">
                系统将融合 ELO、赔率、泊松三个模型，通过动态权重给出最优预测
              </p>
            </div>
          )}

          {prediction && (
            <div className="ensemble-result">
              <div className="result-header">
                <h2>预测结果</h2>
                <span
                  className="confidence-badge"
                  style={{
                    color: CONFIDENCE_LABELS[prediction.confidence]?.color,
                    borderColor:
                      CONFIDENCE_LABELS[prediction.confidence]?.color,
                  }}
                >
                  {CONFIDENCE_LABELS[prediction.confidence]?.text}
                </span>
              </div>

              <div className="result-matchup">
                <div className="result-team">
                  <span className="rt-label">主队</span>
                  <span className="rt-name">{tTeam(prediction.homeTeam)}</span>
                  <span className="rt-rating">
                    ELO {Math.round(prediction.homeRating)}
                  </span>
                </div>
                <div className="result-center">
                  <div className="result-score">
                    {prediction.predictedHomeScore.toFixed(1)} :{' '}
                    {prediction.predictedAwayScore.toFixed(1)}
                  </div>
                  <div className="result-verdict">{predictedLabel}</div>
                </div>
                <div className="result-team">
                  <span className="rt-label">客队</span>
                  <span className="rt-name">{tTeam(prediction.awayTeam)}</span>
                  <span className="rt-rating">
                    ELO {Math.round(prediction.awayRating)}
                  </span>
                </div>
              </div>

              <div className="result-probs">
                <div className="result-prob-item">
                  <div className="rp-header">
                    <span>主队胜</span>
                    <span className="rp-pct">
                      {(prediction.finalHomeWin * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="rp-bar">
                    <div
                      className={`rp-fill home ${prediction.finalHomeWin === maxProb ? 'max' : ''}`}
                      style={{ width: `${prediction.finalHomeWin * 100}%` }}
                    />
                  </div>
                </div>
                <div className="result-prob-item">
                  <div className="rp-header">
                    <span>平局</span>
                    <span className="rp-pct">
                      {(prediction.finalDraw * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="rp-bar">
                    <div
                      className={`rp-fill draw ${prediction.finalDraw === maxProb ? 'max' : ''}`}
                      style={{ width: `${prediction.finalDraw * 100}%` }}
                    />
                  </div>
                </div>
                <div className="result-prob-item">
                  <div className="rp-header">
                    <span>客队胜</span>
                    <span className="rp-pct">
                      {(prediction.finalAwayWin * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="rp-bar">
                    <div
                      className={`rp-fill away ${prediction.finalAwayWin === maxProb ? 'max' : ''}`}
                      style={{ width: `${prediction.finalAwayWin * 100}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="divider" />

              <h3>📊 三模型分解</h3>
              <div className="models-grid">
                {Object.entries(prediction.individualModels).map(
                  ([key, model]) => {
                    const modelMax = Math.max(
                      'homeWin' in model ? model.homeWin : 0,
                      'draw' in model ? model.draw : 0,
                      'awayWin' in model ? model.awayWin : 0,
                    );
                    const contribution = prediction.modelContributions.find(
                      (c) => c.modelName === key,
                    );

                    return (
                      <div key={key} className="model-card">
                        <div className="model-card-header">
                          <span
                            className="model-dot"
                            style={{ background: MODEL_COLORS[key] || '#888' }}
                          />
                          <span className="model-name">
                            {MODEL_LABELS[key] || key}
                          </span>
                          <span className="model-weight">
                            权重:{' '}
                            {contribution
                              ? (contribution.weight * 100).toFixed(0)
                              : '-'}
                            %
                          </span>
                        </div>

                        <div className="model-probs">
                          <div className="model-prob-row">
                            <span className="mp-label">主胜</span>
                            <div className="mp-bar-track">
                              <div
                                className="mp-bar-fill"
                                style={{
                                  width: `${('homeWin' in model ? model.homeWin : 0) * 100}%`,
                                  background: MODEL_COLORS[key] || '#888',
                                  opacity:
                                    modelMax ===
                                    ('homeWin' in model ? model.homeWin : 0)
                                      ? 1
                                      : 0.5,
                                }}
                              />
                            </div>
                            <span className="mp-val">
                              {('homeWin' in model
                                ? model.homeWin * 100
                                : 0
                              ).toFixed(1)}
                              %
                            </span>
                          </div>
                          <div className="model-prob-row">
                            <span className="mp-label">平局</span>
                            <div className="mp-bar-track">
                              <div
                                className="mp-bar-fill"
                                style={{
                                  width: `${('draw' in model ? model.draw : 0) * 100}%`,
                                  background: MODEL_COLORS[key] || '#888',
                                  opacity:
                                    modelMax ===
                                    ('draw' in model ? model.draw : 0)
                                      ? 1
                                      : 0.35,
                                }}
                              />
                            </div>
                            <span className="mp-val">
                              {('draw' in model ? model.draw * 100 : 0).toFixed(
                                1,
                              )}
                              %
                            </span>
                          </div>
                          <div className="model-prob-row">
                            <span className="mp-label">客胜</span>
                            <div className="mp-bar-track">
                              <div
                                className="mp-bar-fill"
                                style={{
                                  width: `${('awayWin' in model ? model.awayWin : 0) * 100}%`,
                                  background: MODEL_COLORS[key] || '#888',
                                  opacity:
                                    modelMax ===
                                    ('awayWin' in model ? model.awayWin : 0)
                                      ? 1
                                      : 0.5,
                                }}
                              />
                            </div>
                            <span className="mp-val">
                              {('awayWin' in model
                                ? model.awayWin * 100
                                : 0
                              ).toFixed(1)}
                              %
                            </span>
                          </div>
                        </div>

                        {'homeGoalsExpected' in model && (
                          <div className="model-extra">
                            <span>
                              预期进球: {model.homeGoalsExpected.toFixed(2)} -{' '}
                              {model.awayGoalsExpected.toFixed(2)}
                            </span>
                            <span>最可能比分: {model.mostLikelyScore}</span>
                          </div>
                        )}
                      </div>
                    );
                  },
                )}
              </div>

              <div className="divider" />

              <h3>🔗 模型贡献度</h3>
              <div className="contributions">
                {prediction.modelContributions.map((c) => (
                  <div key={c.modelName} className="contrib-item">
                    <span
                      className="contrib-dot"
                      style={{
                        background: MODEL_COLORS[c.modelName] || '#888',
                      }}
                    />
                    <span className="contrib-name">
                      {MODEL_LABELS[c.modelName] || c.modelName}
                    </span>
                    <div className="contrib-bar-track">
                      <div
                        className="contrib-bar-fill"
                        style={{
                          width: `${(c.contribution / Math.max(...prediction.modelContributions.map((x) => x.contribution))) * 100}%`,
                          background: MODEL_COLORS[c.modelName] || '#888',
                        }}
                      />
                    </div>
                    <span className="contrib-pct">
                      {(
                        (c.contribution /
                          prediction.modelContributions.reduce(
                            (s, x) => s + x.contribution,
                            0,
                          )) *
                        100
                      ).toFixed(0)}
                      %
                    </span>
                  </div>
                ))}
              </div>

              <div className="divider" />

              <h3>📈 后端概率融合说明</h3>
              <div className="fusion-explanation">
                <div className="fusion-step">
                  <span className="step-num">1</span>
                  <div>
                    <strong>ELO 预测</strong> — 基于球队历史战绩和 ELO
                    评分，计算基础胜平负概率
                  </div>
                </div>
                <div className="fusion-step">
                  <span className="step-num">2</span>
                  <div>
                    <strong>赔率推测</strong> — 从 ELO
                    评分差推导博彩赔率隐含概率，加入冷门偏差修正
                  </div>
                </div>
                <div className="fusion-step">
                  <span className="step-num">3</span>
                  <div>
                    <strong>泊松进球</strong> — Dixon-Coles
                    双变量泊松模型，枚举所有比分计算概率
                  </div>
                </div>
                <div className="fusion-step">
                  <span className="step-num">4</span>
                  <div>
                    <strong>Stacking 融合</strong> —
                    动态权重加权平均，根据实力差距、场地条件自动调权
                  </div>
                </div>
              </div>

              <div className="result-meta">
                <span>
                  主场优势:{' '}
                  {prediction.homeAdvantage > 0
                    ? `${prediction.homeAdvantage} ELO 加成`
                    : '无（中立场地）'}
                </span>
                <span>
                  实力差:{' '}
                  {Math.round(prediction.homeRating - prediction.awayRating)}{' '}
                  ELO 分
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
