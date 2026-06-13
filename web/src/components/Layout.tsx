import { NavLink, Outlet } from 'react-router-dom';
import './Layout.css';

export default function Layout() {
  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="header-inner">
          <NavLink to="/" className="logo">
            <span className="logo-icon">⚽</span>
            <span className="logo-text">FootballPredict</span>
          </NavLink>
          <nav className="nav-links">
            <NavLink to="/" end>
              近期比赛
            </NavLink>
            <NavLink to="/predict">调参预测</NavLink>
            <NavLink to="/rankings">历史数据</NavLink>
            <NavLink to="/players" className="nav-disabled">
              球员信息
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
      <footer className="app-footer">
        <p>FootballPredict — 基于 ELO 评分的足球比赛预测系统</p>
      </footer>
    </div>
  );
}
