import { useContext } from "react";
import { LabourContext } from "../../context/LabourContext";

/**
 * Labour data + actions shared across pages (list, profile).
 * Backed by LabourProvider (in-memory mock). Same API will be backed by the server later.
 */
export default function useLabours() {
  const context = useContext(LabourContext);
  if (!context) throw new Error("useLabours must be used inside <LabourProvider>");
  return context;
}
