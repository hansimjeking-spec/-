const STATE_KEY = "welfareResourceRadar.v1";
const BENEFICIARY_KEY = "welfareResourceRadar.beneficiaries.v1";
const OPS_LOG_KEY = "welfareResourceRadar.opsLog.v1";
const WORKFLOW_KEY = "welfareResourceRadar.workflow.v1";
const SHEETJS_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";

const $ = (selector) => document.querySelector(selector);

function injectOpsCss() {
  if (document.querySelector('link[href="./radar-ops.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./radar-ops.css";
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
  const next = [{ type, message, at: new Date().toISOString() }, ...logs()].slice(0, 30);
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

function splitList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || "").split(/[,;·/\n]/).map((item) => item.trim()).filter(Boolean);
}

function compact(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizeText(value) {
  return compact(value).toLowerCase();
}

function getColumn(row, candidates) {
  const keys = Object.keys(row || {});
  const found = keys.find((key) => candidates.some((candidate) => normalizeText(key).includes(candidate)));
  return found ? compact(row[found]) : "";
}

function normalizeBeneficiary(row, index) {
  const rawText = Object.entries(row || {}).map(([key, value]) => `${key}:${value}`).join(" ");
  return {
    id: `b-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    name: getColumn(row, ["이름", "성명", "대상자", "성함", "name"]) || `대상자 ${index + 1}`,
    age: getColumn(row, ["나이", "연령", "age", "생년", "출생"]),
    household: getColumn(row, ["가구", "세대", "가족", "동거", "house"]),
    needs: getColumn(row, ["욕구", "필요", "지원", "서비스", "문제", "상담", "비고", "특이", "needs"]),
    region: getColumn(row, ["지역", "주소", "동", "읍", "면", "거주", "address"]),
    memo: getColumn(row, ["메모", "비고", "특이", "상세", "note"]),
    raw: row,
    rawText
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quote = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '"' && quote && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      quote = !quote;
      continue;
    }
    if (!quote && (char === "," || char === "\t")) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!quote && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  row.push(cell);
  rows.push(row);
  const headers = (rows.shift() || []).map((header) => compact(header));
  return rows
    .filter((items) => items.some((item) => compact(item)))
    .map((items) => Object.fromEntries(headers.map((header, index) => [header || `열${index + 1}`, compact(items[index] || "")])));
}

function loadSheetJs() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SHEETJS_URL;
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error("엑셀 해석 라이브러리를 불러오지 못했습니다."));
    document.head.appendChild(script);
  });
}

async function parseFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const XLSX = await loadSheetJs();
    const buffer = await file.arrayBuffer();
    const book = XLSX.read(buffer, { type: "array" });
    const sheet = book.Sheets[book.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: "" });
  }
  return parseCsv(await file.text());
}

const CATEGORY_WORDS = {
  생계: ["생계", "생활비", "식비", "체납", "공과금", "경제", "현금", "긴급"],
  긴급지원: ["긴급", "위기", "재난", "실직", "질병", "체납", "퇴거"],
  돌봄: ["돌봄", "독거", "노인", "식사", "도시락", "안부", "요양", "간병"],
  의료: ["의료", "병원", "치료", "진료", "약", "수술", "간병", "건강"],
  주거: ["주거", "월세", "전세", "임대", "퇴거", "거처", "보증금", "집"],
  심리정서: ["심리", "정서", "상담", "우울", "불안", "고립", "마음"],
  고용: ["고용", "취업", "일자리", "직업", "훈련", "구직"],
  교육: ["교육", "장학", "학습", "학교", "교재", "청소년"],
  법률: ["법률", "채무", "파산", "소송", "권리", "상담"]
};

function resourceText(item) {
  return normalizeText([
    item.title,
    item.agency,
    item.category,
    item.region,
    item.summary,
    item.applyMethod,
    splitList(item.targets).join(" "),
    splitList(item.tags).join(" ")
  ].join(" "));
}

function beneficiaryText(item) {
  return normalizeText([item.name, item.age, item.household, item.needs, item.region, item.memo, item.rawText].join(" "));
}

function matchOne(resource, beneficiary) {
  const rText = resourceText(resource);
  const bText = beneficiaryText(beneficiary);
  let score = 0;
  const reasons = [];

  splitList(resource.targets).forEach((target) => {
    const token = normalizeText(target);
    if (token && bText.includes(token)) {
      score += 26;
      reasons.push(`대상 조건 일치: ${target}`);
    }
  });

  const categoryWords = CATEGORY_WORDS[resource.category] || [];
  const matchedCategory = categoryWords.filter((word) => bText.includes(word) || rText.includes(word)).slice(0, 4);
  if (matchedCategory.length) {
    score += matchedCategory.length * 8;
    reasons.push(`${resource.category || "분야"} 키워드: ${matchedCategory.join(", ")}`);
  }

  const needWords = compact(beneficiary.needs).split(/[\s,;·/]+/).filter((word) => word.length >= 2);
  const needHits = needWords.filter((word) => rText.includes(normalizeText(word))).slice(0, 4);
  if (needHits.length) {
    score += needHits.length * 7;
    reasons.push(`욕구 키워드 일치: ${needHits.join(", ")}`);
  }

  if (resource.region && beneficiary.region && (beneficiary.region.includes(resource.region) || resource.region.includes(beneficiary.region) || resource.region === "전국")) {
    score += 9;
    reasons.push(`지역 확인: ${resource.region}`);
  }

  if (resource.urgency === "높음") score += 4;
  const left = daysLeft(resource.deadline);
  if (left !== null && left >= 0 && left <= 7) {
    score += 5;
    reasons.push(`마감 임박: D-${left}`);
  }

  return { resource, beneficiary, score, reasons: [...new Set(reasons)].slice(0, 5) };
}

function daysLeft(deadline) {
  if (!deadline) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${deadline}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target - today) / 86400000);
}

function buildMatches() {
  const resources = state().resources;
  const people = beneficiaries();
  return resources
    .flatMap((resource) => people.map((person) => matchOne(resource, person)))
    .filter((match) => match.score >= 18)
    .sort((a, b) => b.score - a.score)
    .slice(0, 60);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
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

function downloadMatchCsv() {
  const rows = [["대상자", "자원명", "기관", "점수", "추천사유", "마감일", "문의처"]];
  buildMatches().forEach((match) => rows.push([
    match.beneficiary.name,
    match.resource.title || "제목 미정",
    match.resource.agency || "기관 미기재",
    match.score,
    match.reasons.join(" / "),
    match.resource.deadline || "",
    match.resource.contact || ""
  ]));
  downloadBlob("복지자원_대상자_매칭.csv", rows.map((row) => row.map(csvCell).join(",")).join("\n"), "text/csv;charset=utf-8");
  addLog("export", "대상자 매칭 CSV를 내보냈습니다.");
  renderOps();
}

function buildMatchText() {
  const matches = buildMatches().slice(0, 12);
  return [
    `[복지자원 대상자 매칭 / ${new Date().toLocaleDateString("ko-KR")}]`,
    `등록 대상자 ${beneficiaries().length}명 기준으로 추천 후보 ${matches.length}건을 확인했습니다.`,
    "",
    ...matches.map((match, index) => `${index + 1}. ${match.beneficiary.name} → ${match.resource.title || "제목 미정"}\n   사유: ${match.reasons.join(", ") || "키워드 유사"}\n   기관/마감: ${match.resource.agency || "기관 미기재"} / ${match.resource.deadline || "마감 미정"}`)
  ].join("\n");
}

function copyMatchText() {
  navigator.clipboard.writeText(buildMatchText()).then(() => toast("매칭 요약을 복사했습니다."), () => toast("복사 권한을 확인하세요."));
  addLog("copy", "대상자 매칭 요약을 복사했습니다.");
  renderOps();
}

function downloadIcs() {
  const resources = state().resources.filter((item) => item.deadline);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Welfare Resource Radar//KR"];
  resources.forEach((item) => {
    const date = String(item.deadline).replaceAll("-", "");
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${item.id || crypto.randomUUID()}@welfare-resource-radar`);
    lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`);
    lines.push(`DTSTART;VALUE=DATE:${date}`);
    lines.push(`SUMMARY:${icsText(`[마감] ${item.title || "복지자원"}`)}`);
    lines.push(`DESCRIPTION:${icsText([item.agency, item.applyMethod, item.contact, item.sourceUrl].filter(Boolean).join("\\n"))}`);
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  downloadBlob("복지자원_마감일정.ics", lines.join("\r\n"), "text/calendar;charset=utf-8");
  addLog("export", `마감 일정 ${resources.length}건을 내보냈습니다.`);
  renderOps();
}

function icsText(value) {
  return String(value || "").replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replaceAll("\n", "\\n");
}

function enhancedBackup() {
  const payload = {
    exportedAt: new Date().toISOString(),
    state: state(),
    beneficiaries: beneficiaries(),
    workflow: readJson(WORKFLOW_KEY, {}),
    opsLog: logs()
  };
  downloadBlob("복지자원_레이더_전체백업.json", JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
  addLog("backup", "전체 백업 파일을 내보냈습니다.");
  renderOps();
}

function sampleBeneficiaries() {
  const samples = [
    { name: "김OO", age: "78", household: "독거노인", needs: "식사 지원 안부확인 돌봄", region: "제천", memo: "거동 불편" },
    { name: "박OO", age: "54", household: "중장년 1인가구", needs: "생계비 체납 긴급지원", region: "제천", memo: "실직 후 공과금 체납" },
    { name: "이OO", age: "31", household: "청년", needs: "심리상담 우울 고립", region: "충북", memo: "상담 희망" },
    { name: "최OO", age: "67", household: "주거취약", needs: "월세 체납 퇴거 위기 주거", region: "제천", memo: "임시거처 검토" }
  ].map(normalizeBeneficiary);
  writeJson(BENEFICIARY_KEY, samples);
  addLog("sample", "샘플 대상자 4명을 불러왔습니다.");
  renderOps();
}

function clearBeneficiaries() {
  if (!confirm("대상자 명단을 비울까요? 복지자원 데이터는 유지됩니다.")) return;
  writeJson(BENEFICIARY_KEY, []);
  addLog("clear", "대상자 명단을 비웠습니다.");
  renderOps();
}

async function handleFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const rows = await parseFile(file);
    const normalized = rows.map(normalizeBeneficiary).filter((item) => item.name);
    writeJson(BENEFICIARY_KEY, normalized);
    addLog("import", `${file.name}에서 대상자 ${normalized.length}명을 불러왔습니다.`);
    toast(`대상자 ${normalized.length}명을 불러왔습니다.`);
    renderOps();
  } catch (error) {
    addLog("error", error.message || "대상자 파일을 읽지 못했습니다.");
    toast(error.message || "대상자 파일을 읽지 못했습니다.");
  } finally {
    event.target.value = "";
  }
}

function toast(message) {
  const el = document.querySelector("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show", "active");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show", "active"), 2400);
}

function renderOps() {
  injectOpsCss();
  const dashboard = document.querySelector("#dashboardView");
  if (!dashboard) return;
  let panel = document.querySelector("#radarOpsPanel");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "radarOpsPanel";
    panel.className = "radar-ops-panel";
    const lounge = document.querySelector("#radarLoungeHome");
    (lounge || dashboard.querySelector(".dashboard-grid") || dashboard).insertAdjacentElement(lounge ? "afterend" : "beforebegin", panel);
  }

  const people = beneficiaries();
  const resources = state().resources;
  const matches = buildMatches();
  const dueCount = resources.filter((item) => item.deadline).length;
  const logRows = logs().slice(0, 5);

  panel.innerHTML = `
    <div class="radar-ops-grid">
      <section class="radar-ops-card">
        <div class="radar-ops-head">
          <div><strong>대상자 엑셀 매칭</strong><span>대상자 명단을 넣으면 자원별 연결 후보를 추천합니다.</span></div>
          <div class="radar-ops-actions">
            <label class="radar-ops-file-label primary" for="beneficiaryFile">대상자 파일 업로드</label>
            <input class="radar-ops-file" id="beneficiaryFile" type="file" accept=".csv,.tsv,.txt,.xlsx,.xls">
            <button class="radar-ops-button" id="loadBeneficiarySamples" type="button">샘플</button>
            <button class="radar-ops-button" id="clearBeneficiaries" type="button">명단 비우기</button>
          </div>
        </div>
        <p class="radar-ops-help">권장 열 이름: 이름, 나이, 가구유형, 욕구, 지역, 비고. CSV는 바로 읽고, XLSX는 브라우저에서 엑셀 해석 라이브러리를 불러와 처리합니다.</p>
        <div class="radar-ops-stats">
          <div class="radar-ops-stat"><span>대상자</span><strong>${people.length}</strong></div>
          <div class="radar-ops-stat"><span>추천 후보</span><strong>${matches.length}</strong></div>
          <div class="radar-ops-stat"><span>마감 일정</span><strong>${dueCount}</strong></div>
        </div>
        <div class="radar-ops-tools">
          <button class="radar-ops-button primary" id="copyMatchReport" type="button">매칭 요약 복사</button>
          <button class="radar-ops-button" id="downloadMatchCsv" type="button">매칭 CSV</button>
          <button class="radar-ops-button" id="downloadIcs" type="button">마감 일정 캘린더</button>
          <button class="radar-ops-button" id="enhancedBackup" type="button">전체 백업</button>
        </div>
        <div class="radar-ops-results">
          ${matches.length ? matches.slice(0, 10).map(renderMatch).join("") : `<div class="radar-ops-empty">아직 추천 결과가 없습니다. 대상자 명단을 업로드하거나 샘플을 불러온 뒤 복지자원을 등록해보세요.</div>`}
        </div>
      </section>
      <aside class="radar-ops-side">
        <section class="radar-ops-card">
          <div class="radar-ops-head"><div><strong>업무 로그</strong><span>가져오기, 내보내기, 백업 기록을 남깁니다.</span></div></div>
          <div class="radar-ops-log">
            ${logRows.length ? logRows.map((item) => `<div><span>${escapeHtml(item.message)}</span><em>${new Date(item.at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</em></div>`).join("") : `<div><span>아직 업무 로그가 없습니다.</span><em>대기</em></div>`}
          </div>
        </section>
        <section class="radar-ops-card">
          <div class="radar-ops-head"><div><strong>DB 연동 준비</strong><span>지금은 브라우저 저장입니다. 추후 Supabase로 옮길 수 있게 전체 백업 구조를 분리했습니다.</span></div></div>
          <p class="radar-ops-help">개인정보가 포함될 수 있는 대상자 명단은 현재 서버로 전송하지 않고 브라우저에만 저장됩니다. 기관 공유용으로 가려면 로그인과 DB 권한설정이 필요합니다.</p>
        </section>
      </aside>
    </div>
  `;

  panel.querySelector("#beneficiaryFile")?.addEventListener("change", handleFile);
  panel.querySelector("#loadBeneficiarySamples")?.addEventListener("click", sampleBeneficiaries);
  panel.querySelector("#clearBeneficiaries")?.addEventListener("click", clearBeneficiaries);
  panel.querySelector("#copyMatchReport")?.addEventListener("click", copyMatchText);
  panel.querySelector("#downloadMatchCsv")?.addEventListener("click", downloadMatchCsv);
  panel.querySelector("#downloadIcs")?.addEventListener("click", downloadIcs);
  panel.querySelector("#enhancedBackup")?.addEventListener("click", enhancedBackup);
}

function renderMatch(match) {
  return `
    <article class="radar-ops-result">
      <b>${escapeHtml(match.beneficiary.name)} → ${escapeHtml(match.resource.title || "제목 미정")}</b>
      <span>${escapeHtml(match.resource.agency || "기관 미기재")} · ${escapeHtml(match.resource.deadline || "마감 미정")} · 추천점수 ${match.score}</span>
      <div class="radar-ops-pills">${(match.reasons.length ? match.reasons : ["키워드 유사"]).map((reason) => `<i>${escapeHtml(reason)}</i>`).join("")}</div>
    </article>
  `;
}

function scheduleRender() {
  clearTimeout(scheduleRender.timer);
  scheduleRender.timer = setTimeout(renderOps, 160);
}

window.addEventListener("DOMContentLoaded", () => {
  renderOps();
  document.addEventListener("click", scheduleRender, true);
  document.addEventListener("input", scheduleRender, true);
  window.addEventListener("storage", scheduleRender);
  setInterval(renderOps, 2500);
});
