import { useMemo, useState } from "react";
import { useI18n } from "../lib/i18n/use-i18n";
import {
  aggregateRoomResources,
  summarizeRoomObjects,
  objectStore,
  storeCapacity,
} from "../lib/screeps/room-insights";
import { getResourceMeta } from "../lib/screeps/resource-meta";
import type { RoomDetailSnapshot, RoomObjectSummary, ScreepsSession } from "../lib/screeps/types";
import { ResourceThumbIcon } from "./resource-thumb-icon";

export interface RoomIntelEntry { snapshot: RoomDetailSnapshot; stale?: boolean }
export type RoomIntelTab = "overview" | "resources" | "buildings" | "units";
const number = (value?: number) => value === undefined || !Number.isFinite(value) ? "—" : value.toLocaleString();

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const content = rows.map((row) => row.map((value) => {
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function ObjectDetails({ object, snapshot }: { object: RoomObjectSummary; snapshot: RoomDetailSnapshot }) {
  const { t } = useI18n();
  const store = objectStore(object);
  const cooldown = object.cooldown ?? (object.cooldownTime !== undefined && snapshot.gameTime !== undefined ? Math.max(0, object.cooldownTime - snapshot.gameTime) : undefined);
  return (
    <details className="room-object-detail">
      <summary>{object.name ?? object.structureType ?? object.type} <span>({object.x}, {object.y})</span></summary>
      <dl>
        <div><dt>ID</dt><dd><code>{object.id}</code></dd></div>
        <div><dt>{t("map.owner")}</dt><dd>{object.owner ?? object.user ?? "—"}</dd></div>
        <div><dt>{t("intel.hits")}</dt><dd>{number(object.hits)} / {number(object.hitsMax)}</dd></div>
        <div><dt>{t("rooms.capacity")}</dt><dd>{number(storeCapacity(object))}</dd></div>
        {object.level !== undefined ? <div><dt>RCL</dt><dd>{object.level}</dd></div> : null}
        {object.type === "controller" ? <div><dt>{t("intel.downgrade")}</dt><dd>{number(object.ticksToDowngrade ?? (object.downgradeTime !== undefined && snapshot.gameTime !== undefined ? Math.max(0, object.downgradeTime - snapshot.gameTime) : undefined))} ticks</dd></div> : null}
        {object.safeMode !== undefined ? <div><dt>{t("intel.safeMode")}</dt><dd>{number(snapshot.gameTime !== undefined ? Math.max(0, object.safeMode - snapshot.gameTime) : undefined)} ticks</dd></div> : null}
        {object.spawning ? <div><dt>{t("intel.spawning")}</dt><dd>{number(object.spawning.spawnTime !== undefined && snapshot.gameTime !== undefined ? Math.max(0, object.spawning.spawnTime - snapshot.gameTime) : object.spawning.needTime)} ticks</dd></div> : null}
        {cooldown !== undefined ? <div><dt>{t("intel.cooldown")}</dt><dd>{cooldown} ticks</dd></div> : null}
        {object.isPublic !== undefined ? <div><dt>{t("intel.public")}</dt><dd>{t(object.isPublic ? "rooms.true" : "rooms.false")}</dd></div> : null}
        {object.isActive !== undefined ? <div><dt>{t("intel.active")}</dt><dd>{t(object.isActive ? "rooms.true" : "rooms.false")}</dd></div> : null}
        {object.progressTotal ? <div><dt>{t("intel.progress")}</dt><dd>{number(object.progress)} / {number(object.progressTotal)}</dd></div> : null}
        {object.ttl !== undefined ? <div><dt>TTL</dt><dd>{number(object.ttl)}</dd></div> : null}
        {object.role ? <div><dt>{t("intel.role")}</dt><dd>{object.role}</dd></div> : null}
        {object.effects?.length ? <div><dt>{t("intel.effects")}</dt><dd>{object.effects.map((effect) => `${effect.effect}${effect.power ? ` Lv.${effect.power}` : ""}${effect.endTime && snapshot.gameTime !== undefined ? ` (${Math.max(0, effect.endTime - snapshot.gameTime)} ticks)` : ""}`).join(", ")}</dd></div> : null}
        {object.body?.length ? <div><dt>{t("intel.body")}</dt><dd>{object.body.map((part) => `${part.type ?? "?"}${part.boost ? ` [${part.boost}]` : ""}`).join(" · ")}</dd></div> : null}
      </dl>
      {Object.keys(store).length ? <div className="room-object-stock">{Object.entries(store).map(([type, amount]) => <span key={type}>{type} <b>{number(amount)}</b></span>)}</div> : null}
    </details>
  );
}

export function RoomIntelligence({ entries, tab, player }: { entries: RoomIntelEntry[]; tab: RoomIntelTab; player?: ScreepsSession }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [damagedOnly, setDamagedOnly] = useState(false);
  const insights = useMemo(() => entries.map((entry) => ({ ...entry, insight: summarizeRoomObjects(entry.snapshot.objects, player, entry.snapshot.gameTime) })), [entries, player]);
  const hasFreshSnapshot = insights.some((entry) => !entry.stale);
  const resourceTypes = useMemo(() => {
    const filter = query.toLowerCase();
    const resourceNames = new Set(
      insights.flatMap(({ insight }) => insight.resourceTotals.map((item) => item.resourceType))
    );
    const freshTotals = new Map(aggregateRoomResources(
      insights.map(({ insight, stale }) => ({ resourceTotals: insight.resourceTotals, stale }))
    ).map((item) => [item.resourceType, item.amount]));
    return [...resourceNames]
      .filter((resource) =>
        `${resource} ${getResourceMeta(resource).displayName}`.toLowerCase().includes(filter)
      )
      .map((resource) => [resource, freshTotals.get(resource) ?? 0] as const)
      .sort((left, right) =>
        left[0] === "energy" ? -1 : right[0] === "energy" ? 1 : right[1] - left[1]
      );
  }, [insights, query]);
  const objects = useMemo(() => insights.flatMap(({ snapshot, insight, stale }) => {
    const candidates = tab === "units" ? insight.creeps : [...insight.buildingObjects, ...insight.sites];
    return candidates.map((object) => ({ object, snapshot, stale }));
  }), [insights, tab]);
  const types = [...new Set(objects.map(({ object }) => object.type))].sort();
  const filteredObjects = objects.filter(({ object, snapshot }) => {
    if (type && type !== object.type) return false;
    if (damagedOnly && (object.hits === undefined || object.hitsMax === undefined || object.hits >= object.hitsMax)) return false;
    return `${snapshot.roomName} ${snapshot.shard ?? ""} ${object.name ?? ""} ${object.type} ${object.id} ${object.owner ?? ""} ${object.role ?? ""}`.toLowerCase().includes(query.toLowerCase());
  });

  if (entries.length === 0) return <div className="room-empty-state"><p>{t("rooms.noSelectedRooms")}</p></div>;

  if (tab === "overview") {
    return (
      <div className="room-intel-overview">
        <article className="card room-intel-alerts">
          <h2>{t("intel.attention")}</h2>
          {insights.some(({ insight, stale }) => insight.alerts.length || stale) ? insights.flatMap(({ snapshot, insight, stale }) => [
            ...(stale ? [<p className="room-alert" key={`${snapshot.shard}/${snapshot.roomName}/stale`}><strong>{snapshot.roomName} · {snapshot.shard ?? t("map.shardDefault")}</strong><span>{t("intel.stale")}</span></p>] : []),
            ...(!stale ? insight.alerts.map((alert) => <p className={`room-alert ${alert.kind === "hostiles" ? "is-danger" : ""}`} key={`${snapshot.shard}/${snapshot.roomName}/${alert.kind}`}><strong>{snapshot.roomName} · {snapshot.shard ?? t("map.shardDefault")}</strong><span>{t(`intel.alert.${alert.kind}`, { count: alert.count })}</span></p>) : []),
          ]) : <p className="room-health-ok">{t("intel.noAlerts")}</p>}
        </article>
        <article className="card room-resource-distribution">
          <h2>{t("intel.energyDistribution")}</h2>
          {insights.map(({ snapshot, insight, stale }) => {
            const max = Math.max(1, ...insights.filter((item) => !item.stale).map((item) => item.insight.storedEnergy));
            return <div className={`room-distribution-row${stale ? " is-stale" : ""}`} key={`${snapshot.shard}/${snapshot.roomName}`}><span>{snapshot.roomName}<small>{snapshot.shard ?? t("map.shardDefault")}{stale ? ` · ${t("intel.staleShort")}` : ""}</small></span><div className="room-distribution-track"><i style={{ width: stale ? "0%" : `${Math.min(100, insight.storedEnergy / max * 100)}%` }} /></div><b>{stale ? "—" : number(insight.storedEnergy)}</b></div>;
          })}
        </article>
        <article className="card room-table-card">
          <h2>{t("rooms.compareTitle")}</h2>
          <div className="room-data-scroll"><table className="room-data-table"><thead><tr>{[t("rooms.room"), "RCL", t("rooms.energy"), t("intel.stockEnergy"), t("rooms.buildingCount"), t("rooms.creepCount"), t("rooms.constructionSites")].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>
            {insights.map(({ snapshot, insight, stale }) => <tr key={`${snapshot.shard}/${snapshot.roomName}`}><th>{snapshot.roomName}<small>{snapshot.shard ?? t("map.shardDefault")}{stale ? ` · ${t("intel.staleShort")}` : ""}</small></th><td>{stale ? "—" : snapshot.controllerLevel ?? "—"}</td><td>{stale ? "—" : `${number(insight.energyAvailable)} / ${number(insight.energyCapacity)}`}</td><td>{stale ? "—" : number(insight.storedEnergy)}</td><td>{stale ? "—" : insight.buildingCount}</td><td>{stale ? "—" : insight.creepCount}</td><td>{stale ? "—" : insight.constructionSiteCount}</td></tr>)}
          </tbody></table></div>
        </article>
        <article className="card room-natural-resources"><h2>{t("intel.natural")}</h2><div className="room-natural-grid">{insights.map(({ snapshot, insight, stale }) => <div key={`${snapshot.shard}/${snapshot.roomName}`}><h3>{snapshot.roomName} <small>{snapshot.shard}{stale ? ` · ${t("intel.staleShort")}` : ""}</small></h3>{[...insight.sources, ...insight.minerals].map((object) => <p key={object.id}><span>{object.type === "source" ? "Source" : object.mineralType ?? "Mineral"} ({object.x}, {object.y})</span><b>{number(object.type === "source" ? object.energy : object.mineralAmount)}</b><small>{t("intel.regeneration")}: {number(object.ticksToRegeneration ?? (object.cooldownTime !== undefined && snapshot.gameTime !== undefined ? Math.max(0, object.cooldownTime - snapshot.gameTime) : undefined))} ticks</small></p>)}</div>)}</div></article>
      </div>
    );
  }

  return (
    <section className="card room-table-card">
      <div className="room-intel-tools">
        <label className="field room-intel-search"><span>{t("intel.search")}</span><input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder={t("intel.searchPlaceholder")} /></label>
        {tab !== "resources" ? <><label className="field"><span>{t("intel.type")}</span><select aria-label={t("intel.type")} value={type} onChange={(event) => setType(event.currentTarget.value)}><option value="">{t("intel.allTypes")}</option>{types.map((value) => <option key={value}>{value}</option>)}</select></label><label className="room-plain-check"><input type="checkbox" checked={damagedOnly} onChange={(event) => setDamagedOnly(event.currentTarget.checked)} />{t("intel.damagedOnly")}</label></> : null}
        <button type="button" className="ghost-button" onClick={() => downloadCsv(`screeps-${tab}.csv`, tab === "resources"
          ? [[t("resources.resource"), t("resources.total"), ...insights.map(({ snapshot, stale }) => `${snapshot.shard ?? "default"}/${snapshot.roomName}${stale ? ` (${t("intel.staleShort")})` : ""}`)], ...resourceTypes.map(([resource, amount]) => [resource, hasFreshSnapshot ? amount : "—", ...insights.map(({ insight, stale }) => stale ? "—" : insight.resourceTotals.find((item) => item.resourceType === resource)?.amount ?? 0)])]
          : [["room", "shard", "type", "name", "id", "x", "y", "hits", "hitsMax", "store"], ...filteredObjects.map(({ object, snapshot }) => [snapshot.roomName, snapshot.shard ?? "", object.type, object.name ?? "", object.id, object.x, object.y, object.hits ?? "", object.hitsMax ?? "", JSON.stringify(objectStore(object))])])}>{t("intel.export")}</button>
      </div>
      {tab === "resources" ? <>
        <p className="hint-text">{t("intel.stockHint")} {t("intel.freshTotalsOnly")}</p>
        <div className="room-data-scroll"><table className="room-data-table room-resource-matrix"><thead><tr><th>{t("resources.resource")}</th><th>{t("resources.total")}</th>{insights.map(({ snapshot, stale }) => <th key={`${snapshot.shard}/${snapshot.roomName}`}>{snapshot.roomName}<small>{snapshot.shard ?? t("map.shardDefault")}{stale ? ` · ${t("intel.staleShort")}` : ""}</small></th>)}</tr></thead><tbody>
          {resourceTypes.map(([resource, amount]) => <tr key={resource}><th><span className="room-resource-name"><ResourceThumbIcon resourceType={resource} /><span>{resource}<small>{getResourceMeta(resource).displayName}</small></span></span></th><td className="room-cell-emphasis">{hasFreshSnapshot ? number(amount) : "—"}</td>{insights.map(({ snapshot, insight, stale }) => <td key={`${snapshot.shard}/${snapshot.roomName}`}>{stale ? "—" : number(insight.resourceTotals.find((item) => item.resourceType === resource)?.amount ?? 0)}</td>)}</tr>)}
        </tbody></table></div>
        {!resourceTypes.length ? <p className="room-empty-state">{t("intel.emptyInventory")}</p> : null}
      </> : <>
        <div className="room-data-scroll"><table className="room-data-table"><thead><tr><th>{t("rooms.room")}</th><th>{t("intel.object")}</th><th>{t("intel.hits")}</th><th>{tab === "units" ? "TTL" : t("rooms.topResources")}</th></tr></thead><tbody>
          {filteredObjects.map(({ snapshot, object, stale }) => <tr key={`${snapshot.shard}/${snapshot.roomName}/${object.id}`}><th>{snapshot.roomName}<small>{snapshot.shard ?? t("map.shardDefault")}{stale ? ` · ${t("intel.staleShort")}` : ""}</small></th><td><ObjectDetails object={object} snapshot={snapshot} /></td><td><span>{number(object.hits)} / {number(object.hitsMax)}</span>{object.hitsMax ? <div className="room-mini-track"><i style={{ width: `${Math.min(100, (object.hits ?? 0) / object.hitsMax * 100)}%` }} /></div> : null}</td><td>{tab === "units" ? number(object.ttl) : Object.entries(objectStore(object)).filter(([, amount]) => amount > 0).map(([resource, amount]) => <span className="room-inline-stock" key={resource}>{resource} <b>{number(amount)}</b></span>)}{tab === "buildings" && storeCapacity(object) !== undefined ? <small>{t("rooms.capacity")}: {number(storeCapacity(object))}</small> : null}</td></tr>)}
        </tbody></table></div>
        {!filteredObjects.length ? <p className="room-empty-state">{t("intel.noMatches")}</p> : null}
      </>}
    </section>
  );
}
