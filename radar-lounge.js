const LOUNGE_STORAGE_KEY = "welfareResourceRadar.v1";
const LOUNGE_AUTO_KEY = "welfareResourceRadar.lastAutoCollectDate";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function readRadarState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOUNGE_STORAGE_KEY) || "{}");
    return {
      resources: Array.isArray(parsed.resources) ? parsed.resources : [],
      trash: Array.isArray(parsed.trash) ? parsed.trash : [],
      blockedKeys: Array.isArray(parsed.blockedKeys) ? parsed.blockedKeys : []
    };
  } catch {
    return { resources: [], trash: [], blockedKeys: [] };
  }
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
  return String(value || "").split(/[,;·/\n]/).map((item) => item.trim()).filter(Boolean);
}

function daysLeft(deadline) {
  if (!deadline) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${deadline}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target - today) / 86400000);
}

function dueText(deadline) {
  const left = daysLeft(deadline);
  if (left === null) return "마감 미정";
  if (left < 0) return "마감 지남";
  if (left === 0) return "오늘 마감";
  return `D-${left}`;
}

function isDueSoon(item) {
  const left = daysLeft(item.deadline);
  return left !== null && left >= 0 && left <= 7;
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

function score(item) {
  let value = 0;
  if (item.urgency === "높음") value += 50;
  if ((item.status || "검토 필요") === "검토 필요") value += 30;
  if (isDueSoon(item)) value += 40;
  const left = daysLeft(item.deadline);
  if (left !== null && left >= 0) value += Math.max(0, 14 - left);
  if (!item.applyMethod) value += 8;
  if (!item.contact) value += 8;
  return value;
}

function navClick(view) {
  const button = $(`.nav-button[data-view="${view}"]`);
  if (button && !button.hidden) button.click();
}

function focusResource(id, title) {
  navClick("resources");
  const search = $("#globalSearch");
  if (search) {
    search.value = title || "";
    search.dispatchEvent(new Event("input", { bubbles: true }));
  }
  window.setTimeout(() => {
    const safeId = globalThis.CSS?.escape ? CSS.escape(id) : String(id).replace(/"/g, "");
    const card = $(`.resource-card[data-resource-id="${safeId}"]`);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    card?.classList.add("radar-highlight");
    window.setTimeout(() => card?.classList.remove("radar-highlight"), 1600);
  }, 140);
}

function buildShareText(item) {
  return [
    "[복지자원 공유]",
    `사업명: ${item.title || "제목 미정"}`,
    `기관: ${item.agency || "기관 미기재"}`,
    `대상: ${splitList(item.targets).join(", ") || "확인 필요"}`,
    `마감: ${item.deadline || "확인 필요"} ${item.deadline ? `(${dueText(item.deadline)})` : ""}`,
    `신청방법: ${item.applyMethod || "확인 필요"}`,
    `문의: ${item.contact || "확인 필요"}`,
    item.sourceUrl ? `원문: ${item.sourceUrl}` : "",
    "",
    item.summary || "요약 없음"
  ].filter(Boolean).join("\n");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("복사했습니다.");
  } catch {
    toast("복사 권한을 확인하세요.");
  }
}

function toast(message) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show", "active");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => el.classList.remove("show", "active"), 2400);
}

