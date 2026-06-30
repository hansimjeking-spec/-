const SOURCES = {
  chungbuk: {
    name: "충북복지넷",
    agency: "충청북도사회복지협의회",
    listUrls: [
      "https://www.043w.or.kr/www/selectBbsNttList.do?key=150&bbsNo=21&searchCtgry=&pageUnit=10&searchCnd=all&searchKrwd=&pageIndex=1&integrDeptCode=",
      "https://www.043w.or.kr/www/selectBbsNttList.do?key=150&bbsNo=21&searchCtgry=&pageUnit=10&searchCnd=all&searchKrwd=&pageIndex=2&integrDeptCode=",
      "https://www.043w.or.kr/www/selectBbsNttList.do?key=150&bbsNo=21&searchCtgry=&pageUnit=10&searchCnd=all&searchKrwd=&pageIndex=3&integrDeptCode="
    ],
    type: "chungbuk"
  },
  jecheonWelfare: {
    name: "제천시 복지다담",
    agency: "제천시 복지다담",
    region: "제천시",
    listUrls: [
      "https://www.jecheon.go.kr/bokjidadam/www/selectBbsNttList.do?key=43&bbsNo=5&pageIndex=1",
      "https://www.jecheon.go.kr/bokjidadam/www/selectBbsNttList.do?key=43&bbsNo=5&pageIndex=2",
      "https://www.jecheon.go.kr/bokjidadam/www/selectBbsNttList.do?key=43&bbsNo=5&pageIndex=3"
    ],
    type: "jecheonBbs"
  },
  jecheonNotices: {
    name: "제천시 고시공고",
    agency: "제천시",
    region: "제천시",
    listUrls: ["https://www.jecheon.go.kr/rssBbsNtt.do?bbsNo=18&integrDeptCode="],
    type: "rss",
    titleFilter: /(복지|지원|돌봄|바우처|장애|노인|아동|청소년|청년|여성|가족|한부모|다문화|위기|생계|주거|일자리|교육|건강|의료|모집|신청)/
  },
  bokjiro: {
    name: "복지로",
    agency: "한국사회보장정보원",
    region: "제천시",
    type: "bokjiroApi"
  },
  jecheonEmployment: {
    name: "제천고용복지+센터",
    agency: "제천고용복지+센터",
    region: "제천시",
    listUrls: ["https://www.work.go.kr/jecheon/main.do"],
    type: "workGo",
    titleFilter: /(지원|고용|취업|일자리|훈련|교육|외국인|청년|여성|고령자|장애인|안내|공고|모집)/
  }
};

const CATEGORIES = ["생계", "주거", "의료", "돌봄", "교육", "고용", "심리정서", "법률", "긴급지원", "기타"];
const TARGETS = ["독거노인", "장애인", "한부모", "아동·청소년", "청년", "중장년", "위기가구", "이주민", "노숙·주거취약", "아동", "시설", "사회복지관"];

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = request.body || {};
    const requested = Array.isArray(body.sources) && body.sources.length ? body.sources : Object.keys(SOURCES);
    const limitPerSource = Math.min(50, Math.max(1, Number(body.limitPerSource || 30)));
    const resources = [];
    const errors = [];

    for (const key of requested) {
      const source = SOURCES[key];
      if (!source) continue;
      try {
        const items = await collectSource(source, limitPerSource);
        resources.push(...items);
      } catch (error) {
        errors.push({ source: key, name: source.name, message: error.message });
      }
    }

    response.status(200).json({
      collectedAt: new Date().toISOString(),
      resources: uniqueResources(resources),
      errors
    });
  } catch (error) {
    response.status(500).json({ error: error.message || "Collect failed" });
  }
}

