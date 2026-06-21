import { useEffect, useState } from 'react';
import {
  api,
  type WcPrediction,
  type AdvancedPrediction,
  type WcWeather,
  type WcReferee,
  type MatchParamsData,
  type MatchSummaryData,
  type MatchSummaryItem,
} from '../api';
import './PredictAdvanced.css';
import { tTeam, tVenue } from '../utils/i18n';
import { parseBeijingDate, parseBeijingParts } from '../utils/beijing-time';

export default function PredictAdvanced() {
  const [matches, setMatches] = useState<WcPrediction[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<WcPrediction | null>(null);
  const [loading, setLoading] = useState(true);

  const getMatchStatus = (
    m: WcPrediction,
  ): 'live' | 'upcoming' | 'finished' => {
    if (m.actualHomeScore !== null && m.actualAwayScore !== null)
      return 'finished';
    const now = new Date();
    const start = parseBeijingDate(m.matchDate);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    if (now > end) return 'finished';
    if (now >= start) return 'live';
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
  const [_allReferees, setAllReferees] = useState<WcReferee[]>([]);
  const [manualReferee, setManualReferee] = useState(false);

  const [kFactor, setKFactor] = useState(32);
  const [homeAdvantage, setHomeAdvantage] = useState(100);
  const [weatherWeight, setWeatherWeight] = useState(0);
  const [refereeStrictness, setRefereeStrictness] = useState('average');
  const [refereeWeight, setRefereeWeight] = useState(0);
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
  const [homeInjuryImpact, setHomeInjuryImpact] = useState(1);
  const [awayInjuryImpact, setAwayInjuryImpact] = useState(1);
  const [homeStakes, setHomeStakes] = useState(5);
  const [awayStakes, setAwayStakes] = useState(5);

  const [prediction, setPrediction] = useState<AdvancedPrediction | null>(null);
  const [predicting, setPredicting] = useState(false);
  const [error, setError] = useState('');

  const [fairnessWeight, setFairnessWeight] = useState(0);
  const [fifaWeight, setFifaWeight] = useState(0);
  const [bookmakerWeight, setBookmakerWeight] = useState(0);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const [matchSummary, setMatchSummary] = useState<MatchSummaryData | null>(
    null,
  );
  const [summaryEditing, setSummaryEditing] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState<MatchSummaryData | null>(
    null,
  );
  const [gatheringIntelligence, setGatheringIntelligence] = useState(false);
  const [quantifying, setQuantifying] = useState(false);
  const [quantifyReasoning, setQuantifyReasoning] = useState('');

  useEffect(() => {
    const loadMatches = async () => {
      try {
        const data = await api.wc.getPredictions();
        setMatches(data);

        const now = new Date();
        const hasFinishedWithoutScore = data.some(
          (m) =>
            m.actualHomeScore === null &&
            m.actualAwayScore === null &&
            parseBeijingDate(m.matchDate).getTime() + 2 * 60 * 60 * 1000 <
              now.getTime(),
        );

        if (hasFinishedWithoutScore) {
          try {
            const res = await api.wc.refreshScores();
            if (res.updated > 0) {
              const refreshed = await api.wc.getPredictions();
              setMatches(refreshed);
            }
          } catch {}
        }
      } catch {
      } finally {
        setLoading(false);
      }
    };

    loadMatches();
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
    setSaveMsg('');
    setWeather(null);
    setWeatherLoading(true);
    setReferee(null);
    setRefereeLoading(true);
    setManualReferee(false);
    setMatchSummary(null);
    setSummaryEditing(false);
    setSummaryDraft(null);
    try {
      const [data, ref, savedParams] = await Promise.all([
        api.wc.getWeather(m.id),
        api.wc.getReferee(m.id),
        api.wc.getMatchParams(m.id).catch(() => null),
      ]);
      setWeather(data);
      if (ref) {
        setReferee(ref);
        setRefereeStrictness(ref.style);
      }
      if (savedParams) {
        setKFactor(savedParams.kFactor);
        setHomeAdvantage(savedParams.homeAdvantage);
        setNeutral(savedParams.neutral);
        setWeatherWeight(savedParams.weatherWeight);
        setRefereeWeight(savedParams.refereeWeight);
        setRefereeStrictness(savedParams.refereeStrictness);
        setHomeForm(savedParams.homeForm);
        setAwayForm(savedParams.awayForm);
        setHomeStarPower(savedParams.homeStarPower);
        setAwayStarPower(savedParams.awayStarPower);
        setHomeTactics(savedParams.homeTactics);
        setAwayTactics(savedParams.awayTactics);
        setHomeFatigue(savedParams.homeFatigue);
        setAwayFatigue(savedParams.awayFatigue);
        setHomePressure(savedParams.homePressure);
        setAwayPressure(savedParams.awayPressure);
        setHomeInjuryImpact(savedParams.homeInjuryImpact);
        setAwayInjuryImpact(savedParams.awayInjuryImpact);
        setHomeStakes(savedParams.homeStakes);
        setAwayStakes(savedParams.awayStakes);
        setFairnessWeight(savedParams.fairnessWeight);
        setFifaWeight(savedParams.fifaWeight);
        setBookmakerWeight(savedParams.bookmakerWeight);
        if (savedParams.matchSummary) {
          setMatchSummary(savedParams.matchSummary);
        }
      } else {
        setKFactor(32);
        setHomeAdvantage(100);
        setWeatherWeight(0);
        setRefereeWeight(0);
        setRefereeStrictness('average');
        setHomeForm(5);
        setAwayForm(5);
        setHomeStarPower(5);
        setAwayStarPower(5);
        setHomeTactics('balanced');
        setAwayTactics('balanced');
        setHomeFatigue(3);
        setAwayFatigue(3);
        setHomePressure(5);
        setAwayPressure(5);
        setHomeInjuryImpact(1);
        setAwayInjuryImpact(1);
        setHomeStakes(5);
        setAwayStakes(5);
        setFairnessWeight(0);
        setFifaWeight(0);
        setBookmakerWeight(0);
      }
    } catch {
      setWeather(null);
      setReferee(null);
    } finally {
      setWeatherLoading(false);
      setRefereeLoading(false);
    }
  };

  const handleSaveParams = async () => {
    if (!selectedMatch) return;
    setSaving(true);
    setSaveMsg('');
    try {
      await api.wc.saveMatchParams(selectedMatch.id, {
        kFactor,
        homeAdvantage,
        neutral,
        weatherWeight,
        weatherCondition: weather?.during.condition || 'sunny',
        refereeWeight,
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
        homeInjuryImpact,
        awayInjuryImpact,
        homeStakes,
        awayStakes,
        fairnessWeight,
        fifaWeight,
        bookmakerWeight,
        matchSummary: matchSummary,
      });
      setSaveMsg('✅ 已保存');
    } catch {
      setSaveMsg('❌ 保存失败');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 2000);
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
        homeInjuryImpact,
        awayInjuryImpact,
        homeStakes,
        awayStakes,
        fairnessWeight,
        fifaWeight,
        bookmakerWeight,
      });
      if (res && 'error' in res) {
        setError(res.error as string);
      } else if (res) {
        setPrediction(res as AdvancedPrediction);
      } else {
        setError('未找到球队数据');
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

  const [matchTab, setMatchTab] = useState<'upcoming' | 'finished'>('upcoming');

  const emptySummary: MatchSummaryData = {
    highlights: [],
    keyEvents: [''],
    refereeNote: '',
    venueNote: '',
    generalNote: '',
  };

  const getImpactLabel = (impact: MatchSummaryItem['impact']) => {
    switch (impact) {
      case 'home_positive':
        return '利好主队';
      case 'home_negative':
        return '不利主队';
      case 'away_positive':
        return '利好客队';
      case 'away_negative':
        return '不利客队';
      case 'neutral':
        return '中立';
    }
  };

  const startEditSummary = () => {
    setSummaryDraft(
      matchSummary || {
        ...emptySummary,
        highlights: [
          {
            category: '',
            icon: '📋',
            title: '',
            detail: '',
            impact: 'neutral' as const,
          },
        ],
      },
    );
    setSummaryEditing(true);
  };

  const addHighlight = () => {
    if (!summaryDraft) return;
    setSummaryDraft({
      ...summaryDraft,
      highlights: [
        ...summaryDraft.highlights,
        {
          category: '',
          icon: '📋',
          title: '',
          detail: '',
          impact: 'neutral' as const,
        },
      ],
    });
  };

  const removeHighlight = (idx: number) => {
    if (!summaryDraft) return;
    setSummaryDraft({
      ...summaryDraft,
      highlights: summaryDraft.highlights.filter((_, i) => i !== idx),
    });
  };

  const updateHighlight = (
    idx: number,
    field: keyof MatchSummaryItem,
    value: string,
  ) => {
    if (!summaryDraft) return;
    const updated = [...summaryDraft.highlights];
    updated[idx] = { ...updated[idx], [field]: value };
    setSummaryDraft({ ...summaryDraft, highlights: updated });
  };

  const addKeyEvent = () => {
    if (!summaryDraft) return;
    setSummaryDraft({
      ...summaryDraft,
      keyEvents: [...summaryDraft.keyEvents, ''],
    });
  };

  const removeKeyEvent = (idx: number) => {
    if (!summaryDraft) return;
    setSummaryDraft({
      ...summaryDraft,
      keyEvents: summaryDraft.keyEvents.filter((_, i) => i !== idx),
    });
  };

  const updateKeyEvent = (idx: number, value: string) => {
    if (!summaryDraft) return;
    const updated = [...summaryDraft.keyEvents];
    updated[idx] = value;
    setSummaryDraft({ ...summaryDraft, keyEvents: updated });
  };

  const saveSummary = () => {
    if (!summaryDraft) return;
    setMatchSummary(summaryDraft);
    setSummaryEditing(false);
    setSummaryDraft(null);
  };

  const cancelEditSummary = () => {
    setSummaryEditing(false);
    setSummaryDraft(null);
  };

  const handleGatherIntelligence = async () => {
    if (!selectedMatch) return;
    setGatheringIntelligence(true);
    try {
      const res = await api.wc.gatherIntelligence(selectedMatch.id);
      if (res?.summary) {
        setMatchSummary(res.summary);
      }
    } catch {
    } finally {
      setGatheringIntelligence(false);
    }
  };

  const handleQuantifyIntelligence = async () => {
    if (!selectedMatch || !matchSummary) return;
    setQuantifying(true);
    setQuantifyReasoning('');
    try {
      const res = await api.wc.quantifyIntelligence(
        selectedMatch.id,
        matchSummary,
      );
      if (res?.params) {
        const p = res.params;
        setHomeForm(p.homeForm);
        setAwayForm(p.awayForm);
        setHomeStarPower(p.homeStarPower);
        setAwayStarPower(p.awayStarPower);
        setHomeTactics(p.homeTactics);
        setAwayTactics(p.awayTactics);
        setHomeFatigue(p.homeFatigue);
        setAwayFatigue(p.awayFatigue);
        setHomePressure(p.homePressure);
        setAwayPressure(p.awayPressure);
        setHomeInjuryImpact(p.homeInjuryImpact);
        setAwayInjuryImpact(p.awayInjuryImpact);
        setHomeStakes(p.homeStakes);
        setAwayStakes(p.awayStakes);
        setRefereeStrictness(p.refereeStrictness);
        setQuantifyReasoning(res.reasoning || '');
      }
    } catch {
      setQuantifyReasoning('量化失败，请重试');
    } finally {
      setQuantifying(false);
    }
  };

  const upcomingMatches = matches.filter(
    (m) => getMatchStatus(m) !== 'finished',
  );
  const finishedMatches = matches.filter(
    (m) => getMatchStatus(m) === 'finished',
  );
  const displayedMatches =
    matchTab === 'upcoming' ? upcomingMatches : finishedMatches;

  return (
    <div className="predict-adv-page">
      <h1>🎛️ 调参预测</h1>
      <p className="page-desc">
        基于集成预测结果，调整参数权重，精细预测比赛结果
      </p>

      <div className="predict-layout">
        <div className="match-select-panel">
          <h3>选择比赛</h3>
          <div className="match-tabs">
            <button
              className={`match-tab ${matchTab === 'upcoming' ? 'active' : ''}`}
              onClick={() => setMatchTab('upcoming')}
            >
              未开始
              {upcomingMatches.length > 0 && (
                <span className="tab-count">{upcomingMatches.length}</span>
              )}
            </button>
            <button
              className={`match-tab ${matchTab === 'finished' ? 'active' : ''}`}
              onClick={() => setMatchTab('finished')}
            >
              已结束
              {finishedMatches.length > 0 && (
                <span className="tab-count">{finishedMatches.length}</span>
              )}
            </button>
          </div>
          {loading && <div className="loading">加载中...</div>}
          {!loading && displayedMatches.length === 0 && (
            <div className="no-data-small">
              {matchTab === 'upcoming'
                ? '暂无未开始的比赛'
                : '暂无已结束的比赛'}
            </div>
          )}
          <div className="match-list">
            {displayedMatches.map((m) => {
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
                    <span className="mli-vs">
                      {status === 'finished'
                        ? `${m.actualHomeScore} : ${m.actualAwayScore}`
                        : 'vs'}
                    </span>
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
          <div className="match-summary-section">
            <div className="summary-header">
              <h3>📋 赛情概要</h3>
              {selectedMatch && !summaryEditing && (
                <div className="summary-header-actions">
                  <button
                    className="btn-gather-intel"
                    onClick={handleGatherIntelligence}
                    disabled={gatheringIntelligence || quantifying}
                  >
                    {gatheringIntelligence ? '⏳ 搜集中...' : '🔍 搜集情报'}
                  </button>
                  {matchSummary && (
                    <button
                      className="btn-quantify-intel"
                      onClick={handleQuantifyIntelligence}
                      disabled={quantifying || gatheringIntelligence}
                    >
                      {quantifying ? '⏳ 量化中...' : '📊 量化参数'}
                    </button>
                  )}
                  <button
                    className="btn-summary-edit"
                    onClick={startEditSummary}
                    disabled={gatheringIntelligence || quantifying}
                  >
                    {matchSummary ? '✏️ 编辑' : '➕ 添加'}
                  </button>
                </div>
              )}
            </div>

            {!selectedMatch && (
              <div className="summary-placeholder">请先在左侧选择一场比赛</div>
            )}

            {selectedMatch && !summaryEditing && !matchSummary && (
              <div className="summary-empty">
                <div className="summary-empty-icon">📝</div>
                <div className="summary-empty-text">
                  暂无赛情概要，点击上方"添加"按钮录入关键比赛信息
                </div>
              </div>
            )}

            {selectedMatch && !summaryEditing && matchSummary && (
              <div className="summary-display">
                {matchSummary.highlights.length > 0 && (
                  <div className="summary-highlights">
                    {matchSummary.highlights.map((h, i) => (
                      <div
                        key={i}
                        className={`summary-highlight-item impact-${h.impact}`}
                      >
                        <span className="sh-icon">{h.icon}</span>
                        <div className="sh-content">
                          <div className="sh-title-row">
                            <span className="sh-category">{h.category}</span>
                            <span className="sh-title">{h.title}</span>
                          </div>
                          <div className="sh-detail">{h.detail}</div>
                        </div>
                        <span className={`sh-impact-badge badge-${h.impact}`}>
                          {getImpactLabel(h.impact)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {matchSummary.keyEvents.filter((e) => e).length > 0 && (
                  <div className="summary-key-events">
                    <div className="ske-label">🔑 关键事件</div>
                    <ul className="ske-list">
                      {matchSummary.keyEvents
                        .filter((e) => e)
                        .map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                    </ul>
                  </div>
                )}
                {(matchSummary.refereeNote ||
                  matchSummary.venueNote ||
                  matchSummary.generalNote) && (
                  <div className="summary-notes">
                    {matchSummary.refereeNote && (
                      <div className="summary-note-item">
                        <span className="sn-icon">👨‍⚖️</span>
                        <span className="sn-text">
                          {matchSummary.refereeNote}
                        </span>
                      </div>
                    )}
                    {matchSummary.venueNote && (
                      <div className="summary-note-item">
                        <span className="sn-icon">🏟️</span>
                        <span className="sn-text">
                          {matchSummary.venueNote}
                        </span>
                      </div>
                    )}
                    {matchSummary.generalNote && (
                      <div className="summary-note-item">
                        <span className="sn-icon">💬</span>
                        <span className="sn-text">
                          {matchSummary.generalNote}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {quantifyReasoning && (
                  <div className="quantify-reasoning">
                    <span className="sn-icon">🤖</span>
                    <span className="sn-text">{quantifyReasoning}</span>
                  </div>
                )}
              </div>
            )}

            {selectedMatch && summaryEditing && summaryDraft && (
              <div className="summary-edit-form">
                <div className="sef-section-label">关键因素</div>
                {summaryDraft.highlights.map((h, i) => (
                  <div key={i} className="sef-highlight-row">
                    <div className="sef-hr-top">
                      <input
                        className="sef-input sef-icon-input"
                        value={h.icon}
                        onChange={(e) =>
                          updateHighlight(i, 'icon', e.target.value)
                        }
                        placeholder="图标"
                      />
                      <input
                        className="sef-input sef-category-input"
                        value={h.category}
                        onChange={(e) =>
                          updateHighlight(i, 'category', e.target.value)
                        }
                        placeholder="类别(如:主场/裁判/伤病)"
                      />
                      <select
                        className="sef-select"
                        value={h.impact}
                        onChange={(e) =>
                          updateHighlight(i, 'impact', e.target.value)
                        }
                      >
                        <option value="home_positive">利好主队</option>
                        <option value="home_negative">不利主队</option>
                        <option value="away_positive">利好客队</option>
                        <option value="away_negative">不利客队</option>
                        <option value="neutral">中立</option>
                      </select>
                      <button
                        className="sef-remove-btn"
                        onClick={() => removeHighlight(i)}
                      >
                        ✕
                      </button>
                    </div>
                    <input
                      className="sef-input sef-title-input"
                      value={h.title}
                      onChange={(e) =>
                        updateHighlight(i, 'title', e.target.value)
                      }
                      placeholder="标题(如:东道主优势)"
                    />
                    <input
                      className="sef-input sef-detail-input"
                      value={h.detail}
                      onChange={(e) =>
                        updateHighlight(i, 'detail', e.target.value)
                      }
                      placeholder="详细说明(如:世界杯东道主首秀从未输球)"
                    />
                  </div>
                ))}
                <button className="sef-add-btn" onClick={addHighlight}>
                  + 添加关键因素
                </button>

                <div className="sef-section-label">关键事件</div>
                {summaryDraft.keyEvents.map((e, i) => (
                  <div key={i} className="sef-event-row">
                    <input
                      className="sef-input sef-event-input"
                      value={e}
                      onChange={(ev) => updateKeyEvent(i, ev.target.value)}
                      placeholder="关键事件描述(如:第35分钟 西索尔红牌罚下)"
                    />
                    <button
                      className="sef-remove-btn"
                      onClick={() => removeKeyEvent(i)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button className="sef-add-btn" onClick={addKeyEvent}>
                  + 添加关键事件
                </button>

                <div className="sef-section-label">备注</div>
                <input
                  className="sef-input"
                  value={summaryDraft.refereeNote}
                  onChange={(e) =>
                    setSummaryDraft({
                      ...summaryDraft,
                      refereeNote: e.target.value,
                    })
                  }
                  placeholder="裁判备注(如:主裁判极严，全场3张红牌)"
                />
                <input
                  className="sef-input"
                  value={summaryDraft.venueNote}
                  onChange={(e) =>
                    setSummaryDraft({
                      ...summaryDraft,
                      venueNote: e.target.value,
                    })
                  }
                  placeholder="场地备注(如:阿兹特克体育场，海拔2240米)"
                />
                <input
                  className="sef-input"
                  value={summaryDraft.generalNote}
                  onChange={(e) =>
                    setSummaryDraft({
                      ...summaryDraft,
                      generalNote: e.target.value,
                    })
                  }
                  placeholder="综合备注(如:揭幕战传统，东道主首秀不败)"
                />

                <div className="sef-actions">
                  <button
                    className="btn btn-primary sef-save-btn"
                    onClick={saveSummary}
                  >
                    ✅ 确认
                  </button>
                  <button
                    className="btn btn-secondary sef-cancel-btn"
                    onClick={cancelEditSummary}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="param-divider" />

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
              影响 ELO 积分变化幅度，越大波动越剧烈（仅影响基础ELO计算）
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
            <div className="param-hint">主队额外积分加成，0 = 无主场优势</div>
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

          <div className="param-group">
            <label className="param-label">
              🏥 {tTeam(selectedMatch?.homeTeam || '')} 伤停影响{' '}
              <span className="param-value">{homeInjuryImpact}</span>
            </label>
            <input
              type="range"
              min="1"
              max="10"
              step="1"
              value={homeInjuryImpact}
              onChange={(e) => setHomeInjuryImpact(Number(e.target.value))}
            />
            <label className="param-label">
              🏥 {tTeam(selectedMatch?.awayTeam || '')} 伤停影响{' '}
              <span className="param-value">{awayInjuryImpact}</span>
            </label>
            <input
              type="range"
              min="1"
              max="10"
              step="1"
              value={awayInjuryImpact}
              onChange={(e) => setAwayInjuryImpact(Number(e.target.value))}
            />
            <div className="param-hint">
              主力伤停缺阵直接削弱球队实力，值越高表示伤停越严重
            </div>
          </div>

          <div className="param-group">
            <label className="param-label">
              🏆 {tTeam(selectedMatch?.homeTeam || '')} 比赛重要性{' '}
              <span className="param-value">{homeStakes}</span>
            </label>
            <input
              type="range"
              min="1"
              max="10"
              step="1"
              value={homeStakes}
              onChange={(e) => setHomeStakes(Number(e.target.value))}
            />
            <label className="param-label">
              🏆 {tTeam(selectedMatch?.awayTeam || '')} 比赛重要性{' '}
              <span className="param-value">{awayStakes}</span>
            </label>
            <input
              type="range"
              min="1"
              max="10"
              step="1"
              value={awayStakes}
              onChange={(e) => setAwayStakes(Number(e.target.value))}
            />
            <div className="param-hint">
              淘汰赛、出线生死战等关键比赛对球队动力和表现影响显著
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

          <div className="predict-actions">
            <button
              className="btn btn-primary predict-btn"
              onClick={handlePredict}
              disabled={
                predicting ||
                !selectedMatch ||
                gatheringIntelligence ||
                quantifying
              }
            >
              {predicting ? '预测中...' : '🔮 开始预测'}
            </button>
            <button
              className="btn btn-secondary save-params-btn"
              onClick={handleSaveParams}
              disabled={
                saving || !selectedMatch || gatheringIntelligence || quantifying
              }
            >
              {saving ? '保存中...' : '💾 保存参数'}
            </button>
            {saveMsg && <span className="save-msg">{saveMsg}</span>}
          </div>
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
                集成 {Math.round(prediction.homeRating)}
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
                集成 {Math.round(prediction.awayRating)}
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
              <span className="effect-label">🏥 伤停影响</span>
              <span
                className={`effect-value ${prediction.injuryEffect > 0 ? 'positive' : prediction.injuryEffect < 0 ? 'negative' : ''}`}
              >
                {prediction.injuryEffect > 0 ? '+' : ''}
                {prediction.injuryEffect}
              </span>
              <span className="effect-desc">
                {prediction.injuryEffect === 0
                  ? '无差异'
                  : prediction.injuryEffect > 0
                    ? '客队伤停更严重'
                    : '主队伤停更严重'}
              </span>
            </div>
            <div className="effect-card">
              <span className="effect-label">🏆 比赛重要性</span>
              <span
                className={`effect-value ${prediction.stakesEffect > 0 ? 'positive' : prediction.stakesEffect < 0 ? 'negative' : ''}`}
              >
                {prediction.stakesEffect > 0 ? '+' : ''}
                {prediction.stakesEffect}
              </span>
              <span className="effect-desc">
                {prediction.stakesEffect === 0
                  ? '无差异'
                  : prediction.stakesEffect > 0
                    ? '主队更重视'
                    : '客队更重视'}
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
    </div>
  );
}
