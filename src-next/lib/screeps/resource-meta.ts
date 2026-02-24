import { getOfficialMarketResourceAsset, getOfficialMarketResourceIconUrl } from "./official-market-assets";

export type MarketResourceGroupKey =
  | "core"
  | "raw"
  | "factory"
  | "commodity_t1"
  | "commodity_t2"
  | "commodity_t3"
  | "commodity_t4"
  | "commodity_t5"
  | "commodity_t6"
  | "compounds"
  | "other";

export interface ResourceMeta {
  code: string;
  displayName: string;
  category: MarketResourceGroupKey;
  orderInCategory: number;
  aliases: readonly string[];
  iconFileName: string;
  iconUrl: string;
  iconScale?: number;
}

export interface GroupedMarketResource {
  resourceType: string;
  meta: ResourceMeta;
}

export interface MarketResourceGroup {
  key: MarketResourceGroupKey;
  items: GroupedMarketResource[];
}

interface KnownResourceGroupDefinition {
  key: Exclude<MarketResourceGroupKey, "other">;
  resources: readonly string[];
}

const KNOWN_RESOURCE_GROUPS: readonly KnownResourceGroupDefinition[] = [
  {
    key: "core",
    resources: ["energy", "power", "ops", "H", "O", "U", "L", "K", "Z", "X", "G"],
  },
  {
    key: "raw",
    resources: ["silicon", "metal", "biomass", "mist"],
  },
  {
    key: "factory",
    resources: [
      "oxidant",
      "reductant",
      "zynthium_bar",
      "lemergium_bar",
      "utrium_bar",
      "keanium_bar",
      "ghodium_melt",
      "purifier",
      "battery",
      "composite",
      "crystal",
      "liquid",
    ],
  },
  {
    key: "commodity_t1",
    resources: ["wire", "cell", "alloy", "condensate"],
  },
  {
    key: "commodity_t2",
    resources: ["switch", "phlegm", "tube", "concentrate"],
  },
  {
    key: "commodity_t3",
    resources: ["transistor", "tissue", "fixtures", "extract"],
  },
  {
    key: "commodity_t4",
    resources: ["microchip", "muscle", "frame", "spirit"],
  },
  {
    key: "commodity_t5",
    resources: ["circuit", "organoid", "hydraulics", "emanation"],
  },
  {
    key: "commodity_t6",
    resources: ["device", "organism", "machine", "essence"],
  },
  {
    key: "compounds",
    resources: [
      "OH",
      "ZK",
      "UL",
      "UH",
      "UO",
      "KH",
      "KO",
      "LH",
      "LO",
      "ZH",
      "ZO",
      "GH",
      "GO",
      "UH2O",
      "UHO2",
      "KH2O",
      "KHO2",
      "LH2O",
      "LHO2",
      "ZH2O",
      "ZHO2",
      "GH2O",
      "GHO2",
      "XUH2O",
      "XUHO2",
      "XKH2O",
      "XKHO2",
      "XLH2O",
      "XLHO2",
      "XZH2O",
      "XZHO2",
      "XGH2O",
      "XGHO2",
    ],
  },
];

const knownResourceOrder: string[] = [];
const knownResourceSeen = new Set<string>();
for (const group of KNOWN_RESOURCE_GROUPS) {
  for (const resourceType of group.resources) {
    const key = resourceType.toLowerCase();
    if (!knownResourceSeen.has(key)) {
      knownResourceSeen.add(key);
      knownResourceOrder.push(resourceType);
    }
  }
}

export const KNOWN_MARKET_RESOURCES: readonly string[] = knownResourceOrder;

const SPECIAL_CANONICAL_CODES: Record<string, string> = {
  accesskey: "accessKey",
  cpuunlock: "cpuUnlock",
};

const ICON_BASE_URL = "https://static.screeps.com/upload/mineral-icons";

const DIRECT_DISPLAY_NAMES: Record<string, string> = {
  energy: "Energy",
  power: "Power",
  ops: "Ops",
  pixel: "Pixel",
  token: "Subscription Token",
  accessKey: "Access Key",
  cpuUnlock: "CPU Unlock",
  H: "Hydrogen",
  O: "Oxygen",
  U: "Utrium",
  L: "Lemergium",
  K: "Keanium",
  Z: "Zynthium",
  X: "Catalyst",
  G: "Ghodium",
  OH: "Hydroxide",
  ZK: "Zynthium Keanite",
  UL: "Utrium Lemergite",
};

