const STORAGE_KEY = "welfareResourceRadar.v1";
const AUTO_COLLECT_KEY = "welfareResourceRadar.lastAutoCollectDate";
const AUTO_COLLECT_ENABLED_KEY = "welfareResourceRadar.autoCollectDaily";
const ADMIN_MENU_KEY = "welfareResourceRadar.adminMenu";
const ADMIN_PIN_KEY = "welfareResourceRadar.adminPin";
const AUTO_SOURCES = ["chungbuk", "jecheonWelfare", "jecheonNotices", "bokjiro", "jecheonEmployment"];
const CATEGORIES = ["생계", "주거", "의료", "돌봄", "교육", "고용", "심리정서", "법률", "긴급지원", "기타"];
const STATUSES = ["검토 필요", "확인 완료", "신청 예정", "신청 완료", "보류", "종료"];
const TARGETS = ["전체", "독거노인", "장애인", "한부모", "아동·청소년", "청년", "중장년", "위기가구", "이주민", "노숙·주거취약"];

const state = loadState();
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

let inputMode = "url";
let lastCollected = [];
let lightboxItems = [];
let lightboxIndex = 0;

function uid() {
  return globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { resources: [], trash: [], blockedKeys: [], filters: {} };
  try {
    const parsed = JSON.parse(raw);
    const trash = Array.isArray(parsed.trash)
      ? parsed.trash.map((item) => ({
        ...normalizeResource(item),
        deletedAt: item.deletedAt || new Date().toISOString(),
        deletedReason: item.deletedReason || "manual"
      }))
      : [];
    const blockedKeys = new Set(Array.isArray(parsed.blockedKeys) ? parsed.blockedKeys : []);
    trash.forEach((item) => resourceKeys(item).forEach((key) => blockedKeys.add(key)));
    return {
      resources: Array.isArray(parsed.resources) ? parsed.resources.map(normalizeResource) : [],
      trash,
      blockedKeys: [...blockedKeys],
      filters: parsed.filters || {}
    };
  } catch {
    return { resources: [], trash: [], blockedKeys: [], filters: {} };
  }
}

function normalizeResource(item) {
  return {
    id: item.id || uid(),
    title: item.title || "제목 미정",
    agency: item.agency || "",
    category: CATEGORIES.includes(item.category) ? item.category : "기타",
    region: item.region || "전국",
    targets: Array.isArray(item.targets) ? item.targets : splitList(item.targets),
    deadline: item.deadline || "",
    contact: item.contact || "",
    summary: item.summary || "",
    applyMethod: item.applyMethod || "",
    tags: Array.isArray(item.tags) ? item.tags : splitList(item.tags),
    urgency: ["낮음", "보통", "높음"].includes(item.urgency) ? item.urgency : "보통",
    status: STATUSES.includes(item.status) ? item.status : "검토 필요",
    sourceUrl: item.sourceUrl || "",
    rawText: item.rawText || "",
    attachments: Array.isArray(item.attachments) ? item.attachments.map(normalizeAttachment) : [],
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
    important: Boolean(item.important),
    sample: Boolean(item.sample)
  };
}

function normalizeAttachment(file) {
  return {
    id: file.id || uid(),
    name: file.name || "첨부파일",
    type: file.type || "",
    size: Number(file.size || 0),
    dataUrl: file.dataUrl || "",
    url: file.url || ""
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function init() {
  fillSelects();
  bindEvents();
  initAutoCollectControl();
  initAdminMenu();
  archiveExpiredResources();
  renderAll();
  scheduleDailyAutoCollect();
  window.setInterval(() => {
    const archived = archiveExpiredResources();
    if (archived > 0) {
      renderAll();
      showToast(`마감이 지난 자원 ${archived}건을 휴지통으로 이동했습니다.`);
    }
  }, 60 * 60 * 1000);
}

function fillSelects() {
  fillOptions("#dashboardCategory", ["전체 분야", ...CATEGORIES]);
  fillOptions("#dashboardRegion", ["전체 지역", ...regions()]);
  fillOptions("#resourceCategory", ["전체 분야", ...CATEGORIES]);
  fillOptions("#resourceStatus", ["전체 상태", ...STATUSES]);
  fillOptions("#resourceUrgency", ["전체 긴급도", "높음", "보통", "낮음"]);
  fillOptions("#targetFocus", TARGETS);
  fillOptions("#manualCategory", CATEGORIES);
  fillOptions("#reviewCategory", CATEGORIES);
}

function fillOptions(selector, values) {
  const el = $(selector);
  el.innerHTML = values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
}

function bindEvents() {
  $$(".nav-button").forEach((button) => button.addEventListener("click", () => activateView(button.dataset.view)));
  $("#openCollect").addEventListener("click", () => activateView("collect"));
  $$(".mode-tab").forEach((button) => button.addEventListener("click", () => setInputMode(button.dataset.mode)));
  $("#analyzeSource").addEventListener("click", analyzeSource);
  $("#saveManual").addEventListener("click", saveManualDraft);
  $("#collectSources").addEventListener("click", collectSources);
  $("#collectPreview").addEventListener("click", renderSourcePreview);
  $("#autoCollectDaily").addEventListener("change", () => {
    localStorage.setItem(AUTO_COLLECT_ENABLED_KEY, $("#autoCollectDaily").checked ? "1" : "0");
  });
  $("#reviewAttachments").addEventListener("change", renderPendingAttachments);
  $("#reviewForm").addEventListener("submit", saveReviewResource);
  $("#clearReview").addEventListener("click", clearReview);
  ["globalSearch", "dashboardCategory", "dashboardRegion", "resourceCategory", "resourceStatus", "resourceUrgency", "targetFocus"].forEach((id) => {
    $(`#${id}`).addEventListener("input", renderAll);
  });
  $("#copyCategoryStats").addEventListener("click", () => copyText(categoryStatsText()));
  $("#copyDueList").addEventListener("click", () => copyText(dueListText()));
  $("#copyBrief").addEventListener("click", () => copyText(buildBrief()));
  $("#exportBriefTop").addEventListener("click", () => copyText(buildBrief()));
  $("#downloadCsv").addEventListener("click", downloadCsv);
  $("#exportJson").addEventListener("click", exportJson);
  $("#restoreJsonButton").addEventListener("click", () => $("#restoreJsonFile").click());
  $("#restoreJsonFile").addEventListener("change", restoreJson);
  $("#resetData").addEventListener("click", resetData);
  $("#clearBlockedKeys").addEventListener("click", clearBlockedKeys);
  $("#loadSamples").addEventListener("click", loadSamples);
  $("#clearSamples").addEventListener("click", clearSamples);
  $("#closeLightbox").addEventListener("click", closeImageLightbox);
  $("#closeLightboxBackdrop").addEventListener("click", closeImageLightbox);
  $("#prevLightbox").addEventListener("click", () => moveLightbox(-1));
  $("#nextLightbox").addEventListener("click", () => moveLightbox(1));
  $("#toggleAdminMenu").addEventListener("click", toggleAdminMenu);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeImageLightbox();
    if (!$("#imageLightbox").hidden && event.key === "ArrowLeft") moveLightbox(-1);
    if (!$("#imageLightbox").hidden && event.key === "ArrowRight") moveLightbox(1);
  });
}