async function collectSource(source, limit) {
  if (source.type === "bokjiroApi") return collectBokjiro(limit);
  const links = [];
  for (const listUrl of source.listUrls) {
    const html = await fetchText(listUrl);
    const extracted = extractLinks(html, listUrl, source)
      .filter((item) => !source.titleFilter || source.titleFilter.test(item.title));
    links.push(...extracted.slice(0, limit));
    if (links.length >= limit) break;
  }

  const selected = links.slice(0, limit);
  const details = await Promise.all(selected.map(async (link) => {
    const detail = await fetchDetail(link).catch(() => ({ text: link.title, url: link.url }));
    return buildResource({ ...link, ...detail }, source);
  }));
  return details;
}

async function fetchDetail(link) {
  const html = await fetchText(link.url);
  return {
    url: link.url,
    text: extractMainText(html).slice(0, 8000),
    attachments: extractAttachments(html, link.url)
  };
}

async function fetchText(url) {
  const result = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 WelfareResourceRadar/1.0",
      "accept": "text/html,text/plain,application/xhtml+xml"
    }
  });
  if (!result.ok) {
    const safeUrl = new URL(url);
    throw new Error(`${safeUrl.origin}${safeUrl.pathname} ${result.status}`);
  }
  return await result.text();
}

function extractLinks(html, baseUrl, source) {
  if (source.type === "chungbuk") return extractChungbukLinks(html, baseUrl);
  if (source.type === "jecheonBbs") return extractChungbukLinks(html, baseUrl);
  if (source.type === "bokji") return extractBokjiLinks(html, baseUrl);
  if (source.type === "rss") return extractRssLinks(html);
  if (source.type === "workGo") return extractWorkGoLinks(html, baseUrl);
  return extractGenericLinks(html, baseUrl);
}

function extractChungbukLinks(html, baseUrl) {
  const links = [];
  const pattern = /<a\s+href="([^"]*selectBbsNttView\.do[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    links.push({
      url: absoluteUrl(match[1].replaceAll("&amp;", "&"), baseUrl),
      title: cleanText(match[2])
    });
  }
  return links;
}

function extractBokjiLinks(html, baseUrl) {
  const links = [];
  const pattern = /<td class="subject">\s*<a href="javascript:goView\('([^']+)'\)">([\s\S]*?)<\/a>/gi;
  const detailBase = baseUrl.replace(/\/01\.bokji(?:\?.*)?$/, "/01_01.bokji");
  let match;
  while ((match = pattern.exec(html))) {
    links.push({
      url: `${detailBase}?BOARDIDX=${encodeURIComponent(match[1])}`,
      title: cleanText(match[2])
    });
  }
  return links;
}

function extractRssLinks(xml) {
  const links = [];
  const pattern = /<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<\/item>/gi;
  let match;
  while ((match = pattern.exec(xml))) {
    links.push({
      title: cleanText(match[1]),
      url: decodeEntities(cleanText(match[2]))
    });
  }
  return links;
}

function extractWorkGoLinks(html, baseUrl) {
  const links = [];
  const pattern = /<a\s+href="([^"]*\/jecheon\/newsPlace\/notice\/noticeDetail\.do[^"]*)"[^>]*>[\s\S]*?<strong[^>]*>([\s\S]*?)<\/strong>[\s\S]*?<\/a>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    links.push({
      url: absoluteUrl(match[1], baseUrl),
      title: cleanText(match[2]).replace(/\.\.\.$/, "")
    });
  }
  return links;
}

function extractGenericLinks(html, baseUrl) {
  const links = [];
  const base = new URL(baseUrl);
  const pattern = /<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const title = cleanText(match[2]);
    if (!title || title.length < 6 || title.length > 140) continue;
    if (!/(공지|안내|공고|지원|사업|교육|자료|모집|신청|복지|사회)/.test(title)) continue;
    const url = absoluteUrl(match[1], baseUrl);
    if (new URL(url).host !== base.host) continue;
    links.push({ url, title });
  }
  return links;
}