function renderLounge() {
  document.body.classList.add("radar-lounge-theme");
  renameNavigation();

  const dashboard = $("#dashboardView");
  const heading = dashboard?.querySelector(".section-heading");
  if (!dashboard || !heading) return;

  let home = $("#radarLoungeHome");
  if (!home) {
    home = document.createElement("section");
    home.id = "radarLoungeHome";
    home.className = "radar-lounge-home";
    heading.insertAdjacentElement("afterend", home);
  }

  const { resources } = readRadarState();
  const dueSoon = resources.filter(isDueSoon).sort((a, b) => String(a.deadline || "9999").localeCompare(String(b.deadline || "9999")));
  const urgent = resources.filter((item) => item.urgency === "높음");
  const review = resources.filter((item) => (item.status || "검토 필요") === "검토 필요");
  const missingApply = resources.filter((item) => !item.applyMethod || !item.contact);
  const targets = targetMatchCount(resources);
  const priority = [...resources].sort((a, b) => score(b) - score(a)).slice(0, 5);
  const recent = [...resources].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, 4);
  const lastAuto = localStorage.getItem(LOUNGE_AUTO_KEY) || "아직 없음";

  home.innerHTML = `
    <div class="radar-lounge-hero">
      <div>
        <span class="radar-lounge-eyebrow">운영 대시보드</span>
        <h2>오늘 확인할 복지자원이 ${review.length + dueSoon.length}건 있습니다</h2>
        <p>마감 임박, 고긴급, 신청방법 누락 자원을 먼저 보고 대상자 연결 가능성을 확인하세요. 자료 수집 앱이 아니라 하루 업무 순서를 잡아주는 화면으로 정리했습니다.</p>
        <div class="radar-lounge-actions">
          <button class="primary" type="button" data-lounge-view="collect">오늘 자료 수집</button>
          <button type="button" data-lounge-filter="review">검토함 열기</button>
          <button type="button" data-lounge-copy="brief">회의용 요약 복사</button>
        </div>
      </div>
      <aside class="radar-lounge-side">
        <strong>오늘 먼저 볼 것</strong>
        <div class="radar-lounge-priority">
          ${priority.length ? priority.slice(0, 3).map((item) => `
            <article>
              <b>${escapeHtml(item.title || "제목 미정")}</b>
              <span>${escapeHtml(item.agency || "기관 미기재")} · ${escapeHtml(dueText(item.deadline))} · ${escapeHtml(reviewReasons(item).slice(0, 2).join(", ") || "확인 완료")}</span>
            </article>`).join("") : `<article><b>등록된 자원이 없습니다</b><span>샘플 자원을 불러오거나 자료를 수집해보세요.</span></article>`}
        </div>
      </aside>
    </div>

    <div class="radar-lounge-kpis">
      ${kpi("등록 자원", resources.length, "전체 저장된 복지자원")}
      ${kpi("검토 필요", review.length, `${missingApply.length}건은 신청방법·문의처 확인 필요`)}
      ${kpi("마감 임박", dueSoon.length, "7일 이내 마감되는 자원")}
      ${kpi("대상자 추천", targets, "대상 키워드 기준 연결 후보")}
    </div>

    <div class="radar-lounge-workgrid">
      <section class="radar-lounge-card">
        <div class="radar-lounge-head">
          <div><strong>오늘의 검토함</strong><span>우선순위가 높은 자원부터 확인합니다.</span></div>
          <button class="ghostish" type="button" data-lounge-filter="review">전체 보기</button>
        </div>
        <div class="radar-lounge-list">
          ${priority.length ? priority.map((item) => resourceRow(item)).join("") : emptyRow("아직 검토할 자원이 없습니다.")}
        </div>
      </section>

      <div class="radar-lounge-stack">
        <section class="radar-lounge-card">
          <div class="radar-lounge-head"><div><strong>빠른 작업</strong><span>자주 쓰는 동작만 모았습니다.</span></div></div>
          <div class="radar-lounge-quick">
            <button type="button" data-lounge-view="collect">자원 수집</button>
            <button type="button" data-lounge-view="resources">검토함</button>
            <button type="button" data-lounge-view="important">중요 자원</button>
            <button type="button" data-lounge-copy="brief">요약 복사</button>
          </div>
        </section>

        <section class="radar-lounge-card">
          <div class="radar-lounge-head"><div><strong>수집 상태</strong><span>자동 수집이 조용히 실패하지 않게 보는 영역입니다.</span></div></div>
          <div class="radar-lounge-source-log">
            <div><span>마지막 자동 수집</span><em>${escapeHtml(lastAuto)}</em></div>
            <div><span>최근 등록</span><em>${recent.length}건</em></div>
            <div><span>검토 대기</span><em>${review.length}건</em></div>
          </div>
        </section>

        <section class="radar-lounge-matcher">
          <strong>다음 단계: 대상자 엑셀 매칭</strong>
          <p>자원별 대상 조건과 대상자 명단의 연령·가구유형·욕구를 비교해 “누구에게 연결할지” 추천하는 화면으로 확장하면 됩니다.</p>
        </section>
      </div>
    </div>
  `;

  bindLoungeEvents(home, resources);
}

function kpi(label, value, help) {
  return `<article class="radar-lounge-kpi"><span>${escapeHtml(label)}</span><strong>${Number(value || 0).toLocaleString("ko-KR")}</strong><small>${escapeHtml(help)}</small></article>`;
}

