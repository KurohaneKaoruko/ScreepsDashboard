import {
  CELL_WORLD_SIZE,
  ROOM_VIEW_BOX,
  clamp,
  type CameraState,
  type NormalizedRenderObject,
} from "./optimized-renderer-runtime";
import { TERRAIN_TEXTURE_ALIASES, type RenderLayer, type TextureLayerSpec } from "./optimized-renderer-metadata";
import { SCREEPS_RENDERER_RESOURCE_MAP } from "./renderer-resource-map";

type PixiNamespace = {
  Application: new (options: Record<string, unknown>) => {
    view: HTMLCanvasElement;
    stage: {
      addChild: (...children: unknown[]) => unknown;
      removeChildren: () => unknown[];
    };
    renderer: {
      resize: (width: number, height: number) => void;
      destroy: (removeView?: boolean) => void;
    };
    destroy: (removeView?: boolean, stageOptions?: Record<string, unknown>) => void;
  };
  Container: new () => {
    sortableChildren: boolean;
    zIndex: number;
    alpha: number;
    blendMode: number;
    position: { set: (x: number, y: number) => void };
    scale: { set: (x: number, y: number) => void };
    addChild: (...children: unknown[]) => unknown;
    removeChildren: () => unknown[];
  };
  Graphics: new () => {
    zIndex: number;
    alpha: number;
    blendMode: number;
    lineStyle: (width: number, color?: number, alpha?: number) => unknown;
    beginFill: (color: number, alpha?: number) => unknown;
    drawRect: (x: number, y: number, width: number, height: number) => unknown;
    drawRoundedRect: (x: number, y: number, width: number, height: number, radius: number) => unknown;
    drawCircle: (x: number, y: number, radius: number) => unknown;
    drawPolygon: (points: number[] | Array<{ x: number; y: number }>) => unknown;
    moveTo: (x: number, y: number) => unknown;
    lineTo: (x: number, y: number) => unknown;
    closePath: () => unknown;
    endFill: () => unknown;
    destroy: () => void;
  };
  Sprite: {
    new (texture: unknown): {
      zIndex: number;
      alpha: number;
      tint: number;
      rotation: number;
      blendMode: number;
      anchor: { set: (x: number, y?: number) => void };
      position: { set: (x: number, y: number) => void };
      width: number;
      height: number;
      destroy: () => void;
    };
  };
  TilingSprite: {
    new (texture: unknown, width: number, height: number): {
      zIndex: number;
      alpha: number;
      blendMode: number;
      tileScale: { set: (x: number, y?: number) => void };
      position: { set: (x: number, y: number) => void };
      width: number;
      height: number;
      destroy: () => void;
    };
  };
  Text: {
    new (text: string, style: unknown): {
      zIndex: number;
      alpha: number;
      anchor: { set: (x: number, y?: number) => void };
      position: { set: (x: number, y: number) => void };
      destroy: () => void;
    };
  };
  TextStyle: new (style: Record<string, unknown>) => unknown;
  Texture: {
    from: (source: string | HTMLImageElement) => {
      baseTexture?: {
        wrapMode?: number;
        scaleMode?: number;
        mipmap?: number;
      };
    };
  };
  BLEND_MODES: Record<string, number>;
  WRAP_MODES?: Record<string, number>;
  SCALE_MODES?: Record<string, number>;
  MIPMAP_MODES?: Record<string, number>;
};

type RendererModuleLike = {
  PIXI?: PixiNamespace;
  default?: {
    PIXI?: PixiNamespace;
    default?: { PIXI?: PixiNamespace };
  };
};

interface QueueItem {
  zIndex: number;
  node: unknown;
}

interface PixiHostLayer {
  terrain: InstanceType<PixiNamespace["Container"]>;
  roads: InstanceType<PixiNamespace["Container"]>;
  structures: InstanceType<PixiNamespace["Container"]>;
  creeps: InstanceType<PixiNamespace["Container"]>;
  effects: InstanceType<PixiNamespace["Container"]>;
  lighting: InstanceType<PixiNamespace["Container"]>;
  ui: InstanceType<PixiNamespace["Container"]>;
}

