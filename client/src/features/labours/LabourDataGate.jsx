import { WifiOff } from "lucide-react";
import { Button, EmptyState, LoadingState } from "../../components/ui";
import useLabours from "./useLabours";

/**
 * Shows the page only once the real data has been read from the server. While loading there is a spinner (never sample
 * records), and if the server cannot be read there is an error with "Try again" (never a half-filled screen).
 */
export default function LabourDataGate({ children }) {
  const { status, loadError, reload } = useLabours();

  if (status === "loading") return <LoadingState label="Loading your data..." />;
  if (status === "error") {
    return (
      <EmptyState
        icon={WifiOff}
        title="Could not load your data"
        description={`${loadError || "Something went wrong."} Nothing has been changed.`}
        action={<Button onClick={reload}>Try again</Button>}
      />
    );
  }
  return children;
}
