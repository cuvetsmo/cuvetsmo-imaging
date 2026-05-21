// Type shims for the lifted .jsx components from VetMock. JSX has no
// TypeScript signatures of its own — these declarations let App Router
// .tsx pages import them with sensible prop types.

declare module "@/components/lab/DicomViewport.jsx" {
  import type { ComponentType } from "react";
  const Component: ComponentType<{
    file: File;
    caseId?: string | null;
    syncEnabled?: boolean;
  }>;
  export default Component;
}

declare module "@/components/lab/TagInspector.jsx" {
  import type { ComponentType } from "react";
  const Component: ComponentType<{
    file: File;
    onClose: () => void;
  }>;
  export default Component;
}

declare module "@/components/lab/CaseLibraryLocal.jsx" {
  import type { ComponentType } from "react";
  const Component: ComponentType;
  export default Component;
}

declare module "@/components/lab/LabHome.jsx" {
  import type { ComponentType } from "react";
  const Component: ComponentType;
  export default Component;
}

declare module "@/components/occlusion/OcclusionView.jsx" {
  import type { ComponentType } from "react";
  const Component: ComponentType;
  export default Component;
}

declare module "@/components/lab/RecentImports.jsx" {
  import type { ComponentType } from "react";
  const Component: ComponentType;
  export default Component;
}
