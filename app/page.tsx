"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type Player = { id: string; player_number: number; display_name: string; points: number; created_at: string };
type Question = { id: string; question_text: string; options: string[]; is_published: boolean };
type ScheduleItem = { id: string; title: string; description: string | null; starts_at: string | null; sort_order: number; is_visible: boolean };
type PlayerSession = { player_id: string; player_number: number; display_name: string; points: number; session_token: string };
type AdminQuestion = Question & { correct_option_index: number };

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
let supabase: SupabaseClient | null = null;
if (supabaseUrl && supabaseKey) supabase = createClient(supabaseUrl, supabaseKey);

export default function Home() {
  const [view, setView] = useState<"home" | "player" | "admin">("home");
  const [name, setName] = useState("");
  const [player, setPlayer] = useState<PlayerSession | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [adminPin, setAdminPin] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [adminReady, setAdminReady] = useState(false);
  const [adminQuestions, setAdminQuestions] = useState<AdminQuestion[]>([]);
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [scheduleDescription, setScheduleDescription] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [newQuestion, setNewQuestion] = useState("");
  const [newOptions, setNewOptions] = useState(["", "", "", ""]);
  const [correctIndex, setCorrectIndex] = useState(0);

  const currentPlayer = useMemo(() => player ? players.find((item) => item.id === player.player_id) : null, [player, players]);
  const sortedPlayers = useMemo(() => [...players].sort((a, b) => b.points - a.points || a.player_number - b.player_number), [players]);

  useEffect(() => {
    const saved = sessionStorage.getItem("party_player");
    if (saved) { try { setPlayer(JSON.parse(saved) as PlayerSession); setView("player"); } catch { sessionStorage.removeItem("party_player"); } }
    const admin = sessionStorage.getItem("party_admin");
    if (admin) { setAdminToken(admin); setAdminReady(true); }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const load = async () => {
      const [p, q, s] = await Promise.all([
        supabase!.from("party_players").select("id,player_number,display_name,points,created_at").order("points", { ascending: false }).order("player_number", { ascending: true }).limit(500),
        supabase!.from("party_questions").select("id,question_text,options,is_published").eq("is_published", true).order("created_at", { ascending: true }),
        supabase!.from("party_schedule").select("id,title,description,starts_at,sort_order,is_visible").eq("is_visible", true).order("sort_order", { ascending: true })
      ]);
      if (p.data) setPlayers(p.data as Player[]);
      if (q.data) setQuestions(q.data as Question[]);
      if (s.data) setSchedule(s.data as ScheduleItem[]);
    };
    void load();
    const channel = supabase.channel("party-live-board").on("postgres_changes", { event: "*", schema: "public", table: "party_players" }, () => { void load(); }).on("postgres_changes", { event: "*", schema: "public", table: "party_questions" }, () => { void load(); }).on("postgres_changes", { event: "*", schema: "public", table: "party_schedule" }, () => { void load(); }).subscribe();
    return () => { void supabase?.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (!supabase || !player) return;
    const loadAnswers = async () => {
      const { data } = await supabase!.rpc("party_get_player_answers", { p_player_id: player.player_id, p_session_token: player.session_token });
      if (data) setAnswers(data as Record<string, number>);
    };
    void loadAnswers();
  }, [player?.player_id]);

  useEffect(() => {
    if (!supabase || !adminReady || !adminToken) return;
    const loadAdminQuestions = async () => {
      const { data, error } = await supabase!.rpc("party_admin_list_questions", { p_token: adminToken });
      if (!error && data) setAdminQuestions(data as AdminQuestion[]);
    };
    void loadAdminQuestions();
  }, [adminReady, adminToken]);

  async function register() {
    if (!supabase) { setNotice("Database connection is not configured yet."); return; }
    if (!name.trim()) { setNotice("Enter a player name first."); return; }
    setBusy(true); setNotice("");
    const { data, error } = await supabase.rpc("party_register_player", { p_display_name: name.trim() });
    setBusy(false);
    if (error) { setNotice(error.message); return; }
    const next = data as PlayerSession;
    setPlayer(next); sessionStorage.setItem("party_player", JSON.stringify(next)); setView("player");
  }

  async function submitAnswer(question: Question, optionIndex: number) {
    if (!supabase || !player || answers[question.id] !== undefined) return;
    setBusy(true); setNotice("");
    const { data, error } = await supabase.rpc("party_submit_answer", { p_player_id: player.player_id, p_session_token: player.session_token, p_question_id: question.id, p_selected_option_index: optionIndex });
    setBusy(false);
    if (error) { setNotice(error.message); return; }
    setAnswers((prev) => ({ ...prev, [question.id]: optionIndex }));
    const result = data as { correct: boolean; points: number };
    setNotice(result.correct ? "Correct answer! +10 points." : "Answer submitted. Keep going!");
    setPlayer((prev) => prev ? { ...prev, points: result.points } : prev);
  }

  async function adminLogin() {
    if (!supabase || !adminPin.trim()) return;
    setBusy(true); setNotice("");
    const { data, error } = await supabase.rpc("party_admin_login", { p_pin: adminPin });
    setBusy(false);
    if (error) { setNotice(error.message); return; }
    const token = (data as { session_token: string }).session_token;
    setAdminToken(token); setAdminReady(true); sessionStorage.setItem("party_admin", token); setNotice("Admin access granted.");
  }

  async function setupAdmin() {
    if (!supabase || adminPin.length < 8) { setNotice("Choose a PIN with at least 8 characters."); return; }
    setBusy(true); setNotice("");
    const { error } = await supabase.rpc("party_admin_setup", { p_setup_token: setupToken.replace(/\\s+/g, "").toLowerCase(), p_pin: adminPin.trim() });
    setBusy(false);
    if (error) { setNotice(error.message); return; }
    await adminLogin();
  }

  async function publishQuestion() {
    if (!supabase || !adminToken) return;
    const options = newOptions.map((value) => value.trim()).filter(Boolean);
    if (!newQuestion.trim() || options.length < 2 || correctIndex >= options.length) { setNotice("Add a question and at least two options, then select the correct answer."); return; }
    setBusy(true);
    const { error } = await supabase.rpc("party_admin_create_question", { p_token: adminToken, p_question: newQuestion.trim(), p_options: options, p_correct_index: correctIndex });
    setBusy(false);
    if (error) { setNotice(error.message); return; }
    setNewQuestion(""); setNewOptions(["", "", "", ""]); setCorrectIndex(0);
    const refreshed = await supabase.rpc("party_admin_list_questions", { p_token: adminToken });
    if (refreshed.data) setAdminQuestions(refreshed.data as AdminQuestion[]);
    setNotice("Question published to all players.");
  }

  async function toggleQuestion(question: AdminQuestion) {
    if (!supabase || !adminToken) return;
    const { error } = await supabase.rpc("party_admin_set_question_published", { p_token: adminToken, p_question_id: question.id, p_published: !question.is_published });
    if (!error) {
      const refreshed = await supabase.rpc("party_admin_list_questions", { p_token: adminToken });
      if (refreshed.data) setAdminQuestions(refreshed.data as AdminQuestion[]);
    }
    setNotice(error ? error.message : "Question updated.");
  }

  async function deleteQuestion(question: AdminQuestion) {
    if (!supabase || !adminToken || !window.confirm("Delete this question and its answer records?")) return;
    const { error } = await supabase.rpc("party_admin_delete_question", { p_token: adminToken, p_question_id: question.id });
    if (!error) {
      const refreshed = await supabase.rpc("party_admin_list_questions", { p_token: adminToken });
      if (refreshed.data) setAdminQuestions(refreshed.data as AdminQuestion[]);
    }
    setNotice(error ? error.message : "Question deleted.");
  }

  async function addScheduleItem() {
    if (!supabase || !adminToken || !scheduleTitle.trim()) return;
    setBusy(true);
    const { error } = await supabase.rpc("party_admin_add_schedule", {
      p_token: adminToken,
      p_title: scheduleTitle.trim(),
      p_description: scheduleDescription.trim(),
      p_starts_at: scheduleTime ? new Date(scheduleTime).toISOString() : null,
      p_sort_order: schedule.length + 1
    });
    setBusy(false);
    if (error) { setNotice(error.message); return; }
    setScheduleTitle("");
    setScheduleDescription("");
    setScheduleTime("");
    setNotice("Schedule item added.");
  }

  async function deleteScheduleItem(item: ScheduleItem) {
    if (!supabase || !adminToken || !window.confirm("Delete this schedule item?")) return;
    const { error } = await supabase.rpc("party_admin_delete_schedule", { p_token: adminToken, p_schedule_id: item.id });
    setNotice(error ? error.message : "Schedule item deleted.");
  }

  function logoutPlayer() { sessionStorage.removeItem("party_player"); setPlayer(null); setView("home"); }
  async function logoutAdmin() { if (supabase && adminToken) await supabase.rpc("party_admin_logout", { p_token: adminToken }); sessionStorage.removeItem("party_admin"); setAdminToken(""); setAdminReady(false); setAdminQuestions([]); setAdminPin(""); setView("home"); }

  if (!supabase) return <main className="boot"><div className="window boot-window"><div className="titlebar">PARTY.exe - SYSTEM ERROR</div><div className="window-body"><div className="pixel-logo">P!</div><h1>DATABASE NOT CONNECTED</h1><p>Add the Supabase environment variables in Vercel to start the party.</p><code>NEXT_PUBLIC_SUPABASE_URL</code><code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code></div></div></main>;

  return <main className="desktop">
    <div className="desktop-icons"><button onClick={() => setView("home")}><span>🖥️</span>My Party</button><button onClick={() => setView("player")}><span>🎮</span>Player Zone</button><button onClick={() => setView("admin")}><span>🗂️</span>Admin Panel</button><button onClick={() => setView("home")}><span>📊</span>Scoreboard</button></div>
    <header className="topline"><div className="brand"><span className="brand-mark">P!</span><div><b>PARTY.EXE</b><small>TEAM CELEBRATION SYSTEM</small></div></div><div className="system-status"><i/> SYSTEM ONLINE <span>•</span> LIVE SCOREBOARD</div></header>
    <section className="main-window window">
      <div className="titlebar"><span>{view === "home" ? "Welcome to Party.exe" : view === "player" ? "Player Control Panel" : "Administrator Console"}</span><div className="window-controls"><b>_</b><b>□</b><b>×</b></div></div>
      {view === "home" && <div className="window-body home-grid"><section className="hero"><div className="eyebrow">★ THE PARTY IS LOADING ★</div><div className="hero-title">LET'S<br/><em>PLAY!</em></div><p>Join the party, answer the questions, collect points and climb the leaderboard.</p><div className="hero-actions"><button className="btn primary" onClick={() => setView("player")}>ENTER PLAYER ZONE ▶</button><button className="btn" onClick={() => setView("admin")}>ADMIN LOGIN</button></div><div className="pixel-rule"/><div className="hero-foot">NO ACCOUNT NEEDED · PICK A NAME · GET YOUR NUMBER</div></section><section className="side-stack"><div className="panel"><div className="panel-head">LIVE STATUS <span className="live-dot">● LIVE</span></div><div className="stat"><strong>{players.length}</strong><span>PLAYERS JOINED</span></div><div className="stat"><strong>{questions.length}</strong><span>ACTIVE QUESTIONS</span></div></div><div className="panel"><div className="panel-head">HOW TO PLAY</div><ol className="steps"><li>Choose your player name.</li><li>Get your unique player number.</li><li>Answer each question once.</li><li>Earn 10 points for every correct answer.</li></ol></div></section></div>}
      {view === "player" && <div className="window-body"><div className="section-heading"><div><div className="eyebrow">PLAYER TERMINAL</div><h1>{player ? "WELCOME BACK, " + player.display_name.toUpperCase() : "JOIN THE GAME"}</h1></div>{player && <button className="btn small" onClick={logoutPlayer}>LOG OUT</button>}</div>{!player ? <div className="join-card"><label htmlFor="player-name">CHOOSE YOUR PLAYER NAME</label><input id="player-name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void register()} placeholder="Type your name here..."/><button className="btn primary" disabled={busy} onClick={() => void register()}>{busy ? "PLEASE WAIT..." : "CREATE PLAYER ▶"}</button><p className="muted">Duplicate names are allowed. Every new entry gets a separate player number.</p></div> : <><div className="player-stats"><div className="stat-card"><small>PLAYER NUMBER</small><strong>#{player.player_number}</strong></div><div className="stat-card"><small>YOUR POINTS</small><strong>{currentPlayer?.points ?? player.points}</strong></div><div className="stat-card"><small>YOUR RANK</small><strong>{sortedPlayers.findIndex((p) => p.id === player.player_id) + 1 || "—"}</strong></div></div><div className="content-grid"><section className="panel"><div className="panel-head">QUESTIONS <span>{questions.length} AVAILABLE</span></div>{questions.length === 0 && <p className="muted">No questions have been published yet. Stay tuned.</p>}{questions.map((question, index) => <article className="question" key={question.id}><div className="question-number">QUESTION {String(index + 1).padStart(2, "0")}</div><h3>{question.question_text}</h3><div className="option-list">{question.options.map((option, optionIndex) => <button key={optionIndex} disabled={answers[question.id] !== undefined || busy} className={"option " + (answers[question.id] === optionIndex ? "selected" : "")} onClick={() => void submitAnswer(question, optionIndex)}><span>{String.fromCharCode(65 + optionIndex)}</span>{option}</button>)}</div>{answers[question.id] !== undefined && <small className="answered">✓ ANSWER RECORDED</small>}</article>)}</section><section className="panel schedule-panel"><div className="panel-head">EVENT SCHEDULE <span>{schedule.length} ACTIVITIES</span></div><div className="schedule-list">{schedule.map((item, index) => <article className="schedule-card" key={item.id}><div className="schedule-number">{String(index + 1).padStart(2, "0")}</div><div className="schedule-copy"><div className="schedule-time">{item.description?.includes("|") ? item.description.split("|")[0].trim() : "PARTY ACTIVITY"}</div><h3>{item.title}</h3><p>{item.description?.includes("|") ? item.description.split("|").slice(1).join("|").trim() : item.description}</p></div></article>)}</div></section></div></>}</div>}
      {view === "admin" && <div className="window-body"><div className="section-heading"><div><div className="eyebrow">RESTRICTED AREA</div><h1>ADMIN CONSOLE</h1></div>{adminReady && <button className="btn small" onClick={logoutAdmin}>LOG OUT</button>}</div>{!adminReady ? <div className="join-card"><label htmlFor="admin-pin">ADMIN PIN</label><input id="admin-pin" type="password" value={adminPin} onChange={(e) => setAdminPin(e.target.value)} placeholder="Enter admin PIN"/><label htmlFor="setup-token">ONE-TIME SETUP CODE (FIRST SETUP ONLY)</label><input id="setup-token" type="password" value={setupToken} onChange={(e) => setSetupToken(e.target.value)} placeholder="Paste your setup code"/><div className="hero-actions"><button className="btn primary" disabled={busy} onClick={() => void adminLogin()}>UNLOCK CONSOLE</button><button className="btn" disabled={busy} onClick={() => void setupAdmin()}>FIRST-TIME SETUP</button></div><p className="muted">For first-time setup, enter the one-time setup code and choose a private PIN of at least 8 characters. The setup code expires after one successful setup.</p></div> : <div className="content-grid"><section className="panel"><div className="panel-head">PUBLISH A QUESTION</div><label>QUESTION TEXT</label><textarea value={newQuestion} onChange={(e) => setNewQuestion(e.target.value)} placeholder="Write your question..."/>{newOptions.map((option, index) => <div className="option-editor" key={index}><input value={option} onChange={(e) => setNewOptions((prev) => prev.map((item, i) => i === index ? e.target.value : item))} placeholder={"Option " + String.fromCharCode(65 + index)}/><label className="radio-label"><input type="radio" name="correct" checked={correctIndex === index} onChange={() => setCorrectIndex(index)}/> CORRECT</label></div>)}<button className="btn primary" disabled={busy} onClick={() => void publishQuestion()}>PUBLISH QUESTION</button></section><section className="panel"><div className="panel-head">QUESTION CONTROL</div>{adminQuestions.map((question) => <div className="admin-question" key={question.id}><div><b>{question.question_text}</b><small className="admin-status">{question.is_published ? "PUBLISHED" : "HIDDEN"} · CORRECT: {String.fromCharCode(65 + question.correct_option_index)}</small></div><div className="admin-actions"><button className="btn small" onClick={() => void toggleQuestion(question)}>{question.is_published ? "HIDE" : "PUBLISH"}</button><button className="btn small danger" onClick={() => void deleteQuestion(question)}>DELETE</button></div></div>)}</section><section className="panel"><div className="panel-head">MANAGE EVENT SCHEDULE</div><label>ACTIVITY TITLE</label><input value={scheduleTitle} onChange={(e) => setScheduleTitle(e.target.value)} placeholder="New activity title"/><label>DESCRIPTION</label><textarea value={scheduleDescription} onChange={(e) => setScheduleDescription(e.target.value)} placeholder="Short details..."/><label>TIME (OPTIONAL)</label><input type="datetime-local" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)}/><button className="btn primary" disabled={busy} onClick={() => void addScheduleItem()}>ADD TO SCHEDULE</button>{schedule.map((item) => <div className="admin-question" key={item.id}><b>{item.title}</b><button className="btn small danger" onClick={() => void deleteScheduleItem(item)}>DELETE</button></div>)}</section><section className="panel"><div className="panel-head">PLAYER RESULTS · {players.length} PLAYERS</div>{sortedPlayers.map((item, index) => <div className="admin-question" key={item.id}><span>#{item.player_number} {item.display_name}</span><b>{item.points} PTS · #{index + 1}</b></div>)}</section></div>}</div>}
      {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")}>×</button></div>}
    </section>
    <section className="leaderboard window"><div className="titlebar"><span>🏆 TOP PLAYERS.SYS</span><span className="live-dot">● LIVE UPDATE</span></div><div className="leader-list">{sortedPlayers.slice(0, 10).map((item, index) => <div className="leader-row" key={item.id}><span className="rank">{String(index + 1).padStart(2, "0")}</span><span className="leader-name">#{item.player_number} {item.display_name}</span><strong>{item.points} PTS</strong></div>)}{sortedPlayers.length === 0 && <p className="muted">Waiting for the first player...</p>}</div></section>
    <footer className="taskbar"><button onClick={() => setView("home")} className="start-button">▣ START</button><span>PARTY.EXE</span><span className="clock">SYSTEM READY · {new Date().toLocaleDateString("en-GB")}</span></footer>
  </main>;
}