const ROAD_RADIUS = 15;
const ROAD_DIAGONAL = Math.sin(Math.PI / 4) * ROAD_RADIUS;
const ROAD_COLOR = 0x3c3c3c;
const BASE_COLORS: Record<string, number> = {
  source: 0xffe56d,
  mineral: 0xffffff,
  controller: 0x45d87d,
  rampart: 0x45d87d,
  constructedWall: 0x111111,
  road: ROAD_COLOR,
  storage: 0x9f8160,
  terminal: 0x79cbff,
  tower: 0xff9966,
  spawn: 0xb8dbff,
};

function parseColor(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().replace("#", "");
  const parsed = Number.parseInt(normalized, 16);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed & 0xffffff;
}

function hasAnimatedObject(object: NormalizedRenderObject): boolean {
  return (
    Boolean(object.actionLog) ||
    Boolean(object.say?.text) ||
    (typeof object.spawningNeedTime === "number" && object.spawningNeedTime > 0) ||
    (typeof object.cooldownTime === "number" && Number.isFinite(object.cooldownTime))
  );
}

function buildRoadSet(objects: readonly NormalizedRenderObject[]): Set<string> {
  const set = new Set<string>();
  for (const object of objects) {
    if (object.type === "road") {
      set.add(`${object.x}:${object.y}`);
    }
  }
  return set;
}

function resolveDepositAliases(depositType: string | undefined): { base: string; fill: string } {
  const normalized = depositType?.trim().toLowerCase();
  if (normalized === "metal") {
    return { base: "deposit-metal", fill: "deposit-metal-fill" };
  }
  if (normalized === "mist") {
    return { base: "deposit-mist", fill: "deposit-mist-fill" };
  }
  if (normalized === "silicon") {
    return { base: "deposit-silicon", fill: "deposit-silicon-fill" };
  }
  return { base: "deposit-biomass", fill: "deposit-biomass-fill" };
}

function resolveLayerAlias(object: NormalizedRenderObject, layer: TextureLayerSpec): string {
  if (object.type !== "deposit" || !layer.alias.startsWith("deposit-biomass")) {
    return layer.alias;
  }
  const aliases = resolveDepositAliases(object.depositType);
  return layer.alias.endsWith("-fill") ? aliases.fill : aliases.base;
}

async function loadPixiFromRendererPackage(): Promise<PixiNamespace> {
  const module = (await import("@screeps/renderer")) as unknown as RendererModuleLike;
  const pixi =
    module.PIXI ??
    module.default?.PIXI ??
    module.default?.default?.PIXI;
  if (!pixi) {
    throw new Error("PIXI runtime is unavailable.");
  }
  return pixi;
}

export interface OptimizedPixiRuntimeOptions {
  host: HTMLElement;
  width: number;
  height: number;
}

export interface OptimizedPixiRuntime {
  resize(size: { width: number; height: number }): void;
  setCamera(camera: CameraState): void;
  setTerrain(terrainValues: Uint8Array | null, terrainKey: string): void;
  setState(objects: NormalizedRenderObject[], gameTime: number): void;
  renderFrame(gameTime: number): void;
  preloadAliases(aliases: readonly string[]): Promise<void>;
  hasAnimatedObjects(): boolean;
  destroy(): void;
}

class OptimizedPixiRuntimeImpl implements OptimizedPixiRuntime {
  private readonly host: HTMLElement;

  private readonly size = { width: 0, height: 0 };

  private app: InstanceType<PixiNamespace["Application"]> | null = null;

  private pixi: PixiNamespace | null = null;

  private world: InstanceType<PixiNamespace["Container"]> | null = null;

  private layers: PixiHostLayer | null = null;

  private currentTerrain: Uint8Array | null = null;

