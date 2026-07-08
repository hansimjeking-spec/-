const GOVERNANCE_KEY = "welfareResourceRadar.governance.v1";
const STATE_KEY = "welfareResourceRadar.v1";
const BENEFICIARY_KEY = "welfareResourceRadar.beneficiaries.v1";
const OPS_LOG_KEY = "welfareResourceRadar.opsLog.v1";
const WORKFLOW_KEY = "welfareResourceRadar.workflow.v1";

function injectGovernanceCss() {
  if (document.querySelector('link[href="./radar-governance.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./radar-governance.css";
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

function settings() {
  return {
    role: "personal",
    privacy: false,
    dbMode: "local",
    ...readJson(GOVERNANCE_KEY, {})
  };
}

function saveSettings(next) {
  writeJson(GOVERNANCE_KEY, { ...settings(), ...next });
  applyPrivacy();
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

function logs() {
  return readJson(OPS_LOG_KEY, []);
}

function addLog(type, message) {
  const next = [{ type, message, at: new Date().toISOString() }, ...logs()].slice(0, 50);
  writeJson(OPS_LOG_KEY, next);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function bytesUsed() {
  let total = 0;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i) || "";
    if (!key.startsWith("welfareResourceRadar")) continue;
    total += key.length + String(localStorage.getItem(key) || "").length;
  }
  return total * 2;
}

function mb(value) {
  return (value / 1024 / 1024).toFixed(2);
}

function daysLeft(deadline) {
  if (!deadline) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${deadline}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target - today) / 86400000);
}

function integrity() {
  const resources = state().resources;
  const people = beneficiaries();
  const missingDeadline = resources.filter((item) => !item.deadline).length;
  const missingApply = resources.filter((item) => !item.applyMethod || !item.contact).length;
  const expired = resources.filter((item) => {
    const left = daysLeft(item.deadline);
    return left !== null && left < 0;
  }).length;
  const hasPeople = people.length > 0;
  const storageMb = Number(mb(bytesUsed()));
  return { resources, people, missingDeadline, missingApply, expired, hasPeople, storageMb };
}

function statusDot(level) {
  return `<span class="radar-governance-dot ${level}"></span>`;
}

function checkItem(level, text) {
  return `<li>${statusDot(level)}<span>${escapeHtml(text)}</span></li>`;
}

function dbSchemaText() {
  return `Supabase 준비 테이블\n\n1. resources\n- id, title, agency, category, region, targets, deadline, urgency, status, summary, apply_method, contact, source_url, created_at, updated_at\n\n2. beneficiaries\n- id, display_name, age_group, household_type, needs, region, memo, created_at\n\n3. resource_matches\n- id, resource_id, beneficiary_id, score, reasons, created_at\n\n4. workflow_checks\n- id, resource_id, checklist_json, memo, updated_by, updated_at\n\n주의: beneficiaries는 RLS 정책과 기관 내부 권한 설정 후 사용`;
}

function downloadBlob(filename, content, type = "text/plain;charset=utf-8") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function maskName(name, index = 0) {
  const clean = String(name || "대상자").trim();
  if (!clean || clean.startsWith("대상자")) return `대상자 ${index + 1}`;
  const first = clean.slice(0, 1);
  return `${first}OO`;
}

function exportRedactedBeneficiaries() {
  const rows = [["대상자", "연령", "가구유형", "욕구", "지역", "비고"]];
  beneficiaries().forEach((person, index) => rows.push([
    maskName(person.name, index),
    person.age || "",
    person.household || "",
    person.needs || "",
    person.region || "",
    person.memo || ""
  ]));
  downloadBlob("대상자명단_비식별.csv", rows.map((row) => row.map(csvCell).join(",")).join("\n"), "text/csv;charset=utf-8");
  addLog("privacy", "비식별 대상자 명단을 내보냈습니다.");
  renderGovernance();
}

function exportFullBackup() {
  const payload = {
    exportedAt: new Date().toISOString(),
    version: 2,
    state: state(),
    beneficiaries: beneficiaries(),
    workflow: readJson(WORKFLOW_KEY, {}),
    opsLog: logs(),
    governance: settings()
  };
  downloadBlob("복지자원_레이더_기관공유준비_백업.json", JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
  addLog("backup", "기관공유 준비 백업을 내보냈습니다.");
  renderGovernance();
}

async function restoreBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (!payload.state && !payload.resources) throw new Error("복원 가능한 백업 형식이 아닙니다.");
    if (!confirm("백업을 복원하면 현재 브라우저에 저장된 레이더 데이터가 바뀝니다. 계속할까요?")) return;
    if (payload.state) writeJson(STATE_KEY, payload.state);
    else writeJson(STATE_KEY, { resources: payload.resources || [], trash: payload.trash || [], blockedKeys: payload.blockedKeys || [] });
    if (Array.isArray(payload.beneficiaries)) writeJson(BENEFICIARY_KEY, payload.beneficiaries);
    if (payload.workflow) writeJson(WORKFLOW_KEY, payload.workflow);
    if (Array.isArray(payload.opsLog)) writeJson(OPS_LOG_KEY, payload.opsLog);
    if (payload.governance) writeJson(GOVERNANCE_KEY, payload.governance);
    addLog("restore", `${file.name} 백업을 복원했습니다.`);
    renderGovernance();
    setTimeout(() => location.reload(), 450);
  } catch (error) {
    alert(error.message || "백업 파일을 복원하지 못했습니다.");
  } finally {
    event.target.value = "";
  }
}

