export const OFFICIAL_RENDERER_OBJECT_TYPES = [
  "constructedWall",
  "constructionSite",
  "container",
  "controller",
  "creep",
  "deposit",
  "energy",
  "extension",
  "extractor",
  "factory",
  "flag",
  "invaderCore",
  "keeperLair",
  "lab",
  "link",
  "mineral",
  "nuke",
  "nuker",
  "observer",
  "portal",
  "powerBank",
  "powerCreep",
  "powerSpawn",
  "rampart",
  "road",
  "ruin",
  "source",
  "spawn",
  "storage",
  "terminal",
  "tombstone",
  "tower",
] as const;

export const OFFICIAL_PROCESSOR_HINTS: Record<string, readonly string[]> = {
  constructionSite: ["siteProgress"],
  controller: ["siteProgress", "userBadge", "sprite"],
  creep: ["creepBuildBody", "creepActions", "say"],
  invaderCore: ["siteProgress", "creepActions"],
  road: ["road"],
  spawn: ["runAction", "text"],
  terminal: ["draw", "sprite"],
  tower: ["creepActions", "runAction", "draw"],
};

export function isOfficialRendererObjectType(type: string): boolean {
  return (OFFICIAL_RENDERER_OBJECT_TYPES as readonly string[]).includes(type);
}

export function getOfficialProcessorHints(type: string): readonly string[] {
  return OFFICIAL_PROCESSOR_HINTS[type] ?? [];
}