  private terrainKey = "";

  private currentObjects: NormalizedRenderObject[] = [];

  private gameTime = 0;

  private textures = new Map<string, unknown>();

  private texturePromises = new Map<string, Promise<unknown | null>>();

  private pendingTextureRefresh = new Map<string, { rebuildTerrain: boolean }>();

  private renderFrameId: number | null = null;

  constructor(options: OptimizedPixiRuntimeOptions) {
    this.host = options.host;
    this.size.width = Math.max(1, Math.floor(options.width));
    this.size.height = Math.max(1, Math.floor(options.height));
  }

  async init(): Promise<void> {
    this.pixi = await loadPixiFromRendererPackage();
    const dpr = clamp(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, 1, 2);

    this.app = new this.pixi.Application({
      width: this.size.width,
      height: this.size.height,
      antialias: true,
      autoDensity: true,
      resolution: dpr,
      backgroundColor: 0x080d12,
      backgroundAlpha: 1,
      powerPreference: "high-performance",
    });

    this.app.view.classList.add("room-game-map-canvas");
    this.host.textContent = "";
    this.host.appendChild(this.app.view);

    const root = new this.pixi.Container();
    root.sortableChildren = true;

    this.world = new this.pixi.Container();
    this.world.sortableChildren = true;

    const terrain = new this.pixi.Container();
    terrain.sortableChildren = true;
    terrain.zIndex = 0;

    const roads = new this.pixi.Container();
    roads.sortableChildren = true;
    roads.zIndex = 10;

    const structures = new this.pixi.Container();
    structures.sortableChildren = true;
    structures.zIndex = 20;

    const creeps = new this.pixi.Container();
    creeps.sortableChildren = true;
    creeps.zIndex = 30;

    const effects = new this.pixi.Container();
    effects.sortableChildren = true;
    effects.zIndex = 40;

    const lighting = new this.pixi.Container();
    lighting.sortableChildren = true;
    lighting.zIndex = 50;
    lighting.blendMode = this.pixi.BLEND_MODES.ADD;
    lighting.alpha = 0.82;

    const ui = new this.pixi.Container();
    ui.sortableChildren = true;
    ui.zIndex = 60;

    this.layers = {
      terrain,
      roads,
      structures,
      creeps,
      effects,
      lighting,
      ui,
    };

    this.world.addChild(terrain, roads, structures, creeps, effects, lighting, ui);
    root.addChild(this.world);
    this.app.stage.addChild(root);
  }

  resize(size: { width: number; height: number }): void {
    const app = this.app;
    if (!app) {
      return;
    }
    const width = Math.max(1, Math.floor(size.width));
    const height = Math.max(1, Math.floor(size.height));
    this.size.width = width;
    this.size.height = height;
    app.renderer.resize(width, height);
  }

  setCamera(camera: CameraState): void {
    if (!this.world) {
      return;
    }
    this.world.scale.set(camera.zoom, camera.zoom);
    this.world.position.set(camera.offsetX, camera.offsetY);
  }

