import { SCREEPS_RENDERER_RESOURCE_MAP } from "./renderer-resource-map";

export type RenderLayer = "objects" | "lighting" | "effects";

export type FallbackShape =
  | "round"
  | "ring"
  | "rect"
  | "road"
  | "spawn"
  | "source"
  | "controller"
  | "observer"
  | "portal"
  | "power"
  | "mineral"
  | "creep";

export interface TextureLayerSpec {
  alias: string;
  scale?: number;
  alpha?: number;
  offsetX?: number;
  offsetY?: number;
  tintOwner?: boolean;
  layer?: RenderLayer;
}

export interface ObjectRenderSpec {
  zIndex: number;
  hpBar: boolean;
  fallbackShape: FallbackShape;
  textureLayers: readonly TextureLayerSpec[];
}

export const TERRAIN_TEXTURE_ALIASES = ["ground", "ground-mask", "noise1", "noise2"] as const;

const DEFAULT_SPEC: ObjectRenderSpec = {
  zIndex: 6,
  hpBar: true,
  fallbackShape: "round",
  textureLayers: [],
};

export const OBJECT_RENDER_METADATA: Record<string, ObjectRenderSpec> = {
  constructionSite: {
    zIndex: 0,
    hpBar: false,
    fallbackShape: "ring",
    textureLayers: [
      { alias: "tbd", scale: 1.15, alpha: 0.35 },
      { alias: "glow", scale: 1.8, alpha: 0.15, layer: "lighting" },
    ],
  },
  road: {
    zIndex: -1,
    hpBar: false,
    fallbackShape: "road",
    textureLayers: [],
  },
  constructedWall: {
    zIndex: 0,
    hpBar: true,
    fallbackShape: "rect",
    textureLayers: [{ alias: "constructedWall", scale: 1.02 }],
  },
  wall: {
    zIndex: 0,
    hpBar: true,
    fallbackShape: "rect",
    textureLayers: [{ alias: "constructedWall", scale: 1.02 }],
  },
  container: {
    zIndex: 1,
    hpBar: true,
    fallbackShape: "rect",
    textureLayers: [],
  },
  rampart: {
    zIndex: 0,
    hpBar: true,
    fallbackShape: "ring",
    textureLayers: [{ alias: "rampart", scale: 1, alpha: 0.5, layer: "effects", tintOwner: true }],
  },
  source: {
    zIndex: 2,
    hpBar: false,
    fallbackShape: "source",
    textureLayers: [{ alias: "glow", scale: 1.5, alpha: 0.32, layer: "lighting" }],
  },
  mineral: {
    zIndex: 2,
    hpBar: false,
    fallbackShape: "mineral",
    textureLayers: [{ alias: "glow", scale: 2.1, alpha: 0.2, layer: "lighting" }],
  },
  deposit: {
    zIndex: 2,
    hpBar: false,
    fallbackShape: "mineral",
    textureLayers: [
      { alias: "deposit-biomass", scale: 1.1 },
      { alias: "deposit-biomass-fill", scale: 1.1, alpha: 0.8 },
      { alias: "glow", scale: 3, alpha: 0.18, layer: "lighting" },
    ],
  },
  energy: {
    zIndex: 2,
    hpBar: false,
    fallbackShape: "round",
    textureLayers: [{ alias: "glow", scale: 1, alpha: 0.75, layer: "lighting" }],
  },
  portal: {
    zIndex: 3,
    hpBar: false,
    fallbackShape: "portal",
    textureLayers: [
      { alias: "glow", scale: 7, alpha: 0.68, layer: "lighting" },
      { alias: "glow", scale: 1.5, alpha: 0.85, layer: "lighting" },
    ],
  },
  keeperLair: {
    zIndex: 3,
    hpBar: true,
    fallbackShape: "portal",
    textureLayers: [
      { alias: "glow", scale: 8, alpha: 0.45, layer: "lighting" },
      { alias: "glow", scale: 1.5, alpha: 0.8, layer: "lighting" },
    ],
  },
  controller: {
    zIndex: 4,
    hpBar: false,
    fallbackShape: "controller",
    textureLayers: [
      { alias: "controller", scale: 2 },
      { alias: "controller-level", scale: 1, alpha: 0.84 },
      { alias: "glow", scale: 12, alpha: 0.2, layer: "lighting" },
      { alias: "glow", scale: 5, alpha: 0.4, layer: "lighting" },
    ],
  },
  tombstone: {
    zIndex: 5,
    hpBar: false,
    fallbackShape: "round",
    textureLayers: [
      { alias: "tombstone", scale: 1 },
      { alias: "tombstone-border", scale: 1, alpha: 0.9 },
      { alias: "tombstone-resource", scale: 1, alpha: 0.8 },
    ],
  },
  ruin: {
    zIndex: 5,
    hpBar: false,
    fallbackShape: "round",
    textureLayers: [
      { alias: "ruin", scale: 1 },
      { alias: "tombstone-resource", scale: 1, alpha: 0.8 },
    ],
  },
  creep: {
    zIndex: 6,
    hpBar: true,
    fallbackShape: "creep",
    textureLayers: [
      { alias: "creep-npc", scale: 1 },
      { alias: "creep-mask", scale: 1, alpha: 0.9, layer: "lighting" },
      { alias: "glow", scale: 1, alpha: 0.55, layer: "lighting" },
      { alias: "glow", scale: 4, alpha: 0.2, layer: "lighting" },
    ],
  },
  extension: {
    zIndex: 7,
    hpBar: true,
    fallbackShape: "ring",
    textureLayers: [
      { alias: "extension", scale: 1 },
      { alias: "glow", scale: 1, alpha: 0.75, layer: "lighting" },
      { alias: "glow", scale: 2.5, alpha: 0.12, layer: "lighting" },
    ],
  },
  storage: {
    zIndex: 7,
    hpBar: true,
    fallbackShape: "round",
    textureLayers: [
      { alias: "storage-border", scale: 2, tintOwner: true },
      { alias: "storage", scale: 2 },
      { alias: "glow", scale: 2, alpha: 1, layer: "lighting" },
      { alias: "glow", scale: 8, alpha: 0.5, layer: "lighting" },
    ],
  },
  factory: {
    zIndex: 7,
    hpBar: true,
    fallbackShape: "round",
    textureLayers: [
      { alias: "factory-border", scale: 2, tintOwner: true },
      { alias: "factory", scale: 2 },
      { alias: "factory-highlight", scale: 2, alpha: 0.5 },
      { alias: "glow", scale: 2, alpha: 1, layer: "lighting" },
      { alias: "glow", scale: 8, alpha: 0.5, layer: "lighting" },
    ],
  },
  spawn: {
    zIndex: 8,
    hpBar: true,
    fallbackShape: "spawn",
    textureLayers: [
      { alias: "glow", scale: 1, alpha: 0.8, layer: "lighting" },
      { alias: "glow", scale: 6, alpha: 0.2, layer: "lighting" },
    ],
  },
  link: {
    zIndex: 9,
    hpBar: true,
    fallbackShape: "ring",
    textureLayers: [
      { alias: "link-border", scale: 1, tintOwner: true },
      { alias: "link", scale: 1 },
      { alias: "link-energy", scale: 0.5 },
      { alias: "glow", scale: 1, alpha: 1, layer: "lighting" },
      { alias: "glow", scale: 4, alpha: 0.5, layer: "lighting" },
    ],
  },
  observer: {
    zIndex: 10,
    hpBar: true,
    fallbackShape: "observer",
    textureLayers: [{ alias: "glow", scale: 8, alpha: 0.5, layer: "lighting" }],
  },
  powerBank: {
    zIndex: 11,
    hpBar: true,
    fallbackShape: "power",
    textureLayers: [
      { alias: "powerBank", scale: 2 },
      { alias: "glow", scale: 8, alpha: 1, layer: "lighting" },
    ],
  },
  powerSpawn: {
    zIndex: 12,
    hpBar: true,
    fallbackShape: "power",
    textureLayers: [
      { alias: "glow", scale: 1.5, alpha: 1, layer: "lighting" },
      { alias: "glow", scale: 6, alpha: 0.5, layer: "lighting" },
    ],
  },
  tower: {
    zIndex: 13,
    hpBar: true,
    fallbackShape: "round",
    textureLayers: [
      { alias: "tower-base", scale: 2, tintOwner: true },
      { alias: "tower-rotatable", scale: 1.15 },
      { alias: "glow", scale: 1, alpha: 0.72, layer: "lighting" },
      { alias: "glow", scale: 6, alpha: 0.2, layer: "lighting" },
      { alias: "flare1", scale: 4, alpha: 0.24, layer: "effects" },
    ],
  },
  powerCreep: {
    zIndex: 13,
    hpBar: true,
    fallbackShape: "creep",
    textureLayers: [
      { alias: "creep-npc", scale: 1.8 },
      { alias: "glow", scale: 4, alpha: 0.25, layer: "lighting" },
      { alias: "flare2", scale: 4, alpha: 0.28, layer: "effects" },
    ],
  },
  lab: {
    zIndex: 15,
    hpBar: true,
    fallbackShape: "round",
    textureLayers: [
      { alias: "lab", scale: 2 },
      { alias: "lab-highlight", scale: 2, alpha: 0.75 },
      { alias: "lab-mineral", scale: 2, alpha: 0.7 },
      { alias: "glow", scale: 1.5, alpha: 1, layer: "lighting" },
      { alias: "glow", scale: 5, alpha: 0.3, layer: "lighting" },
      { alias: "glow", scale: 1.5, alpha: 0.22, layer: "effects" },
    ],
  },
  terminal: {
    zIndex: 16,
    hpBar: true,
    fallbackShape: "ring",
    textureLayers: [
      { alias: "terminal-border", scale: 2, tintOwner: true },
      { alias: "terminal", scale: 2 },
      { alias: "terminal-arrows", scale: 2, alpha: 0.9 },
      { alias: "terminal-highlight", scale: 2, alpha: 0.24 },
      { alias: "glow", scale: 2, alpha: 0.62, layer: "lighting" },
      { alias: "glow", scale: 8, alpha: 0.17, layer: "lighting" },
    ],
  },
  invaderCore: {
    zIndex: 17,
    hpBar: true,
    fallbackShape: "power",
    textureLayers: [
      { alias: "invaderCore", scale: 2 },
      { alias: "glow", scale: 1, alpha: 1, layer: "lighting" },
      { alias: "glow", scale: 8, alpha: 1, layer: "lighting" },
    ],
  },
  nuker: {
    zIndex: 18,
    hpBar: true,
    fallbackShape: "power",
    textureLayers: [
      { alias: "nuker-border", scale: 3, tintOwner: true },
      { alias: "nuker", scale: 3 },
      { alias: "glow", scale: 1, alpha: 1, layer: "lighting" },
      { alias: "glow", scale: 8, alpha: 0.5, layer: "lighting" },
    ],
  },
  extractor: {
    zIndex: 14,
    hpBar: false,
    fallbackShape: "ring",
    textureLayers: [{ alias: "extractor", scale: 1.02 }],
  },
  flag: {
    zIndex: 8,
    hpBar: false,
    fallbackShape: "observer",
    textureLayers: [
      { alias: "flag", scale: 1 },
      { alias: "flag-secondary", scale: 1, alpha: 0.85 },
    ],
  },
  nuke: {
    zIndex: 20,
    hpBar: false,
    fallbackShape: "power",
    textureLayers: [{ alias: "nuke", scale: 1.3 }],
  },
};

export function normalizeObjectType(type: string): string {
  return type === "wall" ? "constructedWall" : type;
}

export function aliasExists(alias: string): boolean {
  return Boolean(SCREEPS_RENDERER_RESOURCE_MAP[alias]);
}

export function resolveObjectRenderSpec(type: string): ObjectRenderSpec {
  const normalized = normalizeObjectType(type);
  const direct = OBJECT_RENDER_METADATA[normalized];
  if (direct) {
    return direct;
  }

  if (aliasExists(normalized)) {
    return {
      ...DEFAULT_SPEC,
      textureLayers: [{ alias: normalized, scale: 1 }],
    };
  }

  return DEFAULT_SPEC;
}