function initAutoCollectControl() {
  if (localStorage.getItem(AUTO_COLLECT_ENABLED_KEY) === null) {
    localStorage.setItem(AUTO_COLLECT_ENABLED_KEY, "1");
  }
  $("#autoCollectDaily").checked = localStorage.getItem(AUTO_COLLECT_ENABLED_KEY) !== "0";
}

function initAdminMenu() {
  setAdminMenu(localStorage.getItem(ADMIN_MENU_KEY) === "1");
}

function toggleAdminMenu() {
  const enabled = localStorage.getItem(ADMIN_MENU_KEY) === "1";
  if (enabled) {
    setAdminMenu(false);
    return;
  }
  if (requestAdminAccess()) setAdminMenu(true);
}

function setAdminMenu(enabled) {
  localStorage.setItem(ADMIN_MENU_KEY, enabled ? "1" : "0");
  $$(".admin-only").forEach((item) => {
    item.hidden = !enabled;
  });
  $("#toggleAdminMenu").textContent = enabled ? "관리자 모드 종료" : "관리자 모드";
  if (!enabled && ["brief", "settings"].includes($(".nav-button.active")?.dataset.view)) {
    activateView("dashboard");
  }
}

function requestAdminAccess() {
  const savedPin = localStorage.getItem(ADMIN_PIN_KEY);
  if (!savedPin) {
    const newPin = prompt("관리자 PIN을 설정하세요.");
    if (!newPin) return false;
    localStorage.setItem(ADMIN_PIN_KEY, newPin);
    return true;
  }
  return prompt("관리자 PIN을 입력하세요.") === savedPin;
}

function scheduleDailyAutoCollect() {
  if (localStorage.getItem(AUTO_COLLECT_ENABLED_KEY) === "0") return;
  const today = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem(AUTO_COLLECT_KEY) === today) return;
  window.setTimeout(async () => {
    const added = await runSourceCollection(AUTO_SOURCES, { silent: true });
    localStorage.setItem(AUTO_COLLECT_KEY, today);
    if (added > 0) showToast(`오늘 새 복지자료 ${added}건을 자동 수집했습니다.`);
  }, 900);
}

async function collectSources() {
  const sources = $$(".source-check:checked").map((input) => input.value);
  if (!sources.length) {
    showToast("수집할 사이트를 선택하세요.");
    return;
  }
  await runSourceCollection(sources, { silent: false });
}

async function runSourceCollection(sources, options = {}) {
  const silent = Boolean(options.silent);
  $("#collectSources").disabled = true;
  $("#sourceCollectStatus").textContent = silent ? "자동 수집 중" : "수집 중";
  if (!silent) $("#sourcePreview").innerHTML = emptyState("사이트 자료를 읽고 정리하는 중입니다.");
  try {
    const response = await fetch("/api/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources, limitPerSource: 30 })
    });
    if (!response.ok) throw new Error(await response.text());
    const result = await response.json();
    lastCollected = (result.resources || []).filter((item) => !isExpired(item));
    const added = addCollectedResources(lastCollected);
    const failed = Array.isArray(result.errors) ? result.errors : [];
    $("#sourceCollectStatus").textContent = failed.length ? `${added}건 추가 · ${failed.length}곳 확인 필요` : `${added}건 추가`;
    renderAll();
    renderSourcePreview();
    if (!silent) {
      const suffix = failed.length ? ` (${failed.map((item) => item.name || item.source).join(", ")} 확인 필요)` : "";
      showToast(`자동 수집 완료: ${added}건을 새로 추가했습니다.${suffix}`);
    }
    return added;
  } catch (error) {
    $("#sourceCollectStatus").textContent = "실패";
    if (!silent) $("#sourcePreview").innerHTML = emptyState("수집 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.");
    return 0;
  } finally {
    $("#collectSources").disabled = false;
  }
}

function addCollectedResources(resources) {
  const known = new Set([
    ...state.blockedKeys,
    ...state.resources.flatMap(resourceKeys)
  ]);
  let added = 0;
  resources.forEach((item) => {
    const resource = normalizeResource({ ...item, status: "검토 필요" });
    if (isExpired(resource)) return;
    const keys = resourceKeys(resource);
    if (!keys.length || keys.some((key) => known.has(key))) return;
    state.resources.unshift(resource);
    keys.forEach((key) => known.add(key));
    added += 1;
  });
  if (added) saveState();
  return added;
}

function renderSourcePreview() {
  const items = lastCollected.length ? lastCollected : state.resources.slice(0, 30);
  $("#sourcePreview").innerHTML = items.length ? items.slice(0, 30).map((item) => `
    <div class="source-preview-card">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.agency || item.category || "출처 미기재")} · ${escapeHtml(item.deadline || "마감 미정")}</span>
      <p>${escapeHtml(item.summary || item.rawText || "요약 없음")}</p>
      ${item.applyMethod ? `<span>신청: ${escapeHtml(item.applyMethod)}</span>` : ""}
      ${item.sourceUrl ? `<a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener">원문 보기</a>` : ""}
    </div>
  `).join("") : emptyState("아직 수집 결과가 없습니다.");
}

function activateView(view) {
  $$(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $$(".view").forEach((section) => section.classList.remove("active"));
  $(`#${view}View`).classList.add("active");
  if (view === "brief") $("#briefOutput").value = buildBrief();
}

function setInputMode(mode) {
  inputMode = mode;
  $$(".mode-tab").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  $$(".input-mode").forEach((section) => section.classList.remove("active"));
  $(`#${mode}Mode`).classList.add("active");
}

async function analyzeSource() {
  let payload;
  $("#analyzeSource").disabled = true;
  $("#analyzeSource").textContent = "정리 중";
  try {
    payload = inputMode === "document" ? await documentPayload() : sourcePayload();
    if (!payload.url && !payload.text && inputMode !== "manual") {
      showToast(inputMode === "document" ? "한글파일을 선택하세요." : "정리할 URL 또는 텍스트를 입력하세요.");
      return;
    }
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(await response.text());
    const result = await response.json();
    showReview(normalizeResource({
      ...result.resource,
      id: "",
      sourceUrl: payload.url || result.resource?.sourceUrl || "",
      rawText: result.rawText || payload.text || payload.manualText || ""
    }), result.confidence || "확인 필요");
    showToast("핵심 정보를 정리했습니다. 저장 전 한 번 확인하세요.");
  } catch (error) {
    if (payload) {
      const fallback = fallbackAnalyze(payload);
      showReview(fallback, "AI 연결 실패, 기본 추출");
      showToast("AI 정리에 실패해 기본 추출 결과를 만들었습니다.");
    } else {
      $("#documentStatus").textContent = error.message || "한글파일을 읽지 못했습니다.";
      showToast(error.message || "한글파일을 읽지 못했습니다.");
    }
  } finally {
    $("#analyzeSource").disabled = false;
    $("#analyzeSource").textContent = "AI로 정리";
  }
}

async function documentPayload() {
  const file = $("#sourceDocument").files[0];
  if (!file) return { mode: "text", text: "" };
  if (file.size > 15 * 1024 * 1024) throw new Error("15MB 이하의 문서 파일을 선택하세요.");
  $("#documentStatus").textContent = `${file.name} 본문을 읽는 중입니다.`;
  let text = "";
  let format = "";
  if (file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf") {
    format = "pdf";
    text = await extractPdfText(file);
  } else {
    const module = await import("./vendor/hwpxjs.browser.mjs");
    const bytes = new Uint8Array(await file.arrayBuffer());
    format = module.detectFormat(bytes);
    if (format === "hwp") {
      text = await module.hwpToText(bytes);
    } else if (format === "hwpx") {
      const reader = new module.HwpxReader();
      await reader.loadFromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      text = await reader.extractText();
    } else if (format === "hwp3") {
      throw new Error("한글 3.0 문서는 HWPX로 변환한 뒤 다시 시도하세요.");
    } else {
      throw new Error("지원하는 HWP, HWPX 또는 PDF 파일이 아닙니다.");
    }
  }
  const cleaned = String(text || "").replace(/\u0000/g, "").trim();
  if (cleaned.length < 10) {
    throw new Error(format === "pdf"
      ? "PDF에서 글자를 찾지 못했습니다. 스캔본은 OCR 처리 후 다시 시도하세요."
      : "문서에서 읽을 수 있는 본문을 찾지 못했습니다.");
  }
  $("#documentStatus").textContent = `${file.name} · 본문 ${formatNumber(cleaned.length)}자 추출 완료`;
  return {
    mode: "text",
    text: `[파일명: ${file.name}]\n${cleaned}`
  };
}

async function extractPdfText(file) {
  const pdfjs = await import("./vendor/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.mjs", window.location.href).href;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({ data: bytes }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str || "").join(" ").replace(/\s+/g, " ").trim();
    if (text) pages.push(`[${pageNumber}쪽]\n${text}`);
  }
  return pages.join("\n\n");
}

