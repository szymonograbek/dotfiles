import { useLocalSearchParams } from "expo-router";
import { TeamSettingsScreen } from "../../../src/features/teams/TeamSettingsScreen";

export default function TeamSettingsRoute() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  return <TeamSettingsScreen teamId={teamId} />;
}