function buildResource(item, source) {
  const text = `${item.title}\n${item.text || ""}`;
  const deadline = guessDeadline(text);
  return {
    title: item.title || firstLine(text) || "새 복지자료",
    agency: source.agency,
    category: guessCategory(text),
    region: source.region || guessRegion(text),
    targets: guessTargets(text),
    deadline,
    contact: guessContact(text),
    summary: summarize(text),
    applyMethod: guessApplyMethod(text),
    tags: guessTags(text),
    urgency: deadline && daysLeft(deadline) <= 7 ? "높음" : "보통",
    status: "검토 필요",
    sourceUrl: item.url,
    rawText: text.slice(0, 12000),
    attachments: Array.isArray(item.attachments) ? item.attachments : [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function collectBokjiro(limit) {
  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!serviceKey) throw new Error("Vercel 환경변수 DATA_GO_KR_SERVICE_KEY 설정이 필요합니다.");
  const encodedKey = /%[0-9a-f]{2}/i.test(serviceKey) ? serviceKey : encodeURIComponent(serviceKey);
  const endpoint = "https://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations/LcgvWelfarelist";
  const attempts = [
    { query: { ctpvNm: "충청북도", sggNm: "제천시" }, exact: true },
    { query: { sggNm: "제천시" }, exact: true },
    { query: { ctpvNm: "충청북도", numOfRows: Math.max(limit, 100) }, exact: false }
  ];
  let lastXml = "";
  for (const attempt of attempts) {
    const params = new URLSearchParams({
      pageNo: "1",
      numOfRows: String(attempt.query.numOfRows || limit),
      arrgOrd: "001",
      ...attempt.query
    });
    lastXml = await fetchText(`${endpoint}?serviceKey=${encodedKey}&${params}`);
    const records = extractBokjiroRecords(lastXml);
    const jecheonRecords = attempt.exact
      ? records
      : records.filter((item) => Object.values(item).some((value) => String(value).includes("제천")));
    if (jecheonRecords.length) return jecheonRecords.slice(0, limit).map(buildBokjiroResource);
  }
  const message = [
    "resultMessage",
    "resultMsg",
    "returnAuthMsg",
    "errMsg"
  ].map((tag) => extractXmlValue(lastXml, tag)).find(Boolean);
  const code = extractXmlValue(lastXml, "resultCode");
  throw new Error(message || `복지로 제천시 API에서 자료를 찾지 못했습니다.${code ? ` (응답 코드: ${code})` : ""}`);
}

function extractXmlValue(xml, tag) {
  const normalizedXml = normalizeXmlTags(xml);
  const match = normalizedXml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, "i"));
  return match ? cleanText(decodeEntities(match[1])) : "";
}

function extractBokjiroRecords(xml) {
  const normalizedXml = normalizeXmlTags(xml);
  const blocks = [...normalizedXml.matchAll(/<servList>([\s\S]*?)<\/servList>/gi)].map((match) => match[1]);
  return blocks.map((block) => {
    const record = {};
    for (const match of block.matchAll(/<([A-Za-z][\w]*)>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/\1>/g)) {
      record[match[1]] = cleanText(decodeEntities(match[2]));
    }
    return record;
  }).filter((item) => item.servId && item.servNm);
}

function normalizeXmlTags(xml) {
  return String(xml).replace(/(<\/?)[A-Za-z_][\w.-]*:/g, "$1");
}