function sourcePayload() {
  if (inputMode === "url") return { mode: "url", url: $("#sourceUrl").value.trim() };
  if (inputMode === "text") return { mode: "text", text: $("#sourceText").value.trim() };
  return { mode: "manual", text: manualText(), resource: manualResource() };
}

function manualText() {
  const item = manualResource();
  return Object.entries(item).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`).join("\n");
}

function manualResource() {
  return normalizeResource({
    title: $("#manualTitle").value.trim(),
    agency: $("#manualAgency").value.trim(),
    category: $("#manualCategory").value,
    region: $("#manualRegion").value.trim(),
    targets: splitList($("#manualTargets").value),
    deadline: $("#manualDeadline").value,
    summary: $("#manualSummary").value.trim()
  });
}

function fallbackAnalyze(payload) {
  const text = payload.text || payload.manualText || payload.resource?.summary || payload.url || "";
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "새 복지자원";
  return normalizeResource({
    ...payload.resource,
    title: payload.resource?.title || firstLine.slice(0, 70),
    category: guessCategory(text),
    region: guessRegion(text),
    targets: guessTargets(text),
    deadline: guessDeadline(text),
    contact: guessContact(text),
    summary: payload.resource?.summary || summarizePlainText(text),
    tags: [...new Set([guessCategory(text), ...guessTargets(text)].filter(Boolean))],
    rawText: text,
    sourceUrl: payload.url || ""
  });
}

function saveManualDraft() {
  showReview(manualResource(), "직접 입력");
}

function showReview(resource, confidence) {
  $("#reviewPanel").hidden = false;
  $("#reviewId").value = resource.id || "";
  $("#reviewTitle").value = resource.title || "";
  $("#reviewAgency").value = resource.agency || "";
  $("#reviewCategory").value = resource.category || "기타";
  $("#reviewRegion").value = resource.region || "전국";
  $("#reviewUrgency").value = resource.urgency || "보통";
  $("#reviewDeadline").value = resource.deadline || "";
  $("#reviewTargets").value = resource.targets.join(", ");
  $("#reviewContact").value = resource.contact || "";
  $("#reviewSummary").value = resource.summary || "";
  $("#reviewApply").value = resource.applyMethod || "";
  $("#reviewTags").value = resource.tags.join(", ");
  $("#reviewRaw").value = resource.rawText || "";
  $("#reviewAttachments").value = "";
  renderAttachmentPreview(resource.attachments || []);
  updateAttachmentCount(resource.attachments || []);
  $("#reviewConfidence").textContent = confidence;
  $("#reviewTitle").focus();
}

async function saveReviewResource(event) {
  event.preventDefault();
  const id = $("#reviewId").value || uid();
  const existing = state.resources.find((item) => item.id === id);
  const uploadedAttachments = await readSelectedAttachments();
  const resource = normalizeResource({
    id,
    title: $("#reviewTitle").value.trim(),
    agency: $("#reviewAgency").value.trim(),
    category: $("#reviewCategory").value,
    region: $("#reviewRegion").value.trim(),
    urgency: $("#reviewUrgency").value,
    deadline: $("#reviewDeadline").value,
    targets: splitList($("#reviewTargets").value),
    contact: $("#reviewContact").value.trim(),
    summary: $("#reviewSummary").value.trim(),
    applyMethod: $("#reviewApply").value.trim(),
    tags: splitList($("#reviewTags").value),
    rawText: $("#reviewRaw").value.trim(),
    attachments: [...(existing?.attachments || []), ...uploadedAttachments],
    sourceUrl: $("#sourceUrl").value.trim() || existing?.sourceUrl || "",
    status: existing?.status || "검토 필요",
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    important: existing?.important || false,
    sample: existing?.sample || false
  });
  const index = state.resources.findIndex((item) => item.id === id);
  if (index >= 0) state.resources[index] = resource;
  else state.resources.unshift(resource);
  saveState();
  clearReview();
  renderAll();
  activateView("resources");
  showToast("복지자원을 저장했습니다.");
}

function clearReview() {
  $("#reviewForm").reset();
  renderAttachmentPreview([]);
  updateAttachmentCount([]);
  $("#reviewPanel").hidden = true;
}

function renderAll() {
  archiveExpiredResources();
  const selectedRegion = $("#dashboardRegion").value;
  fillOptions("#dashboardRegion", ["전체 지역", ...regions()]);
  if (regions().includes(selectedRegion)) $("#dashboardRegion").value = selectedRegion;
  renderDashboard();
  renderResources();
  renderImportantResources();
  renderTrash();
  $("#briefOutput").value = buildBrief();
}

function renderTrash() {
  $("#trashCount").textContent = formatNumber(state.trash.length);
  $("#blockedCount").textContent = formatNumber(state.blockedKeys.length);
  $("#trashList").innerHTML = state.trash.length ? state.trash
    .slice()
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
    .map((item) => `
      <article class="resource-card trash-card">
        <div class="resource-head">
          <div>
            <h3 class="resource-title">${escapeHtml(item.title)}</h3>
            <div class="resource-meta">
              <span>${escapeHtml(item.agency || "기관 미기재")}</span>
              <span>${escapeHtml(item.category)}</span>
              <span>${escapeHtml(item.region)}</span>
              <span>${item.deletedReason === "expired" ? "마감 자동 이동" : "삭제"} ${escapeHtml(new Date(item.deletedAt).toLocaleString("ko-KR"))}</span>
            </div>
          </div>
          <span class="status-chip">재수집 차단</span>
        </div>
        <p class="resource-summary">${escapeHtml(item.summary || "요약 없음")}</p>
        <div class="resource-actions">
          <button class="primary-button restore-resource" type="button" data-id="${escapeHtml(item.id)}">복원</button>
          <button class="danger-button purge-resource" type="button" data-id="${escapeHtml(item.id)}">영구 삭제</button>
        </div>
      </article>
    `).join("") : emptyState("휴지통이 비어 있습니다.");
  $$(".restore-resource").forEach((button) => button.addEventListener("click", () => restoreResource(button.dataset.id)));
  $$(".purge-resource").forEach((button) => button.addEventListener("click", () => purgeResource(button.dataset.id)));
}

function filteredResources() {
  const query = $("#globalSearch").value.trim().toLowerCase();
  const category = $("#resourceCategory").value;
  const status = $("#resourceStatus").value;
  const urgency = $("#resourceUrgency").value;
  return state.resources.filter((item) => {
    const text = [item.title, item.agency, item.category, item.region, item.summary, item.targets.join(" "), item.tags.join(" ")].join(" ").toLowerCase();
    return (!query || text.includes(query))
      && (category === "전체 분야" || !category || item.category === category)
      && (status === "전체 상태" || !status || item.status === status)
      && (urgency === "전체 긴급도" || !urgency || item.urgency === urgency);
  });
}

function dashboardResources() {
  const category = $("#dashboardCategory").value;
  const region = $("#dashboardRegion").value;
  const query = $("#globalSearch").value.trim().toLowerCase();
  return state.resources.filter((item) => {
    const text = [item.title, item.agency, item.region, item.summary, item.targets.join(" "), item.tags.join(" ")].join(" ").toLowerCase();
    return (!query || text.includes(query))
      && (category === "전체 분야" || !category || item.category === category)
      && (region === "전체 지역" || !region || item.region === region);
  });
}

function renderDashboard() {
  const items = dashboardResources();
  $("#metricTotal").textContent = formatNumber(items.length);
  $("#metricDue").textContent = formatNumber(items.filter(isDueSoon).length);
  $("#metricUrgent").textContent = formatNumber(items.filter((item) => item.urgency === "높음").length);
  $("#metricNeedsReview").textContent = formatNumber(items.filter((item) => item.status === "검토 필요").length);
  renderCollectionOverview(items);
  renderCategoryBars(items);
  renderDueList(items);
  renderRecommendations(items);
}

function renderCollectionOverview(items) {
  const reviewed = items.filter((item) => item.status !== "검토 필요").length;
  const attached = items.filter((item) => item.attachments?.length).length;
  const recent = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
  const reviewRate = items.length ? Math.round((reviewed / items.length) * 100) : 0;
  const lastAutoDate = localStorage.getItem(AUTO_COLLECT_KEY) || "기록 없음";
  $("#collectionHealth").textContent = items.length ? `검토율 ${reviewRate}%` : "대기";
  $("#collectionOverview").innerHTML = `
    <div class="collection-stat">
      <span>마지막 자동 수집</span>
      <strong>${escapeHtml(lastAutoDate)}</strong>
      <small>${localStorage.getItem(AUTO_COLLECT_ENABLED_KEY) === "0" ? "자동 수집 꺼짐" : "매일 첫 접속 시 실행"}</small>
    </div>
    <div class="collection-stat">
      <span>검토 완료/진행</span>
      <strong>${formatNumber(reviewed)} / ${formatNumber(items.length)}</strong>
      <div class="mini-progress"><i style="width:${reviewRate}%"></i></div>
    </div>
    <div class="collection-stat">
      <span>첨부 보유 자원</span>
      <strong>${formatNumber(attached)}건</strong>
      <small>캡처·공고 이미지·파일 포함</small>
    </div>
    <div class="collection-recent">
      <span>최근 수집/등록</span>
      ${recent.length ? recent.map((item) => `
        <button class="recent-resource-link" type="button" data-resource-id="${escapeHtml(item.id)}">
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.category)} · ${escapeHtml(item.agency || "기관 미기재")}</small>
        </button>
      `).join("") : `<div class="compact-item"><span>최근 등록된 자원이 없습니다.</span></div>`}
    </div>
  `;
  $$(".recent-resource-link").forEach((button) => {
    button.addEventListener("click", () => focusResource(button.dataset.resourceId));
  });
}

function renderCategoryBars(items) {
  const counts = CATEGORIES.map((category) => ({
    category,
    count: items.filter((item) => item.category === category).length
  })).filter((item) => item.count > 0);
  const max = Math.max(1, ...counts.map((item) => item.count));
  $("#categoryBars").innerHTML = counts.length ? counts.map((item) => `
    <div class="bar-row">
      <span>${escapeHtml(item.category)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(item.count / max) * 100}%"></div></div>
      <strong>${item.count}</strong>
    </div>
  `).join("") : emptyState("등록된 자원이 없습니다.");
}

function renderDueList(items) {
  const due = [...items].filter((item) => item.deadline).sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 6);
  $("#dueList").innerHTML = due.length ? due.map((item) => `
    <div class="compact-item">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.agency || "기관 미기재")} · ${escapeHtml(item.deadline)} · ${escapeHtml(daysLeftText(item.deadline))}</span>
    </div>
  `).join("") : emptyState("마감일이 등록된 자원이 없습니다.");
}

function renderRecommendations(items) {
  const target = $("#targetFocus").value || "전체";
  const matched = items
    .filter((item) => target === "전체" || item.targets.some((value) => value.includes(target) || target.includes(value)))
    .sort(resourcePriority)
    .slice(0, 6);
  $("#recommendations").innerHTML = matched.length ? matched.map((item) => `
    <article class="recommendation-card">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.category)} · ${escapeHtml(item.region)} · ${escapeHtml(item.urgency)}</span>
      <p>${escapeHtml(item.summary || "요약 없음")}</p>
    </article>
  `).join("") : emptyState("선택한 대상에 맞는 자원이 없습니다.");
}

function renderResources() {
  const items = filteredResources().sort(resourcePriority);
  renderResourceCategorySummary(items);
  $("#resourceList").innerHTML = items.length ? resourceCategoryGroups(items) : emptyState("조건에 맞는 자원이 없습니다.");
  $$(".edit-resource").forEach((button) => button.addEventListener("click", () => editResource(button.dataset.id)));
  $$(".delete-resource").forEach((button) => button.addEventListener("click", () => deleteResource(button.dataset.id)));
  $$("#resourceList .toggle-important").forEach((button) => button.addEventListener("click", () => toggleImportant(button.dataset.id)));
  $$(".status-select").forEach((select) => select.addEventListener("change", () => updateStatus(select.dataset.id, select.value)));
  $$(".resource-attachment-input").forEach((input) => input.addEventListener("change", () => addResourceAttachments(input.dataset.id, input.files)));
  $$(".paste-capture-button").forEach((button) => button.addEventListener("click", () => pasteClipboardCapture(button.dataset.id)));
  $$(".paste-capture-zone").forEach((zone) => zone.addEventListener("paste", (event) => handleCapturePaste(event, zone.dataset.id)));
  $$(".attachment-order-item").forEach((item) => {
    item.addEventListener("dragstart", handleAttachmentDragStart);
    item.addEventListener("dragover", handleAttachmentDragOver);
    item.addEventListener("dragleave", handleAttachmentDragLeave);
    item.addEventListener("drop", handleAttachmentDrop);
    item.addEventListener("dragend", handleAttachmentDragEnd);
  });
  $$(".attachment-slide img").forEach((image) => image.addEventListener("click", () => {
    const gallery = image.closest(".attachment-slides");
    const images = Array.from(gallery?.querySelectorAll("img") || []);
    openImageLightbox(images.map((item) => ({ src: item.src, title: item.alt })), images.indexOf(image));
  }));
}

function renderResourceCategorySummary(items) {
  const total = Math.max(1, items.length);
  const selectedCategory = $("#resourceCategory").value;
  const counts = CATEGORIES.map((category) => {
    const categoryItems = items.filter((item) => item.category === category);
    return {
      category,
      count: categoryItems.length,
      urgent: categoryItems.filter((item) => item.urgency === "높음").length,
      due: categoryItems.filter(isDueSoon).length
    };
  }).filter((item) => item.count > 0);
  $("#resourceCategorySummary").innerHTML = counts.length ? `
    <button class="category-filter-card ${selectedCategory === "전체 분야" ? "active" : ""}" type="button" data-category="전체 분야">
      <span>전체 분야</span>
      <strong>${formatNumber(items.length)}건</strong>
      <i style="width:100%"></i>
      <small>현재 필터 결과 전체</small>
    </button>
    ${counts.map((item) => `
    <button class="category-filter-card ${selectedCategory === item.category ? "active" : ""}" type="button" data-category="${escapeHtml(item.category)}">
      <span>${escapeHtml(item.category)}</span>
      <strong>${formatNumber(item.count)}건</strong>
      <i style="width:${Math.round((item.count / total) * 100)}%"></i>
      <small>긴급 ${formatNumber(item.urgent)} · 7일 내 ${formatNumber(item.due)}</small>
    </button>
  `).join("")}` : "";
  $$(".category-filter-card").forEach((button) => {
    button.addEventListener("click", () => {
      $("#resourceCategory").value = button.dataset.category;
      renderAll();
    });
  });
}

function resourceCategoryGroups(items) {
  return CATEGORIES.map((category) => {
    const categoryItems = items.filter((item) => item.category === category);
    if (!categoryItems.length) return "";
    const urgent = categoryItems.filter((item) => item.urgency === "높음").length;
    const due = categoryItems.filter(isDueSoon).length;
    return `
      <details class="resource-group" open>
        <summary>
          <span>${escapeHtml(category)}</span>
          <strong>${formatNumber(categoryItems.length)}건</strong>
          <em>긴급 ${formatNumber(urgent)} · 7일 내 마감 ${formatNumber(due)}</em>
        </summary>
        <div class="resource-group-list">
          ${categoryItems.map(resourceCard).join("")}
        </div>
      </details>
    `;
  }).join("");
}

function resourceCard(item) {
  const statusOptions = STATUSES.map((status) => `<option ${status === item.status ? "selected" : ""}>${escapeHtml(status)}</option>`).join("");
  const source = item.sourceUrl ? `<a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener">원문 열기</a>` : "";
  const inputId = `attach-${item.id}`;
  const imageAttachments = (item.attachments || []).filter(isImageAttachment);
  return `
    <article class="resource-card" data-resource-id="${escapeHtml(item.id)}">
      <div class="resource-head">
        <div>
          <h3 class="resource-title">${escapeHtml(item.title)}</h3>
          <div class="resource-meta">
            <span>${escapeHtml(item.agency || "기관 미기재")}</span>
            <span>${escapeHtml(item.category)}</span>
            <span>${escapeHtml(item.region)}</span>
            <span>${escapeHtml(item.deadline ? `${item.deadline} ${daysLeftText(item.deadline)}` : "상시/미정")}</span>
            <span>${escapeHtml(item.urgency)}</span>
          </div>
        </div>
        <select class="status-select" data-id="${item.id}" aria-label="상태 변경">${statusOptions}</select>
      </div>
      <p class="resource-summary">${escapeHtml(item.summary || "요약 없음")}</p>
      <div class="resource-tags">
        ${item.targets.map((target) => `<span>${escapeHtml(target)}</span>`).join("")}
        ${item.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("")}
      </div>
      <div class="resource-meta">
        ${item.contact ? `<span>연락처 ${escapeHtml(item.contact)}</span>` : ""}
        ${item.applyMethod ? `<span>신청 ${escapeHtml(item.applyMethod)}</span>` : ""}
        ${item.attachments?.length ? `<span>첨부 ${item.attachments.length}개</span>` : ""}
        ${source ? `<span>${source}</span>` : ""}
      </div>
      ${imageAttachments.length ? attachmentSlides(imageAttachments) : ""}
      ${item.attachments?.length ? attachmentOrderList(item) : ""}
      <div class="resource-actions">
        <button class="important-button toggle-important ${item.important ? "active" : ""}" type="button" data-id="${item.id}" aria-pressed="${item.important}" aria-label="${item.important ? "중요 자원 해제" : "중요 자원으로 표시"}">${item.important ? "★ 중요" : "☆ 중요"}</button>
        <input id="${escapeHtml(inputId)}" class="sr-only resource-attachment-input" type="file" multiple data-id="${escapeHtml(item.id)}" accept="image/*,application/pdf,.hwp,.hwpx,.doc,.docx,.xls,.xlsx,.ppt,.pptx">
        <label class="attachment-button compact-attach-button" for="${escapeHtml(inputId)}">캡처/첨부 추가</label>
        <button class="ghost-button paste-capture-button" type="button" data-id="${escapeHtml(item.id)}">캡처 붙여넣기</button>
        <button class="ghost-button edit-resource" type="button" data-id="${item.id}">수정</button>
        <button class="danger-button delete-resource" type="button" data-id="${item.id}">삭제</button>
      </div>
      <div class="paste-capture-zone" tabindex="0" data-id="${escapeHtml(item.id)}">캡처한 화면은 여기에 Ctrl+V</div>
    </article>
  `;
}

