const ALLIANCE_ENDPOINT = "https://www.leagueofautomatednations.com/alliances.js";
const CACHE_TTL_MS = 20 * 60 * 1000;

let cachedMemberAllianceMap: Map<string, string> | null = null;
let cachedAtMs = 0;
let pendingLoad: Promise<Map<string, string>> | null = null;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

function asMemberList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const output: string[] = [];
  for (const item of value) {
    const member = asString(item);
    if (member) {
      output.push(member);
    }
  }
  return output;
}

async function loadAllianceMap(): Promise<Map<string, string>> {
  const now = Date.now();
  if (cachedMemberAllianceMap && now - cachedAtMs < CACHE_TTL_MS) {
    return cachedMemberAllianceMap;
  }

  if (pendingLoad) {
    return pendingLoad;
  }

  pendingLoad = (async () => {
    const response = await fetch(ALLIANCE_ENDPOINT, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Alliance API request failed: ${response.status}`);
    }

    const payload = asRecord((await response.json()) as unknown) ?? {};
    const memberAllianceMap = new Map<string, string>();

    for (const alliancePayload of Object.values(payload)) {
      const allianceRecord = asRecord(alliancePayload);
      if (!allianceRecord) {
        continue;
      }

      const fullName = asString(allianceRecord.name);
      if (!fullName) {
        continue;
      }

      const members = asMemberList(allianceRecord.members);
      for (const member of members) {
        memberAllianceMap.set(member.toLowerCase(), fullName);
      }
    }

    cachedMemberAllianceMap = memberAllianceMap;
    cachedAtMs = Date.now();
    return memberAllianceMap;
  })();

  try {
    return await pendingLoad;
  } finally {
    pendingLoad = null;
  }
}

export async function fetchAllianceFullNameByPlayer(
  username: string | undefined
): Promise<string | undefined> {
  const normalized = username?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  try {
    const memberAllianceMap = await loadAllianceMap();
    return memberAllianceMap.get(normalized);
  } catch {
    return undefined;
  }
}