const MINERAL_NAME_BY_CODE: Record<string, string> = {
  U: "Utrium",
  K: "Keanium",
  L: "Lemergium",
  Z: "Zynthium",
  G: "Ghodium",
};

const KNOWN_RESOURCE_GROUP_BY_LOWER = new Map<string, Exclude<MarketResourceGroupKey, "other">>();
const ORDER_IN_CATEGORY_BY_LOWER = new Map<string, number>();
for (const group of KNOWN_RESOURCE_GROUPS) {
  group.resources.forEach((resourceType, index) => {
    const key = resourceType.toLowerCase();
    KNOWN_RESOURCE_GROUP_BY_LOWER.set(key, group.key);
    ORDER_IN_CATEGORY_BY_LOWER.set(key, index);
  });
}

const CANONICAL_CODE_BY_LOWER = new Map<string, string>(
  KNOWN_MARKET_RESOURCES.map((resourceType) => [resourceType.toLowerCase(), resourceType])
);

const KNOWN_RESOURCE_SORT_INDEX = new Map<string, number>(
  KNOWN_MARKET_RESOURCES.map((resourceType, index) => [resourceType.toLowerCase(), index])
);

const GROUP_ORDER: readonly MarketResourceGroupKey[] = [
  "core",
  "raw",
  "factory",
  "commodity_t1",
  "commodity_t2",
  "commodity_t3",
  "commodity_t4",
  "commodity_t5",
  "commodity_t6",
  "compounds",
  "other",
];

export const MARKET_RESOURCE_GROUP_ORDER: readonly MarketResourceGroupKey[] = GROUP_ORDER;
export const RESOURCE_THUMB_BASE_PATH = "/screeps-resource-thumbs";

const LOWERCASE_ICON_RESOURCES = new Set<string>(
  KNOWN_MARKET_RESOURCES.filter((resourceType) => resourceType.toLowerCase() === resourceType)
);
LOWERCASE_ICON_RESOURCES.add("token");
LOWERCASE_ICON_RESOURCES.add("pixel");
LOWERCASE_ICON_RESOURCES.add("accesskey");
LOWERCASE_ICON_RESOURCES.add("cpuunlock");

