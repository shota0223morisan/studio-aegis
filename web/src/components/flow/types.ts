import type { ProjectDetail, Session, StoredFile } from "../../lib/api";
import type { Flow } from "../../lib/flow";

export interface StageProps {
  project: ProjectDetail;
  flow: Flow;
  update: (fn: (f: Flow) => Flow) => void;
  session: Session;
  onFilesChange: (files: StoredFile[]) => void;
  patchProject: (p: Partial<ProjectDetail>) => void;
}
