import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type EloRating } from '../api';
import './Rankings.css';

export default function Rankings() {
  const [teams, setTeams] = useState<EloRating[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const limit = 50;

  useEffect(() => {
    setLoading(true);
    api.elo
      .getRankings(page, limit)
      .then((res) => {
        setTeams(res.data);
        setTotal(res.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page]);

  const totalPages = Math.ceil(total / limit);
  const filtered = search
    ? teams.filter((t) =>
        t.teamName.toLowerCase().includes(search.toLowerCase()),
      )
    : teams;

  return (
    <div className="rankings-page">
      <div className="page-header">
        <h1>📊 历史数据 — 国家队 ELO 排名</h1>
        <div className="search-box">
          <input
            type="text"
            placeholder="搜索球队..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="rankings-summary">
        <div className="summary-item">
          <span className="si-value">{total}</span>
          <span className="si-label">球队总数</span>
        </div>
        <div className="summary-item">
          <span className="si-value">
            {teams.length > 0 ? Math.round(teams[0].rating) : '-'}
          </span>
          <span className="si-label">最高 ELO</span>
        </div>
        <div className="summary-item">
          <span className="si-value">
            {teams.length > 0 ? teams[0].teamName : '-'}
          </span>
          <span className="si-label">排名第一</span>
        </div>
      </div>

      {loading && <div className="loading">加载中...</div>}

      {!loading && (
        <>
          <div className="table-wrapper">
            <table className="rankings-table">
              <thead>
                <tr>
                  <th>排名</th>
                  <th>球队</th>
                  <th>ELO 积分</th>
                  <th>场次</th>
                  <th>胜</th>
                  <th>平</th>
                  <th>负</th>
                  <th>进球</th>
                  <th>失球</th>
                  <th>净胜球</th>
                  <th>胜率</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((team, idx) => {
                  const rank = (page - 1) * limit + idx + 1;
                  const gd = team.goalsFor - team.goalsAgainst;
                  const winRate =
                    team.gamesPlayed > 0
                      ? ((team.wins / team.gamesPlayed) * 100).toFixed(1)
                      : '0.0';
                  return (
                    <tr key={team.id}>
                      <td className={`rank rank-${rank <= 3 ? rank : ''}`}>
                        {rank}
                      </td>
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
                      <td className={gd > 0 ? 'win' : gd < 0 ? 'loss' : ''}>
                        {gd > 0 ? `+${gd}` : gd}
                      </td>
                      <td>{winRate}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button disabled={page <= 1} onClick={() => setPage(1)}>
              首页
            </button>
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
              上一页
            </button>
            <span className="page-info">
              第 {page} / {totalPages} 页 (共 {total} 支球队)
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(totalPages)}
            >
              末页
            </button>
          </div>
        </>
      )}
    </div>
  );
}
