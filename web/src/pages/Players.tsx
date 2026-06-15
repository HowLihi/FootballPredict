import { useEffect, useState } from 'react';
import { api, type SquadData, type WcPrediction } from '../api';
import { tTeam } from '../utils/i18n';
import './Players.css';

function formatMarketValue(value: number | undefined): string {
  if (value === undefined || value === null) return '-';
  if (value >= 100) return `€${(value / 100).toFixed(1)}亿`;
  if (value >= 1) return `€${value.toFixed(0)}M`;
  return `€${(value * 1000).toFixed(0)}万`;
}

function overallColor(overall: number): string {
  if (overall >= 88) return '#fbbf24';
  if (overall >= 82) return '#34d399';
  if (overall >= 75) return '#818cf8';
  if (overall >= 70) return '#60a5fa';
  return '#9ca3af';
}

export default function Players() {
  const [teams, setTeams] = useState<string[]>([]);
  const [selectedTeam, setSelectedTeam] = useState('');
  const [squad, setSquad] = useState<SquadData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.wc
      .getRecentMatches()
      .then((data: WcPrediction[]) => {
        const unique = new Set<string>();
        data.forEach((m) => {
          unique.add(m.homeTeam);
          unique.add(m.awayTeam);
        });
        setTeams(Array.from(unique).sort());
      })
      .catch(() => {});
  }, []);

  const handleSelectTeam = async (team: string) => {
    setSelectedTeam(team);
    setSquad(null);
    setError('');
    setLoading(true);
    try {
      const data = await api.wc.getSquad(team);
      setSquad(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (!selectedTeam) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.wc.refreshSquad(selectedTeam);
      setSquad(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const positionOrder: Record<string, number> = {
    GK: 0,
    CB: 1,
    LB: 2,
    RB: 3,
    CDM: 4,
    CM: 5,
    CAM: 6,
    LW: 7,
    RW: 8,
    ST: 9,
  };

  const sortedPlayers = squad
    ? [...squad.players].sort(
        (a, b) =>
          (positionOrder[a.position] ?? 99) - (positionOrder[b.position] ?? 99),
      )
    : [];

  const starPlayers = sortedPlayers.filter((p) => p.isStar);
  const nonStarPlayers = sortedPlayers.filter((p) => !p.isStar);

  const totalMarketValue = squad
    ? squad.players.reduce((s, p) => s + (p.marketValue || 0), 0)
    : 0;

  const avgAge = squad
    ? squad.players.filter((p) => p.age).reduce((s, p) => s + (p.age || 0), 0) /
        squad.players.filter((p) => p.age).length || 0
    : 0;

  return (
    <div className="players-page">
      <div className="players-page-header">
        <h1>👤 球员信息</h1>
        <p className="page-desc">选择球队，查看真实大名单及战斗力评估</p>
      </div>

      <div className="team-selector-bar">
        <label>选择球队：</label>
        <select
          className="team-dropdown"
          value={selectedTeam}
          onChange={(e) => handleSelectTeam(e.target.value)}
        >
          <option value="">-- 请选择球队 --</option>
          {teams.map((t) => (
            <option key={t} value={t}>
              {tTeam(t)}
            </option>
          ))}
        </select>
        {selectedTeam && (
          <button
            className="refresh-btn"
            onClick={handleRefresh}
            disabled={loading}
          >
            🔄 刷新数据
          </button>
        )}
      </div>

      {!selectedTeam && !loading && (
        <div className="players-empty">
          <div className="pe-icon">⚽</div>
          <p>请从上方下拉框中选择一支球队查看大名单</p>
        </div>
      )}

      {loading && <div className="loading">加载中...</div>}
      {error && <div className="error-msg">{error}</div>}

      {squad && !loading && (
        <div className="squad-content">
          {squad.isRealData && (
            <div className="real-data-badge">
              ✅ 真实数据 — 来自 football-data.org API
            </div>
          )}
          {!squad.isRealData && (
            <div className="sim-data-badge">
              ⚠️ 模拟数据 — API暂无该球队数据，以下为算法生成
            </div>
          )}

          <div className="combat-power-card">
            <div className="cpc-header-row">
              <h2 className="cpc-title">
                📊 {tTeam(squad.teamName)} 战斗力评估
              </h2>
              {squad.teamCrest && (
                <img
                  src={squad.teamCrest}
                  alt={squad.teamName}
                  className="team-crest"
                />
              )}
            </div>
            <div className="cpc-main-score">
              <span className="cpc-value">
                {squad.combatPower.finalPower.toFixed(1)}
              </span>
              <span className="cpc-label">综合战力指数</span>
            </div>
            <div className="cpc-breakdown">
              <div className="cpc-item">
                <span className="cpc-item-value">
                  {squad.combatPower.rawAvg.toFixed(1)}
                </span>
                <span className="cpc-item-label">基础均值</span>
              </div>
              <div className="cpc-item negative">
                <span className="cpc-item-value">
                  {squad.combatPower.barrelAdjustment >= 0 ? '+' : ''}
                  {squad.combatPower.barrelAdjustment.toFixed(1)}
                </span>
                <span className="cpc-item-label">木桶效应</span>
              </div>
              <div className="cpc-item negative">
                <span className="cpc-item-value">
                  {squad.combatPower.diminishingAdjustment >= 0 ? '+' : ''}
                  {squad.combatPower.diminishingAdjustment.toFixed(1)}
                </span>
                <span className="cpc-item-label">边际递减</span>
              </div>
              <div className="cpc-item positive">
                <span className="cpc-item-value">
                  +{squad.combatPower.starAdjustment.toFixed(1)}
                </span>
                <span className="cpc-item-label">球星加成</span>
              </div>
            </div>

            <div className="squad-stats-row">
              <div className="squad-stat">
                <span className="squad-stat-value">
                  {formatMarketValue(totalMarketValue)}
                </span>
                <span className="squad-stat-label">全队总身价</span>
              </div>
              <div className="squad-stat">
                <span className="squad-stat-value">
                  {avgAge > 0 ? avgAge.toFixed(1) : '-'}
                </span>
                <span className="squad-stat-label">平均年龄</span>
              </div>
              <div className="squad-stat">
                <span className="squad-stat-value">{squad.players.length}</span>
                <span className="squad-stat-label">球员人数</span>
              </div>
              <div className="squad-stat">
                <span className="squad-stat-value">{starPlayers.length}</span>
                <span className="squad-stat-label">球星数量</span>
              </div>
            </div>

            <div className="cpc-analysis">
              <div className="cpc-analysis-title">📝 理论分析</div>
              <pre className="cpc-analysis-text">
                {squad.combatPower.analysis}
              </pre>
            </div>

            <div className="theory-legend">
              <div className="tl-item">
                <span className="tl-icon">🪣</span>
                <div>
                  <strong>木桶理论</strong>
                  <p>
                    劣势对全队下限有较高加权影响。5名最弱球员与均值的差距按 8%
                    系数扣减战力。
                  </p>
                </div>
              </div>
              <div className="tl-item">
                <span className="tl-icon">📉</span>
                <div>
                  <strong>边际效益递减</strong>
                  <p>
                    优势对球队整体水平有较低加权影响。最强球员的超额能力随对数函数递减。
                  </p>
                </div>
              </div>
              <div className="tl-item">
                <span className="tl-icon">⭐</span>
                <div>
                  <strong>球星理论</strong>
                  <p>
                    球星有利于足球运动推广，国际足联更希望球星有亮眼表现。3名球星按评分提供加成。
                  </p>
                </div>
              </div>
            </div>
          </div>

          <h3 className="squad-section-title">
            ⭐ 球星核心 ({starPlayers.length}人)
          </h3>
          <div className="players-grid">
            {starPlayers.map((p) => (
              <div key={p.number} className="player-card star-card">
                <img src={p.photoUrl} alt={p.name} className="player-photo" />
                <span className="player-star-badge">⭐</span>
                <div className="player-info">
                  <span className="player-number">#{p.number}</span>
                  <span className="player-name">{p.name}</span>
                  <div className="player-meta">
                    <span className="player-position">{p.position}</span>
                    {p.age && <span className="player-age">{p.age}岁</span>}
                    {p.nationality && (
                      <span className="player-nationality">
                        {p.nationality}
                      </span>
                    )}
                  </div>
                  <div className="player-rating-row">
                    <span
                      className="player-overall"
                      style={{ color: overallColor(p.overall) }}
                    >
                      {p.overall}
                    </span>
                    {p.marketValue !== undefined && (
                      <span className="player-market-value">
                        {formatMarketValue(p.marketValue)}
                      </span>
                    )}
                  </div>
                  <div className="player-strengths">
                    {p.strengths.map((s, i) => (
                      <span key={i} className="tag strength">
                        ✓ {s}
                      </span>
                    ))}
                  </div>
                  <div className="player-weaknesses">
                    {p.weaknesses.map((w, i) => (
                      <span key={i} className="tag weakness">
                        ✗ {w}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <h3 className="squad-section-title">
            👥 全队大名单 ({nonStarPlayers.length}人)
          </h3>
          <div className="players-grid">
            {nonStarPlayers.map((p) => (
              <div key={p.number} className="player-card">
                <img src={p.photoUrl} alt={p.name} className="player-photo" />
                <div className="player-info">
                  <span className="player-number">#{p.number}</span>
                  <span className="player-name">{p.name}</span>
                  <div className="player-meta">
                    <span className="player-position">{p.position}</span>
                    {p.age && <span className="player-age">{p.age}岁</span>}
                    {p.nationality && (
                      <span className="player-nationality">
                        {p.nationality}
                      </span>
                    )}
                  </div>
                  <div className="player-rating-row">
                    <span
                      className="player-overall"
                      style={{ color: overallColor(p.overall) }}
                    >
                      {p.overall}
                    </span>
                    {p.marketValue !== undefined && (
                      <span className="player-market-value">
                        {formatMarketValue(p.marketValue)}
                      </span>
                    )}
                  </div>
                  <div className="player-strengths">
                    {p.strengths.map((s, i) => (
                      <span key={i} className="tag strength">
                        ✓ {s}
                      </span>
                    ))}
                  </div>
                  <div className="player-weaknesses">
                    {p.weaknesses.map((w, i) => (
                      <span key={i} className="tag weakness">
                        ✗ {w}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
