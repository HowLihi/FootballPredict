import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type EloRating } from '../api';
import './Dashboard.css';

export default function Dashboard() {
  const [topTeams, setTopTeams] = useState<EloRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.elo
      .getRankings(1, 10)
      .then((res) => setTopTeams(res.data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="dashboard">
      <section className="hero-section">
        <h1>⚽ 足球比赛预测系统</h1>
        <p>基于 ELO 评分算法，分析国际比赛历史数据，预测比赛结果</p>
        <div className="hero-actions">
          <Link to="/predict" className="btn btn-primary">
            预测比赛
          </Link>
          <Link to="/worldcup" className="btn btn-secondary">
            世界杯预测
          </Link>
        </div>
      </section>

      <section className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">🏆</div>
          <div className="stat-info">
            <span className="stat-value">
              {topTeams.length > 0 ? topTeams[0].teamName : '-'}
            </span>
            <span className="stat-label">当前排名第一</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📊</div>
          <div className="stat-info">
            <span className="stat-value">
              {topTeams.length > 0 ? Math.round(topTeams[0].rating) : '-'}
            </span>
            <span className="stat-label">最高 ELO 积分</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🌍</div>
          <div className="stat-info">
            <span className="stat-value">2026</span>
            <span className="stat-label">世界杯年份</span>
          </div>
        </div>
      </section>

      <section className="top-teams-section">
        <div className="section-header">
          <h2>🏆 ELO 排名 Top 10</h2>
          <Link to="/rankings" className="view-all">
            查看全部 →
          </Link>
        </div>
        {loading && <div className="loading">加载中...</div>}
        {error && <div className="error">加载失败: {error}</div>}
        {!loading && !error && (
          <div className="teams-table-wrapper">
            <table className="teams-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>球队</th>
                  <th>ELO</th>
                  <th>场次</th>
                  <th>胜</th>
                  <th>平</th>
                  <th>负</th>
                  <th>进球</th>
                  <th>失球</th>
                </tr>
              </thead>
              <tbody>
                {topTeams.map((team, idx) => (
                  <tr key={team.id}>
                    <td className={`rank rank-${idx + 1}`}>{idx + 1}</td>
                    <td className="team-name">
                      <Link to={`/team/${encodeURIComponent(team.teamName)}`}>
                        {team.teamName}
                      </Link>
                    </td>
                    <td className="rating">{Math.round(team.rating)}</td>
                    <td>{team.gamesPlayed}</td>
                    <td className="win">{team.wins}</td>
                    <td className="draw">{team.draws}</td>
                    <td className="loss">{team.losses}</td>
                    <td>{team.goalsFor}</td>
                    <td>{team.goalsAgainst}</td>
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