  setTerrain(terrainValues: Uint8Array | null, terrainKey: string, force = false): void {
    if (!this.pixi || !this.layers) {
      return;
    }
    if (!force && terrainKey === this.terrainKey && terrainValues === this.currentTerrain) {
      return;
    }
    this.terrainKey = terrainKey;
    this.currentTerrain = terrainValues;

    const terrainLayer = this.layers.terrain;
    const removed = terrainLayer.removeChildren();
    for (const node of removed) {
      (node as { destroy?: () => void }).destroy?.();
    }

    const mapBase = new this.pixi.Graphics();
    mapBase.beginFill(0x555555, 1);
    mapBase.drawRect(0, 0, ROOM_VIEW_BOX, ROOM_VIEW_BOX);
    mapBase.endFill();
    terrainLayer.addChild(mapBase);

    this.enqueueTerrainTexture(terrainLayer, "ground", 0.3, 3, this.pixi.BLEND_MODES.NORMAL, 1);
    this.enqueueTerrainTexture(terrainLayer, "ground-mask", 0.15, 7, this.pixi.BLEND_MODES.MULTIPLY, 2);
    this.enqueueTerrainTexture(terrainLayer, "noise1", 0.08, 9, this.pixi.BLEND_MODES.SCREEN, 3);

    const wallGraphics = new this.pixi.Graphics();
    const swampGraphics = new this.pixi.Graphics();
    wallGraphics.beginFill(0x111111, 0.95);
    swampGraphics.beginFill(0x4a501e, 0.42);

    if (terrainValues) {
      for (let y = 0; y < 50; y += 1) {
        for (let x = 0; x < 50; x += 1) {
          const terrainValue = terrainValues[y * 50 + x];
          const drawX = x * CELL_WORLD_SIZE;
          const drawY = y * CELL_WORLD_SIZE;
          if ((terrainValue & 1) === 1) {
            wallGraphics.drawRect(drawX, drawY, CELL_WORLD_SIZE, CELL_WORLD_SIZE);
          } else if ((terrainValue & 2) === 2) {
            swampGraphics.drawRect(drawX, drawY, CELL_WORLD_SIZE, CELL_WORLD_SIZE);
          }
        }
      }
    }

    wallGraphics.endFill();
    swampGraphics.endFill();
    swampGraphics.zIndex = 4;
    wallGraphics.zIndex = 5;
    terrainLayer.addChild(swampGraphics, wallGraphics);

    this.enqueueTerrainTexture(terrainLayer, "noise2", 0.14, 13, this.pixi.BLEND_MODES.ADD, 6);
  }

  setState(objects: NormalizedRenderObject[], gameTime: number): void {
    this.currentObjects = objects;
    this.gameTime = gameTime;
    this.scheduleRender();
  }

  renderFrame(gameTime: number): void {
    this.gameTime = gameTime;
    this.scheduleRender();
  }

  hasAnimatedObjects(): boolean {
    return this.currentObjects.some((object) => hasAnimatedObject(object));
  }

  async preloadAliases(aliases: readonly string[]): Promise<void> {
    const unique = new Set<string>([...TERRAIN_TEXTURE_ALIASES, ...aliases]);
    const tasks = [...unique].map((alias) => this.getTexture(alias));
    await Promise.all(tasks);
  }

  destroy(): void {
    this.texturePromises.clear();
    this.pendingTextureRefresh.clear();
    const app = this.app;
    this.app = null;
    this.world = null;
    this.layers = null;
    this.pixi = null;
    this.currentObjects = [];
    this.currentTerrain = null;
    this.host.textContent = "";
    if (this.renderFrameId !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(this.renderFrameId);
      this.renderFrameId = null;
    }

    if (!app) {
      return;
    }
    try {
      app.destroy(true, { children: true, texture: false, baseTexture: false });
    } catch {
      // noop
    }
  }

  private enqueueTerrainTexture(
    terrainLayer: InstanceType<PixiNamespace["Container"]>,
    alias: string,
    alpha: number,
    tileScale: number,
    blendMode: number,
    zIndex: number
  ): void {
    const texture = this.textures.get(alias);
    if (texture && this.pixi) {
      const tile = new this.pixi.TilingSprite(texture, ROOM_VIEW_BOX, ROOM_VIEW_BOX);
      tile.tileScale.set(tileScale, tileScale);
      tile.alpha = alpha;
      tile.zIndex = zIndex;
      tile.blendMode = blendMode;
      terrainLayer.addChild(tile);
      return;
    }

    this.requestTexture(alias, true);
  }

