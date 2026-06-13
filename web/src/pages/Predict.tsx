import { useState } from 'react';
import { api, type MatchPrediction } from '../api';
import './Predict.css';

export default function Predict() {
  const [home, setHome] = useState('');
  const [away, setAway] = useState('');
  const [neutral, setNeutral] = useState(false);
  const [prediction, setPrediction] = useState<MatchPrediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handlePredict = async () => {
    if (!home.trim() || !away.trim()) {
      setError('请输入主队和客队名称');
      return;
    }
    setLoading(true);
    setError('');
    setPrediction(null);
    try {
      const res = await api.elo.predictMatch(home.trim(), away.trim(), neutral);
      if (res && 'error' in res) {
        setError(res.error as string);
      } else if (res) {
        setPrediction(res as MatchPrediction);
      } else {
        setError('未找到这两支球队的 ELO 数据，请确认球队名称');
      }
    } catch (err: any) {
      setError(err.message || '预测失败');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handlePredict();
  };

  const maxProb = prediction
    ? Math.max(
        prediction.homeWinProbability,
        prediction.drawProbability,
        prediction.awayWinProbability,
      )
    : 0;

  return (
    <div className="predict-page">
      <h1>🔮 比赛预测</h1>
      <p className="page-desc">输入两支球队名称，基于 ELO 评分预测比赛结果</p>

      <div className="predict-form">
        <div className="form-row">
          <div className="form-group">
            <label>主队</label>
            <input
              type="text"
              placeholder="例: Brazil"
              value={home}
              onChange={(e) => setHome(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div className="vs-badge">VS</div>
          <div className="form-group">
            <label>客队</label>
            <input
              type="text"
              placeholder="例: Argentina"
              value={away}
              onChange={(e) => setAway(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>
        <div className="form-options">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={neutral}
              onChange={(e) => setNeutral(e.target.checked)}
            />
            中立场地（无主场优势）
          </label>
        </div>
        <button
          className="btn btn-primary predict-btn"
          onClick={handlePredict}
          disabled={loading}
        >
          {loading ? '预测中...' : '预测结果'}
        </button>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {prediction && (
        <div className="prediction-result">
          <div className="matchup-display">
            <div className="team-side">
              <span className="team-label">主队</span>
              <span className="team-name-display">{prediction.homeTeam}</span>
              <span className="team-rating-display">
                ELO {Math.round(prediction.homeRating)}
              </span>
            </div>
            <div className="vs-display">VS</div>
            <div className="team-side">
              <span className="team-label">客队</span>
              <span className="team-name-display">{prediction.awayTeam}</span>
              <span className="team-rating-display">
                ELO {Math.round(prediction.awayRating)}
              </span>
            </div>
          </div>

          <div className="prob-bars">
            <div className="prob-item">
              <div className="prob-header">
                <span>主队胜</span>
                <span className="prob-value">
                  {(prediction.homeWinProbability * 100).toFixed(1)}%
                </span>
              </div>
              <div className="prob-bar">
                <div
                  className={`prob-fill home-fill ${prediction.homeWinProbability === maxProb ? 'winner' : ''}`}
                  style={{ width: `${prediction.homeWinProbability * 100}%` }}
                />
              </div>
            </div>
            <div className="prob-item">
              <div className="prob-header">
                <span>平局</span>
                <span className="prob-value">
                  {(prediction.drawProbability * 100).toFixed(1)}%
                </span>
              </div>
              <div className="prob-bar">
                <div
                  className={`prob-fill draw-fill ${prediction.drawProbability === maxProb ? 'winner' : ''}`}
                  style={{ width: `${prediction.drawProbability * 100}%` }}
                />
              </div>
            </div>
            <div className="prob-item">
              <div className="prob-header">
                <span>客队胜</span>
                <span className="prob-value">
                  {(prediction.awayWinProbability * 100).toFixed(1)}%
                </span>
              </div>
              <div className="prob-bar">
                <div
                  className={`prob-fill away-fill ${prediction.awayWinProbability === maxProb ? 'winner' : ''}`}
                  style={{ width: `${prediction.awayWinProbability * 100}%` }}
                />
              </div>
            </div>
          </div>

          <div className="prediction-summary">
            <div className="summary-card">
              <span className="summary-label">预测结果</span>
              <span className="summary-value">
                {maxProb === prediction.homeWinProbability
                  ? `${prediction.homeTeam} 胜`
                  : maxProb === prediction.awayWinProbability
                    ? `${prediction.awayTeam} 胜`
                    : '平局'}
              </span>
            </div>
            <div className="summary-card">
              <span className="summary-label">主场优势</span>
              <span className="summary-value">{prediction.homeAdvantage}</span>
            </div>
            <div className="summary-card">
              <span className="summary-label">ELO 差值</span>
              <span className="summary-value">
                {Math.round(
                  Math.abs(prediction.homeRating - prediction.awayRating),
                )}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
