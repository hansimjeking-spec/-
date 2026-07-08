const SUPABASE_CONFIG_KEY = "welfareResourceRadar.supabase.v1";
const STATE_KEY = "welfareResourceRadar.v1";
const BENEFICIARY_KEY = "welfareResourceRadar.beneficiaries.v1";
const OPS_LOG_KEY = "welfareResourceRadar.opsLog.v1";
const WORKFLOW_KEY = "welfareResourceRadar.workflow.v1";
const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

let clientPromise = null;
let cachedClient = null;

function injectCss() {
  if (document.querySelector('link[href="./radar-supabase.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./radar-supabase.css";
  document.head.appendChild(link);
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function config() {
  return {
    url: "",
    anonKey: "",
    email: "",
    lastSyncAt: "",
    ...readJson(SUPABASE_CONFIG_KEY, {})
  };
}

function saveConfig(next) {
  writeJson(SUPABASE_CONFIG_KEY, { ...config(), ...next });
  cachedClient = null;
  clientPromise = null;
}

function addLog(type, message) {
  const logs = readJson(OPS_LOG_KEY, []);
  writeJson(OPS_LOG_KEY, [{ type, message, at: new Date().toISOString() }, ...logs].slice(0, 50));
}

function state() {
  const raw = readJson(STATE_KEY, {});
  return {
    resources: Array.isArray(raw.resources) ? raw.resources : [],
    trash: Array.isArray(raw.trash) ? raw.trash : [],
    blockedKeys: Array.isArray(raw.blockedKeys) ? raw.blockedKeys : []
  };
}

function beneficiaries() {
  return readJson(BENEFICIARY_KEY, []);
}

function workflow() {
  return readJson(WORKFLOW_KEY, {});
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function getClient() {
  const current = config();
  if (!current.url || !current.anonKey) throw new Error("Supabase URL과 anon key를 먼저 저장하세요.");
  if (cachedClient) return cachedClient;
  if (!clientPromise) {
    clientPromise = import(SUPABASE_CDN).then(({ createClient }) => {
      cachedClient = createClient(current.url, current.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
      return cachedClient;
    });
  }
  return clientPromise;
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || "").split(/[,;·/\n]/).map((item) => item.trim()).filter(Boolean);
}

function resourceRow(resource) {
  return {
    id: String(resource.id || crypto.randomUUID()),
    title: resource.title || "제목 미정",
    agency: resource.agency || null,
    category: resource.category || null,
    region: resource.region || null,
    targets: splitList(resource.targets),
    deadline: resource.deadline || null,
    urgency: resource.urgency || "보통",
    status: resource.status || "검토 필요",
    summary: resource.summary || null,
    apply_method: resource.applyMethod || null,
    contact: resource.contact || null,
    source_url: resource.sourceUrl || null,
    tags: splitList(resource.tags),
    raw: resource,
    updated_at: new Date().toISOString()
  };
}

function beneficiaryRow(person) {
  return {
    id: String(person.id || crypto.randomUUID()),
    display_name: person.name || person.display_name || "대상자",
    age: person.age || null,
    household: person.household || null,
    needs: person.needs || null,
    region: person.region || null,
    memo: person.memo || null,
    raw: person,
    updated_at: new Date().toISOString()
  };
}

function workflowRows() {
  const data = workflow();
  return Object.entries(data).map(([resourceId, value]) => ({
    resource_id: resourceId,
    checklist: value?.checklist || value || {},
    memo: value?.memo || "",
    updated_at: new Date().toISOString()
  }));
}

function localStats() {
  const s = state();
  return {
    resources: s.resources.length,
    beneficiaries: beneficiaries().length,
    workflow: Object.keys(workflow()).length,
    logs: readJson(OPS_LOG_KEY, []).length
  };
}

async function signIn(email) {
  const client = await getClient();
  const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
  if (error) throw error;
  saveConfig({ email });
  addLog("db", `${email}로 로그인 메일을 요청했습니다.`);
}

async function signOut() {
  const client = await getClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
  addLog("db", "Supabase 로그아웃했습니다.");
}

async function getSessionLabel() {
  try {
    const client = await getClient();
    const { data } = await client.auth.getSession();
    return data.session?.user?.email || "로그인 전";
  } catch {
    return "연결 전";
  }
}

async function pushToDb() {
  const client = await getClient();
  const s = state();
  const resourceRows = s.resources.map(resourceRow);
  const beneficiaryRows = beneficiaries().map(beneficiaryRow);
  const wfRows = workflowRows();

  if (resourceRows.length) {
    const { error } = await client.from("radar_resources").upsert(resourceRows, { onConflict: "id" });
    if (error) throw error;
  }
  if (beneficiaryRows.length) {
    const { error } = await client.from("radar_beneficiaries").upsert(beneficiaryRows, { onConflict: "id" });
    if (error) throw error;
  }
  if (wfRows.length) {
    const { error } = await client.from("radar_workflow_checks").upsert(wfRows, { onConflict: "resource_id" });
    if (error) throw error;
  }
  const now = new Date().toISOString();
  saveConfig({ lastSyncAt: now });
  addLog("db", `DB로 자원 ${resourceRows.length}건, 대상자 ${beneficiaryRows.length}명, 체크 ${wfRows.length}건을 올렸습니다.`);
}

async function pullFromDb() {
  const client = await getClient();
  const [resourcesResult, beneficiariesResult, workflowResult] = await Promise.all([
    client.from("radar_resources").select("*").order("updated_at", { ascending: false }).limit(500),
    client.from("radar_beneficiaries").select("*").order("updated_at", { ascending: false }).limit(500),
    client.from("radar_workflow_checks").select("*").limit(500)
  ]);
  if (resourcesResult.error) throw resourcesResult.error;
  if (beneficiariesResult.error) throw beneficiariesResult.error;
  if (workflowResult.error) throw workflowResult.error;

  const current = state();
  const resources = (resourcesResult.data || []).map((row) => ({
    ...(row.raw || {}),
    id: row.id,
    title: row.title,
    agency: row.agency,
    category: row.category,
    region: row.region,
    targets: row.targets || [],
    deadline: row.deadline,
    urgency: row.urgency,
    status: row.status,
    summary: row.summary,
    applyMethod: row.apply_method,
    contact: row.contact,
    sourceUrl: row.source_url,
    tags: row.tags || []
  }));
  const people = (beneficiariesResult.data || []).map((row) => ({
    ...(row.raw || {}),
    id: row.id,
    name: row.display_name,
    age: row.age,
    household: row.household,
    needs: row.needs,
    region: row.region,
    memo: row.memo
  }));
  const wf = Object.fromEntries((workflowResult.data || []).map((row) => [row.resource_id, { checklist: row.checklist || {}, memo: row.memo || "" }]));

  writeJson(STATE_KEY, { ...current, resources });
  writeJson(BENEFICIARY_KEY, people);
  writeJson(WORKFLOW_KEY, wf);
  const now = new Date().toISOString();
  saveConfig({ lastSyncAt: now });
  addLog("db", `DB에서 자원 ${resources.length}건, 대상자 ${people.length}명을 내려받았습니다.`);
}

async function testConnection() {
  const client = await getClient();
  const { error } = await client.from("radar_resources").select("id", { count: "exact", head: true });
  if (error) throw error;
  addLog("db", "Supabase 연결 테스트에 성공했습니다.");
}

function showMessage(message, isError = false) {
  const el = document.querySelector("#supabaseStatus");
  if (!el) return;
  el.textContent = message;
  el.style.borderColor = isError ? "#fecdd3" : "#bfdbfe";
  el.style.background = isError ? "#fff1f2" : "#eff6ff";
  el.style.color = isError ? "#be123c" : "#64748b";
}

async function runAction(label, fn) {
  showMessage(`${label} 진행 중입니다.`);
  try {
    await fn();
    showMessage(`${label} 완료. 필요하면 새로고침해 화면을 확인하세요.`);
    renderSupabase();
  } catch (error) {
    showMessage(error.message || `${label} 실패`, true);
  }
}

function renderSupabase() {
  injectCss();
  const dashboard = document.querySelector("#dashboardView");
  if (!dashboard) return;
  let panel = document.querySelector("#radarSupabasePanel");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "radarSupabasePanel";
    panel.className = "radar-supabase-panel";
    const governance = document.querySelector("#radarGovernancePanel");
    (governance || dashboard.querySelector(".dashboard-grid") || dashboard).insertAdjacentElement(governance ? "afterend" : "beforebegin", panel);
  }

  const current = config();
  const stats = localStats();
  panel.innerHTML = `
    <div class="radar-supabase-grid">
      <section class="radar-supabase-card">
        <div class="radar-supabase-head">
          <div><strong>Supabase DB 연결</strong><span>기관 공유 버전으로 가기 위한 로그인·동기화 준비 단계입니다.</span></div>
        </div>
        <div class="radar-supabase-stats">
          <div class="radar-supabase-stat"><span>로컬 자원</span><strong>${stats.resources}</strong></div>
          <div class="radar-supabase-stat"><span>로컬 대상자</span><strong>${stats.beneficiaries}</strong></div>
          <div class="radar-supabase-stat"><span>체크리스트</span><strong>${stats.workflow}</strong></div>
        </div>
        <form class="radar-supabase-form" id="supabaseConfigForm">
          <label>Supabase URL<input id="supabaseUrl" type="url" placeholder="https://xxxx.supabase.co" value="${escapeHtml(current.url)}"></label>
          <label>Supabase anon key<input id="supabaseAnonKey" type="password" placeholder="public anon key만 입력" value="${escapeHtml(current.anonKey)}"></label>
          <label>로그인 이메일<input id="supabaseEmail" type="email" placeholder="직원 이메일" value="${escapeHtml(current.email)}"></label>
          <div class="radar-supabase-actions">
            <button class="radar-supabase-button primary" type="submit">연결 정보 저장</button>
            <button class="radar-supabase-button" id="testSupabase" type="button">연결 테스트</button>
            <button class="radar-supabase-button" id="sendMagicLink" type="button">로그인 메일</button>
            <button class="radar-supabase-button danger" id="clearSupabase" type="button">연결 정보 삭제</button>
          </div>
        </form>
        <div class="radar-supabase-actions">
          <button class="radar-supabase-button primary" id="pushSupabase" type="button">로컬 → DB 올리기</button>
          <button class="radar-supabase-button" id="pullSupabase" type="button">DB → 로컬 내려받기</button>
          <button class="radar-supabase-button" id="signOutSupabase" type="button">로그아웃</button>
        </div>
        <div class="radar-supabase-status" id="supabaseStatus">마지막 동기화: ${current.lastSyncAt ? new Date(current.lastSyncAt).toLocaleString("ko-KR") : "아직 없음"}</div>
      </section>
      <aside class="radar-supabase-card">
        <div class="radar-supabase-head"><div><strong>진행 순서</strong><span>이 순서대로 하면 됩니다.</span></div></div>
        <div class="radar-supabase-steps">
          <div class="radar-supabase-step">1. Supabase 프로젝트 생성 후 SQL Editor에서 <b>supabase-schema.sql</b> 실행</div>
          <div class="radar-supabase-step">2. Authentication에서 이메일 로그인 허용</div>
          <div class="radar-supabase-step">3. 앱에 Project URL과 anon key 저장</div>
          <div class="radar-supabase-step">4. 로그인 메일로 인증 후 연결 테스트</div>
          <div class="radar-supabase-step">5. 로컬 자료를 DB로 올려 기관 공유 테스트</div>
        </div>
        <p class="radar-supabase-status">service role key는 절대 입력하지 마세요. 이 화면은 브라우저에서 동작하므로 public anon key만 사용해야 합니다.</p>
      </aside>
    </div>
  `;

  panel.querySelector("#supabaseConfigForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveConfig({
      url: panel.querySelector("#supabaseUrl")?.value.trim() || "",
      anonKey: panel.querySelector("#supabaseAnonKey")?.value.trim() || "",
      email: panel.querySelector("#supabaseEmail")?.value.trim() || ""
    });
    addLog("db", "Supabase 연결 정보를 저장했습니다.");
    showMessage("연결 정보를 저장했습니다.");
  });
  panel.querySelector("#clearSupabase")?.addEventListener("click", () => {
    if (!confirm("Supabase 연결 정보를 삭제할까요? 로컬 데이터는 유지됩니다.")) return;
    localStorage.removeItem(SUPABASE_CONFIG_KEY);
    cachedClient = null;
    clientPromise = null;
    addLog("db", "Supabase 연결 정보를 삭제했습니다.");
    renderSupabase();
  });
  panel.querySelector("#testSupabase")?.addEventListener("click", () => runAction("연결 테스트", testConnection));
  panel.querySelector("#sendMagicLink")?.addEventListener("click", () => runAction("로그인 메일 발송", () => signIn(panel.querySelector("#supabaseEmail")?.value.trim() || config().email)));
  panel.querySelector("#pushSupabase")?.addEventListener("click", () => runAction("DB 업로드", pushToDb));
  panel.querySelector("#pullSupabase")?.addEventListener("click", () => runAction("DB 내려받기", pullFromDb));
  panel.querySelector("#signOutSupabase")?.addEventListener("click", () => runAction("로그아웃", signOut));
}

window.addEventListener("DOMContentLoaded", () => {
  renderSupabase();
  window.addEventListener("storage", renderSupabase);
  document.addEventListener("click", () => setTimeout(renderSupabase, 240), true);
});