  private render(): void {
    if (!this.pixi || !this.layers) {
      return;
    }

    const { roads, structures, creeps, effects, lighting, ui } = this.layers;
    for (const layer of [roads, structures, creeps, effects, lighting, ui]) {
      const removed = layer.removeChildren();
      for (const node of removed) {
        (node as { destroy?: () => void }).destroy?.();
      }
    }

    const sortedObjects = [...this.currentObjects].sort(
      (left, right) => left.zIndex - right.zIndex || left.id.localeCompare(right.id)
    );
    const roadSet = buildRoadSet(sortedObjects);
    const gameTime = this.gameTime;

    const structuresQueue: QueueItem[] = [];
    const roadQueue: QueueItem[] = [];
    const creepQueue: QueueItem[] = [];
    const effectQueue: QueueItem[] = [];
    const lightingQueue: QueueItem[] = [];
    const uiQueue: QueueItem[] = [];

    for (const object of sortedObjects) {
      if (object.type === "road") {
        roadQueue.push({ zIndex: object.zIndex, node: this.buildRoadGraphic(object, roadSet) });
        continue;
      }

      const centerX = object.x * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
      const centerY = object.y * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;

      for (const layerSpec of object.spec.textureLayers) {
        const alias = resolveLayerAlias(object, layerSpec);
        const sprite = this.createAliasSprite(object, centerX, centerY, layerSpec, alias);
        if (!sprite) {
          continue;
        }
        const zIndex = object.zIndex + (layerSpec.layer === "lighting" ? 0.001 : layerSpec.layer === "effects" ? 0.002 : 0.003);
        if (layerSpec.layer === "lighting") {
          lightingQueue.push({ zIndex, node: sprite });
        } else if (layerSpec.layer === "effects") {
          effectQueue.push({ zIndex, node: sprite });
        } else if (object.type === "creep" || object.type === "powerCreep") {
          creepQueue.push({ zIndex, node: sprite });
        } else {
          structuresQueue.push({ zIndex, node: sprite });
        }
      }

      this.pushObjectFallback(object, centerX, centerY, structuresQueue, creepQueue);
      this.pushHpBar(object, uiQueue);
      this.pushSayBubble(object, uiQueue);
      this.pushActionLog(object, gameTime, effectQueue);
    }

    this.flushQueue(roadQueue, roads);
    this.flushQueue(structuresQueue, structures);
    this.flushQueue(creepQueue, creeps);
    this.flushQueue(effectQueue, effects);
    this.flushQueue(lightingQueue, lighting);
    this.flushQueue(uiQueue, ui);
  }

  private buildRoadGraphic(object: NormalizedRenderObject, roads: Set<string>): unknown {
    if (!this.pixi) {
      return null;
    }
    const g = new this.pixi.Graphics();
    const centerX = object.x * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
    const centerY = object.y * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
    const hasNW = roads.has(`${object.x - 1}:${object.y - 1}`);
    const hasN = roads.has(`${object.x}:${object.y - 1}`);
    const hasNE = roads.has(`${object.x + 1}:${object.y - 1}`);
    const hasW = roads.has(`${object.x - 1}:${object.y}`);
    g.beginFill(ROAD_COLOR, 1);
    g.drawCircle(centerX, centerY, ROAD_RADIUS);

    if (hasNW) {
      g.drawPolygon([
        centerX + ROAD_DIAGONAL,
        centerY - ROAD_DIAGONAL,
        centerX - ROAD_DIAGONAL,
        centerY + ROAD_DIAGONAL,
        centerX - ROAD_DIAGONAL - CELL_WORLD_SIZE,
        centerY + ROAD_DIAGONAL - CELL_WORLD_SIZE,
        centerX + ROAD_DIAGONAL - CELL_WORLD_SIZE,
        centerY - ROAD_DIAGONAL - CELL_WORLD_SIZE,
      ]);
    }
    if (hasN) {
      g.drawRect(centerX - ROAD_RADIUS, centerY - CELL_WORLD_SIZE, ROAD_RADIUS * 2, CELL_WORLD_SIZE);
    }
    if (hasNE) {
      g.drawPolygon([
        centerX - ROAD_DIAGONAL,
        centerY - ROAD_DIAGONAL,
        centerX + ROAD_DIAGONAL,
        centerY + ROAD_DIAGONAL,
        centerX + ROAD_DIAGONAL + CELL_WORLD_SIZE,
        centerY + ROAD_DIAGONAL - CELL_WORLD_SIZE,
        centerX - ROAD_DIAGONAL + CELL_WORLD_SIZE,
        centerY - ROAD_DIAGONAL - CELL_WORLD_SIZE,
      ]);
    }
    if (hasW) {
      g.drawRect(centerX - CELL_WORLD_SIZE, centerY - ROAD_RADIUS, CELL_WORLD_SIZE, ROAD_RADIUS * 2);
    }
    g.endFill();
    g.zIndex = object.zIndex;
    return g;
  }

