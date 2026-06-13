import { useEffect, useState } from 'react';
import {
  api,
  type GroupPrediction,
  type KnockoutPrediction,
  type PredictionAccuracy,
} from '../api';
import './WorldCup.css';

type Tab = 'groups' | 'knockout' | 'accuracy';

export default function WorldCup() {
  const [tab, setTab] = useState<Tab>('groups');
  const [groups, setGroups] = useState<GroupPrediction[]>([]);
  const [knockout, setKnockout] = useState<KnockoutPrediction[]>([]);
  const [accuracy, setAccuracy] = useState<PredictionAccuracy | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [groupData, knockoutData, accuracyData] = await Promise.all([
        api.wc.getGroupPredictions(),
        api.wc.getKnockoutPredictions(),
        api.wc.getAccuracy(),
      ]);
      setGroups(groupData);
      setKnockout(knockoutData);
      setAccuracy(accuracyData);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await api.wc.generatePredictions();
      setGroups(res.groupPredictions);
      loadData();
    } catch {
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="wc-page">
      <div className="wc-header">
        <div>
          <h1>🌍 2026 世界杯预测</h1>
          <p className="page-desc">
            基于 ELO 评分系统预测 2026 FIFA 世界杯比赛结果
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating ? '生成中...' : '🔄 重新生成预测'}
        </button>
      </div>

      <div className="tab-bar">
        <button
          className={`tab ${tab === 'groups' ? 'active' : ''}`}
          onClick={() => setTab('groups')}
        >
          小组赛
        </button>
        <button
          className={`tab ${tab === 'knockout' ? 'active' : ''}`}
          onClick={() => setTab('knockout')}
        >
          淘汰赛
        </button>
        <button
          className={`tab ${tab === 'accuracy' ? 'active' : ''}`}
          onClick={() => setTab('accuracy')}
        >
          预测准确率
        </button>
      </div>

      {loading && <div className="loading">加载中...</div>}

      {!loading && tab === 'groups' && (
        <div className="groups-grid">
          {groups.length === 0 ? (
            <div className="no-data">
              暂无小组预测数据，请点击"重新生成预测"
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.group} className="group-card">
                <h3 className="group-title">小组 {group.group}</h3>
                <table className="group-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>球队</th>
                      <th>ELO</th>
                      <th>预测积分</th>
                      <th>进球</th>
                      <th>失球</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.teams.map((team, idx) => (
                      <tr
                        key={team.team}
                        className={idx < 2 ? 'qualified' : ''}
                      >
                        <td className={`rank rank-${idx + 1}`}>{idx + 1}</td>
                        <td className="team-name">{team.team}</td>
                        <td className="rating">{Math.round(team.rating)}</td>
                        <td className="points">
                          {team.predictedPoints.toFixed(1)}
                        </td>
                        <td>{team.predictedGoalsFor.toFixed(1)}</td>
                        <td>{team.predictedGoalsAgainst.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="group-legend">
                  <span className="qualified-marker">■</span> 预测出线
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {!loading && tab === 'knockout' && (
        <div className="knockout-section">
          {knockout.length === 0 ? (
            <div className="no-data">暂无淘汰赛预测数据</div>
          ) : (
            <div className="knockout-grid">
              {knockout.map((match) => (
                <div key={match.match} className="knockout-card">
                  <div className="knockout-match-label">{match.match}</div>
                  <div className="knockout-teams">
                    <div
                      className={`knockout-team ${match.predictedWinner === match.homeTeam ? 'predicted-winner' : ''}`}
                    >
                      <span className="k-team-name">{match.homeTeam}</span>
                      <span className="k-prob">
                        {(match.homeWinProb * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="knockout-vs">vs</div>
                    <div
                      className={`knockout-team ${match.predictedWinner === match.awayTeam ? 'predicted-winner' : ''}`}
                    >
                      <span className="k-team-name">{match.awayTeam}</span>
                      <span className="k-prob">
                        {(match.awayWinProb * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                  <div className="knockout-winner">
                    🏆 预测晋级: <strong>{match.predictedWinner}</strong>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!loading && tab === 'accuracy' && accuracy && (
        <div className="accuracy-section">
          <div className="accuracy-grid">
            <div className="accuracy-card main-card">
              <span className="accuracy-value">
                {(accuracy.accuracy * 100).toFixed(1)}%
              </span>
              <span className="accuracy-label">总体准确率</span>
            </div>
            <div className="accuracy-card">
              <span className="accuracy-value">{accuracy.total}</span>
              <span className="accuracy-label">已完赛</span>
            </div>
            <div className="accuracy-card">
              <span className="accuracy-value">{accuracy.correct}</span>
              <span className="accuracy-label">预测正确</span>
            </div>
            <div className="accuracy-card">
              <span className="accuracy-value">{accuracy.homeWins}</span>
              <span className="accuracy-label">预测主胜</span>
            </div>
            <div className="accuracy-card">
              <span className="accuracy-value">{accuracy.draws}</span>
              <span className="accuracy-label">预测平局</span>
            </div>
            <div className="accuracy-card">
              <span className="accuracy-value">{accuracy.awayWins}</span>
              <span className="accuracy-label">预测客胜</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
