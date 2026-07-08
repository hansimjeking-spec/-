const STORAGE_KEY = "welfareResourceRadar.v1";
const WORKFLOW_KEY = "welfareResourceRadar.workflow.v1";

const CHECKS = [
  ["eligibility", "대상 조건 확인"],
  ["deadline", "신청기간 확인"],
  ["contact", "담당자 연락"],
  ["consent", "대상자 동의"],
  ["submitted", "신청 완료"]
];

const SOURCE_GUIDES = [
  ["충북복지넷", "사회복지 자료와 공모 정보를 확인합니다.", "수집 후 중복 여부 확인"],
  ["제천시 복지다담", "지역 복지소식 중심으로 확인합니다.", "대상자 연결 가능성 확인"],
  ["제천시 고시공고", "공식 공고와 신청기간 확인에 유리합니다.", "마감일 우선 확인"],
  ["복지로", "공공데이터포털 인증키가 필요할 수 있습니다.", "관리자 환경변수 확인"],
  ["제천고용복지+센터", "고용·취업 관련 자원을 확인합니다.", "청년·중장년 대상 확인"]
];

function $(selector) {
  return document.querySelector(selector);
}

function $$(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function readState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      resources: Array.isArray(parsed.resources) ? parsed.resources : [],
      trash: Array.isArray(parsed.trash) ? parsed.trash : [],
      blockedKeys: Array.isArray(parsed.blockedKeys) ? parsed.blockedKeys : []
    };
  } catch {
    return { resources: [], trash: [], blockedKeys: [] };
  }
}

