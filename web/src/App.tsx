import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import RecentMatches from './pages/RecentMatches';
import PredictAdvanced from './pages/PredictAdvanced';
import Rankings from './pages/Rankings';
import TeamDetail from './pages/TeamDetail';
import Players from './pages/Players';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<RecentMatches />} />
          <Route path="/predict" element={<PredictAdvanced />} />
          <Route path="/rankings" element={<Rankings />} />
          <Route path="/players" element={<Players />} />
          <Route path="/team/:name" element={<TeamDetail />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