function resourceRow(item) {
  const reasons = reviewReasons(item).slice(0, 4);
  return `
    <article class="radar-lounge-row">
      <div>
        <b>${escapeHtml(item.title || "제목 미정")}</b>
        <span>${escapeHtml(item.agency || "기관 미기재")} · ${escapeHtml(item.category || "기타")} · ${escapeHtml(item.deadline || "마감 미정")} ${escapeHtml(dueText(item.deadline))}</span>
        <div class="radar-lounge-chipline">
          ${reasons.length ? reasons.map((reason) => `<i>${escapeHtml(reason)}</i>`).join("") : `<i>확인 완료</i>`}
        </div>
      </div>
      <div class="radar-lounge-actions-mini">
        <button type="button" data-lounge-focus="${escapeHtml(item.id)}" data-title="${escapeHtml(item.title || "")}">검토</button>
        <button type="button" data-lounge-share="${escapeHtml(item.id)}">공유</button>
      </div>
    </article>
  `;
}

function emptyRow(message) {
  return `<article class="radar-lounge-row"><div><b>${escapeHtml(message)}</b><span>자료를 수집하거나 샘플 자원을 불러오면 이곳에 표시됩니다.</span></div><button type="button" data-lounge-view="collect">수집하기</button></article>`;
}

function targetMatchCount(resources) {
  const targetWords = new Set();
  resources.forEach((item) => splitList(item.targets).forEach((target) => targetWords.add(target)));
  return targetWords.size;
}

function bindLoungeEvents(home, resources) {
  home.querySelectorAll("[data-lounge-view]").forEach((button) => {
    button.addEventListener("click", () => navClick(button.dataset.loungeView));
  });

  home.querySelectorAll("[data-lounge-filter='review']").forEach((button) => {
    button.addEventListener("click", () => {
      const status = $("#resourceStatus");
      if (status) status.value = "검토 필요";
      navClick("resources");
    });
  });

  home.querySelectorAll("[data-lounge-focus]").forEach((button) => {
    button.addEventListener("click", () => focusResource(button.dataset.loungeFocus, button.dataset.title));
  });

  home.querySelectorAll("[data-lounge-share]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = resources.find((resource) => resource.id === button.dataset.loungeShare);
      if (item) copyText(buildShareText(item));
    });
  });

  home.querySelectorAll("[data-lounge-copy='brief']").forEach((button) => {
    button.addEventListener("click", () => copyText(buildBrief(resources)));
  });
}

function buildBrief(resources) {
  const dueSoon = resources.filter(isDueSoon);
  const review = resources.filter((item) => (item.status || "검토 필요") === "검토 필요");
  const urgent = resources.filter((item) => item.urgency === "높음");
  const top = [...resources].sort((a, b) => score(b) - score(a)).slice(0, 6);
  return [
    `[복지자원 업무 요약 / ${new Date().toLocaleDateString("ko-KR")}]`,
    `등록 자원 ${resources.length}건, 검토 필요 ${review.length}건, 마감 임박 ${dueSoon.length}건, 고긴급 ${urgent.length}건입니다.`,
    "",
    "우선 확인 자원",
    ...(top.length ? top.map((item, index) => `${index + 1}. ${item.title || "제목 미정"} / ${item.agency || "기관 미기재"} / ${item.deadline || "마감 미정"} / ${reviewReasons(item).join(", ") || "확인 완료"}`) : ["- 등록된 자원 없음"]),
    "",
    "확인 필요: 대상 조건, 신청방법, 문의처, 제출서류, 원문 근거"
  ].join("\n");
}

function renameNavigation() {
  const labels = {
    dashboard: "대시보드",
    collect: "자원 수집",
    resources: "검토함",
    important: "중요 자원",
    trash: "휴지통",
    brief: "브리핑",
    settings: "자료 관리"
  };
  Object.entries(labels).forEach(([view, label]) => {
    const button = $(`.nav-button[data-view="${view}"]`);
    if (button) button.textContent = label;
  });
  const title = $(".brand h1");
  const subtitle = $(".brand p");
  if (title) title.textContent = "복지자원 레이더";
  if (subtitle) subtitle.textContent = "오늘 할 일을 보여주는 운영판";
  const search = $("#globalSearch");
  if (search) search.placeholder = "자원명, 기관, 대상자 유형, 지역 검색";
  const openCollect = $("#openCollect");
  if (openCollect) openCollect.textContent = "오늘 자료 수집";
}

function scheduleRender() {
  window.clearTimeout(scheduleRender.timer);
  scheduleRender.timer = window.setTimeout(renderLounge, 120);
}

window.addEventListener("DOMContentLoaded", () => {
  renderLounge();
  window.addEventListener("storage", scheduleRender);
  document.addEventListener("click", scheduleRender, true);
  document.addEventListener("input", scheduleRender, true);
  window.setInterval(renderLounge, 1800);
});
