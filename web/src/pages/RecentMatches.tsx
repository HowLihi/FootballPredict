import { useEffect, useState } from 'react';
import { api, type WcPrediction } from '../api';
import { tTeam, tVenue } from '../utils/i18n';
import { beijingDateString, parseBeijingDate } from '../utils/beijing-time';
import './RecentMatches.css';

export default function RecentMatches() {
  const [matches, setMatches] = useState<WcPrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadMatches();
  }, []);

  const loadMatches = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.wc.getRecentMatches();
      setMatches(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const today = beijingDateString();

  const liveMatches = matches.filter(
    (m) => m.actualHomeScore !== null && m.matchDate.startsWith(today),
  );
  const upcomingMatches = matches.filter(
    (m) => m.actualHomeScore === null && m.matchDate >= today,
  );
  const finishedMatches = matches.filter(
    (m) => m.actualHomeScore !== null && m.matchDate < today,
  );

  const formatDate = (dateStr: string) => {
    const d = parseBeijingDate(dateStr);
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const weekday = weekdays[d.getUTCDay()];
    const hours = String(d.getUTCHours()).padStart(2, '0');
    const minutes = String(d.getUTCMinutes()).padStart(2, '0');
    const seconds = String(d.getUTCSeconds()).padStart(2, '0');
    return `${month}月${day}日 周${weekday} ${hours}:${minutes}:${seconds}`;
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

  return (
    <div className="recent-page">
      <div className="recent-header">
        <h1>🏟️ 近期比赛</h1>
        <p className="page-desc">2026 FIFA 世界杯 — 近一周比赛动态</p>
        <button
          className="btn btn-secondary"
          onClick={loadMatches}
          disabled={loading}
        >
          {loading ? '刷新中...' : '🔄 刷新'}
        </button>
      </div>

      {error && <div className="error-msg">加载失败: {error}</div>}

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
              <MatchCard key={m.id} match={m} isLive />
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
                  <MatchCard key={m.id} match={m} />
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
                  <MatchCard key={m.id} match={m} isFinished />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function MatchCard({
  match,
  isLive,
  isFinished,
}: {
  match: WcPrediction;
  isLive?: boolean;
  isFinished?: boolean;
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

  return (
    <div
      className={`match-card ${isLive ? 'live' : ''} ${isFinished ? 'finished' : ''}`}
    >
      <div className="match-card-top">
        <span className="match-group">{match.groupName}组</span>
        <span className="match-round">第{match.round}轮</span>
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
          预测: {predictedLabel} ({match.predictedScoreHome}-
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