function renderImportantResources() {
  const items = state.resources.filter((item) => item.important).sort(resourcePriority);
  $("#importantCount").textContent = formatNumber(items.length);
  $("#importantList").innerHTML = items.length ? items.map((item) => `
    <article class="resource-card important-card" data-resource-id="${escapeHtml(item.id)}">
      <div class="resource-head">
        <div>
          <h3 class="resource-title">${escapeHtml(item.title)}</h3>
          <div class="resource-meta">
            <span>${escapeHtml(item.agency || "기관 미기재")}</span>
            <span>${escapeHtml(item.category)}</span>
            <span>${escapeHtml(item.region)}</span>
            <span>${escapeHtml(item.deadline ? `${item.deadline} ${daysLeftText(item.deadline)}` : "상시/미정")}</span>
          </div>
        </div>
        <span class="important-badge">★ 중요</span>
      </div>
      <p class="resource-summary">${escapeHtml(item.summary || "요약 없음")}</p>
      <div class="resource-actions">
        <button class="ghost-button open-important-resource" type="button" data-id="${escapeHtml(item.id)}">자원 보기</button>
        <button class="important-button active toggle-important" type="button" data-id="${escapeHtml(item.id)}">★ 중요 해제</button>
      </div>
    </article>
  `).join("") : emptyState("중요 자원으로 표시한 항목이 없습니다.");
  $$("#importantList .toggle-important").forEach((button) => button.addEventListener("click", () => toggleImportant(button.dataset.id)));
  $$(".open-important-resource").forEach((button) => button.addEventListener("click", () => focusResource(button.dataset.id)));
}