  private createAliasSprite(
    object: NormalizedRenderObject,
    centerX: number,
    centerY: number,
    layer: TextureLayerSpec,
    alias: string
  ): unknown {
    if (!this.pixi) {
      return null;
    }
    const texture = this.textures.get(alias);
    if (!texture) {
      this.requestTexture(alias, false);
      return null;
    }

    const sprite = new this.pixi.Sprite(texture);
    sprite.anchor.set(0.5, 0.5);
    sprite.position.set(
      centerX + CELL_WORLD_SIZE * (layer.offsetX ?? 0),
      centerY + CELL_WORLD_SIZE * (layer.offsetY ?? 0)
    );
    const size = CELL_WORLD_SIZE * (layer.scale ?? 1);
    sprite.width = size;
    sprite.height = size;
    sprite.alpha = layer.alpha ?? 1;
    if (layer.tintOwner) {
      sprite.tint = parseColor(object.ownerColor, 0x9ac5ff);
    }

    const layerId: RenderLayer = layer.layer ?? "objects";
    if (layerId === "lighting") {
      sprite.blendMode = this.pixi.BLEND_MODES.ADD;
    } else if (layerId === "effects") {
      sprite.blendMode = this.pixi.BLEND_MODES.SCREEN;
    }

    return sprite;
  }

  private pushObjectFallback(
    object: NormalizedRenderObject,
    centerX: number,
    centerY: number,
    structuresQueue: QueueItem[],
    creepQueue: QueueItem[]
  ): void {
    if (!this.pixi) {
      return;
    }

    const hasAnyTextureLayer = object.spec.textureLayers.length > 0;
    const baseColor = BASE_COLORS[object.type] ?? parseColor(object.ownerColor, 0x79f0b7);
    const queue = object.type === "creep" || object.type === "powerCreep" ? creepQueue : structuresQueue;

    if (hasAnyTextureLayer && object.type !== "controller" && object.type !== "source" && object.type !== "mineral") {
      return;
    }

    const g = new this.pixi.Graphics();
    if (object.type === "source") {
      g.beginFill(0x111111, 1);
      g.drawRoundedRect(centerX - 20, centerY - 20, 40, 40, 10);
      g.endFill();
      g.beginFill(0xffe56d, 1);
      g.drawRoundedRect(centerX - 12, centerY - 12, 24, 24, 8);
      g.endFill();
    } else if (object.type === "mineral") {
      g.beginFill(0xffffff, 1);
      g.drawCircle(centerX, centerY, 20);
      g.endFill();
    } else if (object.type === "controller") {
      g.beginFill(0x12161a, 1);
      g.drawCircle(centerX, centerY, 44);
      g.endFill();
      g.lineStyle(7, 0x34c76b, 1);
      g.drawCircle(centerX, centerY, 34);
      g.beginFill(0x34c76b, 1);
      g.drawCircle(centerX, centerY, 18);
      g.endFill();
    } else if (object.spec.fallbackShape === "rect") {
      g.beginFill(baseColor, 1);
      g.drawRoundedRect(centerX - 28, centerY - 28, 56, 56, 8);
      g.endFill();
    } else if (object.spec.fallbackShape === "ring") {
      g.lineStyle(8, baseColor, 1);
      g.drawCircle(centerX, centerY, 24);
      g.beginFill(0x111111, 1);
      g.drawCircle(centerX, centerY, 14);
      g.endFill();
    } else {
      g.beginFill(baseColor, 1);
      g.drawCircle(centerX, centerY, 22);
      g.endFill();
    }

    queue.push({ zIndex: object.zIndex + 0.01, node: g });
  }

