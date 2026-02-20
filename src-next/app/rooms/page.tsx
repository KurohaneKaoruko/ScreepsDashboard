import { Suspense } from "react";
import { RoomDetailRoute } from "../../components/room-detail-route";

export default function RoomsPage() {
  return (
    <Suspense>
      <RoomDetailRoute />
    </Suspense>
  );
}
