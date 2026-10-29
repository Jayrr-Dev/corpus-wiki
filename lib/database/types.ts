// GENERATED FROM THE LIVE SUPABASE SCHEMA (project qeuvxnvwommyjdzxoodd), FK metadata trimmed. DO NOT EDIT BY HAND.
// Regenerate after every new migration: `npm run db:types`.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      // Gmail import (supabase/migrations/20261120020000_gmail_import.sql): read and
      // written only through the gmail_* functions; token_cipher is encrypted by the server
      gmail_connections: {
        Row: {
          person_id: string;
          account_email: string;
          token_cipher: string;
          label_ids: string[];
          connected_at: string;
          updated_at: string;
          last_import_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      gmail_imported_threads: {
        Row: {
          space_id: string;
          account_email: string;
          thread_id: string;
          source_id: string | null;
          imported_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // Billing (lib/billing): read and written only through the billing RPCs
      plans: {
        Row: {
          id: string;
          name: string;
          monthly_usd: number;
          yearly_usd: number | null;
          per_seat: boolean;
          seat_minimum: number;
          weekly_credits: number;
          session_credits: number | null;
          features: Json;
          model_caps: Json;
          sort_order: number;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      subscriptions: {
        Row: {
          user_id: string;
          plan_id: string;
          status: string;
          seats: number;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          period_start: string | null;
          period_end: string | null;
          cancel_at_period_end: boolean;
          stripe_event_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      usage_windows: {
        Row: {
          user_id: string;
          kind: string;
          starts_at: string;
          ends_at: string;
          credits_used: number;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // App-wide feature flags (lib/flags/registry.ts); read and written only
      // through get_feature_flags / set_feature_flag
      feature_flags: {
        Row: {
          key: string;
          enabled: boolean;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // Written only through create_agent_key / revoke_agent_key; the signed-in
      // owner may select every column but key_hash
      agent_keys: {
        Row: {
          id: string;
          owner_id: string;
          space_id: string | null;
          name: string;
          key_hash: string;
          key_prefix: string;
          scopes: string[];
          expires_at: string | null;
          revoked_at: string | null;
          last_used_at: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // Written only through record_agent_call; one of key_id and grant_id is set
      agent_calls: {
        Row: {
          id: string;
          person_id: string;
          key_id: string | null;
          grant_id: string | null;
          space_id: string | null;
          tool: string;
          scope: string;
          ok: boolean;
          error: string | null;
          ms: number;
          summary: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // OAuth clients of the MCP server; a person may select the clients they granted
      oauth_clients: {
        Row: {
          client_id: string;
          name: string;
          redirect_uris: string[];
          kind: "cimd" | "dcr";
          metadata: Json;
          fetched_at: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // A person's consent for one OAuth client; space_id null means all Spaces
      oauth_grants: {
        Row: {
          id: string;
          person_id: string;
          client_id: string;
          space_id: string | null;
          scopes: string[];
          created_at: string;
          revoked_at: string | null;
          last_used_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      spaces: {
        Row: {
          id: string;
          name: string;
          owner_id: string | null;
          created_at: string;
          deleted_at: string | null;
          subtitle: string | null;
          subtitle_for_name: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          owner_id: string;
          created_at?: string;
        };
        Update: {
          name?: string;
          subtitle?: string | null;
          subtitle_for_name?: string | null;
        };
        Relationships: [];
      };
      glossary_embeddings: {
        Row: {
          created_at: string;
          embedding: string;
          entry: Json;
          entry_hash: string;
          model: string;
        };
        Insert: {
          created_at?: string;
          embedding: string;
          entry: Json;
          entry_hash: string;
          model: string;
        };
        Update: {
          created_at?: string;
          embedding?: string;
          entry?: Json;
          entry_hash?: string;
          model?: string;
        };
        Relationships: [];
      };
      glossary_state: {
        Row: {
          live_entries: Json;
          live_input_hash: string | null;
          review_cache: Json;
          pending_entries: Json;
          identity_registry: Json;
          definition_overrides: Json;
          batches: Json;
          completed_batches: number;
          entries: Json;
          error: string | null;
          generated_at: string | null;
          generation_started_at: string | null;
          id: boolean;
          input_hash: string | null;
          lease_token: string | null;
          lease_until: string | null;
          status: string;
          total_batches: number;
        };
        Insert: {
          live_entries?: Json;
          live_input_hash?: string | null;
          review_cache?: Json;
          pending_entries?: Json;
          identity_registry?: Json;
          definition_overrides?: Json;
          batches?: Json;
          completed_batches?: number;
          entries?: Json;
          error?: string | null;
          generated_at?: string | null;
          generation_started_at?: string | null;
          id?: boolean;
          input_hash?: string | null;
          lease_token?: string | null;
          lease_until?: string | null;
          status?: string;
          total_batches?: number;
        };
        Update: {
          live_entries?: Json;
          live_input_hash?: string | null;
          review_cache?: Json;
          pending_entries?: Json;
          identity_registry?: Json;
          definition_overrides?: Json;
          batches?: Json;
          completed_batches?: number;
          entries?: Json;
          error?: string | null;
          generated_at?: string | null;
          generation_started_at?: string | null;
          id?: boolean;
          input_hash?: string | null;
          lease_token?: string | null;
          lease_until?: string | null;
          status?: string;
          total_batches?: number;
        };
        Relationships: [];
      };
      article_reviews: {
        Row: {
          id: string;
          created_at: string;
          event_id: string | null;
          proposal: Json;
          verdict: string;
          failed_checks: string[];
          reason: string;
          decided_by: string;
          target_page_id: string | null;
          section_title: string | null;
          result_page_id: string | null;
          change_set_id: string | null;
          model: string | null;
          prompt_version: string;
          tokens_in: number | null;
          tokens_out: number | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          event_id?: string | null;
          proposal: Json;
          verdict: string;
          failed_checks?: string[];
          reason: string;
          decided_by: string;
          target_page_id?: string | null;
          section_title?: string | null;
          result_page_id?: string | null;
          change_set_id?: string | null;
          model?: string | null;
          prompt_version: string;
          tokens_in?: number | null;
          tokens_out?: number | null;
        };
        Update: {
          result_page_id?: string | null;
          change_set_id?: string | null;
        };
        Relationships: [];
      };
      suggestion_runs: {
        Row: {
          id: string;
          space_id: string;
          requested_by: string | null;
          scope: Json;
          state: "queued" | "running" | "done" | "failed";
          phase: string | null;
          groups: Json | null;
          done: number;
          total: number;
          suggested: number;
          tokens_in: number;
          tokens_out: number;
          lease_token: string | null;
          lease_until: string | null;
          attempts: number;
          error: string | null;
          created_at: string;
          started_at: string | null;
          finished_at: string | null;
        };
        Insert: { id?: string; requested_by?: string | null; scope?: Json };
        Update: {
          state?: "queued" | "running" | "done" | "failed";
          phase?: string | null;
          groups?: Json | null;
          done?: number;
          total?: number;
          suggested?: number;
          tokens_in?: number;
          tokens_out?: number;
          lease_token?: string | null;
          lease_until?: string | null;
          error?: string | null;
          finished_at?: string | null;
        };
        Relationships: [];
      };
      article_suggestions: {
        Row: {
          id: string;
          space_id: string;
          run_id: string;
          group_key: string;
          kind: "create" | "merge";
          page_id: string | null;
          title: string;
          article_type: "entity" | "process" | "requirement" | "concept" | null;
          entity_id: string | null;
          scope: string;
          rationale: string;
          sections: Json;
          unit_ids: string[];
          revision_ids: string[];
          signals: Json;
          status:
            | "pending"
            | "accepting"
            | "applied"
            | "dismissed"
            | "stale"
            | "failed";
          note: string | null;
          result_page_id: string | null;
          model: string | null;
          tokens_in: number | null;
          tokens_out: number | null;
          lease_token: string | null;
          lease_until: string | null;
          attempts: number;
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
        };
        Insert: {
          id?: string;
          run_id: string;
          group_key: string;
          kind: "create" | "merge";
          page_id?: string | null;
          title: string;
          article_type?:
            | "entity"
            | "process"
            | "requirement"
            | "concept"
            | null;
          entity_id?: string | null;
          scope?: string;
          rationale?: string;
          sections: Json;
          unit_ids: string[];
          revision_ids: string[];
          signals?: Json;
          model?: string | null;
          tokens_in?: number | null;
          tokens_out?: number | null;
        };
        Update: {
          title?: string;
          status?:
            | "pending"
            | "accepting"
            | "applied"
            | "dismissed"
            | "stale"
            | "failed";
          note?: string | null;
          result_page_id?: string | null;
          lease_token?: string | null;
          lease_until?: string | null;
          attempts?: number;
          decided_at?: string | null;
          decided_by?: string | null;
          signals?: Json;
        };
        Relationships: [];
      };
      assets: {
        Row: {
          media_url: string | null;
          attribution: string | null;
          license: string | null;
          entity_id: string | null;
          deleted_at: string | null;
          id: string;
          source_id: string | null;
          kind: "image" | "video" | "audio";
          storage_path: string;
          mime_type: string;
          figure_number: number | null;
          origin: "source" | "generated" | "external";
          generated_by: string | null;
          generated_page_id: string | null;
          content_hash: string | null;
          passage_ids: string[];
          title: string | null;
          description: string | null;
          tags: string[];
          input_hash: string | null;
          described_at: string | null;
          model: string | null;
          created_at: string;
          asset_type:
            | "photo"
            | "diagram"
            | "chart"
            | "flowchart"
            | "map"
            | "screenshot"
            | "table"
            | "logo"
            | "drawing"
            | "document scan"
            | "recording"
            | "other"
            | null;
          edited_fields: ("title" | "description" | "tags" | "asset_type")[];
        };
        Insert: {
          media_url?: string | null;
          attribution?: string | null;
          license?: string | null;
          entity_id?: string | null;
          deleted_at?: string | null;
          id?: string;
          source_id?: string | null;
          kind: "image" | "video" | "audio";
          storage_path: string;
          mime_type: string;
          figure_number?: number | null;
          origin?: "source" | "generated" | "external";
          generated_by?: string | null;
          generated_page_id?: string | null;
          content_hash?: string | null;
          passage_ids?: string[];
          title?: string | null;
          description?: string | null;
          tags?: string[];
          input_hash?: string | null;
          described_at?: string | null;
          model?: string | null;
          created_at?: string;
          asset_type?:
            | "photo"
            | "diagram"
            | "chart"
            | "flowchart"
            | "map"
            | "screenshot"
            | "table"
            | "logo"
            | "drawing"
            | "document scan"
            | "recording"
            | "other"
            | null;
          edited_fields?: ("title" | "description" | "tags" | "asset_type")[];
        };
        Update: {
          deleted_at?: string | null;
          mime_type?: string;
          figure_number?: number | null;
          passage_ids?: string[];
          title?: string | null;
          description?: string | null;
          tags?: string[];
          input_hash?: string | null;
          described_at?: string | null;
          model?: string | null;
          asset_type?:
            | "photo"
            | "diagram"
            | "chart"
            | "flowchart"
            | "map"
            | "screenshot"
            | "table"
            | "logo"
            | "drawing"
            | "document scan"
            | "recording"
            | "other"
            | null;
          edited_fields?: ("title" | "description" | "tags" | "asset_type")[];
        };
        Relationships: [];
      };
      asset_tag_aliases: {
        Row: { alias: string; tag: string; created_at: string };
        Insert: { alias: string; tag: string; created_at?: string };
        Update: { tag?: string };
        Relationships: [];
      };
      external_source_reviews: {
        Row: {
          id: string;
          created_at: string;
          page_id: string | null;
          section_id: string | null;
          source_id: string | null;
          stage: string;
          outcome: string;
          context: Json;
          proposal: Json;
          reason: string;
          tokens_in: number | null;
          tokens_out: number | null;
          url: string | null;
          source_title: string | null;
          excerpts: string[];
          model: string | null;
          prompt_version: string;
          reverted_at: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          page_id?: string | null;
          section_id?: string | null;
          source_id?: string | null;
          stage: string;
          outcome: string;
          context: Json;
          proposal: Json;
          reason: string;
          tokens_in?: number | null;
          tokens_out?: number | null;
          url?: string | null;
          source_title?: string | null;
          excerpts?: string[];
          model?: string | null;
          prompt_version?: string;
        };
        Update: {
          source_id?: string | null;
        };
        Relationships: [];
      };
      ai_calls: {
        Row: {
          billed_user_id?: string | null;
          credits?: number | null;
          usage_details?: Json | null;
          role?: string | null;
          completion_tokens: number | null;
          created_at: string;
          duration_ms: number;
          error: string | null;
          id: string;
          model: string;
          prompt_tokens: number | null;
          purpose: string;
          reasoning_effort: string | null;
          reasoning_tokens: number | null;
          status: string;
          subject: string | null;
        };
        Insert: {
          billed_user_id?: string | null;
          credits?: number | null;
          usage_details?: Json | null;
          role?: string | null;
          completion_tokens?: number | null;
          created_at?: string;
          duration_ms: number;
          error?: string | null;
          id?: string;
          model: string;
          prompt_tokens?: number | null;
          purpose: string;
          reasoning_effort?: string | null;
          reasoning_tokens?: number | null;
          status: string;
          subject?: string | null;
        };
        Update: {
          billed_user_id?: string | null;
          credits?: number | null;
          usage_details?: Json | null;
          role?: string | null;
          completion_tokens?: number | null;
          created_at?: string;
          duration_ms?: number;
          error?: string | null;
          id?: string;
          model?: string;
          prompt_tokens?: number | null;
          purpose?: string;
          reasoning_effort?: string | null;
          reasoning_tokens?: number | null;
          status?: string;
          subject?: string | null;
        };
        Relationships: [];
      };
      actions: {
        Row: {
          after_revision_id: string | null;
          applied_at: string | null;
          after_line_revision_id: string | null;
          before_line_revision_id: string | null;
          before_revision_id: string | null;
          change_set_id: string;
          check_results: Json;
          created_at: string;
          expected_revision_id: string | null;
          id: string;
          input: Json;
          outcome: Database["public"]["Enums"]["action_outcome"];
          passage_ids: string[];
          position: number;
          reverted_by_event_id: string | null;
          speech_act: Database["public"]["Enums"]["speech_act"] | null;
          target_id: string | null;
          type: Database["public"]["Enums"]["action_type"];
          undo_state: Json | null;
        };
        Insert: {
          after_revision_id?: string | null;
          applied_at?: string | null;
          after_line_revision_id?: string | null;
          before_line_revision_id?: string | null;
          before_revision_id?: string | null;
          change_set_id: string;
          check_results?: Json;
          created_at?: string;
          expected_revision_id?: string | null;
          id?: string;
          input: Json;
          outcome?: Database["public"]["Enums"]["action_outcome"];
          passage_ids?: string[];
          position: number;
          reverted_by_event_id?: string | null;
          speech_act?: Database["public"]["Enums"]["speech_act"] | null;
          target_id?: string | null;
          type: Database["public"]["Enums"]["action_type"];
          undo_state?: Json | null;
        };
        Update: {
          after_revision_id?: string | null;
          applied_at?: string | null;
          after_line_revision_id?: string | null;
          before_line_revision_id?: string | null;
          before_revision_id?: string | null;
          change_set_id?: string;
          check_results?: Json;
          created_at?: string;
          expected_revision_id?: string | null;
          id?: string;
          input?: Json;
          outcome?: Database["public"]["Enums"]["action_outcome"];
          passage_ids?: string[];
          position?: number;
          reverted_by_event_id?: string | null;
          speech_act?: Database["public"]["Enums"]["speech_act"] | null;
          target_id?: string | null;
          type?: Database["public"]["Enums"]["action_type"];
          undo_state?: Json | null;
        };
        Relationships: [];
      };
      change_notes: {
        Row: {
          created_at: string;
          event_id: string;
          id: string;
          section_id: string;
          summary: string;
        };
        Insert: {
          created_at?: string;
          event_id: string;
          id?: string;
          section_id: string;
          summary: string;
        };
        Update: {
          created_at?: string;
          event_id?: string;
          id?: string;
          section_id?: string;
          summary?: string;
        };
        Relationships: [];
      };
      change_sets: {
        Row: {
          actor_attribution?: Json | null;
          applied_at: string | null;
          author_id: string | null;
          created_at: string;
          event_id: string;
          id: string;
          model_version: string | null;
          prompt_version: string | null;
          proposed_by: Database["public"]["Enums"]["actor_kind"];
          status: Database["public"]["Enums"]["change_set_status"];
          summary: string;
          tokens_in: number | null;
          tokens_out: number | null;
        };
        Insert: {
          actor_attribution?: Json | null;
          applied_at?: string | null;
          author_id?: string | null;
          created_at?: string;
          event_id: string;
          id?: string;
          model_version?: string | null;
          prompt_version?: string | null;
          proposed_by: Database["public"]["Enums"]["actor_kind"];
          status?: Database["public"]["Enums"]["change_set_status"];
          summary: string;
          tokens_in?: number | null;
          tokens_out?: number | null;
        };
        Update: {
          actor_attribution?: Json | null;
          applied_at?: string | null;
          author_id?: string | null;
          created_at?: string;
          event_id?: string;
          id?: string;
          model_version?: string | null;
          prompt_version?: string | null;
          proposed_by?: Database["public"]["Enums"]["actor_kind"];
          status?: Database["public"]["Enums"]["change_set_status"];
          summary?: string;
          tokens_in?: number | null;
          tokens_out?: number | null;
        };
        Relationships: [];
      };
      domain_tabs: {
        Row: {
          id: string;
          name: string;
          description: string;
          root_ids: string[];
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string;
          root_ids?: string[];
          created_at?: string;
        };
        Update: { name?: string; description?: string; root_ids?: string[] };
        Relationships: [];
      };
      domains: {
        Row: {
          context_entity_id?: string | null;
          created_at: string;
          id: string;
          name: string;
          parent_id: string | null;
          path: string;
          proposed_by: Database["public"]["Enums"]["actor_kind"];
          retired_at: string | null;
        };
        Insert: {
          context_entity_id?: string | null;
          created_at?: string;
          id?: string;
          name: string;
          parent_id?: string | null;
          path: string;
          proposed_by: Database["public"]["Enums"]["actor_kind"];
          retired_at?: string | null;
        };
        Update: {
          context_entity_id?: string | null;
          created_at?: string;
          id?: string;
          name?: string;
          parent_id?: string | null;
          path?: string;
          proposed_by?: Database["public"]["Enums"]["actor_kind"];
          retired_at?: string | null;
        };
        Relationships: [];
      };
      error_log: {
        Row: {
          component: string | null;
          created_at: string;
          digest: string | null;
          id: string;
          level: string;
          location: string | null;
          message: string;
          path: string | null;
          person_id: string | null;
          source: string;
          stack: string | null;
        };
        Insert: {
          component?: string | null;
          created_at?: string;
          digest?: string | null;
          id?: string;
          level?: string;
          location?: string | null;
          message: string;
          path?: string | null;
          person_id?: string | null;
          source: string;
          stack?: string | null;
        };
        Update: {
          component?: string | null;
          created_at?: string;
          digest?: string | null;
          id?: string;
          level?: string;
          location?: string | null;
          message?: string;
          path?: string | null;
          person_id?: string | null;
          source?: string;
          stack?: string | null;
        };
        Relationships: [];
      };
      entity_description_revisions: {
        Row: {
          author: Database["public"]["Enums"]["actor_kind"];
          author_id: string | null;
          created_at: string;
          description: string;
          entity_id: string;
          id: string;
          model_version: string | null;
          restored_from_id: string | null;
        };
        Insert: {
          author: Database["public"]["Enums"]["actor_kind"];
          author_id?: string | null;
          created_at?: string;
          description: string;
          entity_id: string;
          id?: string;
          model_version?: string | null;
          restored_from_id?: string | null;
        };
        Update: {
          author?: Database["public"]["Enums"]["actor_kind"];
          author_id?: string | null;
          created_at?: string;
          description?: string;
          entity_id?: string;
          id?: string;
          model_version?: string | null;
          restored_from_id?: string | null;
        };
        Relationships: [];
      };
      entities: {
        Row: {
          aliases: string[];
          created_at: string;
          description: string | null;
          description_model: string | null;
          description_updated_at: string | null;
          id: string;
          key: string;
          merged_into_id: string | null;
          name: string;
          properties: Json;
          retired_at: string | null;
          type: string;
        };
        Insert: {
          aliases?: string[];
          created_at?: string;
          description?: string | null;
          description_model?: string | null;
          description_updated_at?: string | null;
          id?: string;
          key: string;
          merged_into_id?: string | null;
          name: string;
          properties?: Json;
          retired_at?: string | null;
          type: string;
        };
        Update: {
          aliases?: string[];
          created_at?: string;
          description?: string | null;
          description_model?: string | null;
          description_updated_at?: string | null;
          id?: string;
          key?: string;
          merged_into_id?: string | null;
          name?: string;
          properties?: Json;
          retired_at?: string | null;
          type?: string;
        };
        Relationships: [];
      };
      entity_relations: {
        Row: {
          current: boolean;
          from_entity_id: string;
          link: string;
          seniority: string | null;
          share: number | null;
          since: string | null;
          title: string | null;
          to_entity_id: string;
          unit_id: string;
          until: string | null;
        };
        Insert: {
          current?: boolean;
          from_entity_id: string;
          link: string;
          seniority?: string | null;
          share?: number | null;
          since?: string | null;
          title?: string | null;
          to_entity_id: string;
          unit_id: string;
          until?: string | null;
        };
        Update: {
          current?: boolean;
          from_entity_id?: string;
          link?: string;
          seniority?: string | null;
          share?: number | null;
          since?: string | null;
          title?: string | null;
          to_entity_id?: string;
          unit_id?: string;
          until?: string | null;
        };
        Relationships: [];
      };
      entity_profiles: {
        Row: {
          entity_id: string;
          is_stakeholder: boolean;
          kind: string | null;
          relation: string | null;
          key_facts: Json;
          functions: Json;
          contacts: Json;
          person_contacts: Json;
          hidden: boolean;
          input_hash: string | null;
          generated_at: string | null;
          model: string | null;
          updated_at: string;
          web: Json | null;
          web_checked_at: string | null;
          web_hash: string | null;
          logo_url: string | null;
          person: Json | null;
        };
        Insert: {
          entity_id: string;
          is_stakeholder?: boolean;
          kind?: string | null;
          relation?: string | null;
          key_facts?: Json;
          functions?: Json;
          contacts?: Json;
          person_contacts?: Json;
          hidden?: boolean;
          input_hash?: string | null;
          generated_at?: string | null;
          model?: string | null;
          updated_at?: string;
          web?: Json | null;
          web_checked_at?: string | null;
          web_hash?: string | null;
          logo_url?: string | null;
          person?: Json | null;
        };
        Update: {
          entity_id?: string;
          is_stakeholder?: boolean;
          kind?: string | null;
          relation?: string | null;
          key_facts?: Json;
          functions?: Json;
          contacts?: Json;
          person_contacts?: Json;
          hidden?: boolean;
          input_hash?: string | null;
          generated_at?: string | null;
          model?: string | null;
          updated_at?: string;
          web?: Json | null;
          web_checked_at?: string | null;
          web_hash?: string | null;
          logo_url?: string | null;
          person?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "entity_profiles_entity_id_fkey";
            columns: ["entity_id"];
            isOneToOne: true;
            referencedRelation: "entities";
            referencedColumns: ["id"];
          },
        ];
      };
      exceptions: {
        Row: {
          action_id: string;
          created_at: string;
          domain_id: string | null;
          evidence: Json;
          id: string;
          note: string | null;
          reason: Database["public"]["Enums"]["exception_reason"];
          resolved_at: string | null;
          resolved_by_id: string | null;
          status: Database["public"]["Enums"]["exception_status"];
        };
        Insert: {
          action_id: string;
          created_at?: string;
          domain_id?: string | null;
          evidence?: Json;
          id?: string;
          note?: string | null;
          reason: Database["public"]["Enums"]["exception_reason"];
          resolved_at?: string | null;
          resolved_by_id?: string | null;
          status?: Database["public"]["Enums"]["exception_status"];
        };
        Update: {
          action_id?: string;
          created_at?: string;
          domain_id?: string | null;
          evidence?: Json;
          id?: string;
          note?: string | null;
          reason?: Database["public"]["Enums"]["exception_reason"];
          resolved_at?: string | null;
          resolved_by_id?: string | null;
          status?: Database["public"]["Enums"]["exception_status"];
        };
        Relationships: [];
      };
      line_revisions: {
        Row: {
          author: Database["public"]["Enums"]["actor_kind"];
          author_id: string | null;
          content: string;
          created_at: string;
          event_id: string;
          id: string;
          line_id: string;
          model_version: string | null;
          replaces_revision_id: string | null;
          unit_revision_ids: string[];
        };
        Insert: {
          author: Database["public"]["Enums"]["actor_kind"];
          author_id?: string | null;
          content: string;
          created_at?: string;
          event_id: string;
          id?: string;
          line_id: string;
          model_version?: string | null;
          replaces_revision_id?: string | null;
          unit_revision_ids?: string[];
        };
        Update: {
          author?: Database["public"]["Enums"]["actor_kind"];
          author_id?: string | null;
          content?: string;
          created_at?: string;
          event_id?: string;
          id?: string;
          line_id?: string;
          model_version?: string | null;
          replaces_revision_id?: string | null;
          unit_revision_ids?: string[];
        };
        Relationships: [];
      };
      lines: {
        Row: {
          created_at: string;
          current_revision_id: string;
          id: string;
          last_changed_at: string;
          position: number;
          retired_at: string | null;
          section_id: string;
        };
        Insert: {
          created_at?: string;
          current_revision_id: string;
          id?: string;
          last_changed_at?: string;
          position: number;
          retired_at?: string | null;
          section_id: string;
        };
        Update: {
          created_at?: string;
          current_revision_id?: string;
          id?: string;
          last_changed_at?: string;
          position?: number;
          retired_at?: string | null;
          section_id?: string;
        };
        Relationships: [];
      };
      pages: {
        Row: {
          parent_page_id?: string | null;
          article_type?: string | null;
          scope?: string | null;
          context_entity_id?: string | null;
          created_at: string;
          domain_id: string | null;
          entity_id: string | null;
          id: string;
          // "article" for wiki pages, "doc" for a Docs page (doc_set_id names its doc set)
          kind?: "article" | "doc";
          doc_set_id?: string | null;
          retired_at: string | null;
          slug: string;
          title: string;
        };
        Insert: {
          parent_page_id?: string | null;
          article_type?: string | null;
          scope?: string | null;
          context_entity_id?: string | null;
          created_at?: string;
          domain_id?: string | null;
          entity_id?: string | null;
          id?: string;
          retired_at?: string | null;
          slug: string;
          title: string;
        };
        Update: {
          parent_page_id?: string | null;
          article_type?: string | null;
          scope?: string | null;
          context_entity_id?: string | null;
          created_at?: string;
          domain_id?: string | null;
          entity_id?: string | null;
          id?: string;
          retired_at?: string | null;
          slug?: string;
          title?: string;
        };
        Relationships: [];
      };
      passages: {
        Row: {
          confidence: number;
          created_at: string;
          hash: string;
          id: string;
          location: Json;
          position: number;
          source_id: string;
          speaker_label: string | null;
          text: string;
        };
        Insert: {
          confidence?: number;
          created_at?: string;
          hash: string;
          id?: string;
          location?: Json;
          position: number;
          source_id: string;
          speaker_label?: string | null;
          text: string;
        };
        Update: {
          confidence?: number;
          created_at?: string;
          hash?: string;
          id?: string;
          location?: Json;
          position?: number;
          source_id?: string;
          speaker_label?: string | null;
          text?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          email: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      relationships: {
        Row: {
          created_at: string;
          event_id: string;
          from_unit_id: string;
          id: string;
          position: number | null;
          retired_at: string | null;
          to_unit_id: string;
          type: Database["public"]["Enums"]["relationship_type"];
        };
        Insert: {
          created_at?: string;
          event_id: string;
          from_unit_id: string;
          id?: string;
          position?: number | null;
          retired_at?: string | null;
          to_unit_id: string;
          type: Database["public"]["Enums"]["relationship_type"];
        };
        Update: {
          created_at?: string;
          event_id?: string;
          from_unit_id?: string;
          id?: string;
          position?: number | null;
          retired_at?: string | null;
          to_unit_id?: string;
          type?: Database["public"]["Enums"]["relationship_type"];
        };
        Relationships: [];
      };
      revisions: {
        Row: {
          author: Database["public"]["Enums"]["actor_kind"];
          author_id: string | null;
          knowledge_context: Json | null;
          content: string;
          created_at: string;
          event_id: string;
          id: string;
          model_version: string | null;
          passage_ids: string[];
          replaces_revision_id: string | null;
          source_date: string;
          structure: Json | null;
          title: string | null;
          unit_id: string;
        };
        Insert: {
          author: Database["public"]["Enums"]["actor_kind"];
          author_id?: string | null;
          knowledge_context?: Json | null;
          content: string;
          created_at?: string;
          event_id: string;
          id?: string;
          model_version?: string | null;
          passage_ids?: string[];
          replaces_revision_id?: string | null;
          source_date: string;
          structure?: Json | null;
          title?: string | null;
          unit_id: string;
        };
        Update: {
          author?: Database["public"]["Enums"]["actor_kind"];
          author_id?: string | null;
          knowledge_context?: Json | null;
          content?: string;
          created_at?: string;
          event_id?: string;
          id?: string;
          model_version?: string | null;
          passage_ids?: string[];
          replaces_revision_id?: string | null;
          source_date?: string;
          structure?: Json | null;
          title?: string | null;
          unit_id?: string;
        };
        Relationships: [];
      };
      section_inputs: {
        Row: {
          revision_id: string;
          section_id: string;
          unit_id: string;
        };
        Insert: {
          revision_id: string;
          section_id: string;
          unit_id: string;
        };
        Update: {
          revision_id?: string;
          section_id?: string;
          unit_id?: string;
        };
        Relationships: [];
      };
      sections: {
        Row: {
          body: string;
          build_cancelled: boolean;
          built_at: string | null;
          built_with_model_version: string | null;
          created_at: string;
          id: string;
          mode: Database["public"]["Enums"]["section_mode"];
          page_id: string;
          position: number;
          query: Json | null;
          retired_at: string | null;
          status: Database["public"]["Enums"]["section_status"];
          title: string;
        };
        Insert: {
          body?: string;
          build_cancelled?: boolean;
          built_at?: string | null;
          built_with_model_version?: string | null;
          created_at?: string;
          id?: string;
          mode?: Database["public"]["Enums"]["section_mode"];
          page_id: string;
          position: number;
          query?: Json | null;
          retired_at?: string | null;
          status?: Database["public"]["Enums"]["section_status"];
          title: string;
        };
        Update: {
          body?: string;
          build_cancelled?: boolean;
          built_at?: string | null;
          built_with_model_version?: string | null;
          created_at?: string;
          id?: string;
          mode?: Database["public"]["Enums"]["section_mode"];
          page_id?: string;
          position?: number;
          query?: Json | null;
          retired_at?: string | null;
          status?: Database["public"]["Enums"]["section_status"];
          title?: string;
        };
        Relationships: [];
      };
      shift_events: {
        Row: {
          actor: Database["public"]["Enums"]["actor_kind"];
          cause: Database["public"]["Enums"]["event_cause"];
          created_at: string;
          error: string | null;
          finished_at: string | null;
          id: string;
          person_id: string | null;
          source_id: string | null;
          status: Database["public"]["Enums"]["event_status"];
          via: string | null;
        };
        Insert: {
          actor: Database["public"]["Enums"]["actor_kind"];
          cause: Database["public"]["Enums"]["event_cause"];
          created_at?: string;
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          person_id?: string | null;
          source_id?: string | null;
          status?: Database["public"]["Enums"]["event_status"];
          via?: string | null;
        };
        Update: {
          actor?: Database["public"]["Enums"]["actor_kind"];
          cause?: Database["public"]["Enums"]["event_cause"];
          created_at?: string;
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          person_id?: string | null;
          source_id?: string | null;
          status?: Database["public"]["Enums"]["event_status"];
          via?: string | null;
        };
        Relationships: [];
      };
      sources: {
        Row: {
          archive_reason: string | null;
          archived_at: string | null;
          byte_size: number | null;
          created_at: string;
          hash: string;
          id: string;
          mime_type: string;
          origin: string;
          page_count: number | null;
          replaced_by_id: string | null;
          source_date: string;
          storage_path: string;
          title: string;
          url: string | null;
        };
        Insert: {
          archive_reason?: string | null;
          archived_at?: string | null;
          byte_size?: number | null;
          created_at?: string;
          hash: string;
          id?: string;
          mime_type: string;
          origin?: string;
          page_count?: number | null;
          replaced_by_id?: string | null;
          source_date: string;
          storage_path: string;
          title: string;
          url?: string | null;
        };
        Update: {
          archive_reason?: string | null;
          archived_at?: string | null;
          byte_size?: number | null;
          created_at?: string;
          hash?: string;
          id?: string;
          mime_type?: string;
          origin?: string;
          page_count?: number | null;
          replaced_by_id?: string | null;
          source_date?: string;
          storage_path?: string;
          title?: string;
          url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "sources_replaced_by_id_fkey";
            columns: ["replaced_by_id"];
            isOneToOne: false;
            referencedRelation: "sources";
            referencedColumns: ["id"];
          },
        ];
      };
      unit_domains: {
        Row: {
          domain_id: string;
          unit_id: string;
        };
        Insert: {
          domain_id: string;
          unit_id: string;
        };
        Update: {
          domain_id?: string;
          unit_id?: string;
        };
        Relationships: [];
      };
      unit_embeddings: {
        Row: {
          created_at: string;
          embedding: string;
          model: string;
          revision_id: string;
          text_version: number;
          unit_id: string;
        };
        Insert: {
          created_at?: string;
          embedding: string;
          model: string;
          revision_id: string;
          text_version?: number;
          unit_id: string;
        };
        Update: {
          created_at?: string;
          embedding?: string;
          model?: string;
          revision_id?: string;
          text_version?: number;
          unit_id?: string;
        };
        Relationships: [];
      };
      unit_entities: {
        Row: {
          entity_id: string;
          role: Database["public"]["Enums"]["entity_role"];
          unit_id: string;
        };
        Insert: {
          entity_id: string;
          role: Database["public"]["Enums"]["entity_role"];
          unit_id: string;
        };
        Update: {
          entity_id?: string;
          role?: Database["public"]["Enums"]["entity_role"];
          unit_id?: string;
        };
        Relationships: [];
      };
      units: {
        Row: {
          created_at: string;
          current_revision_id: string;
          epistemic_status: Database["public"]["Enums"]["epistemic_status"];
          id: string;
          kind: Database["public"]["Enums"]["unit_kind"];
          last_changed_at: string;
          origin: Database["public"]["Enums"]["unit_origin"];
          retired_at: string | null;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          created_at?: string;
          current_revision_id: string;
          epistemic_status: Database["public"]["Enums"]["epistemic_status"];
          id?: string;
          kind: Database["public"]["Enums"]["unit_kind"];
          last_changed_at?: string;
          origin?: Database["public"]["Enums"]["unit_origin"];
          retired_at?: string | null;
          valid_from: string;
          valid_to?: string | null;
        };
        Update: {
          created_at?: string;
          current_revision_id?: string;
          epistemic_status?: Database["public"]["Enums"]["epistemic_status"];
          id?: string;
          kind?: Database["public"]["Enums"]["unit_kind"];
          last_changed_at?: string;
          origin?: Database["public"]["Enums"]["unit_origin"];
          retired_at?: string | null;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      article_knowledge: {
        Row: {
          article_type: string | null;
          page_id: string | null;
          slug: string | null;
          title: string | null;
          unit_count: number | null;
        };
        Relationships: [];
      };
      knowledge_usage: {
        Row: {
          unit_count: number | null;
          used_unit_count: number | null;
        };
        Relationships: [];
      };
      section_knowledge: {
        Row: {
          page_id: string | null;
          position: number | null;
          section_id: string | null;
          section_title: string | null;
          unit_content: string | null;
          unit_id: string | null;
          unit_title: string | null;
        };
        Relationships: [];
      };
      section_lines: {
        Row: {
          author: Database["public"]["Enums"]["actor_kind"] | null;
          author_id: string | null;
          content: string | null;
          is_stale: boolean | null;
          last_changed_at: string | null;
          line_id: string | null;
          line_revision_id: string | null;
          model_version: string | null;
          page_id: string | null;
          position: number | null;
          section_id: string | null;
          unit_revision_ids: string[] | null;
        };
        Relationships: [];
      };
      source_units: {
        Row: {
          source_id: string | null;
          unit_id: string | null;
        };
        Relationships: [];
      };
      source_usage: {
        Row: {
          article_count: number | null;
          section_count: number | null;
          line_count: number | null;
          source_id: string | null;
          unit_count: number | null;
          used_unit_count: number | null;
        };
        Relationships: [];
      };
      stale_lines: {
        Row: {
          author: Database["public"]["Enums"]["actor_kind"] | null;
          line_id: string | null;
          line_revision_id: string | null;
          section_id: string | null;
        };
        Relationships: [];
      };
      unit_evidence: {
        Row: {
          evidence: string | null;
          unit_id: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      change_set_contexts: {
        Args: { p_change_set_ids: string[] };
        Returns: Json;
      };
      read_upload_workflows: { Args: { p_event_ids: string[] }; Returns: Json };
      sync_assets: { Args: Record<string, never>; Returns: number };
      stakeholder_structure: { Args: Record<string, never>; Returns: Json };
      rename_asset_tag: {
        Args: { p_from: string; p_to: string };
        Returns: number;
      };
      create_agent_key: {
        Args: { p_name: string; p_space: string | null; p_scopes: string[]; p_expires_at: string | null };
        Returns: Json;
      };
      revoke_agent_key: { Args: { p_id: string }; Returns: undefined };
      get_feature_flags: { Args: Record<string, never>; Returns: Json };
      check_and_reserve_usage: { Args: { p_user: string | null; p_credits: number; p_enforce?: boolean }; Returns: Json };
      settle_usage: { Args: { p_user: string; p_session_starts: string | null; p_weekly_starts: string | null; p_delta: number }; Returns: undefined };
      get_billing_account: { Args: { p_user: string }; Returns: Json };
      link_stripe_customer: { Args: { p_user: string; p_customer: string }; Returns: undefined };
      sync_subscription: { Args: { p_subscription: Json }; Returns: undefined };
      // space_billed_user and current_plan_for are SQL-internal helpers of the billing RPCs
      gmail_get_connection: { Args: { p_person_id: string }; Returns: Json };
      gmail_save_connection: { Args: { p_person_id: string; p_account_email: string; p_token_cipher: string }; Returns: undefined };
      gmail_save_tokens: { Args: { p_person_id: string; p_token_cipher: string }; Returns: boolean };
      gmail_set_labels: { Args: { p_person_id: string; p_label_ids: string[] }; Returns: boolean };
      gmail_delete_connection: { Args: { p_person_id: string }; Returns: boolean };
      gmail_mark_imported: { Args: { p_person_id: string }; Returns: undefined };
      gmail_imported_thread_ids: { Args: { p_account_email: string; p_thread_ids: string[] }; Returns: Json };
      gmail_record_thread: { Args: { p_account_email: string; p_thread_id: string; p_source_id: string | null }; Returns: boolean };
      set_feature_flag: { Args: { p_key: string; p_enabled: boolean }; Returns: Json };
      resolve_agent_key: { Args: { p_hash: string }; Returns: Json };
      resolve_oauth_token: { Args: { p_hash: string; p_resource: string }; Returns: Json };
      oauth_get_client: { Args: { p_client_id: string }; Returns: Json };
      oauth_save_client: {
        Args: { p_client_id: string; p_name: string; p_redirect_uris: string[]; p_kind: string; p_metadata: Json };
        Returns: Json;
      };
      oauth_authorize: {
        Args: {
          p_client_id: string;
          p_space: string | null;
          p_scopes: string[];
          p_code_hash: string;
          p_redirect_uri: string;
          p_code_challenge: string;
          p_resource: string;
        };
        Returns: string;
      };
      revoke_oauth_grant: { Args: { p_id: string }; Returns: undefined };
      oauth_exchange_code: {
        Args: {
          p_code_hash: string;
          p_client_id: string;
          p_redirect_uri: string;
          p_challenge: string;
          p_resource: string | null;
          p_access_hash: string;
          p_refresh_hash: string;
          p_access_seconds: number;
          p_refresh_seconds: number;
        };
        Returns: Json;
      };
      oauth_refresh: {
        Args: {
          p_refresh_hash: string;
          p_client_id: string;
          p_resource: string | null;
          p_scopes: string[] | null;
          p_access_hash: string;
          p_new_refresh_hash: string;
          p_access_seconds: number;
          p_refresh_seconds: number;
        };
        Returns: Json;
      };
      oauth_revoke_token: { Args: { p_token_hash: string; p_client_id: string | null }; Returns: undefined };
      agent_call_counts: { Args: { p_key: string }; Returns: Json };
      record_agent_call: {
        Args: {
          p_key: string;
          p_space: string | null;
          p_tool: string;
          p_scope: string;
          p_ok: boolean;
          p_error: string | null;
          p_ms: number;
          p_summary: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      action_outcome:
        | "pending"
        | "applied"
        | "exception"
        | "rejected"
        | "reverted";
      action_type:
        | "create_domain"
        | "create_entity"
        | "add_claim"
        | "revise_claim"
        | "retire_claim"
        | "merge_duplicates"
        | "place_claim"
        | "link"
        | "set_epistemic_status"
        | "write_line"
        | "revise_line"
        | "retire_line"
        | "move_line"
        | "create_page"
        | "rename_page"
        | "retire_page"
        | "create_section"
        | "rename_section"
        | "retire_section"
        | "update_section_query"
        | "update_entity"
        | "retire_entity"
        | "merge_entity"
        | "set_member"
        | "update_domain"
        | "retire_domain"
        | "source_lifecycle"
        | "source_review"
        | "review_page"
        | "glossary_update"
        | "update_page"
        | "retype_entity"
        | "approve_reviewer_budget";
      actor_kind: "ai" | "person";
      change_set_status:
        | "draft"
        | "checking"
        | "applied"
        | "partly_applied"
        | "rejected"
        | "reverted";
      entity_role: "subject" | "object" | "mentioned";
      epistemic_status:
        | "established"
        | "supported"
        | "assumed"
        | "hypothesis"
        | "disputed"
        | "unknown";
      event_cause: "upload" | "edit" | "revert";
      event_status:
        | "received"
        | "extracting"
        | "reconciling"
        | "checking"
        | "applied"
        | "partly_applied"
        | "failed"
        | "reverted";
      exception_reason:
        | "decision_conflict"
        | "source_tie"
        | "deletion"
        | "low_confidence"
        | "domain_tree_review"
        | "root_domain_approval"
        | "update_request"
        | "page_structure_review"
        | "reviewer_budget";
      exception_status: "open" | "accepted" | "rejected";
      relationship_type:
        | "supports"
        | "contradicts"
        | "depends_on"
        | "part_of"
        | "derived_from"
        | "supersedes"
        | "related_to";
      section_mode: "generated" | "manual";
      section_status: "current" | "stale" | "building";
      speech_act: "stated" | "decided" | "proposed" | "asked";
      unit_kind:
        | "fact"
        | "definition"
        | "procedure"
        | "decision"
        | "preference";
      unit_origin: "observed" | "derived";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

// TABLE AND ENUM HELPERS
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
export type Enums<T extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][T];

// ENUM VALUES AT RUNTIME (one source for selects, filters and validation)
export const Constants = {
  public: {
    Enums: {
      action_outcome: [
        "pending",
        "applied",
        "exception",
        "rejected",
        "reverted",
      ],
      action_type: [
        "create_domain",
        "create_entity",
        "add_claim",
        "revise_claim",
        "retire_claim",
        "merge_duplicates",
        "place_claim",
        "link",
        "set_epistemic_status",
        "write_line",
        "revise_line",
        "retire_line",
        "move_line",
        "create_page",
        "rename_page",
        "retire_page",
        "create_section",
        "rename_section",
        "retire_section",
        "update_section_query",
        "update_entity",
        "retire_entity",
        "merge_entity",
        "set_member",
        "update_domain",
        "retire_domain",
        "source_lifecycle",
        "source_review",
        "review_page",
        "glossary_update",
        "update_page",
        "retype_entity",
        "approve_reviewer_budget",
      ],
      actor_kind: ["ai", "person"],
      change_set_status: [
        "draft",
        "checking",
        "applied",
        "partly_applied",
        "rejected",
        "reverted",
      ],
      entity_role: ["subject", "object", "mentioned"],
      epistemic_status: [
        "established",
        "supported",
        "assumed",
        "hypothesis",
        "disputed",
        "unknown",
      ],
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
        "page_structure_review",
        "reviewer_budget",
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
} as const;
