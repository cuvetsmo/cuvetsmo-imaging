// ============================================================================
// types/database.ts
// ============================================================================
// Hand-written Database type for cuvetsmo-imaging. Mirrors the schema in
// supabase/migrations/0001_imaging_schema.sql one-to-one.
//
// AFTER the migration has been applied, REGENERATE this file via:
//
//   mcp__supabase-cuvetsmo__generate_typescript_types
//
// and paste the auto-generated output over the contents below. The hand
// shape is here only so `npm run build` passes before Supabase is wired.
// ============================================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// ---- shared enum-ish unions (mirrored from CHECK constraints) --------------
export type ImagingSpecies = "canine" | "feline" | "equine" | "bovine" | "exotic";

export type ImagingBodyPart =
  | "thorax"
  | "abdomen"
  | "pelvis"
  | "skull"
  | "spine"
  | "limb-fore"
  | "limb-hind"
  | "dental"
  | "other";

export type ImagingCaseModality = "DX" | "CR" | "CT" | "MR" | "US" | "RG" | "OT";
export type ImagingAtlasModality = "DX" | "CR" | "CT" | "MR" | "US" | "RG";

export type ImagingDifficulty = "intro" | "intermediate" | "advanced";

export type ImagingCaseCredibility =
  | "peer-reviewed"
  | "open-textbook"
  | "community"
  | "ai-generated"
  | "cuvet-internal"
  | "sample-demo";

export type ImagingAtlasCredibility =
  | "peer-reviewed"
  | "open-textbook"
  | "community"
  | "ai-generated"
  | "cuvet-internal";

export type ImagingProgressStatus =
  | "viewed"
  | "attempted"
  | "mastered"
  | "marked-difficult";

// Shape of the `recall` jsonb column on imaging_cases (validated client-side).
export type ImagingRecallPayload = {
  findings: string[];
  ddx: { name: string; probability?: "high" | "mid" | "low" }[];
  final_diagnosis: string;
  teaching_points?: string[];
  citation?: string;
};

// ---- Database --------------------------------------------------------------
export type Database = {
  public: {
    Tables: {
      imaging_cases: {
        Row: {
          id: string;
          slug: string;
          title: string;
          species: ImagingSpecies;
          signalment: string | null;
          history: string | null;
          body_part: ImagingBodyPart | null;
          modality: ImagingCaseModality | null;
          difficulty: ImagingDifficulty | null;
          learning_objectives: string[] | null;
          credibility: ImagingCaseCredibility;
          license: string | null;
          source_url: string | null;
          attribution: string | null;
          recall: ImagingRecallPayload | null;
          is_published: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          title: string;
          species: ImagingSpecies;
          signalment?: string | null;
          history?: string | null;
          body_part?: ImagingBodyPart | null;
          modality?: ImagingCaseModality | null;
          difficulty?: ImagingDifficulty | null;
          learning_objectives?: string[] | null;
          credibility: ImagingCaseCredibility;
          license?: string | null;
          source_url?: string | null;
          attribution?: string | null;
          recall?: ImagingRecallPayload | null;
          is_published?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          slug?: string;
          title?: string;
          species?: ImagingSpecies;
          signalment?: string | null;
          history?: string | null;
          body_part?: ImagingBodyPart | null;
          modality?: ImagingCaseModality | null;
          difficulty?: ImagingDifficulty | null;
          learning_objectives?: string[] | null;
          credibility?: ImagingCaseCredibility;
          license?: string | null;
          source_url?: string | null;
          attribution?: string | null;
          recall?: ImagingRecallPayload | null;
          is_published?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };

      imaging_case_files: {
        Row: {
          id: string;
          case_id: string;
          view_name: string;
          storage_path: string;
          mime_type: string;
          byte_size: number | null;
          order_index: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          case_id: string;
          view_name: string;
          storage_path: string;
          mime_type?: string;
          byte_size?: number | null;
          order_index?: number;
          created_at?: string;
        };
        Update: {
          case_id?: string;
          view_name?: string;
          storage_path?: string;
          mime_type?: string;
          byte_size?: number | null;
          order_index?: number;
        };
        Relationships: [
          {
            foreignKeyName: "imaging_case_files_case_id_fkey";
            columns: ["case_id"];
            referencedRelation: "imaging_cases";
            referencedColumns: ["id"];
          },
        ];
      };

      imaging_atlas_entries: {
        Row: {
          id: string;
          slug: string;
          modality: ImagingAtlasModality;
          species: ImagingSpecies;
          body_part: ImagingBodyPart;
          view: string;
          description: string;
          learning_landmarks: string[] | null;
          image_path: string;
          thumbnail_path: string | null;
          license: string;
          source_url: string | null;
          attribution: string | null;
          credibility: ImagingAtlasCredibility;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          modality: ImagingAtlasModality;
          species: ImagingSpecies;
          body_part: ImagingBodyPart;
          view: string;
          description: string;
          learning_landmarks?: string[] | null;
          image_path: string;
          thumbnail_path?: string | null;
          license: string;
          source_url?: string | null;
          attribution?: string | null;
          credibility: ImagingAtlasCredibility;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          slug?: string;
          modality?: ImagingAtlasModality;
          species?: ImagingSpecies;
          body_part?: ImagingBodyPart;
          view?: string;
          description?: string;
          learning_landmarks?: string[] | null;
          image_path?: string;
          thumbnail_path?: string | null;
          license?: string;
          source_url?: string | null;
          attribution?: string | null;
          credibility?: ImagingAtlasCredibility;
          updated_at?: string;
        };
        Relationships: [];
      };

      imaging_user_progress: {
        Row: {
          id: string;
          user_id: string;
          case_id: string | null;
          atlas_entry_id: string | null;
          status: ImagingProgressStatus;
          last_viewed_at: string;
          times_viewed: number;
        };
        Insert: {
          id?: string;
          user_id: string;
          case_id?: string | null;
          atlas_entry_id?: string | null;
          status: ImagingProgressStatus;
          last_viewed_at?: string;
          times_viewed?: number;
        };
        Update: {
          status?: ImagingProgressStatus;
          last_viewed_at?: string;
          times_viewed?: number;
        };
        Relationships: [
          {
            foreignKeyName: "imaging_user_progress_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "imaging_user_progress_case_id_fkey";
            columns: ["case_id"];
            referencedRelation: "imaging_cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "imaging_user_progress_atlas_entry_id_fkey";
            columns: ["atlas_entry_id"];
            referencedRelation: "imaging_atlas_entries";
            referencedColumns: ["id"];
          },
        ];
      };

      imaging_recall_attempts: {
        Row: {
          id: string;
          user_id: string;
          case_id: string;
          notes: string;
          confidence: number;
          self_scored_accuracy: number | null;
          revealed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          case_id: string;
          notes: string;
          confidence: number;
          self_scored_accuracy?: number | null;
          revealed_at?: string | null;
          created_at?: string;
        };
        Update: {
          notes?: string;
          confidence?: number;
          self_scored_accuracy?: number | null;
          revealed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "imaging_recall_attempts_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "imaging_recall_attempts_case_id_fkey";
            columns: ["case_id"];
            referencedRelation: "imaging_cases";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
