const STAFF_SUPABASE_CONFIG_KEY = "welfareResourceRadar.supabase.v1";
const STAFF_LOG_KEY = "welfareResourceRadar.opsLog.v1";
const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

let staffClientPromise = null;
let staffClient = null;

function injectStaffCss() {
  if (document.querySelector('link[href="./radar-staff.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./radar-staff.css";
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
    ...readJson(STAFF_SUPABASE_CONFIG_KEY, {})
  };
}

function addLog(type, message) {
  const logs = readJson(STAFF_LOG_KEY, []);
  writeJson(STAFF_LOG_KEY, [{ type, message, at: new Date().toISOString() }, ...logs].slice(0, 50));
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
  if (!current.url || !current.anonKey) throw new Error("Supabase 연결 정보를 먼저 저장하세요.");
  if (staffClient) return staffClient;
  if (!staffClientPromise) {
    staffClientPromise = import(SUPABASE_CDN).then(({ createClient }) => {
      staffClient = createClient(current.url, current.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
      return staffClient;
    });
  }
  return staffClientPromise;
}

async function sessionInfo() {
  try {
    const client = await getClient();
    const { data } = await client.auth.getSession();
    const user = data.session?.user || null;
    if (!user) return { user: null, profile: null };
    const { data: profile } = await client.from("radar_profiles").select("*").eq("id", user.id).maybeSingle();
    return { user, profile };
  } catch {
    return { user: null, profile: null };
  }
}

function adminSql(userId, name = "관리자") {
  return `insert into public.radar_profiles (id, display_name, role)\nvalues ('${String(userId || "본인-auth-user-id").replace(/'/g, "''")}', '${String(name || "관리자").replace(/'/g, "''")}', 'admin')\non conflict (id) do update set role = 'admin', display_name = excluded.display_name;`;
}

function inviteText() {
  return [
    "[복지자원 레이더 직원 접속 안내]",
    "1. 복지자원 레이더에 접속합니다.",
    "2. Supabase DB 연결 정보가 설정된 상태에서 본인 이메일을 입력합니다.",
    "3. 로그인 메일을 열어 인증합니다.",
    "4. 로그인 후 ‘내 프로필 생성/갱신’을 눌러 직원 프로필을 만듭니다.",
    "5. 담당자/관리자 권한이 필요한 경우 관리자에게 권한 변경을 요청합니다.",
    "",
    location.origin
  ].join("\n");
}

async function saveMyProfile() {
  const client = await getClient();
  const { data } = await client.auth.getSession();
  const user = data.session?.user;
  if (!user) throw new Error("먼저 로그인 메일로 로그인하세요.");

  const displayName = document.querySelector("#staffDisplayName")?.value.trim() || user.email || "직원";
  const organization = document.querySelector("#staffOrganization")?.value.trim() || "제천종합사회복지관";
  const { data: existing } = await client.from("radar_profiles").select("role").eq("id", user.id).maybeSingle();
  const role = existing?.role || "staff";

  const { error } = await client.from("radar_profiles").upsert({
    id: user.id,
    display_name: displayName,
    organization,
    role
  }, { onConflict: "id" });
  if (error) throw error;
  addLog("staff", `${displayName} 프로필을 저장했습니다.`);
}

async function loadMembers() {
  const client = await getClient();
  const { data, error } = await client.from("radar_profiles").select("id, display_name, role, organization, updated_at").order("updated_at", { ascending: false }).limit(100);
  if (error) throw error;
  return data || [];
}

async function updateMemberRole() {
  const client = await getClient();
  const memberId = document.querySelector("#memberIdForRole")?.value.trim();
  const role = document.querySelector("#memberRoleSelect")?.value || "staff";
  if (!memberId) throw new Error("권한을 변경할 직원 ID를 입력하세요.");
  const { error } = await client.from("radar_profiles").update({ role }).eq("id", memberId);
  if (error) throw error;
  addLog("staff", `직원 ${memberId} 권한을 ${role}(으)로 변경했습니다.`);
}

function showStatus(message, isError = false) {
  const el = document.querySelector("#staffStatus");
  if (!el) return;
  el.textContent = message;
  el.style.borderColor = isError ? "#fecdd3" : "#bfdbfe";
  el.style.background = isError ? "#fff1f2" : "#eff6ff";
  el.style.color = isError ? "#be123c" : "#64748b";
}

async function run(label, fn) {
  showStatus(`${label} 진행 중입니다.`);
  try {
    const result = await fn();
    showStatus(`${label} 완료.`);
    renderStaff(result);
  } catch (error) {
    showStatus(error.message || `${label} 실패`, true);
  }
}

function memberListHtml(members) {
  if (!members?.length) return `<div class="radar-staff-status">직원 목록이 없거나, 현재 계정에 직원 목록 조회 권한이 없습니다.</div>`;
  return members.map((member) => `
    <article class="radar-staff-member">
      <div>
        <b>${escapeHtml(member.display_name || "이름 미기재")}</b>
        <span>${escapeHtml(member.organization || "기관 미기재")} · ${escapeHtml(member.id)}</span>
      </div>
      <span class="radar-staff-pill">${escapeHtml(member.role || "staff")}</span>
    </article>
  `).join("");
}

async function renderStaff(preloadedMembers = null) {
  injectStaffCss();
  const dashboard = document.querySelector("#dashboardView");
  if (!dashboard) return;
  let panel = document.querySelector("#radarStaffPanel");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "radarStaffPanel";
    panel.className = "radar-staff-panel";
    const supabase = document.querySelector("#radarSupabasePanel");
    (supabase || dashboard.querySelector(".dashboard-grid") || dashboard).insertAdjacentElement(supabase ? "afterend" : "beforebegin", panel);
  }

  const { user, profile } = await sessionInfo();
  const members = preloadedMembers || [];
  const userId = user?.id || "";
  const email = user?.email || config().email || "";
  const name = profile?.display_name || email.split("@")[0] || "";
  const organization = profile?.organization || "제천종합사회복지관";
  const role = profile?.role || "로그인 전";

  panel.innerHTML = `
    <div class="radar-staff-grid">
      <section class="radar-staff-card">
        <div class="radar-staff-head">
          <div><strong>직원 계정·권한</strong><span>로그인 후 내 프로필을 만들고, 관리자 권한에서 직원 권한을 관리합니다.</span></div>
        </div>
        <form class="radar-staff-form" id="staffProfileForm">
          <label>현재 로그인 이메일<input value="${escapeHtml(email || "로그인 전")}" readonly></label>
          <label>내 사용자 ID<input id="staffUserId" value="${escapeHtml(userId || "로그인 후 표시")}" readonly></label>
          <label>표시 이름<input id="staffDisplayName" value="${escapeHtml(name)}" placeholder="예: 사례관리팀 윤종필"></label>
          <label>기관명<input id="staffOrganization" value="${escapeHtml(organization)}"></label>
          <div class="radar-staff-actions">
            <button class="radar-staff-button primary" type="submit">내 프로필 생성/갱신</button>
            <button class="radar-staff-button" id="copyMyAdminSql" type="button">내 관리자 지정 SQL 복사</button>
            <button class="radar-staff-button" id="copyInviteText" type="button">직원 안내문 복사</button>
          </div>
        </form>
        <div class="radar-staff-status" id="staffStatus">현재 권한: ${escapeHtml(role)}. 최초 가입자는 staff로 생성됩니다.</div>
      </section>
      <aside class="radar-staff-card">
        <div class="radar-staff-head"><div><strong>직원 목록</strong><span>admin 권한이면 전체 직원 목록을 볼 수 있습니다.</span></div></div>
        <div class="radar-staff-actions">
          <button class="radar-staff-button primary" id="refreshMembers" type="button">직원 목록 새로고침</button>
        </div>
        <div class="radar-staff-list">${memberListHtml(members)}</div>
        <hr style="border:0;border-top:1px solid #eef2f7;margin:14px 0;">
        <form class="radar-staff-form" id="staffRoleForm">
          <label>직원 ID<input id="memberIdForRole" placeholder="권한 변경할 직원 UUID"></label>
          <label>권한<select id="memberRoleSelect"><option value="staff">staff</option><option value="manager">manager</option><option value="admin">admin</option></select></label>
          <button class="radar-staff-button" type="submit">권한 변경</button>
        </form>
        <pre class="radar-staff-sql">${escapeHtml(adminSql(userId, name || "관리자"))}</pre>
      </aside>
    </div>
  `;

  panel.querySelector("#staffProfileForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    run("내 프로필 저장", saveMyProfile);
  });
  panel.querySelector("#refreshMembers")?.addEventListener("click", () => run("직원 목록 조회", loadMembers));
  panel.querySelector("#staffRoleForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    run("직원 권한 변경", updateMemberRole);
  });
  panel.querySelector("#copyMyAdminSql")?.addEventListener("click", () => {
    navigator.clipboard.writeText(adminSql(userId, panel.querySelector("#staffDisplayName")?.value.trim() || "관리자"));
    showStatus("관리자 지정 SQL을 복사했습니다.");
  });
  panel.querySelector("#copyInviteText")?.addEventListener("click", () => {
    navigator.clipboard.writeText(inviteText());
    showStatus("직원 안내문을 복사했습니다.");
  });
}

window.addEventListener("DOMContentLoaded", () => {
  renderStaff();
  window.addEventListener("storage", () => renderStaff());
  document.addEventListener("click", () => setTimeout(() => renderStaff(), 260), true);
});