function readWorkflow() {
  try {
    return JSON.parse(localStorage.getItem(WORKFLOW_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeWorkflow(workflow) {
  localStorage.setItem(WORKFLOW_KEY, JSON.stringify(workflow));
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
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || "").split(/[,·/\n]/).map((item) => item.trim()).filter(Boolean);
}

function activeView(view) {
  const button = $(`.nav-button[data-view="${view}"]`);
  if (!button || button.hidden) {
    showToast(view === "brief" ? "관리자 모드를 켠 뒤 브리핑을 열 수 있습니다." : "해당 메뉴를 열 수 없습니다.");
    return;
  }
  button.click();
}

function showToast(message) {
  const toast = $("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show", "active");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show", "active"), 2600);
}

async function copyText(text, success = "복사했습니다.") {
  try {
    await navigator.clipboard.writeText(text);
    showToast(success);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    showToast(success);
  }
}

function daysLeft(deadline) {
  if (!deadline) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(`${deadline}T00:00:00`);
  if (Number.isNaN(end.getTime())) return null;
  return Math.ceil((end - today) / 86400000);
}

function isDueSoon(item) {
  const left = daysLeft(item.deadline);
  return left !== null && left >= 0 && left <= 7;
}

function daysLeftText(deadline) {
  const left = daysLeft(deadline);
  if (left === null) return "마감 미정";
  if (left < 0) return "마감 지남";
  if (left === 0) return "오늘 마감";
  return `${left}일 남음`;
}

function reviewReasons(item) {
  const reasons = [];
  if ((item.status || "검토 필요") === "검토 필요") reasons.push("미검토");
  if (item.urgency === "높음") reasons.push("고긴급");
  if (isDueSoon(item)) reasons.push("마감 임박");
  if (!item.deadline) reasons.push("마감일 확인");
  if (!item.applyMethod) reasons.push("신청방법 확인");
  if (!item.contact) reasons.push("문의처 확인");
  if (!splitList(item.targets).length) reasons.push("대상 확인");
  return reasons;
}

function priorityScore(item) {
  let score = 0;
  if (item.urgency === "높음") score += 50;
  if ((item.status || "검토 필요") === "검토 필요") score += 30;
  if (isDueSoon(item)) score += 40;
  const left = daysLeft(item.deadline);
  if (left !== null && left >= 0) score += Math.max(0, 14 - left);
  if (!item.applyMethod || !item.contact) score += 8;
  return score;
}

function resourceShareText(item) {
  return [
    "[복지자원 공유]",
    `사업명: ${item.title || "제목 미정"}`,
    `기관: ${item.agency || "기관 미기재"}`,
    `대상: ${splitList(item.targets).join(", ") || "확인 필요"}`,
    `분야/지역: ${item.category || "기타"} / ${item.region || "전국"}`,
    `신청기간: ${item.deadline ? `${item.deadline} (${daysLeftText(item.deadline)})` : "확인 필요"}`,
    `신청방법: ${item.applyMethod || "확인 필요"}`,
    `문의: ${item.contact || "확인 필요"}`,
    item.sourceUrl ? `원문: ${item.sourceUrl}` : "원문: 확인 필요",
    "",
    item.summary || "요약 없음"
  ].join("\n");
}

function extractDocuments(item) {
  const text = [item.applyMethod, item.summary, item.rawText].filter(Boolean).join("\n");
  const match = text.match(/(제출\s*서류|구비\s*서류|준비\s*서류|필요\s*서류)[\s\S]{0,180}/);
  if (!match) return "제출서류 확인 필요";
  return match[0].replace(/\s+/g, " ").trim();
}

function mountDashboardEnhancements() {
  const view = $("#dashboardView");
  const heading = view?.querySelector(".section-heading");
  if (!view || !heading) return;
  let hub = $("#radarWorkflowHub");
  if (!hub) {
    hub = document.createElement("section");
    hub.id = "radarWorkflowHub";
    hub.className = "radar-enhance-hub";
    heading.insertAdjacentElement("afterend", hub);
  }

  const { resources } = readState();
  const queue = [...resources]
    .map((item) => ({ item, reasons: reviewReasons(item) }))
    .filter((entry) => entry.reasons.length)
    .sort((a, b) => priorityScore(b.item) - priorityScore(a.item))
    .slice(0, 6);
  const duplicateCount = scanDuplicates(resources).length;

  hub.innerHTML = `
    <div class="radar-next-steps">
      <article><strong>1. 수집</strong><span>URL, 문서, 공고문을 넣습니다.</span><button class="ghost-button" data-radar-open="collect">정보 수집</button></article>
      <article><strong>2. 검토</strong><span>마감·대상·신청방법을 확인합니다.</span><button class="ghost-button" data-radar-filter="review">미검토 보기</button></article>
      <article><strong>3. 연결</strong><span>대상자 유형과 신청 난이도를 봅니다.</span><button class="ghost-button" data-radar-scroll="recommendations">추천 보기</button></article>
      <article><strong>4. 공유</strong><span>회의·카톡·보고용 문장으로 복사합니다.</span><button class="ghost-button" data-radar-open="brief">브리핑</button></article>
    </div>
    ${resources.length ? "" : `
      <div class="radar-empty-guide">
        <div>
          <strong>처음 사용이라면 샘플을 먼저 불러오세요.</strong>
          <p>샘플 자원 3건으로 대시보드, 대상자 추천, 브리핑 흐름을 바로 확인할 수 있습니다.</p>
        </div>
        <div class="button-row">
          <button class="primary-button" id="radarLoadSamples" type="button">샘플 자원 불러오기</button>
          <button class="ghost-button" data-radar-open="collect" type="button">직접 수집하기</button>
        </div>
      </div>
    `}
    <div class="radar-queue-panel">
      <div class="radar-panel-title">
        <div><strong>오늘 검토할 자원</strong><span>마감 임박, 고긴급, 누락 항목을 먼저 보여줍니다.</span></div>
        <em>중복 의심 ${duplicateCount}건</em>
      </div>
      ${queue.length ? queue.map(({ item, reasons }) => `
        <article class="radar-queue-item">
          <div>
            <strong>${escapeHtml(item.title || "제목 미정")}</strong>
            <span>${escapeHtml(item.agency || "기관 미기재")} · ${escapeHtml(item.deadline || "마감 미정")} · ${escapeHtml(daysLeftText(item.deadline))}</span>
            <p>${reasons.slice(0, 4).map((reason) => `<i>${escapeHtml(reason)}</i>`).join("")}</p>
          </div>
          <button class="ghost-button" data-radar-focus="${escapeHtml(item.id)}" type="button">목록에서 보기</button>
        </article>
      `).join("") : `<div class="radar-soft-empty">오늘 우선 검토할 자원이 없습니다. 새 공고를 수집하면 이곳에 정리됩니다.</div>`}
    </div>
  `;

  hub.querySelectorAll("[data-radar-open]").forEach((button) => {
    button.addEventListener("click", () => activeView(button.dataset.radarOpen));
  });
  hub.querySelector("#radarLoadSamples")?.addEventListener("click", () => $("#loadSamples")?.click());
  hub.querySelector("[data-radar-filter='review']")?.addEventListener("click", () => {
    const status = $("#resourceStatus");
    if (status) status.value = "검토 필요";
    activeView("resources");
  });
  hub.querySelector("[data-radar-scroll='recommendations']")?.addEventListener("click", () => $("#recommendations")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  hub.querySelectorAll("[data-radar-focus]").forEach((button) => {
    button.addEventListener("click", () => focusResourceById(button.dataset.radarFocus));
  });
}

function mountCollectGuides() {
  const panel = $(".source-panel");
  if (panel && !$("#radarCollectionGuide")) {
    const help = panel.querySelector(".source-help");
    if (help) {
      help.innerHTML = "복지로 자동 수집을 사용하려면 공공데이터포털 인증키가 필요합니다. 관리자에게 <code>DATA_GO_KR_SERVICE_KEY</code> 등록을 요청하세요.";
    }
    panel.insertAdjacentHTML("beforeend", `
      <div id="radarCollectionGuide" class="radar-collection-guide">
        <strong>수집 성공/실패 확인표</strong>
        <div class="radar-source-table">
          ${SOURCE_GUIDES.map(([name, description, action]) => `
            <div><b>${escapeHtml(name)}</b><span>${escapeHtml(description)}</span><em>${escapeHtml(action)}</em></div>
          `).join("")}
        </div>
      </div>
    `);
  }

  const documentMode = $("#documentMode");
  const status = $("#documentStatus");
  if (documentMode && status && !$("#radarDocumentGuide")) {
    status.insertAdjacentHTML("afterend", `
      <div id="radarDocumentGuide" class="radar-document-guide">
        <strong>문서가 안 읽힐 때 확인</strong>
        <ul>
          <li>배포용 한글 문서는 HWPX로 다시 저장한 뒤 업로드합니다.</li>
          <li>스캔 PDF는 텍스트 선택이 되지 않으므로 OCR 변환이 필요합니다.</li>
          <li>암호가 걸린 파일은 암호 해제 후 다시 올립니다.</li>
          <li>표가 이미지로 들어간 공문은 텍스트를 복사해 붙여넣는 편이 빠릅니다.</li>
        </ul>
      </div>
    `);
  }
}

function mountReviewGuide() {
  const panel = $("#reviewPanel");
  if (!panel || $("#radarReviewGuide")) return;
  const head = panel.querySelector(".panel-head");
  head?.insertAdjacentHTML("afterend", `
    <div id="radarReviewGuide" class="radar-review-guide">
      <strong>저장 전 필수 확인</strong>
      <span>마감일</span><span>대상 조건</span><span>신청방법</span><span>문의처</span><span>제출서류</span><span>원문 근거</span>
    </div>
  `);
}

function mountDuplicatePanel() {
  const list = $("#resourceList");
  const view = $("#resourcesView");
  if (!list || !view) return;
  let panel = $("#radarDuplicatePanel");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "radarDuplicatePanel";
    panel.className = "radar-duplicate-panel";
    list.insertAdjacentElement("beforebegin", panel);
  }
  const duplicates = scanDuplicates(readState().resources).slice(0, 6);
  panel.innerHTML = duplicates.length ? `
    <div class="radar-panel-title">
      <div><strong>중복 의심 자원</strong><span>제목·기관·마감일이 비슷한 항목입니다. 병합 전 원문을 확인하세요.</span></div>
      <button class="ghost-button" id="copyDuplicateReport" type="button">중복 목록 복사</button>
    </div>
    ${duplicates.map(([a, b]) => `
      <article class="radar-duplicate-item">
        <div><strong>${escapeHtml(a.title)}</strong><span>${escapeHtml(a.agency || "기관 미기재")} · ${escapeHtml(a.deadline || "마감 미정")}</span></div>
        <div><strong>${escapeHtml(b.title)}</strong><span>${escapeHtml(b.agency || "기관 미기재")} · ${escapeHtml(b.deadline || "마감 미정")}</span></div>
        <button class="text-button" data-radar-focus="${escapeHtml(a.id)}" type="button">첫 항목 보기</button>
      </article>
    `).join("")}
  ` : `<div class="radar-soft-empty">중복으로 보이는 자원이 없습니다.</div>`;

  panel.querySelector("#copyDuplicateReport")?.addEventListener("click", () => {
    const text = duplicates.map(([a, b], index) => `${index + 1}. ${a.title} / ${b.title}`).join("\n");
    copyText(text || "중복 의심 자원이 없습니다.", "중복 목록을 복사했습니다.");
  });
  panel.querySelectorAll("[data-radar-focus]").forEach((button) => button.addEventListener("click", () => focusResourceById(button.dataset.radarFocus)));
}

function scanDuplicates(resources) {
  const pairs = [];
  for (let i = 0; i < resources.length; i += 1) {
    for (let j = i + 1; j < resources.length; j += 1) {
      const a = resources[i];
      const b = resources[j];
      const titleA = normalizeText(a.title);
      const titleB = normalizeText(b.title);
      if (!titleA || !titleB) continue;
      const sameUrl = a.sourceUrl && b.sourceUrl && a.sourceUrl === b.sourceUrl;
      const closeTitle = titleA === titleB || (titleA.length > 8 && titleB.includes(titleA)) || (titleB.length > 8 && titleA.includes(titleB));
      const closeMeta = (a.agency && b.agency && a.agency === b.agency) || (a.deadline && b.deadline && a.deadline === b.deadline);
      if (sameUrl || (closeTitle && closeMeta)) pairs.push([a, b]);
    }
  }
  return pairs;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/공고|안내|모집|사업|신청|지원/g, "")
    .replace(/[^가-힣a-z0-9]/g, "")
    .trim();
}

function decorateResourceCards() {
  const resources = readState().resources;
  const byId = new Map(resources.map((item) => [item.id, item]));
  const workflow = readWorkflow();
  $$(".resource-card[data-resource-id]:not([data-radar-enhanced])").forEach((card) => {
    const item = byId.get(card.dataset.resourceId);
    if (!item) return;
    card.dataset.radarEnhanced = "1";
    const flow = workflow[item.id] || { checks: {}, memo: "" };
    const done = CHECKS.filter(([key]) => flow.checks?.[key]).length;
    const missing = reviewReasons(item).filter((reason) => reason.includes("확인") || reason === "미검토");
    const tools = document.createElement("div");
    tools.className = "radar-card-tools";
    tools.innerHTML = `
      <div class="radar-card-facts">
        <span>${escapeHtml(daysLeftText(item.deadline))}</span>
        <span>${escapeHtml(splitList(item.targets).join(", ") || "대상 확인 필요")}</span>
        <span>${escapeHtml(item.contact || "문의처 확인 필요")}</span>
        <span>${escapeHtml(extractDocuments(item))}</span>
      </div>
      ${missing.length ? `<div class="radar-missing-line">확인 필요: ${missing.map(escapeHtml).join(", ")}</div>` : ""}
      <div class="radar-card-actions">
        <button class="ghost-button radar-copy-share" type="button">공유문구 복사</button>
        ${item.contact ? `<button class="ghost-button radar-copy-contact" type="button">연락처 복사</button>` : ""}
        ${item.sourceUrl ? `<a class="ghost-button radar-open-source" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener">원문 보기</a>` : ""}
      </div>
      <div class="radar-workflow-box">
        <div class="radar-progress"><strong>${done}/${CHECKS.length}</strong><span>진행 체크</span></div>
        <div class="radar-check-grid">
          ${CHECKS.map(([key, label]) => `
            <label><input type="checkbox" data-radar-check="${key}" ${flow.checks?.[key] ? "checked" : ""}> ${escapeHtml(label)}</label>
          `).join("")}
        </div>
        <label class="radar-memo-label">우리 기관에서 할 일<textarea class="radar-memo" rows="2" placeholder="예: 김OO 어르신 검토, 사례관리 회의 공유">${escapeHtml(flow.memo || "")}</textarea></label>
      </div>
    `;
    card.appendChild(tools);

    tools.querySelector(".radar-copy-share")?.addEventListener("click", () => copyText(resourceShareText(item), "공유문구를 복사했습니다."));
    tools.querySelector(".radar-copy-contact")?.addEventListener("click", () => copyText(item.contact, "연락처를 복사했습니다."));
    tools.querySelectorAll("[data-radar-check]").forEach((input) => {
      input.addEventListener("change", () => {
        const current = readWorkflow();
        current[item.id] ||= { checks: {}, memo: "" };
        current[item.id].checks ||= {};
        current[item.id].checks[input.dataset.radarCheck] = input.checked;
        writeWorkflow(current);
        const count = CHECKS.filter(([key]) => current[item.id].checks[key]).length;
        tools.querySelector(".radar-progress strong").textContent = `${count}/${CHECKS.length}`;
      });
    });
    tools.querySelector(".radar-memo")?.addEventListener("input", debounce((event) => {
      const current = readWorkflow();
      current[item.id] ||= { checks: {}, memo: "" };
      current[item.id].memo = event.target.value;
      writeWorkflow(current);
    }, 300));
  });
}

function mountBriefTemplates() {
  const textarea = $("#briefOutput");
  const view = $("#briefView");
  if (!textarea || !view || $("#radarBriefTemplates")) return;
  const panel = document.createElement("section");
  panel.id = "radarBriefTemplates";
  panel.className = "radar-brief-templates";
  panel.innerHTML = `
    <div class="radar-panel-title">
      <div><strong>복사 템플릿</strong><span>팀 회의, 사례관리, 카톡 공유, 내부 보고용으로 바로 바꿉니다.</span></div>
    </div>
    <div class="button-row">
      <button class="ghost-button" data-template="team" type="button">팀 회의용</button>
      <button class="ghost-button" data-template="case" type="button">사례관리용</button>
      <button class="ghost-button" data-template="chat" type="button">카톡 공유용</button>
      <button class="ghost-button" data-template="report" type="button">내부 보고용</button>
    </div>
  `;
  textarea.insertAdjacentElement("beforebegin", panel);
  panel.querySelectorAll("[data-template]").forEach((button) => {
    button.addEventListener("click", () => {
      textarea.value = buildTemplate(button.dataset.template);
      textarea.focus();
      textarea.select();
    });
  });
}

function buildTemplate(type) {
  const resources = readState().resources;
  const now = new Date().toLocaleDateString("ko-KR");
  const due = resources.filter(isDueSoon).sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)));
  const urgent = resources.filter((item) => item.urgency === "높음");
  const review = resources.filter((item) => (item.status || "검토 필요") === "검토 필요");
  const byCategory = countBy(resources, "category");

  if (type === "team") {
    return [
      `[복지자원 주간 공유 / ${now}]`,
      `이번 주 확인할 복지자원은 총 ${resources.length}건입니다.`,
      `마감 임박 자원 ${due.length}건, 고긴급 자원 ${urgent.length}건, 미검토 자원 ${review.length}건입니다.`,
      "",
      "우선 검토 자원",
      ...formatResourceLines([...due, ...urgent].slice(0, 7)),
      "",
      "확인 필요: 대상 조건, 신청방법, 문의처, 제출서류"
    ].join("\n");
  }

  if (type === "case") {
    return [
      `[사례관리 연계 가능 자원 / ${now}]`,
      `생계 ${byCategory["생계"] || 0}건, 의료 ${byCategory["의료"] || 0}건, 주거 ${byCategory["주거"] || 0}건, 심리정서 ${byCategory["심리정서"] || 0}건이 확인되었습니다.`,
      "",
      "대상자 연계 시 먼저 볼 자원",
      ...formatResourceLines(resources.sort((a, b) => priorityScore(b) - priorityScore(a)).slice(0, 8)),
      "",
      "연계 전 확인: 대상자 동의, 소득·연령 기준, 신청서류, 신청 마감일"
    ].join("\n");
  }

  if (type === "chat") {
    const top = resources.sort((a, b) => priorityScore(b) - priorityScore(a))[0];
    return top ? resourceShareText(top) : "[복지자원 공유]\n등록된 자원이 없습니다.";
  }

  return [
    `[복지자원 수집 결과 보고 / ${now}]`,
    `1. 신규·등록 자원: ${resources.length}건`,
    `2. 마감 임박 자원: ${due.length}건`,
    `3. 고긴급 자원: ${urgent.length}건`,
    `4. 검토 필요 자원: ${review.length}건`,
    "",
    "분야별 현황",
    ...Object.entries(byCategory).map(([category, count]) => `- ${category}: ${count}건`),
    "",
    "우선 조치 필요",
    ...formatResourceLines([...due, ...urgent].slice(0, 8))
  ].join("\n");
}

function formatResourceLines(items) {
  if (!items.length) return ["- 해당 자원 없음"];
  return items.map((item) => `- ${item.title || "제목 미정"} / ${item.agency || "기관 미기재"} / ${item.deadline || "마감 미정"} / ${splitList(item.targets).join(", ") || "대상 확인"}`);
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const name = item[key] || "기타";
    acc[name] = (acc[name] || 0) + 1;
    return acc;
  }, {});
}

function focusResourceById(id) {
  const item = readState().resources.find((resource) => resource.id === id);
  if (!item) return;
  activeView("resources");
  const search = $("#globalSearch");
  if (search) {
    search.value = item.title || item.agency || "";
    search.dispatchEvent(new Event("input", { bubbles: true }));
  }
  window.setTimeout(() => {
    const card = $(`.resource-card[data-resource-id="${CSS.escape(id)}"]`);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    card?.classList.add("radar-highlight");
    window.setTimeout(() => card?.classList.remove("radar-highlight"), 1800);
  }, 120);
}

function debounce(callback, wait = 200) {
  let timer;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), wait);
  };
}

function refreshEnhancements() {
  mountDashboardEnhancements();
  mountCollectGuides();
  mountReviewGuide();
  mountDuplicatePanel();
  decorateResourceCards();
  mountBriefTemplates();
}

const scheduleRefresh = debounce(refreshEnhancements, 80);

window.addEventListener("DOMContentLoaded", () => {
  refreshEnhancements();
  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.body, { childList: true, subtree: true });
  window.setInterval(refreshEnhancements, 2000);
});
