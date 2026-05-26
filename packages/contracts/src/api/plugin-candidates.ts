export type SkillPluginCandidateSourceKind = 'project-file' | 'referenced-file' | 'repo-link';

export type SkillPluginCandidateProvenance =
  | 'uploaded-skill-md'
  | 'markdown-skill-doc'
  | 'plugin-like-link';

export interface SkillPluginCandidateDraftInput {
  artifactKind: 'skill-md' | 'markdown-skill-doc' | 'repo-plugin';
  source: string;
  title?: string;
  description?: string;
  contentExcerpt?: string;
  suggestedFiles: string[];
}

export interface SkillPluginCandidate {
  id: string;
  projectId: string;
  runId: string | null;
  sourceKind: SkillPluginCandidateSourceKind;
  sourceRef: string;
  provenance: SkillPluginCandidateProvenance;
  confidence: number;
  title?: string;
  description?: string;
  fingerprint: string;
  draftInput: SkillPluginCandidateDraftInput;
  status: 'active' | 'dismissed';
  dismissedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface SkillPluginCandidateListRequest {
  includeDismissed?: boolean;
}

export interface SkillPluginCandidateListResponse {
  candidates: SkillPluginCandidate[];
}

export interface SkillPluginCandidateDismissResponse {
  candidate: SkillPluginCandidate;
}