function focusResource(id) {
  const item = state.resources.find((resource) => resource.id === id);
  if (!item) return;
  $("#resourceCategory").value = item.category;
  $("#resourceStatus").value = "전체 상태";
  $("#resourceUrgency").value = "전체 긴급도";
  activateView("resources");
  renderAll();
  window.setTimeout(() => {
    const card = $(`.resource-card[data-resource-id="${cssEscape(id)}"]`);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    card?.classList.add("resource-card-focus");
    window.setTimeout(() => card?.classList.remove("resource-card-focus"), 1600);
  }, 50);
}

function attachmentOrderList(item) {
  return `
    <div class="attachment-order-list" aria-label="첨부파일 순서">
      ${(item.attachments || []).map((file, index) => `
        <div class="attachment-order-item" draggable="true" data-resource-id="${escapeHtml(item.id)}" data-attachment-id="${escapeHtml(file.id)}">
          <span class="drag-handle" aria-hidden="true">↕</span>
          <span class="attachment-order-number">${index + 1}</span>
          ${attachmentLink(file)}
          <span class="attachment-size">${formatFileSize(file.size)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

async function addResourceAttachments(id, fileList) {
  const item = state.resources.find((resource) => resource.id === id);
  if (!item) return;
  const uploadedAttachments = await readFiles(fileList);
  if (!uploadedAttachments.length) return;
  item.attachments = [...(item.attachments || []), ...uploadedAttachments];
  item.updatedAt = new Date().toISOString();
  saveState();
  renderAll();
  showToast(`${uploadedAttachments.length}개 파일을 첨부했습니다.`);
}

async function pasteClipboardCapture(id) {
  const pasted = await readClipboardImages();
  if (pasted.length) {
    addAttachmentsToResource(id, pasted);
    showToast(`${pasted.length}개 캡처 화면을 붙여넣었습니다.`);
    return;
  }
  const zone = $(`.paste-capture-zone[data-id="${cssEscape(id)}"]`);
  zone?.focus();
  showToast("캡처한 뒤 Ctrl+V로 붙여넣으세요.");
}

async function handleCapturePaste(event, id) {
  const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  event.preventDefault();
  const pasted = await readFiles(files);
  addAttachmentsToResource(id, pasted);
  showToast(`${pasted.length}개 캡처 화면을 붙여넣었습니다.`);
}

function addAttachmentsToResource(id, attachments) {
  const item = state.resources.find((resource) => resource.id === id);
  if (!item || !attachments.length) return;
  item.attachments = [...(item.attachments || []), ...attachments];
  item.updatedAt = new Date().toISOString();
  saveState();
  renderAll();
}

function handleAttachmentDragStart(event) {
  event.currentTarget.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", JSON.stringify({
    resourceId: event.currentTarget.dataset.resourceId,
    attachmentId: event.currentTarget.dataset.attachmentId
  }));
}

