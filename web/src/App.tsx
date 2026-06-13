import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Rankings from './pages/Rankings';
import TeamDetail from './pages/TeamDetail';
import Predict from './pages/Predict';
import WorldCup from './pages/WorldCup';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/rankings" element={<Rankings />} />
          <Route path="/team/:name" element={<TeamDetail />} />
          <Route path="/predict" element={<Predict />} />
          <Route path="/worldcup" element={<WorldCup />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
