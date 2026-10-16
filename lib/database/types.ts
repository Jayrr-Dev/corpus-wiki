// GENERATED FROM THE LIVE SUPABASE SCHEMA (project qeuvxnvwommyjdzxoodd), FK metadata trimmed. DO NOT EDIT BY HAND.
// Regenerate after every new migration: `npm run db:types`.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      external_source_reviews: {
        Row: {
          id: string; created_at: string; page_id: string | null; section_id: string | null; source_id: string | null;
          stage: string; outcome: string; context: Json; proposal: Json; reason: string;
          tokens_in: number | null; tokens_out: number | null;
          url: string | null; source_title: string | null; excerpts: string[]; model: string | null; prompt_version: string; reverted_at: string | null;
        }
        Insert: {
          id?: string; created_at?: string; page_id?: string | null; section_id?: string | null; source_id?: string | null;
          stage: string; outcome: string; context: Json; proposal: Json; reason: string;
          tokens_in?: number | null; tokens_out?: number | null;
          url?: string | null; source_title?: string | null; excerpts?: string[]; model?: string | null; prompt_version?: string;
        }
        Update: {
          source_id?: string | null;
        }
        Relationships: []
      }
      ai_calls: {
        Row: {
          role?: string | null
          completion_tokens: number | null
          created_at: string
          duration_ms: number
          error: string | null
          id: string
          model: string
          prompt_tokens: number | null
          purpose: string
          reasoning_effort: string | null
          reasoning_tokens: number | null
          status: string
          subject: string | null
        }
        Insert: {
          role?: string | null
          completion_tokens?: number | null
          created_at?: string
          duration_ms: number
          error?: string | null
          id?: string
          model: string
          prompt_tokens?: number | null
          purpose: string
          reasoning_effort?: string | null
          reasoning_tokens?: number | null
          status: string
          subject?: string | null
        }
        Update: {
          role?: string | null
          completion_tokens?: number | null
          created_at?: string
          duration_ms?: number
          error?: string | null
          id?: string
          model?: string
          prompt_tokens?: number | null
          purpose?: string
          reasoning_effort?: string | null
          reasoning_tokens?: number | null
          status?: string
          subject?: string | null
        }
        Relationships: []
      }
      actions: {
        Row: {
          after_revision_id: string | null
          applied_at: string | null
          after_line_revision_id: string | null
          before_line_revision_id: string | null
          before_revision_id: string | null
          change_set_id: string
          check_results: Json
          created_at: string
          expected_revision_id: string | null
          id: string
          input: Json
          outcome: Database["public"]["Enums"]["action_outcome"]
          passage_ids: string[]
          position: number
          reverted_by_event_id: string | null
          speech_act: Database["public"]["Enums"]["speech_act"] | null
          target_id: string | null
          type: Database["public"]["Enums"]["action_type"]
          undo_state: Json | null
        }
        Insert: {
          after_revision_id?: string | null
          applied_at?: string | null
          after_line_revision_id?: string | null
          before_line_revision_id?: string | null
          before_revision_id?: string | null
          change_set_id: string
          check_results?: Json
          created_at?: string
          expected_revision_id?: string | null
          id?: string
          input: Json
          outcome?: Database["public"]["Enums"]["action_outcome"]
          passage_ids?: string[]
          position: number
          reverted_by_event_id?: string | null
          speech_act?: Database["public"]["Enums"]["speech_act"] | null
          target_id?: string | null
          type: Database["public"]["Enums"]["action_type"]
          undo_state?: Json | null
        }
        Update: {
          after_revision_id?: string | null
          applied_at?: string | null
          after_line_revision_id?: string | null
          before_line_revision_id?: string | null
          before_revision_id?: string | null
          change_set_id?: string
          check_results?: Json
          created_at?: string
          expected_revision_id?: string | null
          id?: string
          input?: Json
          outcome?: Database["public"]["Enums"]["action_outcome"]
          passage_ids?: string[]
          position?: number
          reverted_by_event_id?: string | null
          speech_act?: Database["public"]["Enums"]["speech_act"] | null
          target_id?: string | null
          type?: Database["public"]["Enums"]["action_type"]
          undo_state?: Json | null
        }
        Relationships: []
      }
      change_notes: {
        Row: {
          created_at: string
          event_id: string
          id: string
          section_id: string
          summary: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          section_id: string
          summary: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          section_id?: string
          summary?: string
        }
        Relationships: []
      }
      change_sets: {
        Row: {
          actor_attribution?: Json | null
          applied_at: string | null
          author_id: string | null
          created_at: string
          event_id: string
          id: string
          model_version: string | null
          prompt_version: string | null
          proposed_by: Database["public"]["Enums"]["actor_kind"]
          status: Database["public"]["Enums"]["change_set_status"]
          summary: string
          tokens_in: number | null
          tokens_out: number | null
        }
        Insert: {
          actor_attribution?: Json | null
          applied_at?: string | null
          author_id?: string | null
          created_at?: string
          event_id: string
          id?: string
          model_version?: string | null
          prompt_version?: string | null
          proposed_by: Database["public"]["Enums"]["actor_kind"]
          status?: Database["public"]["Enums"]["change_set_status"]
          summary: string
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Update: {
          actor_attribution?: Json | null
          applied_at?: string | null
          author_id?: string | null
          created_at?: string
          event_id?: string
          id?: string
          model_version?: string | null
          prompt_version?: string | null
          proposed_by?: Database["public"]["Enums"]["actor_kind"]
          status?: Database["public"]["Enums"]["change_set_status"]
          summary?: string
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Relationships: []
      }
      domain_tabs: {
        Row: { id: string; name: string; description: string; root_ids: string[]; created_at: string }
        Insert: { id?: string; name: string; description?: string; root_ids?: string[]; created_at?: string }
        Update: { name?: string; description?: string; root_ids?: string[] }
        Relationships: []
      }
      domains: {
        Row: {
          context_entity_id?: string | null
          created_at: string
          id: string
          name: string
          parent_id: string | null
          path: string
          proposed_by: Database["public"]["Enums"]["actor_kind"]
          retired_at: string | null
        }
        Insert: {
          context_entity_id?: string | null
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
          path: string
          proposed_by: Database["public"]["Enums"]["actor_kind"]
          retired_at?: string | null
        }
        Update: {
          context_entity_id?: string | null
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
          path?: string
          proposed_by?: Database["public"]["Enums"]["actor_kind"]
          retired_at?: string | null
        }
        Relationships: []
      }
      entities: {
        Row: {
          aliases: string[]
          created_at: string
          description: string | null
          description_model: string | null
          description_updated_at: string | null
          id: string
          key: string
          merged_into_id: string | null
          name: string
          properties: Json
          retired_at: string | null
          type: string
        }
        Insert: {
          aliases?: string[]
          created_at?: string
          description?: string | null
          description_model?: string | null
          description_updated_at?: string | null
          id?: string
          key: string
          merged_into_id?: string | null
          name: string
          properties?: Json
          retired_at?: string | null
          type: string
        }
        Update: {
          aliases?: string[]
          created_at?: string
          description?: string | null
          description_model?: string | null
          description_updated_at?: string | null
          id?: string
          key?: string
          merged_into_id?: string | null
          name?: string
          properties?: Json
          retired_at?: string | null
          type?: string
        }
        Relationships: []
      }
      exceptions: {
        Row: {
          action_id: string
          created_at: string
          domain_id: string | null
          evidence: Json
          id: string
          note: string | null
          reason: Database["public"]["Enums"]["exception_reason"]
          resolved_at: string | null
          resolved_by_id: string | null
          status: Database["public"]["Enums"]["exception_status"]
        }
        Insert: {
          action_id: string
          created_at?: string
          domain_id?: string | null
          evidence?: Json
          id?: string
          note?: string | null
          reason: Database["public"]["Enums"]["exception_reason"]
          resolved_at?: string | null
          resolved_by_id?: string | null
          status?: Database["public"]["Enums"]["exception_status"]
        }
        Update: {
          action_id?: string
          created_at?: string
          domain_id?: string | null
          evidence?: Json
          id?: string
          note?: string | null
          reason?: Database["public"]["Enums"]["exception_reason"]
          resolved_at?: string | null
          resolved_by_id?: string | null
          status?: Database["public"]["Enums"]["exception_status"]
        }
        Relationships: []
      }
      line_revisions: {
        Row: {
          author: Database["public"]["Enums"]["actor_kind"]
          author_id: string | null
          content: string
          created_at: string
          event_id: string
          id: string
          line_id: string
          model_version: string | null
          replaces_revision_id: string | null
          unit_revision_ids: string[]
        }
        Insert: {
          author: Database["public"]["Enums"]["actor_kind"]
          author_id?: string | null
          content: string
          created_at?: string
          event_id: string
          id?: string
          line_id: string
          model_version?: string | null
          replaces_revision_id?: string | null
          unit_revision_ids?: string[]
        }
        Update: {
          author?: Database["public"]["Enums"]["actor_kind"]
          author_id?: string | null
          content?: string
          created_at?: string
          event_id?: string
          id?: string
          line_id?: string
          model_version?: string | null
          replaces_revision_id?: string | null
          unit_revision_ids?: string[]
        }
        Relationships: []
      }
      lines: {
        Row: {
          created_at: string
          current_revision_id: string
          id: string
          last_changed_at: string
          position: number
          retired_at: string | null
          section_id: string
        }
        Insert: {
          created_at?: string
          current_revision_id: string
          id?: string
          last_changed_at?: string
          position: number
          retired_at?: string | null
          section_id: string
        }
        Update: {
          created_at?: string
          current_revision_id?: string
          id?: string
          last_changed_at?: string
          position?: number
          retired_at?: string | null
          section_id?: string
        }
        Relationships: []
      }
      pages: {
        Row: {
          parent_page_id?: string | null
          context_entity_id?: string | null
          created_at: string
          domain_id: string | null
          entity_id: string | null
          id: string
          retired_at: string | null
          slug: string
          title: string
        }
        Insert: {
          parent_page_id?: string | null
          context_entity_id?: string | null
          created_at?: string
          domain_id?: string | null
          entity_id?: string | null
          id?: string
          retired_at?: string | null
          slug: string
          title: string
        }
        Update: {
          parent_page_id?: string | null
          context_entity_id?: string | null
          created_at?: string
          domain_id?: string | null
          entity_id?: string | null
          id?: string
          retired_at?: string | null
          slug?: string
          title?: string
        }
        Relationships: []
      }
      passages: {
        Row: {
          confidence: number
          created_at: string
          hash: string
          id: string
          location: Json
          position: number
          source_id: string
          speaker_label: string | null
          text: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          hash: string
          id?: string
          location?: Json
          position: number
          source_id: string
          speaker_label?: string | null
          text: string
        }
        Update: {
          confidence?: number
          created_at?: string
          hash?: string
          id?: string
          location?: Json
          position?: number
          source_id?: string
          speaker_label?: string | null
          text?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      relationships: {
        Row: {
          created_at: string
          event_id: string
          from_unit_id: string
          id: string
          retired_at: string | null
          to_unit_id: string
          type: Database["public"]["Enums"]["relationship_type"]
        }
        Insert: {
          created_at?: string
          event_id: string
          from_unit_id: string
          id?: string
          retired_at?: string | null
          to_unit_id: string
          type: Database["public"]["Enums"]["relationship_type"]
        }
        Update: {
          created_at?: string
          event_id?: string
          from_unit_id?: string
          id?: string
          retired_at?: string | null
          to_unit_id?: string
          type?: Database["public"]["Enums"]["relationship_type"]
        }
        Relationships: []
      }
      revisions: {
        Row: {
          author: Database["public"]["Enums"]["actor_kind"]
          author_id: string | null
          knowledge_context: Json | null
          content: string
          created_at: string
          event_id: string
          id: string
          model_version: string | null
          passage_ids: string[]
          replaces_revision_id: string | null
          source_date: string
          title: string | null
          unit_id: string
        }
        Insert: {
          author: Database["public"]["Enums"]["actor_kind"]
          author_id?: string | null
          knowledge_context?: Json | null
          content: string
          created_at?: string
          event_id: string
          id?: string
          model_version?: string | null
          passage_ids?: string[]
          replaces_revision_id?: string | null
          source_date: string
          title?: string | null
          unit_id: string
        }
        Update: {
          author?: Database["public"]["Enums"]["actor_kind"]
          author_id?: string | null
          knowledge_context?: Json | null
          content?: string
          created_at?: string
          event_id?: string
          id?: string
          model_version?: string | null
          passage_ids?: string[]
          replaces_revision_id?: string | null
          source_date?: string
          title?: string | null
          unit_id?: string
        }
        Relationships: []
      }
      section_inputs: {
        Row: {
          revision_id: string
          section_id: string
          unit_id: string
        }
        Insert: {
          revision_id: string
          section_id: string
          unit_id: string
        }
        Update: {
          revision_id?: string
          section_id?: string
          unit_id?: string
        }
        Relationships: []
      }
      sections: {
        Row: {
          body: string
          built_at: string | null
          built_with_model_version: string | null
          created_at: string
          id: string
          mode: Database["public"]["Enums"]["section_mode"]
          page_id: string
          position: number
          query: Json | null
          retired_at: string | null
          status: Database["public"]["Enums"]["section_status"]
          title: string
        }
        Insert: {
          body?: string
          built_at?: string | null
          built_with_model_version?: string | null
          created_at?: string
          id?: string
          mode?: Database["public"]["Enums"]["section_mode"]
          page_id: string
          position: number
          query?: Json | null
          retired_at?: string | null
          status?: Database["public"]["Enums"]["section_status"]
          title: string
        }
        Update: {
          body?: string
          built_at?: string | null
          built_with_model_version?: string | null
          created_at?: string
          id?: string
          mode?: Database["public"]["Enums"]["section_mode"]
          page_id?: string
          position?: number
          query?: Json | null
          retired_at?: string | null
          status?: Database["public"]["Enums"]["section_status"]
          title?: string
        }
        Relationships: []
      }
      shift_events: {
        Row: {
          actor: Database["public"]["Enums"]["actor_kind"]
          cause: Database["public"]["Enums"]["event_cause"]
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          person_id: string | null
          source_id: string | null
          status: Database["public"]["Enums"]["event_status"]
          via: string | null
        }
        Insert: {
          actor: Database["public"]["Enums"]["actor_kind"]
          cause: Database["public"]["Enums"]["event_cause"]
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          person_id?: string | null
          source_id?: string | null
          status?: Database["public"]["Enums"]["event_status"]
          via?: string | null
        }
        Update: {
          actor?: Database["public"]["Enums"]["actor_kind"]
          cause?: Database["public"]["Enums"]["event_cause"]
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          person_id?: string | null
          source_id?: string | null
          status?: Database["public"]["Enums"]["event_status"]
          via?: string | null
        }
        Relationships: []
      }
      sources: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          byte_size: number | null
          created_at: string
          hash: string
          id: string
          mime_type: string
          origin: string
          page_count: number | null
          replaced_by_id: string | null
          source_date: string
          storage_path: string
          title: string
          url: string | null
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          byte_size?: number | null
          created_at?: string
          hash: string
          id?: string
          mime_type: string
          origin?: string
          page_count?: number | null
          replaced_by_id?: string | null
          source_date: string
          storage_path: string
          title: string
          url?: string | null
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          byte_size?: number | null
          created_at?: string
          hash?: string
          id?: string
          mime_type?: string
          origin?: string
          page_count?: number | null
          replaced_by_id?: string | null
          source_date?: string
          storage_path?: string
          title?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sources_replaced_by_id_fkey"
            columns: ["replaced_by_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_domains: {
        Row: {
          domain_id: string
          unit_id: string
        }
        Insert: {
          domain_id: string
          unit_id: string
        }
        Update: {
          domain_id?: string
          unit_id?: string
        }
        Relationships: []
      }
      unit_embeddings: {
        Row: {
          created_at: string
          embedding: string
          model: string
          revision_id: string
          unit_id: string
        }
        Insert: {
          created_at?: string
          embedding: string
          model: string
          revision_id: string
          unit_id: string
        }
        Update: {
          created_at?: string
          embedding?: string
          model?: string
          revision_id?: string
          unit_id?: string
        }
        Relationships: []
      }
      unit_entities: {
        Row: {
          entity_id: string
          role: Database["public"]["Enums"]["entity_role"]
          unit_id: string
        }
        Insert: {
          entity_id: string
          role: Database["public"]["Enums"]["entity_role"]
          unit_id: string
        }
        Update: {
          entity_id?: string
          role?: Database["public"]["Enums"]["entity_role"]
          unit_id?: string
        }
        Relationships: []
      }
      units: {
        Row: {
          created_at: string
          current_revision_id: string
          epistemic_status: Database["public"]["Enums"]["epistemic_status"]
          id: string
          kind: Database["public"]["Enums"]["unit_kind"]
          last_changed_at: string
          origin: Database["public"]["Enums"]["unit_origin"]
          retired_at: string | null
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          created_at?: string
          current_revision_id: string
          epistemic_status: Database["public"]["Enums"]["epistemic_status"]
          id?: string
          kind: Database["public"]["Enums"]["unit_kind"]
          last_changed_at?: string
          origin?: Database["public"]["Enums"]["unit_origin"]
          retired_at?: string | null
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          created_at?: string
          current_revision_id?: string
          epistemic_status?: Database["public"]["Enums"]["epistemic_status"]
          id?: string
          kind?: Database["public"]["Enums"]["unit_kind"]
          last_changed_at?: string
          origin?: Database["public"]["Enums"]["unit_origin"]
          retired_at?: string | null
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      section_lines: {
        Row: {
          author: Database["public"]["Enums"]["actor_kind"] | null
          author_id: string | null
          content: string | null
          is_stale: boolean | null
          last_changed_at: string | null
          line_id: string | null
          line_revision_id: string | null
          model_version: string | null
          page_id: string | null
          position: number | null
          section_id: string | null
          unit_revision_ids: string[] | null
        }
        Relationships: []
      }
      source_units: {
        Row: {
          source_id: string | null
          unit_id: string | null
        }
        Relationships: []
      }
      source_usage: {
        Row: {
          article_count: number | null
          line_count: number | null
          source_id: string | null
          unit_count: number | null
        }
        Relationships: []
      }
      stale_lines: {
        Row: {
          author: Database["public"]["Enums"]["actor_kind"] | null
          line_id: string | null
          line_revision_id: string | null
          section_id: string | null
        }
        Relationships: []
      }
      unit_evidence: {
        Row: {
          evidence: string | null
          unit_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      read_upload_workflows: { Args: { p_event_ids: string[] }; Returns: Json };
    }
    Enums: {
      action_outcome: "pending" | "applied" | "exception" | "rejected" | "reverted"
      action_type:
        | "source_lifecycle"
        | "source_review"
        | "create_domain"
        | "create_entity"
        | "add_claim"
        | "revise_claim"
        | "retire_claim"
        | "merge_duplicates"
        | "link"
        | "set_epistemic_status"
        | "write_line"
        | "revise_line"
        | "retire_line"
        | "move_line"
        | "create_page"
        | "rename_page"
        | "review_page"
        | "retire_page"
        | "create_section"
        | "rename_section"
        | "retire_section"
        | "update_entity"
        | "retire_entity"
        | "update_domain"
        | "retire_domain"
      actor_kind: "ai" | "person"
      change_set_status:
        | "draft"
        | "checking"
        | "applied"
        | "partly_applied"
        | "rejected"
        | "reverted"
      entity_role: "subject" | "object" | "mentioned"
      epistemic_status:
        | "established"
        | "supported"
        | "assumed"
        | "hypothesis"
        | "disputed"
        | "unknown"
      event_cause: "upload" | "edit" | "revert"
      event_status:
        | "received"
        | "extracting"
        | "reconciling"
        | "checking"
        | "applied"
        | "partly_applied"
        | "failed"
        | "reverted"
      exception_reason:
        | "decision_conflict"
        | "source_tie"
        | "deletion"
        | "low_confidence"
        | "domain_tree_review"
        | "root_domain_approval"
        | "update_request"
      exception_status: "open" | "accepted" | "rejected"
      relationship_type:
        | "supports"
        | "contradicts"
        | "depends_on"
        | "part_of"
        | "derived_from"
        | "supersedes"
        | "related_to"
      section_mode: "generated" | "manual"
      section_status: "current" | "stale" | "building"
      speech_act: "stated" | "decided" | "proposed" | "asked"
      unit_kind: "fact" | "definition" | "procedure" | "decision" | "preference"
      unit_origin: "observed" | "derived"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// TABLE AND ENUM HELPERS
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"]
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"]
export type Enums<T extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][T]

// ENUM VALUES AT RUNTIME (one source for selects, filters and validation)
export const Constants = {
  public: {
    Enums: {
      action_outcome: ["pending", "applied", "exception", "rejected", "reverted"],
      action_type: [
        "source_lifecycle",
        "source_review",
        "create_domain",
        "create_entity",
        "add_claim",
        "revise_claim",
        "retire_claim",
        "merge_duplicates",
        "link",
        "set_epistemic_status",
        "write_line",
        "revise_line",
        "retire_line",
        "move_line",
        "create_page",
        "rename_page",
        "review_page",
        "retire_page",
        "create_section",
        "rename_section",
        "retire_section",
        "update_entity",
        "retire_entity",
        "update_domain",
        "retire_domain",
      ],
      actor_kind: ["ai", "person"],
      change_set_status: ["draft", "checking", "applied", "partly_applied", "rejected", "reverted"],
      entity_role: ["subject", "object", "mentioned"],
      epistemic_status: ["established", "supported", "assumed", "hypothesis", "disputed", "unknown"],
      event_cause: ["upload", "edit", "revert"],
      event_status: [
        "received",
        "extracting",
        "reconciling",
        "checking",
        "applied",
        "partly_applied",
        "failed",
        "reverted",
      ],
      exception_reason: [
        "decision_conflict",
        "source_tie",
        "deletion",
        "low_confidence",
        "domain_tree_review",
        "root_domain_approval",
        "update_request",
      ],
      exception_status: ["open", "accepted", "rejected"],
      relationship_type: [
        "supports",
        "contradicts",
        "depends_on",
        "part_of",
        "derived_from",
        "supersedes",
        "related_to",
      ],
      section_mode: ["generated", "manual"],
      section_status: ["current", "stale", "building"],
      speech_act: ["stated", "decided", "proposed", "asked"],
      unit_kind: ["fact", "definition", "procedure", "decision", "preference"],
      unit_origin: ["observed", "derived"],
    },
  },
} as const