function handleAttachmentDragOver(event) {
  event.preventDefault();
  event.currentTarget.classList.add("drag-over");
  event.dataTransfer.dropEffect = "move";
}

function handleAttachmentDragLeave(event) {
  event.currentTarget.classList.remove("drag-over");
}

function handleAttachmentDrop(event) {
  event.preventDefault();
  event.currentTarget.classList.remove("drag-over");
  const payload = dragPayload(event);
  const targetResourceId = event.currentTarget.dataset.resourceId;
  const targetAttachmentId = event.currentTarget.dataset.attachmentId;
  if (!payload || payload.resourceId !== targetResourceId || payload.attachmentId === targetAttachmentId) return;
  reorderAttachment(targetResourceId, payload.attachmentId, targetAttachmentId);
}

function handleAttachmentDragEnd() {
  $$(".attachment-order-item").forEach((item) => item.classList.remove("dragging", "drag-over"));
}

function dragPayload(event) {
  try {
    return JSON.parse(event.dataTransfer.getData("text/plain") || "{}");
  } catch {
    return null;
  }
}

function reorderAttachment(resourceId, movedId, targetId) {
  const item = state.resources.find((resource) => resource.id === resourceId);
  if (!item?.attachments?.length) return;
  const from = item.attachments.findIndex((file) => file.id === movedId);
  const to = item.attachments.findIndex((file) => file.id === targetId);
  if (from < 0 || to < 0 || from === to) return;
  const [moved] = item.attachments.splice(from, 1);
  item.attachments.splice(to, 0, moved);
  item.updatedAt = new Date().toISOString();
  saveState();
  renderAll();
  showToast("첨부파일 순서를 저장했습니다.");
}

async function readClipboardImages() {
  if (!navigator.clipboard?.read) return [];
  try {
    const items = await navigator.clipboard.read();
    const files = [];
    for (const item of items) {
      const imageType = item.types.find((type) => type.startsWith("image/"));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      files.push(new File([blob], `clipboard-${Date.now()}-${files.length + 1}.png`, { type: imageType }));
    }
    return readFiles(files);
  } catch {
    return [];
  }
}

function editResource(id) {
  const item = state.resources.find((resource) => resource.id === id);
  if (!item) return;
  showReview(item, "수정 중");
  activateView("collect");
}

function deleteResource(id) {
  const item = state.resources.find((resource) => resource.id === id);
  if (!item || !confirm(`"${item.title}" 자원을 휴지통으로 이동할까요?\n자동 수집에서도 다시 추가되지 않습니다.`)) return;
  const deleted = { ...item, deletedAt: new Date().toISOString(), deletedReason: "manual" };
  state.trash.unshift(deleted);
  const blocked = new Set(state.blockedKeys);
  resourceKeys(item).forEach((key) => blocked.add(key));
  state.blockedKeys = [...blocked];
  state.resources = state.resources.filter((resource) => resource.id !== id);
  saveState();
  renderAll();
  showToast("휴지통으로 이동하고 재수집을 차단했습니다.");
}

function archiveExpiredResources() {
  const expired = state.resources.filter(isExpired);
  if (!expired.length) return 0;
  const expiredIds = new Set(expired.map((item) => item.id));
  const blocked = new Set(state.blockedKeys);
  const deletedAt = new Date().toISOString();
  expired.forEach((item) => resourceKeys(item).forEach((key) => blocked.add(key)));
  state.trash = [
    ...expired.map((item) => ({ ...item, deletedAt, deletedReason: "expired" })),
    ...state.trash
  ];
  state.resources = state.resources.filter((item) => !expiredIds.has(item.id));
  state.blockedKeys = [...blocked];
  saveState();
  return expired.length;
}

function toggleImportant(id) {
  const item = state.resources.find((resource) => resource.id === id);
  if (!item) return;
  item.important = !item.important;
  item.updatedAt = new Date().toISOString();
  saveState();
  renderAll();
  showToast(item.important ? "중요 자원으로 표시했습니다." : "중요 표시를 해제했습니다.");
}

function restoreResource(id) {
  const item = state.trash.find((resource) => resource.id === id);
  if (!item) return;
  if (isExpired(item)) {
    showToast("마감이 지난 자원은 복원할 수 없습니다.");
    return;
  }
  const { deletedAt, ...restored } = item;
  state.trash = state.trash.filter((resource) => resource.id !== id);
  const restoredKeys = new Set(resourceKeys(item));
  const remainingTrashKeys = new Set(state.trash.flatMap(resourceKeys));
  state.blockedKeys = state.blockedKeys.filter((key) => !restoredKeys.has(key) || remainingTrashKeys.has(key));
  state.resources.unshift(normalizeResource({ ...restored, updatedAt: new Date().toISOString() }));
  saveState();
  renderAll();
  showToast("자원을 복원하고 재수집 차단을 해제했습니다.");
}