function buildBokjiroResource(item) {
  const text = [
    item.servNm, item.servDgst, item.sprtTrgtCn, item.slctCritCn, item.alwServCn,
    item.aplyMtdNm, item.lifeNmArray, item.trgterIndvdlNmArray, item.intrsThemaNmArray
  ].filter(Boolean).join("\n");
  const deadline = normalizeApiDate(item.enfcEndYmd);
  return {
    title: item.servNm,
    agency: item.bizChrDeptNm || "복지로",
    category: guessCategory(text),
    region: item.sggNm || item.ctpvNm || "전국",
    targets: [...new Set([...guessTargets(text), ...splitApiValues(item.trgterIndvdlNmArray), ...splitApiValues(item.lifeNmArray)])].slice(0, 5),
    deadline,
    contact: guessContact(text),
    summary: item.servDgst || summarize(text),
    applyMethod: item.aplyMtdNm || guessApplyMethod(text),
    tags: [...new Set(["복지로", ...splitApiValues(item.intrsThemaNmArray)])].slice(0, 6),
    urgency: deadline && daysLeft(deadline) <= 7 ? "높음" : "보통",
    status: "검토 필요",
    sourceUrl: item.servDtlLink || `https://www.bokjiro.go.kr/ssis-tbu/index.do?servId=${encodeURIComponent(item.servId)}`,
    rawText: text.slice(0, 12000),
    attachments: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function normalizeApiDate(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 8) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function splitApiValues(value) {
  return String(value || "").split(/[,|/]/).map((item) => item.trim()).filter(Boolean);
}

function extractAttachments(html, baseUrl) {
  const attachments = [];
  const seen = new Set();
  const pattern = /<a\s+([^>]*href="([^"]+)"[^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const attrs = match[1] || "";
    const href = match[2] || "";
    const label = cleanText(match[3]);
    if (!href || href.startsWith("#") || /^javascript:/i.test(href)) continue;
    const url = safeAbsoluteUrl(href, baseUrl);
    if (!url || seen.has(url)) continue;
    const name = attachmentName(label, href, attrs);
    if (!isAttachmentCandidate(url, name, attrs)) continue;
    seen.add(url);
    attachments.push({
      id: `auto-${attachments.length + 1}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      type: inferFileType(name, url),
      size: 0,
      url
    });
  }
  return attachments.slice(0, 20);
}

function attachmentName(label, href, attrs) {
  const decodedHref = decodeEntities(href);
  const title = attrs.match(/\btitle="([^"]+)"/i)?.[1];
  const download = attrs.match(/\bdownload(?:="([^"]*)")?/i)?.[1];
  const candidate = cleanText(download || title || label);
  if (candidate && candidate.length <= 160 && !/^다운로드$|^첨부파일$/.test(candidate)) return candidate;
  try {
    const parsed = new URL(decodedHref, "https://example.com/");
    const fromParam = ["fileNm", "fileName", "filename", "atchFileNm", "orignlFileNm", "streFileNm"]
      .map((key) => parsed.searchParams.get(key))
      .find(Boolean);
    if (fromParam) return decodeURIComponent(fromParam);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
  } catch {}
  return "첨부파일";
}

function isAttachmentCandidate(url, name, attrs) {
  const value = `${url} ${name} ${attrs}`.toLowerCase();
  if (/webwatch\.or\.kr|wa_situation|javascript:void|새창/.test(value)) return false;
  return /\.(png|jpe?g|gif|webp|pdf|hwp|hwpx|docx?|xlsx?|pptx?|zip)\b/i.test(value)
    || /download|atch|attach|file|첨부|붙임|다운로드|파일/.test(value);
}

function inferFileType(name, url) {
  const value = `${name} ${url}`.toLowerCase();
  if (/\.(png)\b/.test(value)) return "image/png";
  if (/\.(jpe?g)\b/.test(value)) return "image/jpeg";
  if (/\.(gif)\b/.test(value)) return "image/gif";
  if (/\.(webp)\b/.test(value)) return "image/webp";
  if (/\.(pdf)\b/.test(value)) return "application/pdf";
  if (/\.(hwp|hwpx)\b/.test(value)) return "application/x-hwp";
  return "";
}

function safeAbsoluteUrl(href, baseUrl) {
  try {
    return absoluteUrl(href, baseUrl);
  } catch {
    return "";
  }
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#039;|&#39;/g, "'")
    .replace(/&quot;/g, "\"");
}

function extractMainText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#039;|&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value) {
  return extractMainText(value).replace(/\s+/g, " ").trim();
}

function absoluteUrl(href, baseUrl) {
  return new URL(href.replaceAll("&amp;", "&"), baseUrl).toString();
}

function firstLine(text) {
  return String(text).split(/\r?\n|[.。]/).map((line) => line.trim()).find(Boolean);
}

function summarize(text) {
  const cleaned = contentOnly(text).replace(/\s+/g, " ").trim();
  const sentences = cleaned.split(/(?<=[.!?。]|다\.|요\.|\))/).map((line) => line.trim()).filter(Boolean);
  return (sentences.slice(0, 2).join(" ") || cleaned).slice(0, 360);
}

function contentOnly(text) {
  let cleaned = String(text || "");
  const contentMatch = cleaned.match(/내용\s+([\s\S]*?)(?:파일|목록|이전글|다음글|담당부서|COPYRIGHT)/);
  if (contentMatch?.[1]) cleaned = contentMatch[1];
  return cleaned
    .replace(/사회복지자료 & 정보[^.]+/g, " ")
    .replace(/본문 바로가기|주메뉴 바로가기|풋터 바로가기/g, " ")
    .replace(/조회수\s*\d+|작성일\s*20\d{2}[./-]\d{1,2}[./-]\d{1,2}/g, " ");
}

function guessCategory(text) {
  const rules = [
    ["주거", /주거|임대|월세|전세|퇴거|거처|에너지|난방|보일러|태양광/],
    ["의료", /의료|병원|치료|진료|간병|소아|분만|응급/],
    ["돌봄", /돌봄|요양|식사|도시락|안부|케어|양육/],
    ["교육", /교육|장학|학습|학교|연수|스쿨/],
    ["고용", /고용|취업|일자리|직업|채용|구인/],
    ["심리정서", /심리|상담|정서|우울|불안|마음/],
    ["법률", /법률|소송|채무|파산|권리/],
    ["긴급지원", /긴급|위기|재난|응급|공모/],
    ["생계", /생계|생활비|식비|체납|공과금|후원|지원금/]
  ];
  return rules.find(([, regex]) => regex.test(text))?.[0] || "기타";
}

function guessRegion(text) {
  return ["충북", "충청북도", "전국", "서울", "경기", "인천", "부산", "대구", "광주", "대전", "울산", "세종", "강원", "충남", "전북", "전남", "경북", "경남", "제주"]
    .find((region) => text.includes(region)) || "전국";
}

function guessTargets(text) {
  return TARGETS.filter((target) => text.includes(target)).slice(0, 5);
}

function guessDeadline(text) {
  const normalized = String(text).replace(/\s+/g, " ");
  const datePattern = /20\d{2}[./-]\d{1,2}[./-]\d{1,2}/g;
  let match;
  while ((match = datePattern.exec(normalized))) {
    const context = normalized.slice(Math.max(0, match.index - 28), match.index + match[0].length + 28);
    if (/(작성일|등록일|게시일)/.test(context)) continue;
    if (/(마감|까지|신청|접수|기간|제출|~|～)/.test(context)) return toDate(match[0]);
  }
  const short = normalized.match(/~\s*(\d{1,2})[./월]\s*(\d{1,2})/);
  if (short) return `2026-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}`;
  return "";
}

function toDate(value) {
  const [year, month, day] = value.replace(/[.]/g, "-").split("-").map((part) => part.padStart(2, "0"));
  return `${year}-${month}-${day}`;
}

function guessContact(text) {
  return String(text).match(/\d{2,4}[)-]?\d{3,4}-\d{4}/)?.[0] || "";
}

function guessApplyMethod(text) {
  const match = contentOnly(text).match(/(신청[^.。]{0,120}|접수[^.。]{0,120}|제출[^.。]{0,120})/);
  return match?.[0]?.trim() || "";
}

function guessTags(text) {
  const candidates = ["공모", "지원사업", "교육", "자료", "신청", "모집", "안내", "복지정보", "사회복지관", "충북"];
  return candidates.filter((tag) => text.includes(tag)).slice(0, 6);
}

function daysLeft(deadline) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${deadline}T00:00:00`) - today) / 86400000);
}

function uniqueResources(resources) {
  const seen = new Set();
  return resources.filter((resource) => {
    const key = resource.sourceUrl || resource.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
