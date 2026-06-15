import { useEffect, useState } from 'react';
import {
  api,
  type WcPrediction,
  type AdvancedPrediction,
  type WcWeather,
  type WcReferee,
} from '../api';
import './PredictAdvanced.css';
import { tTeam, tVenue } from '../utils/i18n';
import { parseBeijingDate, parseBeijingParts } from '../utils/beijing-time';

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
    const start = parseBeijingDate(m.matchDate);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    if (now >= start && now <= end) return 'live';
    return 'upcoming';
  };

  const formatMatchTime = (dateStr: string) => {
    const b = parseBeijingParts(dateStr);
    return `${b.year.slice(2)}/${b.month}/${b.day} ${b.hours}:${b.minutes}`;
  };

  const [weather, setWeather] = useState<WcWeather | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);

  const [referee, setReferee] = useState<WcReferee | null>(null);
  const [refereeLoading, setRefereeLoading] = useState(false);
  const [allReferees, setAllReferees] = useState<WcReferee[]>([]);
  const [manualReferee, setManualReferee] = useState(false);

  const [kFactor, setKFactor] = useState(32);
  const [homeAdvantage, setHomeAdvantage] = useState(100);
  const [weatherWeight, setWeatherWeight] = useState(1.0);
  const [refereeStrictness, setRefereeStrictness] = useState('average');
  const [refereeWeight, setRefereeWeight] = useState(1.0);
  const [neutral, setNeutral] = useState(false);

  const [homeForm, setHomeForm] = useState(5);
  const [awayForm, setAwayForm] = useState(5);
  const [homeStarPower, setHomeStarPower] = useState(5);
  const [awayStarPower, setAwayStarPower] = useState(5);
  const [homeTactics, setHomeTactics] = useState('balanced');
  const [awayTactics, setAwayTactics] = useState('balanced');
  const [homeFatigue, setHomeFatigue] = useState(3);
  const [awayFatigue, setAwayFatigue] = useState(3);
  const [homePressure, setHomePressure] = useState(5);
  const [awayPressure, setAwayPressure] = useState(5);

  const [prediction, setPrediction] = useState<AdvancedPrediction | null>(null);
  const [predicting, setPredicting] = useState(false);
  const [error, setError] = useState('');

  const [fairnessWeight, setFairnessWeight] = useState(1.0);
  const [fifaWeight, setFifaWeight] = useState(1.0);
  const [bookmakerWeight, setBookmakerWeight] = useState(1.0);

  useEffect(() => {
    api.wc
      .getRecentMatches()
      .then((data) => {
        const now = new Date();
        const upcoming = data.filter(
          (m) => parseBeijingDate(m.matchDate) > now,
        );
        setMatches(upcoming);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    api.wc
      .getAllReferees()
      .then(setAllReferees)
      .catch(() => {});
  }, []);

  const handleSelectMatch = async (m: WcPrediction) => {
    setSelectedMatch(m);
    setNeutral(m.neutral);
    setPrediction(null);
    setError('');
    setWeather(null);
    setWeatherLoading(true);
    setReferee(null);
    setRefereeLoading(true);
    setManualReferee(false);
    try {
      const [data, ref] = await Promise.all([
        api.wc.getWeather(m.id),
        api.wc.getReferee(m.id),
      ]);
      setWeather(data);
      if (ref) {
        setReferee(ref);
        setRefereeStrictness(ref.style);
      }
    } catch {
      setWeather(null);
      setReferee(null);
    } finally {
      setWeatherLoading(false);
      setRefereeLoading(false);
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
        weatherCondition: weather?.during.condition || 'sunny',
        refereeStrictness,
        homeForm,
        awayForm,
        homeStarPower,
        awayStarPower,
        homeTactics,
        awayTactics,
        homeFatigue,
        awayFatigue,
        homePressure,
        awayPressure,
        fairnessWeight,
        fifaWeight,
        bookmakerWeight,
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
                  <div className="mli-header">
                    <span className="mli-group">{m.groupName}组</span>
                    <span className="mli-time">
                      {formatMatchTime(m.matchDate)}
                    </span>
                  </div>
                  <div className="mli-teams">
                    <span>{tTeam(m.homeTeam)}</span>
                    <span className="mli-vs">vs</span>
                    <span>{tTeam(m.awayTeam)}</span>
                    {status === 'live' && (
                      <span className="mli-live-badge">● 进行中</span>
                    )}
                  </div>
                  {m.venue && (
                    <div className="mli-venue">{tVenue(m.venue)}</div>
                  )}
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
                <div className="weather-slots">
                  {[
                    { key: 'before', label: '赛前2小时', data: weather.before },
                    { key: 'during', label: '比赛期间', data: weather.during },
                    { key: 'after', label: '赛后2小时', data: weather.after },
                  ].map((slot) => (
                    <div className="weather-slot" key={slot.key}>
                      <div className="weather-slot-header">
                        <span className="weather-icon">{slot.data.label}</span>
                        <span className="weather-slot-label">{slot.label}</span>
                      </div>
                      <div className="weather-slot-details">
                        {slot.data.temperature !== null && (
                          <div className="weather-detail-item">
                            <span className="wd-label">气温</span>
                            <span className="wd-value">
                              {slot.data.temperature}°C
                            </span>
                          </div>
                        )}
                        {slot.data.precipitation !== null && (
                          <div className="weather-detail-item">
                            <span className="wd-label">降水</span>
                            <span className="wd-value">
                              {slot.data.precipitation}%
                            </span>
                          </div>
                        )}
                        {slot.data.windSpeed !== null && (
                          <div className="weather-detail-item">
                            <span className="wd-label">风速</span>
                            <span className="wd-value">
                              {slot.data.windSpeed} km/h
                            </span>
                          </div>
                        )}
                        {slot.data.humidity !== null && (
                          <div className="weather-detail-item">
                            <span className="wd-label">湿度</span>
                            <span className="wd-value">
                              {slot.data.humidity}%
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="weather-source">
                  数据来源: Open-Meteo | {weather.matchDate}
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
            <label className="param-label">比赛裁判</label>
            {!selectedMatch && (
              <div className="weather-placeholder">请先在左侧选择一场比赛</div>
            )}
            {selectedMatch && refereeLoading && (
              <div className="weather-loading">正在获取裁判信息...</div>
            )}
            {selectedMatch && !refereeLoading && referee && !manualReferee && (
              <div className="referee-info-card">
                <div className="referee-header">
                  <span className="referee-name">👨‍⚖️ {referee.name}</span>
                  <span className="referee-nationality">
                    {referee.nationality}
                  </span>
                  <span className={`referee-badge badge-${referee.style}`}>
                    {referee.styleLabel}
                  </span>
                </div>
                <div className="referee-summary">{referee.styleSummary}</div>
                <button
                  className="referee-change-btn"
                  onClick={() => setManualReferee(true)}
                >
                  手动选择其他裁判
                </button>
              </div>
            )}
            {(manualReferee || (!refereeLoading && !referee)) &&
              selectedMatch && (
                <select
                  className="referee-select"
                  value={refereeStrictness}
                  onChange={(e) => setRefereeStrictness(e.target.value)}
                >
                  <option value="lenient">宽松型 — 更少出牌</option>
                  <option value="average">均衡型 — 标准判罚</option>
                  <option value="strict">严格型 — 更多出牌</option>
                  <option value="very_strict">极严型 — 频繁出牌</option>
                </select>
              )}
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

          <div className="param-divider" />

          <div className="param-group">
            <label className="param-label">
              🏃 {tTeam(selectedMatch?.homeTeam || '')} 近期状态{' '}
              <span className="param-value">{homeForm}</span>
            </label>
            <input
              type="range"
              min="1"
              max="10"
              step="1"
              value={homeForm}
              onChange={(e) => setHomeForm(Number(e.target.value))}
            />
            <label className="param-label">
              🏃 {tTeam(selectedMatch?.awayTeam || '')} 近期状态{' '}
              <span className="param-value">{awayForm}</span>
            </label>
            <input
              type="range"
              min="1"
              max="10"
              step="1"
              value={awayForm}
              onChange={(e) => setAwayForm(Number(e.target.value))}
            />
            <div className="param-hint">
              近期连胜/连败对球队信心和表现影响显著
            </div>
          </div>

          <div className="param-group">
            <label className="param-label">
              ⭐ {tTeam(selectedMatch?.homeTeam || '')} 球星影响力{' '}
              <span className="param-value">{homeStarPower}</span>
            </label>
            <input
              type="range"
              min="1"
              max="10"
              step="1"
              value={homeStarPower}
              onChange={(e) => setHomeStarPower(Number(e.target.value))}
            />
            <label className="param-label">
              ⭐ {tTeam(selectedMatch?.awayTeam || '')} 球星影响力{' '}
              <span className="param-value">{awayStarPower}</span>
            </label>
            <input
              type="range"
              min="1"
              max="10"
              step="1"
              value={awayStarPower}
              onChange={(e) => setAwayStarPower(Number(e.target.value))}
            />
            <div className="param-hint">
              球星个人能力可在关键时刻改变比赛走势
            </div>
          </div>

          <div className="param-group">
            <label className="param-label">
              🎯 {tTeam(selectedMatch?.homeTeam || '')} 战术风格
            </label>
            <select
              className="referee-select"
              value={homeTactics}
              onChange={(e) => setHomeTactics(e.target.value)}
            >
              <option value="attacking">进攻型 — 积极前压</option>
              <option value="balanced">均衡型 — 攻守兼备</option>
              <option value="defensive">防守型 — 稳固反击</option>
            </select>
            <label className="param-label">
              🎯 {tTeam(selectedMatch?.awayTeam || '')} 战术风格
            </label>
            <select
              className="referee-select"
              value={awayTactics}
              onChange={(e) => setAwayTactics(e.target.value)}
            >
              <option value="attacking">进攻型 — 积极前压</option>
              <option value="balanced">均衡型 — 攻守兼备</option>
              <option value="defensive">防守型 — 稳固反击</option>
            </select>
            <div className="param-hint">
              进攻型倾向更多进球但防守薄弱，防守型更稳固但进攻乏力
            </div>
          </div>

          <div className="param-group">
            <label className="param-label">
              😫 {tTeam(selectedMatch?.homeTeam || '')} 疲劳度{' '}
              <span className="param-value">{homeFatigue}</span>
            </label>
            <input
              type="range"
              min="1"
              max="10"
              step="1"
              value={homeFatigue}
              onChange={(e) => setHomeFatigue(Number(e.target.value))}
            />
            <label className="param-label">
              😫 {tTeam(selectedMatch?.awayTeam || '')} 疲劳度{' '}
              <span className="param-value">{awayFatigue}</span>
            </label>
            <input
              type="range"
              min="1"
              max="10"
              step="1"
              value={awayFatigue}
              onChange={(e) => setAwayFatigue(Number(e.target.value))}
            />
            <div className="param-hint">
              赛程密集、长途旅行导致疲劳，高疲劳降低球队表现
            </div>
          </div>

          <div className="param-group">
            <label className="param-label">
              💪 {tTeam(selectedMatch?.homeTeam || '')} 心理压力{' '}
              <span className="param-value">{homePressure}</span>
            </label>
            <input
              type="range"
              min="1"
              max="10"
              step="1"
              value={homePressure}
              onChange={(e) => setHomePressure(Number(e.target.value))}
            />
            <label className="param-label">
              💪 {tTeam(selectedMatch?.awayTeam || '')} 心理压力{' '}
              <span className="param-value">{awayPressure}</span>
            </label>
            <input
              type="range"
              min="1"
              max="10"
              step="1"
              value={awayPressure}
              onChange={(e) => setAwayPressure(Number(e.target.value))}
            />
            <div className="param-hint">
              大赛经验不足或背水一战的压力影响发挥
            </div>
          </div>

          <div className="param-divider" />
          <div className="param-group">
            <label className="param-label">
              ⚖️ 公平维持权重{' '}
              <span className="param-value">{fairnessWeight.toFixed(1)}</span>
            </label>
            <input
              type="range"
              min="0"
              max="3"
              step="0.1"
              value={fairnessWeight}
              onChange={(e) => setFairnessWeight(Number(e.target.value))}
            />
            <div className="param-hint">
              公平性考量对预测的影响，值越高越倾向于缩小强弱差距
            </div>
          </div>
          <div className="param-group">
            <label className="param-label">
              💰 FIFA收益权重{' '}
              <span className="param-value">{fifaWeight.toFixed(1)}</span>
            </label>
            <input
              type="range"
              min="0"
              max="3"
              step="0.1"
              value={fifaWeight}
              onChange={(e) => setFifaWeight(Number(e.target.value))}
            />
            <div className="param-hint">
              商业推广因素对预测的影响，值越高强队越受青睐
            </div>
          </div>
          <div className="param-group">
            <label className="param-label">
              🎰 庄家收益权重{' '}
              <span className="param-value">{bookmakerWeight.toFixed(1)}</span>
            </label>
            <input
              type="range"
              min="0"
              max="3"
              step="0.1"
              value={bookmakerWeight}
              onChange={(e) => setBookmakerWeight(Number(e.target.value))}
            />
            <div className="param-hint">
              资本博弈因素对预测的影响，值越高平局和冷门概率越大
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
              <span className="rt-name">{tTeam(prediction.homeTeam)}</span>
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
                  ? `${tTeam(prediction.homeTeam)} 胜`
                  : maxProb === prediction.awayWinProbability
                    ? `${tTeam(prediction.awayTeam)} 胜`
                    : '平局'}
              </div>
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
            <div className="effect-card">
              <span className="effect-label">🏃 状态影响</span>
              <span
                className={`effect-value ${prediction.formEffect > 0 ? 'positive' : prediction.formEffect < 0 ? 'negative' : ''}`}
              >
                {prediction.formEffect > 0 ? '+' : ''}
                {prediction.formEffect}
              </span>
              <span className="effect-desc">
                {prediction.formEffect === 0
                  ? '无差异'
                  : prediction.formEffect > 0
                    ? '主队状态优'
                    : '客队状态优'}
              </span>
            </div>
            <div className="effect-card">
              <span className="effect-label">⭐ 球星影响</span>
              <span
                className={`effect-value ${prediction.starEffect > 0 ? 'positive' : prediction.starEffect < 0 ? 'negative' : ''}`}
              >
                {prediction.starEffect > 0 ? '+' : ''}
                {prediction.starEffect}
              </span>
              <span className="effect-desc">
                {prediction.starEffect === 0
                  ? '无差异'
                  : prediction.starEffect > 0
                    ? '主队球星强'
                    : '客队球星强'}
              </span>
            </div>
            <div className="effect-card">
              <span className="effect-label">🎯 战术影响</span>
              <span
                className={`effect-value ${prediction.tacticsEffect > 0 ? 'positive' : prediction.tacticsEffect < 0 ? 'negative' : ''}`}
              >
                {prediction.tacticsEffect > 0 ? '+' : ''}
                {prediction.tacticsEffect}
              </span>
              <span className="effect-desc">
                {prediction.tacticsEffect === 0
                  ? '无差异'
                  : prediction.tacticsEffect > 0
                    ? '主队战术优'
                    : '客队战术优'}
              </span>
            </div>
            <div className="effect-card">
              <span className="effect-label">😫 疲劳影响</span>
              <span
                className={`effect-value ${prediction.fatigueEffect > 0 ? 'positive' : prediction.fatigueEffect < 0 ? 'negative' : ''}`}
              >
                {prediction.fatigueEffect > 0 ? '+' : ''}
                {prediction.fatigueEffect}
              </span>
              <span className="effect-desc">
                {prediction.fatigueEffect === 0
                  ? '无差异'
                  : prediction.fatigueEffect > 0
                    ? '客队更疲劳'
                    : '主队更疲劳'}
              </span>
            </div>
            <div className="effect-card">
              <span className="effect-label">💪 压力影响</span>
              <span
                className={`effect-value ${prediction.pressureEffect > 0 ? 'positive' : prediction.pressureEffect < 0 ? 'negative' : ''}`}
              >
                {prediction.pressureEffect > 0 ? '+' : ''}
                {prediction.pressureEffect}
              </span>
              <span className="effect-desc">
                {prediction.pressureEffect === 0
                  ? '无差异'
                  : prediction.pressureEffect > 0
                    ? '客队压力大'
                    : '主队压力大'}
              </span>
            </div>
            <div className="effect-card">
              <span className="effect-label">⚖️ 公平维持</span>
              <span
                className={`effect-value ${prediction.fairnessEffect > 0 ? 'positive' : prediction.fairnessEffect < 0 ? 'negative' : ''}`}
              >
                {prediction.fairnessEffect > 0 ? '+' : ''}
                {prediction.fairnessEffect}
              </span>
              <span className="effect-desc">
                {prediction.fairnessEffect === 0
                  ? '无影响'
                  : prediction.fairnessEffect > 0
                    ? '偏向主队'
                    : '偏向客队'}
              </span>
            </div>
            <div className="effect-card">
              <span className="effect-label">💰 FIFA收益</span>
              <span
                className={`effect-value ${prediction.fifaEffect > 0 ? 'positive' : prediction.fifaEffect < 0 ? 'negative' : ''}`}
              >
                {prediction.fifaEffect > 0 ? '+' : ''}
                {prediction.fifaEffect}
              </span>
              <span className="effect-desc">
                {prediction.fifaEffect === 0
                  ? '无影响'
                  : prediction.fifaEffect > 0
                    ? '利好强队'
                    : '利好弱队'}
              </span>
            </div>
            <div className="effect-card">
              <span className="effect-label">🎰 庄家收益</span>
              <span
                className={`effect-value ${prediction.bookmakerEffect > 0 ? 'positive' : prediction.bookmakerEffect < 0 ? 'negative' : ''}`}
              >
                {prediction.bookmakerEffect > 0 ? '+' : ''}
                {prediction.bookmakerEffect}
              </span>
              <span className="effect-desc">
                {prediction.bookmakerEffect === 0
                  ? '无影响'
                  : prediction.bookmakerEffect > 0
                    ? '偏向主队'
                    : '偏向客队'}
              </span>
            </div>
          </div>
        </div>
      )}

      {prediction && (
        <div className="comparison-section">
          <h3 className="comparison-title">🌐 博弈论分析</h3>

          <div className="game-theory-analysis">
            <div className="gta-card">
              <div className="gta-header">
                <span className="gta-icon">⚖️</span>
                <span className="gta-title">比赛公平维持角度</span>
              </div>
              <p className="gta-text">
                {prediction.fairnessEffect === 0
                  ? '双方实力接近，公平维持机制无明显影响。'
                  : prediction.fairnessEffect > 0
                    ? `公平维持机制倾向于缩小差距，主队胜率被下调 ${Math.abs(prediction.fairnessEffect * 100).toFixed(1)}%，弱队获得更多机会。赛事组织方可能通过VAR介入、补时增加等方式平衡比赛。`
                    : `公平维持机制倾向于缩小差距，客队胜率被下调 ${Math.abs(prediction.fairnessEffect * 100).toFixed(1)}%，弱队获得更多机会。赛事组织方可能通过VAR介入、补时增加等方式平衡比赛。`}
              </p>
            </div>
            <div className="gta-card">
              <div className="gta-header">
                <span className="gta-icon">💰</span>
                <span className="gta-title">国际足联推广收益角度</span>
              </div>
              <p className="gta-text">
                {prediction.fifaEffect === 0
                  ? '双方实力接近，商业推广因素无明显倾向。'
                  : prediction.fifaEffect > 0
                    ? `从商业推广角度，强队晋级有利于维持赛事关注度和赞助商利益。当前模型中FIFA收益因素使主队胜率提升 ${(prediction.fifaEffect * 100).toFixed(1)}%。`
                    : `从商业推广角度，强队晋级有利于维持赛事关注度和赞助商利益。当前模型中FIFA收益因素使客队胜率提升 ${(Math.abs(prediction.fifaEffect) * 100).toFixed(1)}%。`}
              </p>
            </div>
            <div className="gta-card">
              <div className="gta-header">
                <span className="gta-icon">🎰</span>
                <span className="gta-title">资本庄家收益角度</span>
              </div>
              <p className="gta-text">
                {prediction.bookmakerEffect === 0
                  ? '双方概率均衡，庄家无需额外平衡投注。'
                  : `博彩庄家倾向于平衡两边投注额以锁定利润。当前模型中庄家因素使主队胜率调整 ${(prediction.bookmakerEffect * 100).toFixed(1)}%，同时平局概率有所上升，因为平局是庄家利润最优解。`}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
