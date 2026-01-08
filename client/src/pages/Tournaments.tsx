import { AppLayout } from "@/components/layout/AppLayout";
import { TournamentsView } from "@/components/bots/views/TournamentsView";

export default function Tournaments() {
  return (
    <AppLayout title="Bot Tournaments">
      <TournamentsView />
    </AppLayout>
  );
}