  private pushHpBar(object: NormalizedRenderObject, uiQueue: QueueItem[]): void {
    if (!this.pixi || !object.spec.hpBar) {
      return;
    }
    if (
      typeof object.hits !== "number" ||
      typeof object.hitsMax !== "number" ||
      !Number.isFinite(object.hits) ||
      !Number.isFinite(object.hitsMax) ||
      object.hitsMax <= 0
    ) {
      return;
    }
    const ratio = clamp(object.hits / object.hitsMax, 0, 1);
    const x = object.x * CELL_WORLD_SIZE + 18;
    const y = object.y * CELL_WORLD_SIZE + 86;
    const g = new this.pixi.Graphics();
    g.beginFill(0x000000, 0.68);
    g.drawRoundedRect(x, y, 64, 8, 3);
    g.endFill();
    g.beginFill(0x34c76b, 1);
    g.drawRoundedRect(x + 1, y + 1, 62 * ratio, 6, 2);
    g.endFill();
    uiQueue.push({ zIndex: object.zIndex + 0.4, node: g });
  }

  private pushSayBubble(object: NormalizedRenderObject, uiQueue: QueueItem[]): void {
    if (!this.pixi || !object.say?.text) {
      return;
    }
    const text = object.say.text.trim();
    if (!text) {
      return;
    }

    const centerX = object.x * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
    const centerY = object.y * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
    const style = new this.pixi.TextStyle({
      fontFamily: "Roboto, sans-serif",
      fontSize: 26,
      fontWeight: "600",
      fill: 0x111111,
      align: "center",
    });
    const label = new this.pixi.Text(text.length > 36 ? `${text.slice(0, 35)}...` : text, style);
    label.anchor.set(0.5, 0.5);
    label.position.set(centerX, centerY - 120);

    const paddingX = 16;
    const paddingY = 10;
    const width = Math.max(88, ((label as unknown as { width: number }).width || 88) + paddingX * 2);
    const height = Math.max(44, ((label as unknown as { height: number }).height || 24) + paddingY * 2);
    const bubble = new this.pixi.Graphics();
    const bubbleX = centerX - width * 0.5;
    const bubbleY = centerY - 120 - height * 0.5;
    bubble.beginFill(object.say.isPublic ? 0xdd8888 : 0xcccccc, 0.96);
    bubble.drawRoundedRect(bubbleX, bubbleY, width, height, 10);
    bubble.endFill();
    bubble.lineStyle(2, 0x101317, 0.9);
    bubble.drawRoundedRect(bubbleX, bubbleY, width, height, 10);
    bubble.beginFill(object.say.isPublic ? 0xdd8888 : 0xcccccc, 0.96);
    bubble.drawPolygon([centerX - 10, bubbleY + height, centerX + 10, bubbleY + height, centerX, bubbleY + height + 12]);
    bubble.endFill();

    uiQueue.push({ zIndex: object.zIndex + 0.6, node: bubble });
    uiQueue.push({ zIndex: object.zIndex + 0.61, node: label });
  }

