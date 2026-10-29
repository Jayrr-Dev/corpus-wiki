import { Badge } from "@/components/ui/badge";
import { VIDEO_STATUS_LABELS, type VideoStatus } from "@/lib/video/types";

const VARIANT: Record<VideoStatus, "outline" | "secondary" | "destructive"> = { script: "outline", voicing: "outline", rendering: "outline", ready: "secondary", failed: "destructive" };

// STATUS CHIP: Script, Voicing, Rendering, Ready or Failed
export function StatusChip({ status }: { status: VideoStatus }) {
  return <Badge variant={VARIANT[status]}>{VIDEO_STATUS_LABELS[status]}</Badge>;
}
