// App.jsx
import React, { useState, useEffect, useRef } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';

export default function ChessTutorApp() {
  const gameRef = useRef(new Chess());
  const [fen, setFen] = useState(gameRef.current.fen());
  const [moveHistory, setMoveHistory] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [timer, setTimer] = useState(0);
  const timerRef = useRef(null);
  const [engineStatus, setEngineStatus] = useState('stopped');
  const engineRef = useRef(null);
  const [engineEval, setEngineEval] = useState(null);
  const [enginePV, setEnginePV] = useState(null);
  const [engineTimeMs, setEngineTimeMs] = useState(120);
  const [allowAnyMove, setAllowAnyMove] = useState(false);
  const [boardWidth, setBoardWidth] = useState(Math.min(420, Math.floor(window.innerWidth * 0.92)));

  const lessons = [
    { id: 1, title: "Scholar's Mate", fen: 'start', solution: ['e4','e5','Bc4','Nc6','Qh5','Nf6','Qxf7#'], hint: 'Coordinate queen & bishop toward f7.' },
    { id: 2, title: 'Opening Principles', fen: 'start', solution: null, hint: 'Develop knights/bishops, control center, castle early.' },
    { id: 3, title: 'Tactical Fork', fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/3P4/2N5/PPP1PPPP/R1BQKBNR w KQkq - 2 3', solution: ['d5','exd4','Nb5'], hint: 'Find the knight jump that attacks two pieces.' }
  ];

  useEffect(() => {
    function handleResize() {
      setBoardWidth(Math.min(420, Math.floor(window.innerWidth * 0.92)));
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => { loadLesson(0); return () => stopTimer(); }, []);

  useEffect(() => {
    try {
      const w = new Worker('/stockfish.js');
      engineRef.current = w;
      w.onmessage = (e) => handleEngineMessage(e.data);
      w.postMessage('uci');
      setEngineStatus('ready');
    } catch (err) {
      engineRef.current = null;
      setEngineStatus('missing');
      setFeedback('Engine not loaded. Please place stockfish.js in public/.');
    }
    return () => { if (engineRef.current) { engineRef.current.terminate(); engineRef.current = null; } };
  }, []);

  function handleEngineMessage(msg) {
    if (typeof msg !== 'string') msg = String(msg);
    if (msg.startsWith('bestmove')) {
      setEngineStatus('idle');
      setFeedback(f => f + '\nEngine bestmove: ' + msg.split(' ')[1]);
      return;
    }
    if (msg.includes('score') && msg.includes('pv')) {
      const scoreMatch = msg.match(/score (cp|mate) (-?\d+)/);
      const pvMatch = msg.match(/pv (.+)$/);
      if (scoreMatch) {
        const type = scoreMatch[1];
        const val = parseInt(scoreMatch[2], 10);
        const cp = type === 'cp' ? val : (val > 0 ? 99999 : -99999);
        setEngineEval(cp);
      }
      if (pvMatch) setEnginePV(pvMatch[1]);
    }
  }

  function askEngine(fenToAnalyze = null, ms = engineTimeMs) {
    const w = engineRef.current;
    if (!w) { setFeedback('Engine not available.'); return; }
    setEngineEval(null); setEnginePV(null); setEngineStatus('thinking');
    const pos = fenToAnalyze || gameRef.current.fen();
    w.postMessage('position fen ' + pos);
    w.postMessage('go movetime ' + ms);
  }

  function startTimer() { stopTimer(); setTimer(0); timerRef.current = setInterval(() => setTimer(t => t + 1), 1000); }
  function stopTimer() { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } }

  function loadLesson(idx) {
    const lesson = lessons[idx];
    const chess = new Chess();
    if (lesson.fen && lesson.fen !== 'start') chess.load(lesson.fen);
    gameRef.current = chess;
    setFen(chess.fen());
    setMoveHistory([]);
    setFeedback(lesson.hint ? 'Hint: ' + lesson.hint : '');
    setAllowAnyMove(!lesson.solution);
    startTimer();
  }

  function onDrop(src, dst) {
    const chess = gameRef.current;
    const lesson = lessons.find(l => l.id === lessons[0].id);
    const moveObj = { from: src, to: dst, promotion: 'q' };

    const tmp = new Chess(chess.fen());
    const tryMove = tmp.move(moveObj);
    if (!tryMove) { setFeedback('Illegal move.'); return false; }

    if (lesson.solution && !allowAnyMove) {
      const userHistory = gameRef.current.history();
      const expected = lesson.solution[userHistory.length];
      const tmp2 = new Chess(chess.fen());
      let expectedUCI = null;
      try { const m = tmp2.move(expected); if (m) expectedUCI = m.from + m.to; } catch(e) { expectedUCI = null; }
      const userUCI = tryMove.from + tryMove.to;
      if (expectedUCI && expectedUCI !== userUCI) { setFeedback('هذه ليست الحركة المتوقعة فهاد الدرس. جرّب الحركة المخططة أو فعّل التدريب الحر.'); return false; }
      if (!expectedUCI) { if (tryMove.san !== expected) { setFeedback('الحركة لا تطابق حل الدرس.'); return false; } }
    }

    const real = chess.move(moveObj);
    if (!real) { setFeedback('Illegal move.'); return false; }
    setMoveHistory(m => [...m, real.san]);
    setFen(chess.fen());
    setFeedback('');
    askEngine(chess.fen(), Math.max(50, Math.min(300, engineTimeMs)));
    if (lessons[0].solution) {
      const hist = gameRef.current.history();
      if (hist.length === lessons[0].solution.length) {
        setFeedback('تم إكمال الدرس! أحسنت.');
        stopTimer();
      }
    }
    return true;
  }

  function cpToLabel(cp) {
    if (cp === null || cp === undefined) return '—';
    const a = Math.abs(cp);
    if (a < 50) return 'Good move';
    if (a < 150) return 'Inaccuracy';
    if (a < 300) return 'Mistake';
    return 'Blunder';
  }

  function undoMove() {
    const c = gameRef.current;
    c.undo();
    setFen(c.fen());
    setMoveHistory(m => { const copy = [...m]; copy.pop(); return copy; });
    setFeedback('Undid last move.');
  }

  function exportPGN() {
    const pgn = gameRef.current.pgn();
    navigator.clipboard.writeText(pgn).then(() => setFeedback('PGN copied.'));
  }

  function importPGN() {
    const p = prompt('Paste PGN:');
    if (!p) return;
    const c = new Chess();
    const ok = c.load_pgn(p);
    if (!ok) { alert('Invalid PGN'); return; }
    gameRef.current = c;
    setFen(c.fen());
    setMoveHistory(c.history());
    setFeedback('PGN loaded.');
  }

  function exportFEN() {
    const f = gameRef.current.fen();
    navigator.clipboard.writeText(f).then(() => setFeedback('FEN copied.'));
  }

  function importFEN() {
    const f = prompt('Enter FEN (or start):', gameRef.current.fen());
    if (!f) return;
    const c = new Chess();
    if (f.trim() === 'start') {
      gameRef.current = new Chess();
    } else {
      const ok = c.load(f);
      if (!ok) { alert('Invalid FEN'); return; }
      gameRef.current = c;
    }
    setFen(gameRef.current.fen());
    setMoveHistory([]);
    setFeedback('FEN loaded.');
  }

  return (
    <div style={{ padding: 12, fontFamily: 'Inter, system-ui, sans-serif', background: '#f7fbff', minHeight: '100vh' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h1 style={{ fontSize: 18, margin: 0 }}>Chess Tutor — Mobile</h1>
          <div style={{ fontSize: 12, color: '#555' }}>{timer}s</div>
        </header>

        <main style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <section style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: boardWidth }}>
              <Chessboard id="mobileBoard" position={fen} onPieceDrop={(s, d) => onDrop(s, d)} boardWidth={boardWidth} />
            </div>
          </section>

          <section style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button onClick={undoMove} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #ddd' }}>Undo</button>
            <button onClick={() => askEngine(null, 300)} style={{ padding: '10px 14px', borderRadius: 8, background: '#0b69ff', color: 'white' }}>Deep Analyze</button>
            <button onClick={() => setAllowAnyMove(v => !v)} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #ddd' }}>
              {allowAnyMove ? 'Disable Free' : 'Enable Free'}
            </button>
            <button onClick={exportPGN} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #ddd' }}>Export PGN</button>
            <button onClick={importPGN} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #ddd' }}>Import PGN</button>
          </section>

          <section style={{ background: 'white', padding: 10, borderRadius: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{lessons[0].title}</div>
            <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>{lessons[0].hint}</div>
            <div style={{ marginTop: 10, fontSize: 12 }}>
              <div><strong>Engine:</strong> {engineStatus} {engineEval !== null ? ` — ${engineEval / 100} (cp)` : ''}</div>
              <div style={{ marginTop: 6 }}><strong>Verdict:</strong> {engineEval === null ? '—' : cpToLabel(engineEval)}</div>
              <div style={{ marginTop: 6 }}><strong>PV:</strong> <div style={{ color: '#444', fontSize: 11 }}>{enginePV || '—'}</div></div>
              <div style={{ marginTop: 8, color: '#0b69ff', whiteSpace: 'pre-wrap' }}>{feedback}</div>
            </div>
          </section>

          <section style={{ background: 'white', padding: 10, borderRadius: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Moves</div>
            <div style={{ marginTop: 8, maxHeight: 160, overflow: 'auto', fontSize: 13 }}>
              {moveHistory.length === 0 ? (
                <div style={{ color: '#999' }}>No moves yet.</div>
              ) : (
                <ol style={{ paddingLeft: 18 }}>
                  {moveHistory.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
        }
