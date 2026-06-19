import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type WcPrediction, type EnsemblePrediction } from '../api';
import { tTeam, tVenue, getTeamFlag } from '../utils/i18n';
import {
  beijingNow,
  parseBeijingDate,
  parseBeijingParts,
} from '../utils/beijing-time';
import './RecentMatches.css';

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

export default function RecentMatches() {
  const [matches, setMatches] = useState<WcPrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [selectedMatch, setSelectedMatch] = useState<WcPrediction | null>(null);
  const [prediction, setPrediction] = useState<EnsemblePrediction | null>(null);
  const [predLoading, setPredLoading] = useState(false);
  const [predError, setPredError] = useState('');

  const loadMatches = useCallback(async () => {
    setError('');
    try {
      const data = await api.wc.getRecentMatches();
      setMatches(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMatches();
    timerRef.current = setInterval(loadMatches, 5 * 60 * 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [loadMatches]);

  const loadPrediction = async (m: WcPrediction) => {
    setPredLoading(true);
    setPredError('');
    setPrediction(null);
    try {
      const res = await api.ensemble.predict(m.homeTeam, m.awayTeam, m.neutral);
      if (res && 'error' in res) {
        setPredError(res.error as string);
      } else if (res) {
        setPrediction(res as EnsemblePrediction);
      } else {
        setPredError('未找到球队数据');
      }
    } catch (err: any) {
      setPredError(err.message);
    } finally {
      setPredLoading(false);
    }
  };

  const handleSelectMatch = async (m: WcPrediction) => {
    if (selectedMatch?.id === m.id) {
      setSelectedMatch(null);
      setPrediction(null);
      return;
    }
    setSelectedMatch(m);
    loadPrediction(m);
  };

  useEffect(() => {
    if (matches.length > 0 && !selectedMatch && !predLoading) {
      const now = beijingNow();
      const live = matches.filter(
        (m) =>
          m.actualHomeScore === null &&
          parseBeijingDate(m.matchDate) <= now &&
          parseBeijingDate(m.matchDate).getTime() + 2 * 60 * 60 * 1000 >
            now.getTime(),
      );
      const upcoming = matches.filter(
        (m) =>
          m.actualHomeScore === null && parseBeijingDate(m.matchDate) > now,
      );
      const finished = matches.filter(
        (m) => m.actualHomeScore !== null && m.actualAwayScore !== null,
      );
      const firstMatch = live[0] || upcoming[0] || finished[0];
      if (firstMatch) {
        handleSelectMatch(firstMatch);
      }
    }
  }, [matches]);

  useEffect(() => {
    if (!selectedMatch || predLoading) return;
    const latest = matches.find((m) => m.id === selectedMatch.id);
    if (!latest) return;

    const wasFinished =
      selectedMatch.actualHomeScore !== null &&
      selectedMatch.actualAwayScore !== null;
    const isNowFinished =
      latest.actualHomeScore !== null && latest.actualAwayScore !== null;

    if (!wasFinished && isNowFinished) {
      setSelectedMatch(latest);
      loadPrediction(latest);
    } else if (
      wasFinished &&
      isNowFinished &&
      (latest.actualHomeScore !== selectedMatch.actualHomeScore ||
        latest.actualAwayScore !== selectedMatch.actualAwayScore)
    ) {
      setSelectedMatch(latest);
    }
  }, [matches]);

  const now = beijingNow();
  const finishedMatches = matches.filter(
    (m) => m.actualHomeScore !== null && m.actualAwayScore !== null,
  );
  const liveMatches = matches.filter(
    (m) =>
      m.actualHomeScore === null &&
      parseBeijingDate(m.matchDate) <= now &&
      parseBeijingDate(m.matchDate).getTime() + 2 * 60 * 60 * 1000 >
        now.getTime(),
  );
  const upcomingMatches = matches.filter(
    (m) => m.actualHomeScore === null && parseBeijingDate(m.matchDate) > now,
  );

  const formatDate = (dateStr: string) => {
    const b = parseBeijingParts(dateStr);
    return `${b.month}月${b.day}日 周${b.weekday} ${b.hours}:${b.minutes}:${b.seconds}`;
  };

  const groupByDate = (list: WcPrediction[]) => {
    const map = new Map<string, WcPrediction[]>();
    for (const m of list) {
      const key = m.matchDate;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return map;
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
    <div className="recent-page">
      <div className="recent-header">
        <h1>🏟️ 近期比赛</h1>
        <p className="page-desc">2026 FIFA 世界杯 — 点击比赛查看集成预测详情</p>
      </div>

      {error && <div className="error-msg">加载失败: {error}</div>}

      <div className="recent-layout">
        <div className="recent-list-panel">
          {loading && <div className="loading">加载中...</div>}

          {!loading && matches.length === 0 && (
            <div className="no-data">暂无近期比赛数据，请先生成世界杯预测</div>
          )}

          {!loading && liveMatches.length > 0 && (
            <section className="match-section live-section">
              <h2 className="section-title">
                <span className="live-dot" /> 进行中
              </h2>
              <div className="match-cards">
                {liveMatches.map((m) => (
                  <MatchCard
                    key={m.id}
                    match={m}
                    isLive
                    selected={selectedMatch?.id === m.id}
                    onSelect={() => handleSelectMatch(m)}
                  />
                ))}
              </div>
            </section>
          )}

          {!loading && upcomingMatches.length > 0 && (
            <section className="match-section">
              <h2 className="section-title">📅 即将开始</h2>
              {Array.from(groupByDate(upcomingMatches)).map(([date, list]) => (
                <div key={date} className="date-group">
                  <h3 className="date-label">{formatDate(date)}</h3>
                  <div className="match-cards">
                    {list.map((m) => (
                      <MatchCard
                        key={m.id}
                        match={m}
                        selected={selectedMatch?.id === m.id}
                        onSelect={() => handleSelectMatch(m)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}

          {!loading && finishedMatches.length > 0 && (
            <section className="match-section">
              <h2 className="section-title">✅ 已结束</h2>
              {Array.from(groupByDate(finishedMatches)).map(([date, list]) => (
                <div key={date} className="date-group">
                  <h3 className="date-label">{formatDate(date)}</h3>
                  <div className="match-cards">
                    {list.map((m) => (
                      <MatchCard
                        key={m.id}
                        match={m}
                        isFinished
                        selected={selectedMatch?.id === m.id}
                        onSelect={() => handleSelectMatch(m)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>

        <div className="recent-detail-panel">
          {!selectedMatch && !predLoading && (
            <div className="detail-placeholder">
              <div className="placeholder-icon">🧠</div>
              <p>点击左侧比赛卡片，查看三模型集成预测详情</p>
              <p className="placeholder-hint">
                系统将融合 ELO、赔率、泊松三个模型，通过动态权重给出最优预测
              </p>
            </div>
          )}

          {selectedMatch && predLoading && (
            <div className="detail-placeholder">
              <div className="placeholder-icon">⏳</div>
              <p>
                正在分析 {tTeam(selectedMatch.homeTeam)} vs{' '}
                {tTeam(selectedMatch.awayTeam)}...
              </p>
            </div>
          )}

          {predError && (
            <div className="detail-placeholder">
              <div className="placeholder-icon">⚠️</div>
              <p>预测失败: {predError}</p>
            </div>
          )}

          {prediction && (
            <div className="ensemble-result">
              <div className="result-header">
                <h2>集成预测</h2>
                <span
                  className="confidence-badge"
                  style={{
                    color: CONFIDENCE_LABELS[prediction.confidence]?.color,
                    borderColor:
                      CONFIDENCE_LABELS[prediction.confidence]?.color,
                    background:
                      CONFIDENCE_LABELS[prediction.confidence]?.color + '12',
                  }}
                >
                  {CONFIDENCE_LABELS[prediction.confidence]?.text}
                </span>
              </div>

              {selectedMatch?.actualHomeScore !== null &&
                selectedMatch?.actualAwayScore !== null && (
                  <div className="result-actual">
                    <div className="ra-label">最终比分</div>
                    <div className="ra-score-row">
                      <div className="ra-team">
                        <span className="ra-team-flag">
                          {getTeamFlag(selectedMatch.homeTeam)}
                        </span>
                        <span className="ra-team-name">
                          {tTeam(selectedMatch.homeTeam)}
                        </span>
                      </div>
                      <div className="ra-score-center">
                        <span className="ra-score-num">
                          {selectedMatch.actualHomeScore}
                        </span>
                        <span className="ra-score-sep">:</span>
                        <span className="ra-score-num">
                          {selectedMatch.actualAwayScore}
                        </span>
                      </div>
                      <div className="ra-team">
                        <span className="ra-team-name">
                          {tTeam(selectedMatch.awayTeam)}
                        </span>
                        <span className="ra-team-flag">
                          {getTeamFlag(selectedMatch.awayTeam)}
                        </span>
                      </div>
                    </div>
                    <div className="ra-compare">
                      <div className="ra-compare-item">
                        <span className="ra-compare-label">预测比分</span>
                        <span className="ra-compare-value">
                          {prediction.predictedHomeScore.toFixed(1)} :{' '}
                          {prediction.predictedAwayScore.toFixed(1)}
                        </span>
                      </div>
                      <div className="ra-compare-item">
                        <span className="ra-compare-label">预测方向</span>
                        <span className="ra-compare-value">
                          {predictedLabel}
                        </span>
                      </div>
                      <div
                        className={`ra-compare-item ra-result ${selectedMatch.resultCorrect ? 'correct' : 'wrong'}`}
                      >
                        <span className="ra-compare-label">预测结果</span>
                        <span className="ra-compare-value">
                          {selectedMatch.resultCorrect ? '✅ 正确' : '❌ 错误'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

              {selectedMatch?.actualHomeScore === null && (
                <div className="result-matchup">
                  <div className="rm-team rm-home">
                    <div className="rm-team-flag">
                      {getTeamFlag(prediction.homeTeam)}
                    </div>
                    <div className="rm-team-info">
                      <span className="rm-team-name">
                        {tTeam(prediction.homeTeam)}
                      </span>
                      <span className="rm-team-rating">
                        ELO {Math.round(prediction.homeRating)}
                      </span>
                    </div>
                  </div>
                  <div className="rm-center">
                    <div className="rm-score">
                      <span className="rm-score-num">
                        {prediction.predictedHomeScore.toFixed(1)}
                      </span>
                      <span className="rm-score-sep">:</span>
                      <span className="rm-score-num">
                        {prediction.predictedAwayScore.toFixed(1)}
                      </span>
                    </div>
                    <div className="rm-verdict">{predictedLabel}</div>
                  </div>
                  <div className="rm-team rm-away">
                    <div className="rm-team-info">
                      <span className="rm-team-name">
                        {tTeam(prediction.awayTeam)}
                      </span>
                      <span className="rm-team-rating">
                        ELO {Math.round(prediction.awayRating)}
                      </span>
                    </div>
                    <div className="rm-team-flag">
                      {getTeamFlag(prediction.awayTeam)}
                    </div>
                  </div>
                </div>
              )}

              <div className="result-probs-compact">
                <div className="rpc-bar">
                  <div
                    className="rpc-seg rpc-home"
                    style={{ width: `${prediction.finalHomeWin * 100}%` }}
                  />
                  <div
                    className="rpc-seg rpc-draw"
                    style={{ width: `${prediction.finalDraw * 100}%` }}
                  />
                  <div
                    className="rpc-seg rpc-away"
                    style={{ width: `${prediction.finalAwayWin * 100}%` }}
                  />
                </div>
                <div className="rpc-labels">
                  <span className="rpc-label-item">
                    <span className="rpc-dot home" />
                    主胜{' '}
                    <strong>
                      {(prediction.finalHomeWin * 100).toFixed(1)}%
                    </strong>
                  </span>
                  <span className="rpc-label-item">
                    <span className="rpc-dot draw" />
                    平局{' '}
                    <strong>{(prediction.finalDraw * 100).toFixed(1)}%</strong>
                  </span>
                  <span className="rpc-label-item">
                    <span className="rpc-dot away" />
                    客胜{' '}
                    <strong>
                      {(prediction.finalAwayWin * 100).toFixed(1)}%
                    </strong>
                  </span>
                </div>
              </div>

              <div className="divider" />

              <h3>📊 三模型对比</h3>
              <div className="models-compare">
                <div className="mc-header">
                  <span className="mc-blank" />
                  <span className="mc-col-label">主胜</span>
                  <span className="mc-col-label">平局</span>
                  <span className="mc-col-label">客胜</span>
                </div>
                {Object.entries(prediction.individualModels).map(
                  ([key, model]) => {
                    const contribution = prediction.modelContributions.find(
                      (c) => c.modelName === key,
                    );
                    const hw = 'homeWin' in model ? model.homeWin : 0;
                    const dr = 'draw' in model ? model.draw : 0;
                    const aw = 'awayWin' in model ? model.awayWin : 0;
                    const modelMax = Math.max(hw, dr, aw);

                    return (
                      <div key={key} className="mc-row">
                        <span className="mc-model-name">
                          <span
                            className="mc-dot"
                            style={{ background: MODEL_COLORS[key] || '#888' }}
                          />
                          {MODEL_LABELS[key] || key}
                          <span className="mc-weight">
                            {contribution
                              ? (contribution.weight * 100).toFixed(0)
                              : '-'}
                            %
                          </span>
                        </span>
                        <span
                          className={`mc-val ${hw === modelMax ? 'mc-max' : ''}`}
                        >
                          {(hw * 100).toFixed(1)}%
                        </span>
                        <span
                          className={`mc-val ${dr === modelMax ? 'mc-max' : ''}`}
                        >
                          {(dr * 100).toFixed(1)}%
                        </span>
                        <span
                          className={`mc-val ${aw === modelMax ? 'mc-max' : ''}`}
                        >
                          {(aw * 100).toFixed(1)}%
                        </span>
                      </div>
                    );
                  },
                )}
                <div className="mc-row mc-row-final">
                  <span className="mc-model-name">
                    <span className="mc-dot" style={{ background: '#fff' }} />
                    集成结果
                  </span>
                  <span
                    className={`mc-val ${prediction.finalHomeWin === maxProb ? 'mc-max' : ''}`}
                  >
                    {(prediction.finalHomeWin * 100).toFixed(1)}%
                  </span>
                  <span
                    className={`mc-val ${prediction.finalDraw === maxProb ? 'mc-max' : ''}`}
                  >
                    {(prediction.finalDraw * 100).toFixed(1)}%
                  </span>
                  <span
                    className={`mc-val ${prediction.finalAwayWin === maxProb ? 'mc-max' : ''}`}
                  >
                    {(prediction.finalAwayWin * 100).toFixed(1)}%
                  </span>
                </div>
              </div>

              {'poisson' in prediction.individualModels && (
                <>
                  <div className="divider" />
                  <div className="poisson-extra">
                    <div className="pe-item">
                      <span className="pe-label">预期进球</span>
                      <span className="pe-value">
                        {prediction.individualModels.poisson.homeGoalsExpected.toFixed(
                          2,
                        )}{' '}
                        —{' '}
                        {prediction.individualModels.poisson.awayGoalsExpected.toFixed(
                          2,
                        )}
                      </span>
                    </div>
                    <div className="pe-item">
                      <span className="pe-label">最可能比分</span>
                      <span className="pe-value pe-score">
                        {prediction.individualModels.poisson.mostLikelyScore}
                      </span>
                    </div>
                  </div>
                </>
              )}

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

              <div className="result-meta">
                <span>
                  🏠{' '}
                  {prediction.homeAdvantage > 0
                    ? `主场优势 +${prediction.homeAdvantage}`
                    : '中立场地'}
                </span>
                <span>
                  ⚔️ 实力差{' '}
                  {Math.round(prediction.homeRating - prediction.awayRating)}{' '}
                  ELO
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MatchCard({
  match,
  isLive,
  isFinished,
  selected,
  onSelect,
}: {
  match: WcPrediction;
  isLive?: boolean;
  isFinished?: boolean;
  selected?: boolean;
  onSelect: () => void;
}) {
  const maxProb = Math.max(
    match.homeWinProb,
    match.drawProb,
    match.awayWinProb,
  );
  const predictedLabel =
    maxProb === match.homeWinProb
      ? `${tTeam(match.homeTeam)} 胜`
      : maxProb === match.awayWinProb
        ? `${tTeam(match.awayTeam)} 胜`
        : '平局';

  const timeParts = parseBeijingParts(match.matchDate);
  return (
    <div
      className={`match-card ${isLive ? 'live' : ''} ${isFinished ? 'finished' : ''} ${selected ? 'selected' : ''}`}
      onClick={onSelect}
      style={{ cursor: 'pointer' }}
    >
      <div className="match-card-top">
        <span className="match-group">{match.groupName}组</span>
        <span className="match-round">第{match.round}轮</span>
        <span className="match-time">
          {timeParts.month}月{timeParts.day}日 {timeParts.hours}:
          {timeParts.minutes}
        </span>
        {match.venue && (
          <span className="match-venue">📍 {tVenue(match.venue)}</span>
        )}
      </div>

      <div className="match-teams">
        <div
          className={`match-team ${match.predictedResult === 'H' ? 'predicted-winner' : ''}`}
        >
          <span className="team-name">{tTeam(match.homeTeam)}</span>
          <span className="team-rating">
            ELO {Math.round(match.homeRating)}
          </span>
        </div>
        <div className="match-vs">
          {isFinished || isLive ? (
            <span className="match-score">
              {match.actualHomeScore} - {match.actualAwayScore}
            </span>
          ) : (
            <span className="vs-text">VS</span>
          )}
        </div>
        <div
          className={`match-team ${match.predictedResult === 'A' ? 'predicted-winner' : ''}`}
        >
          <span className="team-name">{tTeam(match.awayTeam)}</span>
          <span className="team-rating">
            ELO {Math.round(match.awayRating)}
          </span>
        </div>
      </div>

      <div className="match-probs">
        <div className="prob-row">
          <span className="prob-label">主胜</span>
          <div className="prob-bar-small">
            <div
              className={`prob-fill-sm home ${match.homeWinProb === maxProb ? 'max' : ''}`}
              style={{ width: `${match.homeWinProb * 100}%` }}
            />
          </div>
          <span className="prob-pct">
            {(match.homeWinProb * 100).toFixed(0)}%
          </span>
        </div>
        <div className="prob-row">
          <span className="prob-label">平局</span>
          <div className="prob-bar-small">
            <div
              className={`prob-fill-sm draw ${match.drawProb === maxProb ? 'max' : ''}`}
              style={{ width: `${match.drawProb * 100}%` }}
            />
          </div>
          <span className="prob-pct">{(match.drawProb * 100).toFixed(0)}%</span>
        </div>
        <div className="prob-row">
          <span className="prob-label">客胜</span>
          <div className="prob-bar-small">
            <div
              className={`prob-fill-sm away ${match.awayWinProb === maxProb ? 'max' : ''}`}
              style={{ width: `${match.awayWinProb * 100}%` }}
            />
          </div>
          <span className="prob-pct">
            {(match.awayWinProb * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      <div className="match-card-bottom">
        <span className="predict-label">
          🧠 集成预测: {predictedLabel} ({match.predictedScoreHome}-
          {match.predictedScoreAway})
        </span>
        {isFinished && match.resultCorrect !== null && (
          <span
            className={`result-badge ${match.resultCorrect ? 'correct' : 'wrong'}`}
          >
            {match.resultCorrect ? '✅ 预测正确' : '❌ 预测错误'}
          </span>
        )}
      </div>
    </div>
  );
}
