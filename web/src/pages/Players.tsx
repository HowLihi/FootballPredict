import './Players.css';

export default function Players() {
  return (
    <div className="players-page">
      <h1>👤 球员信息</h1>
      <p className="page-desc">球员数据模块正在开发中，敬请期待...</p>
      <div className="coming-soon">
        <div className="cs-icon">🚧</div>
        <h2>功能建设中</h2>
        <p>球员信息模块将提供：</p>
        <ul>
          <li>球员个人资料与生涯数据</li>
          <li>球员 ELO 评分排名</li>
          <li>球员伤病状态追踪</li>
          <li>球员对比赛结果的影响力分析</li>
        </ul>
      </div>
    </div>
  );
}
