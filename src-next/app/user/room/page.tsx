import { Suspense } from "react";
import { RoomDetailRoute } from "../../../components/room-detail-route";

export default function RoomDetailPage() {
  return (
    <Suspense>
      <RoomDetailRoute />
    </Suspense>
  );
}
