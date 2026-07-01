const CATEGORIES = ["생계", "주거", "의료", "돌봄", "교육", "고용", "심리정서", "법률", "긴급지원", "기타"];
const TARGETS = ["독거노인", "장애인", "한부모", "아동·청소년", "청년", "중장년", "위기가구", "이주민", "노숙·주거취약"];

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = request.body || {};
    const source = await buildSource(body);
    const analysis = await analyzeWithGemini(source);
    response.status(200).json({
      resource: analysis.resource,
      rawText: source.text,
      confidence: analysis.aiUsed ? "AI 초안" : `기본 추출${analysis.reason ? ` (${analysis.reason})` : ""}`
    });
  } catch (error) {
    response.status(500).json({ error: error.message || "Analyze failed" });
  }
}

async function buildSource(body) {
  if (body.mode === "manual" && body.resource) {
    return {
      url: "",
      text: body.text || JSON.stringify(body.resource),
      resource: body.resource
    };
  }

  if (body.url) {
    const pageText = await fetchPageText(body.url);
    return { url: body.url, text: pageText };
  }

  return { url: "", text: String(body.text || "").slice(0, 24000) };
}

async function fetchPageText(url) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("지원하지 않는 URL입니다.");
  const result = await fetch(parsed.toString(), {
    headers: {
      "user-agent": "Mozilla/5.0 WelfareResourceRadar/1.0",
      "accept": "text/html,text/plain,application/xhtml+xml"
    }
  });
  if (!result.ok) throw new Error(`URL을 읽지 못했습니다. (${result.status})`);
  const html = await result.text();
  return extractText(html).slice(0, 24000);
}

function extractText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

async function analyzeWithGemini(source) {
  if (source.resource?.title) return { resource: normalize(source.resource, source), aiUsed: false, reason: "직접 입력" };
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { resource: fallback(source), aiUsed: false, reason: "키 없음" };

  const prompt = `
너는 한국 사회복지 현장의 사례관리자를 돕는 정보 정리 도우미다.
아래 원문에서 복지 자원 정보를 추출해 JSON 하나만 반환해라.

필드:
title, agency, category, region, targets, deadline, contact, summary, applyMethod, tags, urgency

규칙:
- category는 ${CATEGORIES.join(", ")} 중 하나
- targets와 tags는 문자열 배열
- deadline은 YYYY-MM-DD 형식, 없으면 빈 문자열
- urgency는 낮음/보통/높음 중 하나
- summary는 실무자가 대상자에게 설명할 수 있게 2문장 이내
- 불확실한 값은 빈 문자열 또는 빈 배열

원문:
${source.text}
`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const result = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
    })
  });

  if (!result.ok) {
    const detail = await result.json().catch(() => ({}));
    return { resource: fallback(source), aiUsed: false, reason: detail.error?.status || `HTTP ${result.status}` };
  }
  const data = await result.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  return { resource: normalize(JSON.parse(text), source), aiUsed: true };
}

function normalize(item, source) {
  return {
    title: String(item.title || "새 복지자원").slice(0, 120),
    agency: String(item.agency || ""),
    category: CATEGORIES.includes(item.category) ? item.category : "기타",
    region: String(item.region || "전국"),
    targets: toList(item.targets),
    deadline: /^\d{4}-\d{2}-\d{2}$/.test(item.deadline || "") ? item.deadline : "",
    contact: String(item.contact || ""),
    summary: String(item.summary || "").slice(0, 500),
    applyMethod: String(item.applyMethod || "").slice(0, 500),
    tags: toList(item.tags).slice(0, 8),
    urgency: ["낮음", "보통", "높음"].includes(item.urgency) ? item.urgency : "보통",
    sourceUrl: source.url || ""
  };
}

function fallback(source) {
  const text = source.text || "";
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const title = lines.find((line) => !line.startsWith("[파일명:")) || "새 복지자원";
  return normalize({
    title: title.slice(0, 80),
    agency: labeledValue(lines, ["시행기관", "주관기관", "담당기관", "기관"]),
    category: guessCategory(text),
    region: guessRegion(text),
    deadline: extractDeadline(text),
    contact: text.match(/\d{2,4}-\d{3,4}-\d{4}/)?.[0] || "",
    summary: text.replace(/\s+/g, " ").slice(0, 220),
    applyMethod: labeledValue(lines, ["신청방법", "접수방법", "신청 방법", "접수 방법"]),
    targets: guessTargets(text),
    tags: []
  }, source);
}

function labeledValue(lines, labels) {
  for (const line of lines) {
    for (const label of labels) {
      const match = line.match(new RegExp(`^${label}\\s*[:：]?\\s*(.+)$`));
      if (match?.[1]) return match[1].trim().slice(0, 300);
    }
  }
  return "";
}

function extractDeadline(text) {
  const matches = [...String(text).matchAll(/(20\d{2})\s*(?:년|[./-])\s*(\d{1,2})\s*(?:월|[./-])\s*(\d{1,2})\s*일?/g)];
  if (!matches.length) return "";
  const dates = matches.map((match) => {
    const month = String(match[2]).padStart(2, "0");
    const day = String(match[3]).padStart(2, "0");
    return `${match[1]}-${month}-${day}`;
  });
  return dates.sort().at(-1) || "";
}

function guessTargets(text) {
  return TARGETS.filter((target) => text.includes(target)).slice(0, 4);
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

function toList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || "").split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
}
