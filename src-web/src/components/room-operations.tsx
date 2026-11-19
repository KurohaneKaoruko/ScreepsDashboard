import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../lib/i18n/use-i18n";
import {
  buildRoomIntents,
  CONSTRUCTION_TYPES,
  createConstructionSite,
  submitRoomIntent,
  type RoomAction,
  type ConstructionInput,
  type RoomIntent,
} from "../lib/screeps/room-actions";
import { isOwnObject } from "../lib/screeps/room-insights";
import type { RoomDetailSnapshot, ScreepsSession } from "../lib/screeps/types";

interface Props {
  session: ScreepsSession;
  snapshots: RoomDetailSnapshot[];
  onComplete?: () => void;
}

interface OperationResult {
  label: string;
  error?: string;
}

const ROOM_ACTIONS: readonly RoomAction[] = [
  "closeRamparts",
  "openRamparts",
  "enableNotifications",
  "disableNotifications",
];

export function RoomOperations({ session, snapshots, onComplete }: Props) {
  const { t } = useI18n();
  const [action, setAction] = useState<RoomAction>("closeRamparts");
  const [pendingAction, setPendingAction] = useState<RoomAction | null>(null);
  const [reviewedPlan, setReviewedPlan] = useState<RoomIntent[]>([]);
  const [construction, setConstruction] = useState<ConstructionInput | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const mounted = useRef(true);
  const [results, setResults] = useState<OperationResult[]>([]);
  const [siteRoom, setSiteRoom] = useState("");
  const [siteType, setSiteType] = useState("road");
  const [siteX, setSiteX] = useState("25");
  const [siteY, setSiteY] = useState("25");
  const [siteName, setSiteName] = useState("");
  const plan = useMemo(
    () => buildRoomIntents(session, snapshots, action),
    [action, session, snapshots]
  );
  const ownedRooms = snapshots.filter((snapshot) =>
    snapshot.objects.some((object) =>
      object.type === "controller" && isOwnObject(object, session)
    )
  );
  const targetRoom = ownedRooms.find((room) =>
    `${room.shard ?? ""}/${room.roomName}` === siteRoom
  ) ?? ownedRooms[0];
  const reviewing = Boolean(pendingAction || construction);
  const controlsDisabled = busy || reviewing;
  const hasToken = Boolean(session.token.trim());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function execute() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setResults([]);
    const output: OperationResult[] = [];
    try {
      if (construction) {
        try {
          await createConstructionSite(session, construction);
          output.push({ label: `${construction.room} (${construction.x}, ${construction.y})` });
        } catch (error) {
          output.push({
            label: construction.room,
            error: error instanceof Error ? error.message : t("common.unknownError"),
          });
        }
      } else {
        for (const intent of reviewedPlan) {
          if (!mounted.current) break;
          const label = `${intent.shard ?? t("map.shardDefault")}/${intent.room} · ${intent.type} · ${intent.objectId}`;
          try {
            await submitRoomIntent(session, intent);
            output.push({ label });
          } catch (error) {
            output.push({
              label,
              error: error instanceof Error ? error.message : t("common.unknownError"),
            });
          }
          if (mounted.current) setResults([...output]);
        }
      }
      if (mounted.current) {
        setResults(output);
        setPendingAction(null);
        setConstruction(null);
        onComplete?.();
      }
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className="room-operations card">
      <h2>{t("ops.title")}</h2>
      <p className="hint-text">{t(hasToken ? "ops.hint" : "ops.guest")}</p>
      <div className="room-operations-form">
        <label className="field">
          <span>{t("ops.action")}</span>
          <select
            value={action}
            onChange={(event) => setAction(event.currentTarget.value as RoomAction)}
            disabled={controlsDisabled}
          >
            {ROOM_ACTIONS.map((value) => (
              <option value={value} key={value}>{t(`ops.${value}`)}</option>
            ))}
          </select>
        </label>
        <button
          className="secondary-button"
          disabled={!hasToken || !plan.length || controlsDisabled}
          onClick={() => {
            setReviewedPlan(plan);
            setPendingAction(action);
          }}
        >
          {t("ops.review", { count: plan.length })}
        </button>
      </div>
      <details className="room-construction-form">
        <summary>{t("ops.construction")}</summary>
        <form
          className="room-operations-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!targetRoom || !hasToken || controlsDisabled) return;
            setConstruction({
              room: targetRoom.roomName,
              shard: targetRoom.shard,
              x: Number(siteX),
              y: Number(siteY),
              structureType: siteType,
              ...(siteName.trim() ? { name: siteName.trim() } : {}),
            });
          }}
        >
          <label className="field">
            <span>{t("rooms.room")}</span>
            <select
              value={targetRoom ? `${targetRoom.shard ?? ""}/${targetRoom.roomName}` : ""}
              onChange={(event) => setSiteRoom(event.currentTarget.value)}
              disabled={controlsDisabled}
            >
              {ownedRooms.map((room) => (
                <option key={`${room.shard}/${room.roomName}`} value={`${room.shard ?? ""}/${room.roomName}`}>
                  {room.roomName} · {room.shard ?? t("map.shardDefault")}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("rooms.structures")}</span>
            <select value={siteType} disabled={controlsDisabled} onChange={(event) => setSiteType(event.currentTarget.value)}>
              {CONSTRUCTION_TYPES.map((type) => <option key={type}>{type}</option>)}
            </select>
          </label>
          <label className="field">
            <span>X</span>
            <input type="number" min="0" max="49" step="1" required disabled={controlsDisabled} value={siteX} onChange={(event) => setSiteX(event.currentTarget.value)} />
          </label>
          <label className="field">
            <span>Y</span>
            <input type="number" min="0" max="49" step="1" required disabled={controlsDisabled} value={siteY} onChange={(event) => setSiteY(event.currentTarget.value)} />
          </label>
          {siteType === "spawn" ? (
            <label className="field">
              <span>{t("ops.spawnName")}</span>
              <input required maxLength={50} disabled={controlsDisabled} value={siteName} onChange={(event) => setSiteName(event.currentTarget.value)} />
            </label>
          ) : null}
          <button className="secondary-button" disabled={!hasToken || !targetRoom || controlsDisabled}>
            {t("ops.reviewSite")}
          </button>
        </form>
      </details>
      {reviewing ? (
        <div className="room-operation-confirm" role="region" aria-label={t("ops.confirmTitle")}>
          <h3>{t("ops.confirmTitle")}</h3>
          <p>{construction ? `${construction.room} · ${construction.shard ?? t("map.shardDefault")} · ${construction.structureType} (${construction.x}, ${construction.y})${construction.name ? ` · ${construction.name}` : ""}` : `${t(`ops.${pendingAction!}`)} · ${reviewedPlan.length} ${t("rooms.objects")}`}</p>
          {!construction ? (
            <ul>
              {reviewedPlan.map((item) => (
                <li key={`${item.shard}/${item.room}/${item.objectId}`}>
                  {item.shard ?? t("map.shardDefault")}/{item.room} · {item.type} · <code>{item.objectId}</code>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="inline-actions">
            <button className="secondary-button" onClick={() => void execute()} disabled={busy || (!construction && !reviewedPlan.length)}>{busy ? t("common.syncing") : t("ops.confirm")}</button>
            <button className="ghost-button" disabled={busy} onClick={() => { setPendingAction(null); setConstruction(null); }}>{t("ops.cancel")}</button>
          </div>
        </div>
      ) : null}
      {results.length ? (
        <div className="room-operation-results" role="status">
          <p>{t("ops.results", {
            success: results.filter((result) => !result.error).length,
            failed: results.filter((result) => result.error).length,
          })}</p>
          {results.map((result, index) => (
            <p key={index} className={result.error ? "error-text" : "hint-text"}>
              {result.label} · {result.error ?? t("ops.queued")}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