  private pushActionLog(object: NormalizedRenderObject, gameTime: number, effectQueue: QueueItem[]): void {
    if (!this.pixi || !object.actionLog) {
      return;
    }
    const centerX = object.x * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
    const centerY = object.y * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
    const pulse = 0.65 + 0.35 * (0.5 + Math.sin(gameTime * 7 + object.x + object.y) * 0.5);
    const g = new this.pixi.Graphics();
    g.lineStyle(3, 0xa8cbff, pulse);
    for (const target of Object.values(object.actionLog)) {
      if (!target) {
        continue;
      }
      const tx = target.x * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
      const ty = target.y * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
      g.moveTo(centerX, centerY);
      g.lineTo(tx, ty);
      g.beginFill(0xa8cbff, pulse);
      g.drawCircle((centerX + tx) * 0.5, (centerY + ty) * 0.5, 4);
      g.endFill();
    }
    effectQueue.push({ zIndex: object.zIndex + 0.5, node: g });
  }

  private flushQueue(queue: QueueItem[], target: InstanceType<PixiNamespace["Container"]>): void {
    queue.sort((left, right) => left.zIndex - right.zIndex);
    for (const item of queue) {
      const node = item.node as {
        zIndex?: number;
      } | null;
      if (!node) {
        continue;
      }
      if (typeof node.zIndex === "number") {
        node.zIndex = item.zIndex;
      }
      target.addChild(node);
    }
  }

  private getTexture(alias: string): Promise<unknown | null> {
    const cached = this.textures.get(alias);
    if (cached) {
      return Promise.resolve(cached);
    }
    const pending = this.texturePromises.get(alias);
    if (pending) {
      return pending;
    }
    const src = SCREEPS_RENDERER_RESOURCE_MAP[alias];
    if (!src || !this.pixi) {
      return Promise.resolve(null);
    }

    const promise = new Promise<unknown | null>((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        if (!this.pixi) {
          resolve(null);
          return;
        }
        const texture = this.pixi.Texture.from(image);
        if (texture.baseTexture) {
          if (this.pixi.WRAP_MODES?.REPEAT !== undefined) {
            texture.baseTexture.wrapMode = this.pixi.WRAP_MODES.REPEAT;
          }
          if (this.pixi.SCALE_MODES?.LINEAR !== undefined) {
            texture.baseTexture.scaleMode = this.pixi.SCALE_MODES.LINEAR;
          }
          if (this.pixi.MIPMAP_MODES?.OFF !== undefined) {
            texture.baseTexture.mipmap = this.pixi.MIPMAP_MODES.OFF;
          }
        }
        this.textures.set(alias, texture);
        resolve(texture);
      };
      image.onerror = () => {
        reject(new Error(`Failed to load optimized pixi texture: ${alias}`));
      };
      image.src = src;
    }).finally(() => {
      this.texturePromises.delete(alias);
    });

    this.texturePromises.set(alias, promise);
    return promise;
  }

  private scheduleRender(): void {
    if (typeof window === "undefined") {
      this.render();
      return;
    }
    if (this.renderFrameId !== null) {
      return;
    }
    this.renderFrameId = window.requestAnimationFrame(() => {
      this.renderFrameId = null;
      this.render();
    });
  }

  private requestTexture(alias: string, rebuildTerrain: boolean): void {
    if (this.textures.has(alias)) {
      return;
    }

    const existing = this.pendingTextureRefresh.get(alias);
    if (existing) {
      if (rebuildTerrain) {
        existing.rebuildTerrain = true;
      }
      return;
    }

    this.pendingTextureRefresh.set(alias, { rebuildTerrain });
    void this.getTexture(alias)
      .then((loaded) => {
        const pending = this.pendingTextureRefresh.get(alias);
        this.pendingTextureRefresh.delete(alias);
        if (!loaded || !this.layers || !this.pixi) {
          return;
        }

        if (pending?.rebuildTerrain && this.terrainKey) {
          this.setTerrain(this.currentTerrain, this.terrainKey, true);
        }
        this.scheduleRender();
      })
      .catch(() => {
        this.pendingTextureRefresh.delete(alias);
      });
  }
}

export async function createOptimizedPixiRuntime(
  options: OptimizedPixiRuntimeOptions
): Promise<OptimizedPixiRuntime> {
  const runtime = new OptimizedPixiRuntimeImpl(options);
  await runtime.init();
  return runtime;
}
