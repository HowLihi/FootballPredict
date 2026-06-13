import { useEffect, useState } from 'react';
import {
  api,
  type WcPrediction,
  type AdvancedPrediction,
  type WcWeather,
} from '../api';
import './PredictAdvanced.css';

const REFEREE_OPTIONS = [
  { value: 'lenient', label: '宽松 — 更少出牌，比赛流畅' },
  { value: 'average', label: '适中 — 标准判罚尺度' },
  { value: 'strict', label: '严格 — 更多出牌，比赛中断多' },
  { value: 'very_strict', label: '极严 — 频繁出牌，比赛碎片化' },
];

export default function PredictAdvanced() {
  const [matches, setMatches] = useState<WcPrediction[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<WcPrediction | null>(null);
  const [loading, setLoading] = useState(true);

  const getMatchStatus = (m: WcPrediction): 'live' | 'upcoming' => {
    const now = new Date();
    const start = new Date(m.matchDate.replace(' ', 'T'));
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    if (now >= start && now <= end) return 'live';
    return 'upcoming';
  };

  const formatMatchTime = (dateStr: string) => {
    const d = new Date(dateStr.replace(' ', 'T'));
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  const [weather, setWeather] = useState<WcWeather | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);

  const [kFactor, setKFactor] = useState(32);
  const [homeAdvantage, setHomeAdvantage] = useState(100);
  const [weatherWeight, setWeatherWeight] = useState(1.0);
  const [refereeStrictness, setRefereeStrictness] = useState('average');
  const [refereeWeight, setRefereeWeight] = useState(1.0);
  const [neutral, setNeutral] = useState(false);

  const [prediction, setPrediction] = useState<AdvancedPrediction | null>(null);
  const [predicting, setPredicting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.wc
      .getRecentMatches()
      .then((data) => {
        const upcoming = data.filter((m) => m.actualHomeScore === null);
        setMatches(upcoming);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSelectMatch = async (m: WcPrediction) => {
    setSelectedMatch(m);
    setNeutral(m.neutral);
    setPrediction(null);
    setError('');
    setWeather(null);
    setWeatherLoading(true);
    try {
      const data = await api.wc.getWeather(m.id);
      setWeather(data);
    } catch {
      setWeather(null);
    } finally {
      setWeatherLoading(false);
    }
  };

  const handlePredict = async () => {
    if (!selectedMatch) {
      setError('请先选择一场比赛');
      return;
    }
    setPredicting(true);
    setError('');
    setPrediction(null);
    try {
      const res = await api.elo.predictAdvanced({
        homeTeam: selectedMatch.homeTeam,
        awayTeam: selectedMatch.awayTeam,
        neutral,
        kFactor,
        homeAdvantage,
        weatherWeight,
        refereeWeight,
        weatherCondition: weather?.condition || 'sunny',
        refereeStrictness,
      });
      if (res && 'error' in res) {
        setError(res.error as string);
      } else if (res) {
        setPrediction(res as AdvancedPrediction);
      } else {
        setError('未找到球队 ELO 数据');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPredicting(false);
    }
  };

  const maxProb = prediction
    ? Math.max(
        prediction.homeWinProbability,
        prediction.drawProbability,
        prediction.awayWinProbability,
      )
    : 0;

  return (
    <div className="predict-adv-page">
      <h1>🎛️ 调参预测</h1>
      <p className="page-desc">选择一场比赛，调整参数权重，预测比赛结果</p>

      <div className="predict-layout">
        <div className="match-select-panel">
          <h3>选择比赛</h3>
          {loading && <div className="loading">加载中...</div>}
          {!loading && matches.length === 0 && (
            <div className="no-data-small">暂无即将开始或进行中的比赛</div>
          )}
          <div className="match-list">
            {matches.map((m) => {
              const status = getMatchStatus(m);
              return (
                <div
                  key={m.id}
                  className={`match-list-item ${selectedMatch?.id === m.id ? 'selected' : ''}`}
                  onClick={() => handleSelectMatch(m)}
                >
                  <div className="mli-teams">
                    <span>{m.homeTeam}</span>
                    <span className="mli-vs">vs</span>
                    <span>{m.awayTeam}</span>
                    {status === 'live' && (
                      <span className="mli-live-badge">● 进行中</span>
                    )}
                  </div>
                  <div className="mli-meta">
                    <span>{m.groupName}组</span>
                    <span>{formatMatchTime(m.matchDate)}</span>
                    {m.venue && <span>📍 {m.venue}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="params-panel">
          <h3>参数调节</h3>

          <div className="param-group">
            <label className="param-label">
              K 因子 <span className="param-value">{kFactor}</span>
            </label>
            <input
              type="range"
              min="10"
              max="60"
              step="1"
              value={kFactor}
              onChange={(e) => setKFactor(Number(e.target.value))}
            />
            <div className="param-hint">
              影响 ELO 积分变化幅度，越大波动越剧烈
            </div>
          </div>

          <div className="param-group">
            <label className="param-label">
              主场优势 <span className="param-value">{homeAdvantage}</span>
            </label>
            <input
              type="range"
              min="0"
              max="200"
              step="5"
              value={homeAdvantage}
              onChange={(e) => setHomeAdvantage(Number(e.target.value))}
            />
            <div className="param-hint">主队额外 ELO 加成，0 = 无主场优势</div>
          </div>

          <div className="param-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={neutral}
                onChange={(e) => setNeutral(e.target.checked)}
              />
              中立场地（忽略主场优势）
            </label>
          </div>

          <div className="param-divider" />

          <div className="param-group">
            <label className="param-label">天气条件</label>
            {!selectedMatch && (
              <div className="weather-placeholder">
                请先在左侧选择一场比赛以获取天气
              </div>
            )}
            {selectedMatch && weatherLoading && (
              <div className="weather-loading">正在获取天气数据...</div>
            )}
            {selectedMatch && !weatherLoading && weather && (
              <div className="weather-info-card">
                <div className="weather-main">
                  <span className="weather-icon">{weather.label}</span>
                </div>
                <div className="weather-details">
                  {weather.temperature !== null && (
                    <div className="weather-detail-item">
                      <span className="wd-label">气温</span>
                      <span className="wd-value">{weather.temperature}°C</span>
                    </div>
                  )}
                  {weather.precipitation !== null && (
                    <div className="weather-detail-item">
                      <span className="wd-label">降水概率</span>
                      <span className="wd-value">{weather.precipitation}%</span>
                    </div>
                  )}
                  {weather.windSpeed !== null && (
                    <div className="weather-detail-item">
                      <span className="wd-label">风速</span>
                      <span className="wd-value">{weather.windSpeed} km/h</span>
                    </div>
                  )}
                  {weather.humidity !== null && (
                    <div className="weather-detail-item">
                      <span className="wd-label">湿度</span>
                      <span className="wd-value">{weather.humidity}%</span>
                    </div>
                  )}
                </div>
                <div className="weather-source">
                  数据来源: Open-Meteo | {weather.matchDate} 比赛日
                </div>
              </div>
            )}
            {selectedMatch && !weatherLoading && !weather && (
              <div className="weather-placeholder">暂无该场地天气数据</div>
            )}
          </div>

          <div className="param-group">
            <label className="param-label">
              天气影响权重{' '}
              <span className="param-value">{weatherWeight.toFixed(1)}</span>
            </label>
            <input
              type="range"
              min="0"
              max="3"
              step="0.1"
              value={weatherWeight}
              onChange={(e) => setWeatherWeight(Number(e.target.value))}
            />
            <div className="param-hint">
              恶劣天气会缩小强弱差距，权重越大影响越明显
            </div>
          </div>

          <div className="param-divider" />

          <div className="param-group">
            <label className="param-label">裁判严格度</label>
            <div className="referee-options">
              {REFEREE_OPTIONS.map((r) => (
                <button
                  key={r.value}
                  className={`referee-btn ${refereeStrictness === r.value ? 'active' : ''}`}
                  onClick={() => setRefereeStrictness(r.value)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="param-group">
            <label className="param-label">
              裁判影响权重{' '}
              <span className="param-value">{refereeWeight.toFixed(1)}</span>
            </label>
            <input
              type="range"
              min="0"
              max="3"
              step="0.1"
              value={refereeWeight}
              onChange={(e) => setRefereeWeight(Number(e.target.value))}
            />
            <div className="param-hint">
              严格裁判增加平局概率，宽松裁判有利于强队
            </div>
          </div>

          <button
            className="btn btn-primary predict-btn"
            onClick={handlePredict}
            disabled={predicting || !selectedMatch}
          >
            {predicting ? '预测中...' : '🔮 开始预测'}
          </button>
        </div>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {prediction && (
        <div className="prediction-result">
          <div className="result-matchup">
            <div className="result-team">
              <span className="rt-label">主队</span>
              <span className="rt-name">{prediction.homeTeam}</span>
              <span className="rt-rating">
                ELO {Math.round(prediction.homeRating)}
              </span>
            </div>
            <div className="result-center">
              <div className="result-score">
                {prediction.predictedHomeScore} :{' '}
                {prediction.predictedAwayScore}
              </div>
              <div className="result-verdict">
                {maxProb === prediction.homeWinProbability
                  ? `${prediction.homeTeam} 胜`
                  : maxProb === prediction.awayWinProbability
                    ? `${prediction.awayTeam} 胜`
                    : '平局'}
              </div>
            </div>
            <div className="result-team">
              <span className="rt-label">客队</span>
              <span className="rt-name">{prediction.awayTeam}</span>
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
                  {(prediction.homeWinProbability * 100).toFixed(1)}%
                </span>
              </div>
              <div className="rp-bar">
                <div
                  className={`rp-fill home ${prediction.homeWinProbability === maxProb ? 'max' : ''}`}
                  style={{ width: `${prediction.homeWinProbability * 100}%` }}
                />
              </div>
            </div>
            <div className="result-prob-item">
              <div className="rp-header">
                <span>平局</span>
                <span className="rp-pct">
                  {(prediction.drawProbability * 100).toFixed(1)}%
                </span>
              </div>
              <div className="rp-bar">
                <div
                  className={`rp-fill draw ${prediction.drawProbability === maxProb ? 'max' : ''}`}
                  style={{ width: `${prediction.drawProbability * 100}%` }}
                />
              </div>
            </div>
            <div className="result-prob-item">
              <div className="rp-header">
                <span>客队胜</span>
                <span className="rp-pct">
                  {(prediction.awayWinProbability * 100).toFixed(1)}%
                </span>
              </div>
              <div className="rp-bar">
                <div
                  className={`rp-fill away ${prediction.awayWinProbability === maxProb ? 'max' : ''}`}
                  style={{ width: `${prediction.awayWinProbability * 100}%` }}
                />
              </div>
            </div>
          </div>

          <div className="result-effects">
            <div className="effect-card">
              <span className="effect-label">天气影响</span>
              <span
                className={`effect-value ${prediction.weatherEffect > 0 ? 'positive' : prediction.weatherEffect < 0 ? 'negative' : ''}`}
              >
                {prediction.weatherEffect > 0 ? '+' : ''}
                {prediction.weatherEffect}
              </span>
              <span className="effect-desc">
                {prediction.weatherEffect === 0
                  ? '无影响'
                  : prediction.weatherEffect > 0
                    ? '利好主队'
                    : '利好客队'}
              </span>
            </div>
            <div className="effect-card">
              <span className="effect-label">裁判影响</span>
              <span
                className={`effect-value ${prediction.refereeEffect > 0 ? 'positive' : prediction.refereeEffect < 0 ? 'negative' : ''}`}
              >
                {prediction.refereeEffect > 0 ? '+' : ''}
                {prediction.refereeEffect}
              </span>
              <span className="effect-desc">
                {prediction.refereeEffect === 0
                  ? '无影响'
                  : prediction.refereeEffect > 0
                    ? '增加平局概率'
                    : '降低平局概率'}
              </span>
            </div>
            <div className="effect-card">
              <span className="effect-label">主场优势</span>
              <span className="effect-value positive">
                {prediction.homeAdvantage}
              </span>
              <span className="effect-desc">
                {prediction.homeAdvantage === 0 ? '中立场地' : '主队加成'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
