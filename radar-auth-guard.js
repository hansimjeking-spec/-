const AUTH_CONFIG_KEY = "welfareResourceRadar.supabase.v1";
const AUTH_LOG_KEY = "welfareResourceRadar.opsLog.v1";
const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

let authClientPromise = null;
let authClient = null;
let currentAuthState = { mode: "local", role: "local", email: "", profile: null, user: null };

function injectAuthCss() {
  if (document.querySelector('link[href="./radar-auth-guard.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./radar-auth-guard.css";
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
  return { url: "", anonKey: "", email: "", ...readJson(AUTH_CONFIG_KEY, {}) };
}

function addLog(type, message) {
  const logs = readJson(AUTH_LOG_KEY, []);
  writeJson(AUTH_LOG_KEY, [{ type, message, at: new Date().toISOString() }, ...logs].slice(0, 50));
}

async function getClient() {
  const current = config();
  if (!current.url || !current.anonKey) return null;
  if (authClient) return authClient;
  if (!authClientPromise) {
    authClientPromise = import(SUPABASE_CDN).then(({ createClient }) => {
      authClient = createClient(current.url, current.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
      return authClient;
    });
  }
  return authClientPromise;
}

async function resolveAuthState() {
  const current = config();
  if (!current.url || !current.anonKey) {
    return { mode: "local", role: "local", email: "", profile: null, user: null };
  }
  try {
    const client = await getClient();
    const { data } = await client.auth.getSession();
    const user = data.session?.user || null;
    if (!user) return { mode: "db", role: "guest", email: current.email || "", profile: null, user: null };

    const { data: profile } = await client.from("radar_profiles").select("id, display_name, role, organization").eq("id", user.id).maybeSingle();
    const role = profile?.role || "guest";
    return { mode: "db", role, email: user.email || current.email || "", profile, user };
  } catch {
    return { mode: "db", role: "guest", email: current.email || "", profile: null, user: null };
  }
}

function roleLabel(state) {
  if (state.mode === "local") return "로컬 테스트";
  if (state.role === "admin") return "관리자";
  if (state.role === "manager") return "담당자";
  if (state.role === "staff") return "직원 조회";
  return state.user ? "프로필 필요" : "로그인 필요";
}

function roleHelp(state) {
  if (state.mode === "local") return "Supabase 연결 전이라 로컬 테스트 모드입니다. 저장·삭제·내보내기가 브라우저 저장소에서 동작합니다.";
  if (!state.user) return "DB 연결 정보가 설정되었습니다. 자료 수정·대상자 매칭·백업 기능은 로그인 후 사용할 수 있습니다.";
  if (!state.profile) return "로그인은 되었지만 직원 프로필이 없습니다. 직원 계정·권한 패널에서 내 프로필을 먼저 생성하세요.";
  if (state.role === "staff") return "조회 권한입니다. 자원 등록·수정, 대상자 매칭, 백업·복원은 담당자 이상 권한이 필요합니다.";
  if (state.role === "manager") return "담당자 권한입니다. 자원과 대상자 매칭을 관리할 수 있습니다. 직원 권한 변경은 관리자만 가능합니다.";
  return "관리자 권한입니다. 직원 권한 관리와 기관 공유 설정을 점검할 수 있습니다.";
}

function canWrite() {
  return currentAuthState.mode === "local" || ["manager", "admin"].includes(currentAuthState.role);
}

function canAdmin() {
  return currentAuthState.mode === "local" || currentAuthState.role === "admin";
}

function isAlwaysAllowed(target) {
  const allowedIds = new Set([
    "supabaseConfigForm",
    "testSupabase",
    "sendMagicLink",
    "clearSupabase",
    "signOutSupabase",
    "staffProfileForm",
    "copyMyAdminSql",
    "copyInviteText",
    "refreshMembers",
    "toggleAdminMenu",
    "globalSearch",
    "openCollect"
  ]);
  const id = target?.id || target?.closest?.("[id]")?.id;
  if (id && allowedIds.has(id)) return true;
  if (target?.closest?.(".nav-button")) return true;
  if (target?.closest?.("#radarSupabasePanel")) return true;
  if (target?.closest?.("#radarStaffPanel") && !target.closest("#staffRoleForm")) return true;
  return false;
}

function looksLikeMutation(target) {
  const button = target?.closest?.("button, input[type='submit'], label, a");
  if (!button) return false;
  const text = (button.textContent || button.value || "").trim();
  const id = button.id || "";
  const mutationWords = [
    "저장", "삭제", "복원", "초기화", "수집", "정리", "업로드", "내보내기", "백업", "비식별", "CSV", "캘린더", "샘플", "권한 변경", "명단", "첨부파일", "자원으로 저장"
  ];
  const mutationIds = [
    "analyzeSource", "saveManual", "collectSources", "clearBlockedKeys", "exportJson", "restoreJsonButton", "resetData", "loadSamples", "clearSamples", "copyBrief", "downloadCsv", "beneficiaryFile", "downloadMatchCsv", "downloadIcs", "enhancedBackup", "governanceBackup", "governanceRestore", "exportRedacted", "pushSupabase", "pullSupabase"
  ];
  return mutationIds.includes(id) || mutationWords.some((word) => text.includes(word));
}

function blockEvent(event, message) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  showToast(message);
  addLog("auth", message);
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  if (toast) {
    toast.textContent = message;
    toast.classList.add("show", "active");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show", "active"), 2600);
    return;
  }
  alert(message);
}

function ensureRibbon() {
  const dashboard = document.querySelector("#dashboardView");
  if (!dashboard) return null;
  let ribbon = document.querySelector("#radarAuthRibbon");
  if (!ribbon) {
    ribbon = document.createElement("section");
    ribbon.id = "radarAuthRibbon";
    ribbon.className = "radar-auth-ribbon";
    const lounge = document.querySelector("#radarLoungeHome");
    const heading = dashboard.querySelector(".section-heading");
    (lounge || heading || dashboard).insertAdjacentElement(lounge ? "beforebegin" : "afterend", ribbon);
  }
  return ribbon;
}

function renderLockedNotices() {
  const dashboard = document.querySelector("#dashboardView");
  if (!dashboard) return;
  let notice = document.querySelector("#radarLockedNotice");
  const shouldShow = currentAuthState.mode === "db" && !canWrite();
  if (!shouldShow) {
    notice?.remove();
    return;
  }
  if (!notice) {
    notice = document.createElement("section");
    notice.id = "radarLockedNotice";
    notice.className = "radar-auth-locked-panel";
    const supabase = document.querySelector("#radarSupabasePanel");
    (supabase || dashboard.querySelector(".dashboard-grid") || dashboard).insertAdjacentElement(supabase ? "afterend" : "beforebegin", notice);
  }
  notice.textContent = currentAuthState.user
    ? "현재 계정은 조회 권한입니다. 대상자 매칭, 자료 백업, 자원 등록·수정은 담당자(manager) 이상 권한이 필요합니다."
    : "로그인 전입니다. Supabase 로그인 메일 인증 후 직원 프로필을 생성하면 권한에 맞춰 기능이 열립니다.";
}

function setBodyRoleClasses() {
  document.body.classList.remove("radar-db-local", "radar-db-guest", "radar-db-staff", "radar-db-manager", "radar-db-admin");
  document.body.classList.add(`radar-db-${currentAuthState.role}`);
  document.body.dataset.radarDbRole = currentAuthState.role;
}

function renderRibbon() {
  const ribbon = ensureRibbon();
  if (!ribbon) return;
  const pillClass = currentAuthState.mode === "local" ? "" : canWrite() ? "" : currentAuthState.user ? "warn" : "lock";
  ribbon.innerHTML = `
    <div>
      <strong>접근 상태: ${roleLabel(currentAuthState)}</strong>
      <span>${roleHelp(currentAuthState)}</span>
    </div>
    <span class="radar-auth-pill ${pillClass}">${currentAuthState.email || "LOCAL"}</span>
  `;
}

function updateControls() {
  const restrictedSelectors = [
    "#radarOpsPanel button", "#radarOpsPanel input", "#radarOpsPanel label",
    "#radarGovernancePanel button", "#radarGovernancePanel input", "#radarGovernancePanel label",
    "#collectView button", "#collectView input", "#collectView textarea", "#collectView select",
    "#settingsView button", "#settingsView input",
    "#briefView button"
  ];
  document.querySelectorAll(restrictedSelectors.join(",")).forEach((el) => {
    if (currentAuthState.mode === "local" || canWrite()) {
      el.classList.remove("radar-auth-disabled");
      el.disabled = false;
    } else if (!isAlwaysAllowed(el)) {
      el.classList.add("radar-auth-disabled");
      if ("disabled" in el) el.disabled = true;
    }
  });

  document.querySelectorAll("#staffRoleForm input, #staffRoleForm select, #staffRoleForm button").forEach((el) => {
    if (canAdmin()) {
      el.classList.remove("radar-auth-disabled");
      el.disabled = false;
    } else {
      el.classList.add("radar-auth-disabled");
      if ("disabled" in el) el.disabled = true;
    }
  });
}

async function refreshAuthGuard() {
  injectAuthCss();
  currentAuthState = await resolveAuthState();
  setBodyRoleClasses();
  renderRibbon();
  renderLockedNotices();
  updateControls();
}

document.addEventListener("click", (event) => {
  if (currentAuthState.mode === "local") return;
  if (isAlwaysAllowed(event.target)) return;
  if (!canWrite() && looksLikeMutation(event.target)) {
    blockEvent(event, "담당자(manager) 이상 권한이 필요한 기능입니다.");
  }
  if (!canAdmin() && event.target?.closest?.("#staffRoleForm")) {
    blockEvent(event, "관리자(admin) 권한이 필요한 기능입니다.");
  }
}, true);

document.addEventListener("submit", (event) => {
  if (currentAuthState.mode === "local") return;
  if (event.target?.closest?.("#supabaseConfigForm") || event.target?.closest?.("#staffProfileForm")) return;
  if (!canAdmin() && event.target?.closest?.("#staffRoleForm")) {
    blockEvent(event, "관리자(admin) 권한이 필요한 기능입니다.");
    return;
  }
  if (!canWrite()) {
    blockEvent(event, "담당자(manager) 이상 권한이 필요한 기능입니다.");
  }
}, true);

window.addEventListener("DOMContentLoaded", () => {
  refreshAuthGuard();
  window.addEventListener("storage", refreshAuthGuard);
  document.addEventListener("click", () => setTimeout(refreshAuthGuard, 260), true);
  document.addEventListener("input", () => setTimeout(refreshAuthGuard, 260), true);
  setInterval(refreshAuthGuard, 3000);
});
