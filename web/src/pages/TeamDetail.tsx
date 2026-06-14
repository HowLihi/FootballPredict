import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, type EloRating, type EloHistory } from '../api';
import { tTeam } from '../utils/i18n';
import './TeamDetail.css';

export default function TeamDetail() {
  const { name } = useParams<{ name: string }>();
  const [team, setTeam] = useState<EloRating | null>(null);
  const [history, setHistory] = useState<EloHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const teamName = name ? decodeURIComponent(name) : '';

  useEffect(() => {
    if (!teamName) return;
    setLoading(true);
    Promise.all([
      api.elo.getTeamRating(teamName),
      api.elo.getTeamHistory(teamName, 30),
    ])
      .then(([ratingRes, historyRes]) => {
        if (ratingRes && 'error' in ratingRes) {
          setError(ratingRes.error);
        } else {
          setTeam(ratingRes as EloRating | null);
        }
        if (historyRes && !('error' in historyRes)) {
          setHistory(historyRes as EloHistory[]);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [teamName]);

  if (loading) return <div className="loading">加载中...</div>;
  if (error) return <div className="error">{error}</div>;
  if (!team) return <div className="error">未找到球队: {teamName}</div>;

  const gd = team.goalsFor - team.goalsAgainst;
  const winRate =
    team.gamesPlayed > 0
      ? ((team.wins / team.gamesPlayed) * 100).toFixed(1)
      : '0.0';

  return (
    <div className="team-detail">
      <Link to="/rankings" className="back-link">
        ← 返回排名
      </Link>

      <div className="team-header">
        <h1>{tTeam(team.teamName)}</h1>
        <div className="team-rating-badge">ELO {Math.round(team.rating)}</div>
      </div>

      <div className="team-stats-grid">
        <div className="team-stat-card">
          <span className="team-stat-value">{team.gamesPlayed}</span>
          <span className="team-stat-label">总场次</span>
        </div>
        <div className="team-stat-card win-card">
          <span className="team-stat-value">{team.wins}</span>
          <span className="team-stat-label">胜</span>
        </div>
        <div className="team-stat-card draw-card">
          <span className="team-stat-value">{team.draws}</span>
          <span className="team-stat-label">平</span>
        </div>
        <div className="team-stat-card loss-card">
          <span className="team-stat-value">{team.losses}</span>
          <span className="team-stat-label">负</span>
        </div>
        <div className="team-stat-card">
          <span className="team-stat-value">{team.goalsFor}</span>
          <span className="team-stat-label">进球</span>
        </div>
        <div className="team-stat-card">
          <span className="team-stat-value">{team.goalsAgainst}</span>
          <span className="team-stat-label">失球</span>
        </div>
        <div className="team-stat-card">
          <span className="team-stat-value">{gd > 0 ? `+${gd}` : gd}</span>
          <span className="team-stat-label">净胜球</span>
        </div>
        <div className="team-stat-card">
          <span className="team-stat-value">{winRate}%</span>
          <span className="team-stat-label">胜率</span>
        </div>
      </div>

      <section className="history-section">
        <h2>📋 近期比赛记录</h2>
        {history.length === 0 ? (
          <div className="no-data">暂无比赛记录</div>
        ) : (
          <div className="table-wrapper">
            <table className="history-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>对手</th>
                  <th>主/客</th>
                  <th>比分</th>
                  <th>结果</th>
                  <th>ELO 变化</th>
                  <th>当前 ELO</th>
                  <th>赛事</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{h.matchDate}</td>
                    <td>
                      <Link to={`/team/${encodeURIComponent(h.opponentName)}`}>
                        {tTeam(h.opponentName)}
                      </Link>
                    </td>
                    <td>{h.isHome ? '主场' : '客场'}</td>
                    <td>
                      {h.isHome ? (
                        <>
                          <span className="score-highlight">{h.homeScore}</span>{' '}
                          - {h.awayScore}
                        </>
                      ) : (
                        <>
                          {h.homeScore} -{' '}
                          <span className="score-highlight">{h.awayScore}</span>
                        </>
                      )}
                    </td>
                    <td className={`result-${h.result}`}>
                      {h.result === 'W' ? '胜' : h.result === 'L' ? '负' : '平'}
                    </td>
                    <td className={h.ratingChange >= 0 ? 'win' : 'loss'}>
                      {h.ratingChange >= 0 ? '+' : ''}
                      {h.ratingChange.toFixed(1)}
                    </td>
                    <td className="rating">{Math.round(h.rating)}</td>
                    <td className="tournament">{h.tournament || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