function purgeResource(id) {
  const item = state.trash.find((resource) => resource.id === id);
  if (!item || !confirm(`"${item.title}" 자원을 휴지통에서 영구 삭제할까요?\n재수집 차단 기록은 유지됩니다.`)) return;
  state.trash = state.trash.filter((resource) => resource.id !== id);
  saveState();
  renderAll();
  showToast("자원 내용은 삭제하고 재수집 차단 기록은 유지했습니다.");
}

function clearBlockedKeys() {
  const trashKeys = new Set(state.trash.flatMap(resourceKeys));
  const orphanCount = state.blockedKeys.filter((key) => !trashKeys.has(key)).length;
  if (!orphanCount) {
    showToast("해제할 영구 삭제 차단 기록이 없습니다.");
    return;
  }
  if (!confirm(`영구 삭제한 자원의 재수집 차단 기록 ${orphanCount}개를 해제할까요?\n다음 수집에서 다시 추가될 수 있습니다.`)) return;
  state.blockedKeys = [...trashKeys];
  saveState();
  renderAll();
  showToast("영구 삭제 자원의 재수집 차단을 해제했습니다.");
}

function updateStatus(id, status) {
  const item = state.resources.find((resource) => resource.id === id);
  if (!item) return;
  item.status = status;
  item.updatedAt = new Date().toISOString();
  saveState();
  renderAll();
}

function buildBrief() {
  const items = dashboardResources().sort(resourcePriority);
  const due = items.filter(isDueSoon);
  const urgent = items.filter((item) => item.urgency === "높음");
  const lines = [
    `[복지자원 브리핑] ${new Date().toLocaleDateString("ko-KR")}`,
    "",
    `- 전체 등록: ${items.length}건`,
    `- 7일 내 마감: ${due.length}건`,
    `- 고긴급: ${urgent.length}건`,
    `- 검토 필요: ${items.filter((item) => item.status === "검토 필요").length}건`,
    "",
    "1. 우선 확인 자원"
  ];
  [...new Set([...urgent, ...due])].slice(0, 8).forEach((item, index) => {
    lines.push(`${index + 1}) ${item.title} / ${item.agency || "기관 미기재"} / ${item.category} / ${item.deadline || "마감 미정"}`);
    lines.push(`   - 대상: ${item.targets.join(", ") || "미기재"}`);
    lines.push(`   - 요약: ${item.summary || "요약 없음"}`);
  });
  lines.push("", "2. 분야별 건수");
  lines.push(categoryStatsText(items));
  return lines.join("\n");
}

function categoryStatsText(items = dashboardResources()) {
  return CATEGORIES
    .map((category) => [category, items.filter((item) => item.category === category).length])
    .filter(([, count]) => count > 0)
    .map(([category, count]) => `- ${category}: ${count}건`)
    .join("\n") || "- 등록된 자원 없음";
}

function dueListText() {
  return dashboardResources()
    .filter((item) => item.deadline)
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
    .slice(0, 10)
    .map((item) => `- ${item.deadline} ${item.title} (${item.agency || "기관 미기재"})`)
    .join("\n") || "- 마감일 등록 자원 없음";
}

function downloadCsv() {
  const rows = [["제목", "기관", "분야", "지역", "대상", "마감일", "긴급도", "상태", "연락처", "요약", "신청방법", "원문URL", "첨부파일"]];
  state.resources.forEach((item) => rows.push([
    item.title, item.agency, item.category, item.region, item.targets.join("; "),
    item.deadline, item.urgency, item.status, item.contact, item.summary, item.applyMethod, item.sourceUrl,
    (item.attachments || []).map((file) => file.name).join("; ")
  ]));
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  downloadBlob("복지자원_목록.csv", new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
}

function renderPendingAttachments() {
  const files = Array.from($("#reviewAttachments").files || []).map((file) => ({
    name: file.name,
    size: file.size,
    type: file.type
  }));
  renderAttachmentPreview(files);
  updateAttachmentCount(files);
}

function renderAttachmentPreview(files) {
  $("#reviewAttachmentPreview").innerHTML = files.length ? files.map((file) => `
    <div class="attachment-chip">
      <span>${escapeHtml(file.name)}</span>
      <span>${formatFileSize(file.size)}</span>
    </div>
  `).join("") : "";
}

function updateAttachmentCount(files) {
  const count = Array.isArray(files) ? files.length : 0;
  $("#reviewAttachmentCount").textContent = count ? `${count}개 파일 선택됨` : "선택된 파일 없음";
}

async function readSelectedAttachments() {
  return readFiles($("#reviewAttachments").files);
}

async function readFiles(fileList) {
  const files = Array.from(fileList || []);
  return Promise.all(files.map((file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(normalizeAttachment({
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl: String(reader.result || "")
    }));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  })));
}

function attachmentSlides(files) {
  return `
    <div class="attachment-slides" aria-label="첨부 이미지 슬라이드">
      ${files.map((file, index) => `
        <figure class="attachment-slide">
          <img src="${escapeHtml(attachmentSource(file))}" alt="${escapeHtml(file.name)}" title="클릭해서 크게 보기">
          <figcaption>${index + 1}/${files.length} ${escapeHtml(file.name)}</figcaption>
        </figure>
      `).join("")}
    </div>
  `;
}

function openImageLightbox(items, index = 0) {
  lightboxItems = Array.isArray(items) ? items : [];
  lightboxIndex = Math.max(0, Math.min(index, lightboxItems.length - 1));
  $("#imageLightbox").hidden = false;
  document.body.classList.add("lightbox-open");
  renderLightboxImage();
}

function renderLightboxImage() {
  const item = lightboxItems[lightboxIndex];
  if (!item) return closeImageLightbox();
  $("#lightboxImage").src = item.src;
  $("#lightboxImage").alt = item.title || "첨부 이미지";
  $("#lightboxTitle").textContent = `${lightboxIndex + 1}/${lightboxItems.length} ${item.title || "첨부 이미지"}`;
  $("#prevLightbox").disabled = lightboxItems.length <= 1;
  $("#nextLightbox").disabled = lightboxItems.length <= 1;
}

function moveLightbox(direction) {
  if (lightboxItems.length <= 1) return;
  lightboxIndex = (lightboxIndex + direction + lightboxItems.length) % lightboxItems.length;
  renderLightboxImage();
}

function closeImageLightbox() {
  const lightbox = $("#imageLightbox");
  if (lightbox?.hidden) return;
  lightbox.hidden = true;
  $("#lightboxImage").src = "";
  lightboxItems = [];
  lightboxIndex = 0;
  document.body.classList.remove("lightbox-open");
}

function isImageAttachment(file) {
  return Boolean(
    file?.dataUrl?.startsWith("data:image/")
    || file?.type?.startsWith("image/")
    || /\.(png|jpe?g|gif|webp)\b/i.test(`${file?.name || ""} ${file?.url || ""}`)
  );
}

function attachmentLink(file) {
  const href = file.dataUrl || file.url;
  if (!href) return `<span>${escapeHtml(file.name)}</span>`;
  const download = file.dataUrl ? ` download="${escapeHtml(file.name)}"` : ` target="_blank" rel="noopener"`;
  return `<span><a href="${escapeHtml(href)}"${download}>${escapeHtml(file.name)}</a></span>`;
}

function attachmentSource(file) {
  return file?.dataUrl || file?.url || "";
}