function applyPrivacy() {
  const privacy = settings().privacy;
  document.body.classList.toggle("radar-privacy-on", Boolean(privacy));
  document.body.dataset.radarRole = settings().role;
}

function renderGovernance() {
  injectGovernanceCss();
  applyPrivacy();
  const dashboard = document.querySelector("#dashboardView");
  if (!dashboard) return;
  let panel = document.querySelector("#radarGovernancePanel");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "radarGovernancePanel";
    panel.className = "radar-governance-panel";
    const ops = document.querySelector("#radarOpsPanel");
    (ops || dashboard.querySelector(".dashboard-grid") || dashboard).insertAdjacentElement(ops ? "afterend" : "beforebegin", panel);
  }

  const current = settings();
  const report = integrity();
  const checks = [
    checkItem(current.privacy ? "" : "warn", current.privacy ? "개인정보 표시 보호가 켜져 있습니다." : "개인정보 표시 보호가 꺼져 있습니다. 회의·화면공유 전 켜는 것을 권장합니다."),
    checkItem(report.hasPeople ? "warn" : "", report.hasPeople ? `대상자 명단 ${report.people.length}명이 브라우저에 저장되어 있습니다. 공용 PC 사용 후 비우기 또는 백업 관리를 확인하세요.` : "저장된 대상자 명단이 없습니다."),
    checkItem(report.missingApply ? "warn" : "", report.missingApply ? `신청방법 또는 문의처 확인 필요 자원 ${report.missingApply}건이 있습니다.` : "신청방법과 문의처가 대체로 정리되어 있습니다."),
    checkItem(report.expired ? "danger" : "", report.expired ? `마감 지난 자원 ${report.expired}건이 목록에 남아 있습니다.` : "마감 지난 자원은 확인되지 않습니다."),
    checkItem(report.storageMb > 4 ? "danger" : report.storageMb > 2 ? "warn" : "", `브라우저 저장 용량 사용량 약 ${report.storageMb}MB입니다.`)
  ];

  panel.innerHTML = `
    <div class="radar-governance-grid">
      <section class="radar-governance-card">
        <div class="radar-governance-head">
          <div><strong>권한·개인정보 점검 <span class="radar-privacy-badge">보호 표시 중</span></strong><span>기관 공유 버전으로 가기 전, 개인정보와 복원 흐름을 먼저 정리합니다.</span></div>
          <div class="radar-governance-actions">
            <select class="radar-governance-select" id="radarRoleSelect" aria-label="사용 모드">
              <option value="personal" ${current.role === "personal" ? "selected" : ""}>개인 테스트</option>
              <option value="staff" ${current.role === "staff" ? "selected" : ""}>직원 조회</option>
              <option value="manager" ${current.role === "manager" ? "selected" : ""}>담당자 관리</option>
              <option value="admin" ${current.role === "admin" ? "selected" : ""}>관리자</option>
            </select>
            <button class="radar-governance-button ${current.privacy ? "primary" : ""}" id="togglePrivacy" type="button">${current.privacy ? "개인정보 보호 끄기" : "개인정보 보호 켜기"}</button>
          </div>
        </div>
        <div class="radar-governance-stats">
          <div class="radar-governance-stat"><span>자원</span><strong>${report.resources.length}</strong></div>
          <div class="radar-governance-stat"><span>대상자</span><strong>${report.people.length}</strong></div>
          <div class="radar-governance-stat"><span>확인 필요</span><strong>${report.missingApply}</strong></div>
          <div class="radar-governance-stat"><span>저장 용량</span><strong>${report.storageMb}MB</strong></div>
        </div>
        <ul class="radar-governance-checks">${checks.join("")}</ul>
        <div class="radar-governance-alert">현재 권한 기능은 브라우저 안에서 화면 흐름을 나누는 수준입니다. 실제 기관 공유용 보안은 로그인, DB, RLS 권한 설정이 붙어야 완성됩니다.</div>
      </section>
      <aside class="radar-governance-stack">
        <section class="radar-governance-card">
          <div class="radar-governance-head"><div><strong>백업·복원</strong><span>기관 PC 이동, 테스트 복구, 데이터 이전을 위한 안전장치입니다.</span></div></div>
          <div class="radar-governance-actions">
            <button class="radar-governance-button primary" id="governanceBackup" type="button">전체 백업</button>
            <label class="radar-governance-file-label" for="governanceRestore">백업 복원</label>
            <input class="radar-governance-file" id="governanceRestore" type="file" accept=".json,application/json">
            <button class="radar-governance-button" id="exportRedacted" type="button">대상자 비식별 CSV</button>
          </div>
          <p class="radar-governance-restore-note">백업에는 자원, 대상자 명단, 체크리스트, 업무 로그가 포함됩니다. 외부 공유 전에는 비식별 CSV를 사용하세요.</p>
        </section>
        <section class="radar-governance-card">
          <div class="radar-governance-head"><div><strong>DB 연동 설계</strong><span>Supabase 연결 전 필요한 테이블 구조입니다.</span></div></div>
          <div class="radar-governance-actions"><button class="radar-governance-button" id="copyDbSchema" type="button">DB 설계 복사</button></div>
          <pre class="radar-governance-dbcode">${escapeHtml(dbSchemaText())}</pre>
        </section>
      </aside>
    </div>
  `;

  panel.querySelector("#togglePrivacy")?.addEventListener("click", () => {
    saveSettings({ privacy: !settings().privacy });
    addLog("privacy", settings().privacy ? "개인정보 보호 표시를 켰습니다." : "개인정보 보호 표시를 껐습니다.");
    renderGovernance();
  });
  panel.querySelector("#radarRoleSelect")?.addEventListener("change", (event) => {
    saveSettings({ role: event.target.value });
    addLog("role", `사용 모드를 ${event.target.selectedOptions[0]?.textContent || event.target.value}(으)로 변경했습니다.`);
    renderGovernance();
  });
  panel.querySelector("#governanceBackup")?.addEventListener("click", exportFullBackup);
  panel.querySelector("#governanceRestore")?.addEventListener("change", restoreBackup);
  panel.querySelector("#exportRedacted")?.addEventListener("click", exportRedactedBeneficiaries);
  panel.querySelector("#copyDbSchema")?.addEventListener("click", () => {
    navigator.clipboard.writeText(dbSchemaText()).then(() => alert("DB 설계를 복사했습니다."), () => alert("복사 권한을 확인하세요."));
  });
}

function scheduleRender() {
  clearTimeout(scheduleRender.timer);
  scheduleRender.timer = setTimeout(renderGovernance, 220);
}

window.addEventListener("DOMContentLoaded", () => {
  renderGovernance();
  document.addEventListener("click", scheduleRender, true);
  document.addEventListener("input", scheduleRender, true);
  window.addEventListener("storage", scheduleRender);
  setInterval(applyPrivacy, 700);
  setInterval(renderGovernance, 3500);
});
