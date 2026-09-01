// ═══════════════════════════════════════════════════════════════════════════════════
// database.types.ts
//
// GENERATED FILE — DO NOT HAND-EDIT.
//
// Produced by `pnpm db:types` (`supabase gen types typescript --local > database.types.ts`)
// from the migrations in `supabase/migrations/`, which are the single source of truth for
// the schema (CONVENTIONS.md §3.4, §5; DATA_MODEL.md §13 rule 6).
//
// The CI `types-drift` job regenerates this file and runs `git diff --exit-code`, so a
// migration merged without a regenerated copy of this file fails the merge gate rather
// than surfacing as a type error weeks later (BUILD_PLAN S1-T19, S1-T20).
//
// If a row shape here looks wrong, the fix is a migration plus `pnpm db:types` in the SAME
// commit — never an edit to this file, and never a hand-written row type in a feature
// folder (CONVENTIONS.md §5: "DB row types always come from the generated root
// database.types.ts; never hand-write a row shape").
//
// This file is committed at the REPO ROOT, not under `lib/` or `types/`.
// ═══════════════════════════════════════════════════════════════════════════════════

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instanciate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      affiliations: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      application_windows: {
        Row: {
          closes_at: string
          created_at: string
          form_kind: Database["public"]["Enums"]["form_kind"]
          id: string
          opens_at: string
          term_id: string
        }
        Insert: {
          closes_at: string
          created_at?: string
          form_kind: Database["public"]["Enums"]["form_kind"]
          id?: string
          opens_at: string
          term_id: string
        }
        Update: {
          closes_at?: string
          created_at?: string
          form_kind?: Database["public"]["Enums"]["form_kind"]
          id?: string
          opens_at?: string
          term_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_windows_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          applicant_email: string
          applicant_family_name: string
          applicant_given_name: string
          created_at: string
          id: string
          payload: Json
          person_id: string | null
          proof_drive_file_id: string | null
          proof_mime_type: string | null
          proof_size_bytes: number | null
          proof_verified_at: string | null
          proof_web_view_link: string | null
          redacted_at: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["application_status"]
          submit_token_expires_at: string | null
          submit_token_hash: string | null
          submitted_at: string | null
          term_id: string
        }
        Insert: {
          applicant_email: string
          applicant_family_name: string
          applicant_given_name: string
          created_at?: string
          id?: string
          payload?: Json
          person_id?: string | null
          proof_drive_file_id?: string | null
          proof_mime_type?: string | null
          proof_size_bytes?: number | null
          proof_verified_at?: string | null
          proof_web_view_link?: string | null
          redacted_at?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          submit_token_expires_at?: string | null
          submit_token_hash?: string | null
          submitted_at?: string | null
          term_id: string
        }
        Update: {
          applicant_email?: string
          applicant_family_name?: string
          applicant_given_name?: string
          created_at?: string
          id?: string
          payload?: Json
          person_id?: string | null
          proof_drive_file_id?: string | null
          proof_mime_type?: string | null
          proof_size_bytes?: number | null
          proof_verified_at?: string | null
          proof_web_view_link?: string | null
          redacted_at?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          submit_token_expires_at?: string | null
          submit_token_hash?: string | null
          submitted_at?: string | null
          term_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          actor_role: string
          actor_user_id: string | null
          created_at: string
          id: number
          new_data: Json | null
          note: string | null
          old_data: Json | null
          operation: string
          row_id: string | null
          table_name: string
        }
        Insert: {
          actor_role: string
          actor_user_id?: string | null
          created_at?: string
          id?: number
          new_data?: Json | null
          note?: string | null
          old_data?: Json | null
          operation: string
          row_id?: string | null
          table_name: string
        }
        Update: {
          actor_role?: string
          actor_user_id?: string | null
          created_at?: string
          id?: number
          new_data?: Json | null
          note?: string | null
          old_data?: Json | null
          operation?: string
          row_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      committee_memberships: {
        Row: {
          committee_id: string
          created_at: string
          membership_id: string
        }
        Insert: {
          committee_id: string
          created_at?: string
          membership_id: string
        }
        Update: {
          committee_id?: string
          created_at?: string
          membership_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "committee_memberships_committee_id_fkey"
            columns: ["committee_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "committee_memberships_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "committee_memberships_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "v_member_directory"
            referencedColumns: ["membership_id"]
          },
        ]
      }
      committees: {
        Row: {
          code: string
          created_at: string
          department_id: string | null
          id: string
          name: string
          term_id: string
        }
        Insert: {
          code: string
          created_at?: string
          department_id?: string | null
          id?: string
          name: string
          term_id: string
        }
        Update: {
          code?: string
          created_at?: string
          department_id?: string | null
          id?: string
          name?: string
          term_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "committees_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "committees_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      confidentiality_acknowledgements: {
        Row: {
          agreement_version: string
          person_id: string
          recorded_by: string
          signed_at: string
          term_id: string
        }
        Insert: {
          agreement_version: string
          person_id: string
          recorded_by: string
          signed_at?: string
          term_id: string
        }
        Update: {
          agreement_version?: string
          person_id?: string
          recorded_by?: string
          signed_at?: string
          term_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "confidentiality_acknowledgements_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confidentiality_acknowledgements_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      department_assignments: {
        Row: {
          created_at: string
          department_id: string
          membership_id: string
        }
        Insert: {
          created_at?: string
          department_id: string
          membership_id: string
        }
        Update: {
          created_at?: string
          department_id?: string
          membership_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_assignments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_assignments_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_assignments_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "v_member_directory"
            referencedColumns: ["membership_id"]
          },
        ]
      }
      departments: {
        Row: {
          code: string
          created_at: string
          head_position: string
          id: string
          name: string
          term_id: string
        }
        Insert: {
          code: string
          created_at?: string
          head_position: string
          id?: string
          name: string
          term_id: string
        }
        Update: {
          code?: string
          created_at?: string
          head_position?: string
          id?: string
          name?: string
          term_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_head_position_fkey"
            columns: ["head_position"]
            isOneToOne: false
            referencedRelation: "officer_positions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "departments_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      member_affiliations: {
        Row: {
          affiliation_id: string
          created_at: string
          membership_id: string
        }
        Insert: {
          affiliation_id: string
          created_at?: string
          membership_id: string
        }
        Update: {
          affiliation_id?: string
          created_at?: string
          membership_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_affiliations_affiliation_id_fkey"
            columns: ["affiliation_id"]
            isOneToOne: false
            referencedRelation: "affiliations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_affiliations_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_affiliations_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "v_member_directory"
            referencedColumns: ["membership_id"]
          },
        ]
      }
      member_id_counters: {
        Row: {
          join_year: number
          last_seq: number
        }
        Insert: {
          join_year: number
          last_seq?: number
        }
        Update: {
          join_year?: number
          last_seq?: number
        }
        Relationships: []
      }
      memberships: {
        Row: {
          created_at: string
          ended_reason: string | null
          expected_grad_year: number | null
          id: string
          person_id: string
          region_id: string
          status: Database["public"]["Enums"]["membership_status"]
          term_id: string
          updated_at: string
          year_level: number | null
        }
        Insert: {
          created_at?: string
          ended_reason?: string | null
          expected_grad_year?: number | null
          id?: string
          person_id: string
          region_id: string
          status?: Database["public"]["Enums"]["membership_status"]
          term_id: string
          updated_at?: string
          year_level?: number | null
        }
        Update: {
          created_at?: string
          ended_reason?: string | null
          expected_grad_year?: number | null
          id?: string
          person_id?: string
          region_id?: string
          status?: Database["public"]["Enums"]["membership_status"]
          term_id?: string
          updated_at?: string
          year_level?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "memberships_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      mfa_recovery_codes: {
        Row: {
          code_hash: string
          code_salt: string
          consumed_at: string | null
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          code_hash: string
          code_salt: string
          consumed_at?: string | null
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          code_hash?: string
          code_salt?: string
          consumed_at?: string | null
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      officer_assignments: {
        Row: {
          committee_id: string | null
          created_at: string
          department_id: string | null
          id: string
          is_acting: boolean
          person_id: string
          role: string
          status: Database["public"]["Enums"]["officer_assignment_status"]
          status_note: string | null
          term_id: string
        }
        Insert: {
          committee_id?: string | null
          created_at?: string
          department_id?: string | null
          id?: string
          is_acting?: boolean
          person_id: string
          role: string
          status?: Database["public"]["Enums"]["officer_assignment_status"]
          status_note?: string | null
          term_id: string
        }
        Update: {
          committee_id?: string | null
          created_at?: string
          department_id?: string | null
          id?: string
          is_acting?: boolean
          person_id?: string
          role?: string
          status?: Database["public"]["Enums"]["officer_assignment_status"]
          status_note?: string | null
          term_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "officer_assignments_committee_id_fkey"
            columns: ["committee_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "officer_assignments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "officer_assignments_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "officer_assignments_role_fkey"
            columns: ["role"]
            isOneToOne: false
            referencedRelation: "officer_positions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "officer_assignments_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      officer_positions: {
        Row: {
          code: string
          grants_org_role: Database["public"]["Enums"]["org_role"]
          is_administrator: boolean
          sort_order: number
          title: string
        }
        Insert: {
          code: string
          grants_org_role: Database["public"]["Enums"]["org_role"]
          is_administrator?: boolean
          sort_order: number
          title: string
        }
        Update: {
          code?: string
          grants_org_role?: Database["public"]["Enums"]["org_role"]
          is_administrator?: boolean
          sort_order?: number
          title?: string
        }
        Relationships: []
      }
      people: {
        Row: {
          address_line: string | null
          birthdate: string | null
          city_municipality: string | null
          contact_number: string | null
          created_at: string
          family_name: string
          given_name: string
          id: string
          join_year: number
          member_id: string | null
          middle_name: string | null
          personal_email: string | null
          postal_code: string | null
          province: string | null
          redacted_at: string | null
          school: string | null
          school_id_no: string | null
          suffix: string | null
          updated_at: string
        }
        Insert: {
          address_line?: string | null
          birthdate?: string | null
          city_municipality?: string | null
          contact_number?: string | null
          created_at?: string
          family_name: string
          given_name: string
          id?: string
          join_year: number
          member_id?: string | null
          middle_name?: string | null
          personal_email?: string | null
          postal_code?: string | null
          province?: string | null
          redacted_at?: string | null
          school?: string | null
          school_id_no?: string | null
          suffix?: string | null
          updated_at?: string
        }
        Update: {
          address_line?: string | null
          birthdate?: string | null
          city_municipality?: string | null
          contact_number?: string | null
          created_at?: string
          family_name?: string
          given_name?: string
          id?: string
          join_year?: number
          member_id?: string | null
          middle_name?: string | null
          personal_email?: string | null
          postal_code?: string | null
          province?: string | null
          redacted_at?: string | null
          school?: string | null
          school_id_no?: string | null
          suffix?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rate_limit_buckets: {
        Row: {
          bucket: string
          hit_count: number
          key_hash: string
          window_started_at: string
        }
        Insert: {
          bucket: string
          hit_count?: number
          key_hash: string
          window_started_at: string
        }
        Update: {
          bucket?: string
          hit_count?: number
          key_hash?: string
          window_started_at?: string
        }
        Relationships: []
      }
      regions: {
        Row: {
          code: string
          id: string
          island_group: Database["public"]["Enums"]["island_group"]
          name: string
          sort_order: number
        }
        Insert: {
          code: string
          id?: string
          island_group: Database["public"]["Enums"]["island_group"]
          name: string
          sort_order: number
        }
        Update: {
          code?: string
          id?: string
          island_group?: Database["public"]["Enums"]["island_group"]
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      renewal_submissions: {
        Row: {
          id: string
          payload: Json
          person_id: string
          submitted_at: string
          term_id: string
        }
        Insert: {
          id?: string
          payload?: Json
          person_id: string
          submitted_at?: string
          term_id: string
        }
        Update: {
          id?: string
          payload?: Json
          person_id?: string
          submitted_at?: string
          term_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "renewal_submissions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renewal_submissions_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      rr_region_grants: {
        Row: {
          created_at: string
          granted_by: string
          region_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by: string
          region_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string
          region_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rr_region_grants_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      sensitive_column_registry: {
        Row: {
          column_name: string
          rationale: string
          table_name: string
        }
        Insert: {
          column_name: string
          rationale: string
          table_name: string
        }
        Update: {
          column_name?: string
          rationale?: string
          table_name?: string
        }
        Relationships: []
      }
      term_summaries: {
        Row: {
          counts: Json
          snapshotted_at: string
          term_id: string
        }
        Insert: {
          counts: Json
          snapshotted_at?: string
          term_id: string
        }
        Update: {
          counts?: Json
          snapshotted_at?: string
          term_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "term_summaries_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: true
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      terms: {
        Row: {
          archived_at: string | null
          created_at: string
          ends_on: string
          id: string
          label: string
          starts_on: string
          status: Database["public"]["Enums"]["term_status"]
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          ends_on: string
          id?: string
          label: string
          starts_on: string
          status?: Database["public"]["Enums"]["term_status"]
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          ends_on?: string
          id?: string
          label?: string
          starts_on?: string
          status?: Database["public"]["Enums"]["term_status"]
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          person_id: string | null
          region_id: string | null
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          person_id?: string | null
          region_id?: string | null
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          person_id?: string | null
          region_id?: string | null
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_member_directory: {
        Row: {
          committee_name: string | null
          department_name: string | null
          family_name: string | null
          given_name: string | null
          island_group: Database["public"]["Enums"]["island_group"] | null
          join_year: number | null
          member_id: string | null
          membership_id: string | null
          person_id: string | null
          region_name: string | null
          status: Database["public"]["Enums"]["membership_status"] | null
          term_id: string | null
          year_level: number | null
        }
        Relationships: [
          {
            foreignKeyName: "memberships_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      assert_confidentiality_ack: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      audit_row: {
        Args: Record<PropertyKey, never>
        Returns: unknown
      }
      auth_person_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      auth_region_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      auth_region_ids: {
        Args: Record<PropertyKey, never>
        Returns: string[]
      }
      auth_role: {
        Args: Record<PropertyKey, never>
        Returns: Database["public"]["Enums"]["org_role"]
      }
      check_rate_limit: {
        Args: {
          p_bucket: string
          p_key_hash: string
          p_limit: number
          p_window: unknown
        }
        Returns: boolean
      }
      consume_recovery_code: {
        Args: { p_code: string }
        Returns: boolean
      }
      current_term_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      finalize_application: {
        Args: {
          p_app_id: string
          p_file_ref: string
          p_mime: string
          p_size: number
          p_token: string
        }
        Returns: undefined
      }
      get_person_sensitive: {
        Args: { p_person_id: string }
        Returns: Json
      }
      has_aal2: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      has_confidentiality_ack: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_admin_reader: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_user_roles_writer: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      issue_recovery_codes: {
        Args: Record<PropertyKey, never>
        Returns: string[]
      }
      mask_sensitive: {
        Args: { p_row: Json; p_table: string }
        Returns: Json
      }
      purge_abandoned_drafts: {
        Args: { p_age?: unknown }
        Returns: {
          application_id: string
          storage_ref: string
        }[]
      }
      reject_write_to_archived_term: {
        Args: Record<PropertyKey, never>
        Returns: unknown
      }
      reject_write_to_archived_term_via_membership: {
        Args: Record<PropertyKey, never>
        Returns: unknown
      }
      set_updated_at: {
        Args: Record<PropertyKey, never>
        Returns: unknown
      }
    }
    Enums: {
      application_status: "draft" | "pending" | "approved" | "rejected"
      campaign_status: "draft" | "queued" | "sending" | "sent" | "failed"
      email_event_type:
        | "delivered"
        | "opened"
        | "clicked"
        | "bounced"
        | "complained"
      form_kind:
        | "membership_application"
        | "committee_application"
        | "membership_renewal"
        | "freeform"
      island_group: "Luzon" | "Visayas" | "Mindanao"
      membership_status:
        | "renewal_pending"
        | "active"
        | "graduated"
        | "resigned"
        | "left"
        | "terminated"
      officer_assignment_status:
        | "active"
        | "on_leave"
        | "suspended"
        | "resigned"
        | "dismissed"
        | "impeached"
        | "ended"
      org_role:
        | "exec_admin"
        | "tech_admin"
        | "crrd_admin"
        | "moderator"
        | "officer"
        | "regional_rep"
        | "member"
      recipient_status: "queued" | "sent" | "failed" | "suppressed"
      term_status: "draft" | "active" | "archived"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      application_status: ["draft", "pending", "approved", "rejected"],
      campaign_status: ["draft", "queued", "sending", "sent", "failed"],
      email_event_type: [
        "delivered",
        "opened",
        "clicked",
        "bounced",
        "complained",
      ],
      form_kind: [
        "membership_application",
        "committee_application",
        "membership_renewal",
        "freeform",
      ],
      island_group: ["Luzon", "Visayas", "Mindanao"],
      membership_status: [
        "renewal_pending",
        "active",
        "graduated",
        "resigned",
        "left",
        "terminated",
      ],
      officer_assignment_status: [
        "active",
        "on_leave",
        "suspended",
        "resigned",
        "dismissed",
        "impeached",
        "ended",
      ],
      org_role: [
        "exec_admin",
        "tech_admin",
        "crrd_admin",
        "moderator",
        "officer",
        "regional_rep",
        "member",
      ],
      recipient_status: ["queued", "sent", "failed", "suppressed"],
      term_status: ["draft", "active", "archived"],
    },
  },
} as const