function toTitleCase(raw: string): string {
  return raw
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function canonicalResourceCode(resourceType: string): string {
  const trimmed = resourceType.trim();
  if (!trimmed) {
    return "";
  }

  const lower = trimmed.toLowerCase();
  const known = CANONICAL_CODE_BY_LOWER.get(lower);
  if (known) {
    return known;
  }

  const special = SPECIAL_CANONICAL_CODES[lower];
  if (special) {
    return special;
  }

  if (/^[a-z0-9]+$/.test(lower) && /\d/.test(lower)) {
    return lower.toUpperCase();
  }
  if (/^[a-z]{1,2}$/.test(lower)) {
    return lower.toUpperCase();
  }

  return trimmed;
}

function iconFileName(resourceCode: string): string {
  const lower = resourceCode.toLowerCase();
  if (LOWERCASE_ICON_RESOURCES.has(lower)) {
    return lower;
  }
  return resourceCode;
}

function parseCompoundDisplayName(resourceType: string): string | undefined {
  const compound = resourceType.trim().toUpperCase();
  if (!compound) {
    return undefined;
  }

  const tier3 = compound.match(/^X([UKLZG])(H2O|HO2)$/);
  if (tier3) {
    const mineral = MINERAL_NAME_BY_CODE[tier3[1]];
    if (!mineral) {
      return undefined;
    }
    const suffix = tier3[2] === "H2O" ? "Acid" : "Alkalide";
    return `Catalyzed ${mineral} ${suffix}`;
  }

  const tier2 = compound.match(/^([UKLZG])(H2O|HO2)$/);
  if (tier2) {
    const mineral = MINERAL_NAME_BY_CODE[tier2[1]];
    if (!mineral) {
      return undefined;
    }
    const suffix = tier2[2] === "H2O" ? "Acid" : "Alkalide";
    return `${mineral} ${suffix}`;
  }

  const tier1 = compound.match(/^([UKLZG])(H|O)$/);
  if (tier1) {
    const mineral = MINERAL_NAME_BY_CODE[tier1[1]];
    if (!mineral) {
      return undefined;
    }
    const suffix = tier1[2] === "H" ? "Hydride" : "Oxide";
    return `${mineral} ${suffix}`;
  }

  return undefined;
}

function inferCategory(code: string): MarketResourceGroupKey {
  const known = KNOWN_RESOURCE_GROUP_BY_LOWER.get(code.toLowerCase());
  if (known) {
    return known;
  }

  if (/^X?[UKLZG](H2O|HO2|H|O)$/i.test(code) || /^(OH|ZK|UL)$/i.test(code)) {
    return "compounds";
  }

  return "other";
}

function buildAliases(code: string, displayName: string): readonly string[] {
  const aliases = new Set<string>();
  const candidates = [
    code,
    code.toLowerCase(),
    code.toUpperCase(),
    code.replace(/_/g, " "),
    code.replace(/_/g, ""),
    displayName,
    displayName.replace(/\s+/g, ""),
  ];

  for (const candidate of candidates) {
    const normalized = candidate.trim().toLowerCase();
    if (normalized) {
      aliases.add(normalized);
    }
  }

  return [...aliases];
}

export function getResourceSortIndex(resourceType: string): number | undefined {
  const key = resourceType.trim().toLowerCase();
  if (!key) {
    return undefined;
  }
  return KNOWN_RESOURCE_SORT_INDEX.get(key);
}

export function getResourceMeta(resourceType: string): ResourceMeta {
  const code = canonicalResourceCode(resourceType);
  const upperCode = code.toUpperCase();
  const lowerCode = code.toLowerCase();
  const officialAsset = getOfficialMarketResourceAsset(code);
  const officialIconUrl = getOfficialMarketResourceIconUrl(code);

  const displayName =
    officialAsset?.displayName ??
    DIRECT_DISPLAY_NAMES[code] ??
    DIRECT_DISPLAY_NAMES[upperCode] ??
    DIRECT_DISPLAY_NAMES[lowerCode] ??
    parseCompoundDisplayName(code) ??
    toTitleCase(code);

  const category = inferCategory(code);
  const orderInCategory = ORDER_IN_CATEGORY_BY_LOWER.get(lowerCode) ?? Number.MAX_SAFE_INTEGER;
  const resolvedIconFileName = iconFileName(code);

  return {
    code,
    displayName,
    category,
    orderInCategory,
    aliases: buildAliases(code, displayName),
    iconFileName: resolvedIconFileName,
    iconUrl: officialIconUrl ?? `${ICON_BASE_URL}/${encodeURIComponent(resolvedIconFileName)}.png`,
    iconScale: officialAsset?.iconScale,
  };
}

export function getResourceThumbnailUrl(resourceType: string): string {
  const meta = getResourceMeta(resourceType);
  return `${RESOURCE_THUMB_BASE_PATH}/${encodeURIComponent(meta.iconFileName)}.png`;
}

export function groupMarketResources(resourceTypes: readonly string[]): MarketResourceGroup[] {
  const itemByCode = new Map<string, GroupedMarketResource>();
  for (const resourceType of resourceTypes) {
    const trimmed = resourceType.trim();
    if (!trimmed) {
      continue;
    }

    const meta = getResourceMeta(trimmed);
    const key = meta.code.toLowerCase();
    if (!itemByCode.has(key)) {
      itemByCode.set(key, {
        resourceType: meta.code,
        meta,
      });
    }
  }

  const bucketByGroup = new Map<MarketResourceGroupKey, GroupedMarketResource[]>();
  for (const key of GROUP_ORDER) {
    bucketByGroup.set(key, []);
  }

  for (const item of itemByCode.values()) {
    const bucket = bucketByGroup.get(item.meta.category);
    if (bucket) {
      bucket.push(item);
    }
  }

  for (const key of GROUP_ORDER) {
    const items = bucketByGroup.get(key);
    if (!items || items.length <= 1) {
      continue;
    }

    items.sort((left, right) => {
      if (key === "other") {
        const byName = left.meta.displayName.localeCompare(right.meta.displayName);
        if (byName !== 0) {
          return byName;
        }
        return left.meta.code.localeCompare(right.meta.code);
      }

      if (left.meta.orderInCategory !== right.meta.orderInCategory) {
        return left.meta.orderInCategory - right.meta.orderInCategory;
      }
      return left.meta.code.localeCompare(right.meta.code);
    });
  }

  return GROUP_ORDER.map((key) => ({
    key,
    items: bucketByGroup.get(key) ?? [],
  })).filter((group) => group.items.length > 0);
}