function formatFileSize(size) {
  const value = Number(size || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function exportJson() {
  downloadBlob("복지자원_백업.json", new Blob([JSON.stringify(state, null, 2)], { type: "application/json;charset=utf-8" }));
}

function restoreJson() {
  const file = $("#restoreJsonFile").files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const restored = JSON.parse(String(reader.result || "{}"));
      state.resources = Array.isArray(restored.resources) ? restored.resources.map(normalizeResource) : [];
      state.trash = Array.isArray(restored.trash)
        ? restored.trash.map((item) => ({
          ...normalizeResource(item),
          deletedAt: item.deletedAt || new Date().toISOString(),
          deletedReason: item.deletedReason || "manual"
        }))
        : [];
      state.blockedKeys = Array.isArray(restored.blockedKeys) ? restored.blockedKeys : [];
      state.filters = restored.filters || {};
      saveState();
      renderAll();
      showToast("백업을 복원했습니다.");
    } catch {
      showToast("JSON 파일을 읽지 못했습니다.");
    }
  };
  reader.readAsText(file, "utf-8");
}

function resetData() {
  if (!confirm("모든 자원을 휴지통으로 이동할까요? 먼저 JSON 백업을 권장합니다.")) return;
  const deletedAt = new Date().toISOString();
  const blocked = new Set(state.blockedKeys);
  state.resources.forEach((item) => resourceKeys(item).forEach((key) => blocked.add(key)));
  state.trash = [...state.resources.map((item) => ({ ...item, deletedAt })), ...state.trash];
  state.blockedKeys = [...blocked];
  state.resources = [];
  saveState();
  renderAll();
}

function loadSamples() {
  const existing = new Set(state.resources.map((item) => item.title));
  sampleResources().forEach((item) => {
    if (!existing.has(item.title)) state.resources.unshift(normalizeResource({ ...item, sample: true }));
  });
  saveState();
  renderAll();
  showToast("샘플 자원을 불러왔습니다.");
}

function clearSamples() {
  state.resources = state.resources.filter((item) => !item.sample);
  saveState();
  renderAll();
}

function sampleResources() {
  const today = new Date();
  const date = (days) => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };
  return [
    { title: "긴급 생계비 소액 지원", agency: "지역복지재단", category: "긴급지원", region: "전국", targets: ["위기가구", "중장년"], deadline: date(5), urgency: "높음", summary: "갑작스러운 실직, 질병, 체납으로 생계 위기에 놓인 가구에 단기 생계비를 지원합니다.", applyMethod: "사례관리자 추천서와 증빙서류 이메일 제출", tags: ["생계", "체납"] },
    { title: "독거노인 식사 배달 연계", agency: "노인종합복지관", category: "돌봄", region: "서울", targets: ["독거노인"], deadline: "", urgency: "보통", summary: "결식 우려가 있는 독거노인에게 주 3회 도시락 배달과 안부 확인을 제공합니다.", applyMethod: "전화 상담 후 방문 사정", tags: ["식사", "안부확인"] },
    { title: "청년 마음건강 상담 바우처", agency: "보건복지 상담센터", category: "심리정서", region: "전국", targets: ["청년"], deadline: date(21), urgency: "보통", summary: "우울, 불안, 사회적 고립을 겪는 청년에게 전문 심리상담 비용 일부를 지원합니다.", applyMethod: "복지로 또는 주민센터 신청", tags: ["상담", "바우처"] },
    { title: "주거취약가구 임시거처 지원", agency: "주거복지센터", category: "주거", region: "경기", targets: ["노숙·주거취약", "위기가구"], deadline: date(2), urgency: "높음", summary: "퇴거 위기, 노숙 위험, 재난 피해 가구에 임시거처와 주거상담을 연계합니다.", applyMethod: "센터 전화 접수 후 현장 확인", tags: ["퇴거", "임시거처"] }
  ];
}

function guessCategory(text) {
  const rules = [
    ["주거", /주거|임대|월세|전세|퇴거|거처/],
    ["의료", /의료|병원|치료|진료|간병/],
    ["돌봄", /돌봄|요양|식사|도시락|안부/],
    ["교육", /교육|장학|학습|학교/],
    ["고용", /고용|취업|일자리|직업/],
    ["심리정서", /심리|상담|정서|우울|불안/],
    ["법률", /법률|소송|채무|파산|권리/],
    ["긴급지원", /긴급|위기|재난|응급/],
    ["생계", /생계|생활비|식비|체납|공과금/]
  ];
  return rules.find(([, regex]) => regex.test(text))?.[0] || "기타";
}

function guessRegion(text) {
  return ["전국", "서울", "경기", "인천", "부산", "대구", "광주", "대전", "울산", "세종", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"]
    .find((region) => text.includes(region)) || "전국";
}

function guessTargets(text) {
  return TARGETS.filter((target) => target !== "전체" && text.includes(target)).slice(0, 4);
}

function guessDeadline(text) {
  const match = text.match(/20\d{2}[./-]\d{1,2}[./-]\d{1,2}/);
  if (!match) return "";
  const parts = match[0].replace(/[.]/g, "-").split("-").map((part) => part.padStart(2, "0"));
  return `${parts[0]}-${parts[1]}-${parts[2]}`;
}

function guessContact(text) {
  return text.match(/\d{2,4}-\d{3,4}-\d{4}/)?.[0] || "";
}

function summarizePlainText(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, 180);
}

function regions() {
  return [...new Set(state.resources.map((item) => item.region).filter(Boolean))].sort();
}

function resourceKeys(item) {
  const keys = [];
  const url = canonicalUrl(item?.sourceUrl);
  const title = normalizeKeyText(item?.title);
  const agency = normalizeKeyText(item?.agency);
  if (url) keys.push(`url:${url}`);
  if (title) keys.push(`title:${title}|${agency}`);
  return keys;
}

function canonicalUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"]
      .forEach((key) => url.searchParams.delete(key));
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString().replace(/\?$/, "").toLowerCase();
  } catch {
    return String(value).trim().toLowerCase();
  }
}

function normalizeKeyText(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || "").split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
}

function resourcePriority(a, b) {
  const urgencyScore = { "높음": 0, "보통": 1, "낮음": 2 };
  return (urgencyScore[a.urgency] ?? 1) - (urgencyScore[b.urgency] ?? 1)
    || (a.deadline || "9999").localeCompare(b.deadline || "9999")
    || b.createdAt.localeCompare(a.createdAt);
}

function isDueSoon(item) {
  if (!item.deadline) return false;
  const days = daysLeft(item.deadline);
  return days >= 0 && days <= 7;
}

function isExpired(item) {
  if (!item?.deadline) return false;
  const days = daysLeft(item.deadline);
  return !Number.isNaN(days) && days < 0;
}

function daysLeft(deadline) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${deadline}T00:00:00`);
  return Math.round((target - today) / 86400000);
}

function daysLeftText(deadline) {
  const days = daysLeft(deadline);
  if (Number.isNaN(days)) return "";
  if (days < 0) return "마감 지남";
  if (days === 0) return "오늘 마감";
  return `D-${days}`;
}

function emptyState(message) {
  return `<div class="compact-item"><span>${escapeHtml(message)}</span></div>`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("클립보드에 복사했습니다.");
  } catch {
    showToast("복사 권한을 확인하세요.");
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(Number(value || 0));
}

function showToast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  setTimeout(() => $("#toast").classList.remove("show"), 2300);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(String(value)) : String(value).replaceAll('"', '\\"');
}

init();
