export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
          consented_at: string | null
          created_at: string
          id: string
          noa_drive_file_id: string | null
          noa_mime_type: string | null
          noa_size_bytes: number | null
          noa_verified_at: string | null
          payload: Json
          person_id: string | null
          privacy_notice_version: string | null
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
          consented_at?: string | null
          created_at?: string
          id?: string
          noa_drive_file_id?: string | null
          noa_mime_type?: string | null
          noa_size_bytes?: number | null
          noa_verified_at?: string | null
          payload?: Json
          person_id?: string | null
          privacy_notice_version?: string | null
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
          consented_at?: string | null
          created_at?: string
          id?: string
          noa_drive_file_id?: string | null
          noa_mime_type?: string | null
          noa_size_bytes?: number | null
          noa_verified_at?: string | null
          payload?: Json
          person_id?: string | null
          privacy_notice_version?: string | null
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
            foreignKeyName: "applications_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_email_merge_fields"
            referencedColumns: ["person_id"]
          },
          {
            foreignKeyName: "applications_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_member_directory"
            referencedColumns: ["person_id"]
          },
          {
            foreignKeyName: "applications_privacy_notice_version_fkey"
            columns: ["privacy_notice_version"]
            isOneToOne: false
            referencedRelation: "privacy_notice_versions"
            referencedColumns: ["version"]
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
            foreignKeyName: "committee_memberships_committee_id_fkey"
            columns: ["committee_id"]
            isOneToOne: false
            referencedRelation: "v_membership_committee_counts"
            referencedColumns: ["committee_id"]
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
            foreignKeyName: "confidentiality_acknowledgements_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_email_merge_fields"
            referencedColumns: ["person_id"]
          },
          {
            foreignKeyName: "confidentiality_acknowledgements_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_member_directory"
            referencedColumns: ["person_id"]
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
      email_campaigns: {
        Row: {
          audience_filter: Json
          body_html: string
          body_markdown: string
          created_at: string
          created_by: string
          failed_count: number
          form_kind: Database["public"]["Enums"]["form_kind"]
          id: string
          queued_at: string | null
          recipient_count: number
          sent_at: string | null
          sent_count: number
          status: Database["public"]["Enums"]["campaign_status"]
          subject: string
          template_key: string
          term_id: string
        }
        Insert: {
          audience_filter?: Json
          body_html: string
          body_markdown: string
          created_at?: string
          created_by: string
          failed_count?: number
          form_kind?: Database["public"]["Enums"]["form_kind"]
          id?: string
          queued_at?: string | null
          recipient_count?: number
          sent_at?: string | null
          sent_count?: number
          status?: Database["public"]["Enums"]["campaign_status"]
          subject: string
          template_key: string
          term_id: string
        }
        Update: {
          audience_filter?: Json
          body_html?: string
          body_markdown?: string
          created_at?: string
          created_by?: string
          failed_count?: number
          form_kind?: Database["public"]["Enums"]["form_kind"]
          id?: string
          queued_at?: string | null
          recipient_count?: number
          sent_at?: string | null
          sent_count?: number
          status?: Database["public"]["Enums"]["campaign_status"]
          subject?: string
          template_key?: string
          term_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_campaigns_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      email_recipients: {
        Row: {
          campaign_id: string
          claimed_at: string | null
          created_at: string
          error: string | null
          id: string
          merge: Json
          person_id: string
          provider_message_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["recipient_status"]
          to_email: string
        }
        Insert: {
          campaign_id: string
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          merge: Json
          person_id: string
          provider_message_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["recipient_status"]
          to_email: string
        }
        Update: {
          campaign_id?: string
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          merge?: Json
          person_id?: string
          provider_message_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["recipient_status"]
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_recipients_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_recipients_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_email_merge_fields"
            referencedColumns: ["person_id"]
          },
          {
            foreignKeyName: "email_recipients_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_member_directory"
            referencedColumns: ["person_id"]
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
            foreignKeyName: "memberships_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_email_merge_fields"
            referencedColumns: ["person_id"]
          },
          {
            foreignKeyName: "memberships_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_member_directory"
            referencedColumns: ["person_id"]
          },
          {
            foreignKeyName: "memberships_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "v_membership_region_counts"
            referencedColumns: ["region_id"]
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
            foreignKeyName: "officer_assignments_committee_id_fkey"
            columns: ["committee_id"]
            isOneToOne: false
            referencedRelation: "v_membership_committee_counts"
            referencedColumns: ["committee_id"]
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
            foreignKeyName: "officer_assignments_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_email_merge_fields"
            referencedColumns: ["person_id"]
          },
          {
            foreignKeyName: "officer_assignments_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_member_directory"
            referencedColumns: ["person_id"]
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
          award_year: number | null
          birthdate: string | null
          city_municipality: string | null
          contact_number: string | null
          created_at: string
          facebook_account: string | null
          family_name: string
          given_name: string
          id: string
          join_year: number
          member_id: string | null
          middle_name: string | null
          personal_email: string | null
          postal_code: string | null
          program_id: string | null
          province: string | null
          redacted_at: string | null
          scholarship_award:
            | Database["public"]["Enums"]["scholarship_award"]
            | null
          school: string | null
          school_id_no: string | null
          sex: Database["public"]["Enums"]["sex_option"] | null
          suffix: string | null
          university_id: string | null
          updated_at: string
        }
        Insert: {
          address_line?: string | null
          award_year?: number | null
          birthdate?: string | null
          city_municipality?: string | null
          contact_number?: string | null
          created_at?: string
          facebook_account?: string | null
          family_name: string
          given_name: string
          id?: string
          join_year: number
          member_id?: string | null
          middle_name?: string | null
          personal_email?: string | null
          postal_code?: string | null
          program_id?: string | null
          province?: string | null
          redacted_at?: string | null
          scholarship_award?:
            | Database["public"]["Enums"]["scholarship_award"]
            | null
          school?: string | null
          school_id_no?: string | null
          sex?: Database["public"]["Enums"]["sex_option"] | null
          suffix?: string | null
          university_id?: string | null
          updated_at?: string
        }
        Update: {
          address_line?: string | null
          award_year?: number | null
          birthdate?: string | null
          city_municipality?: string | null
          contact_number?: string | null
          created_at?: string
          facebook_account?: string | null
          family_name?: string
          given_name?: string
          id?: string
          join_year?: number
          member_id?: string | null
          middle_name?: string | null
          personal_email?: string | null
          postal_code?: string | null
          program_id?: string | null
          province?: string | null
          redacted_at?: string | null
          scholarship_award?:
            | Database["public"]["Enums"]["scholarship_award"]
            | null
          school?: string | null
          school_id_no?: string | null
          sex?: Database["public"]["Enums"]["sex_option"] | null
          suffix?: string | null
          university_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "people_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "people_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      privacy_notice_versions: {
        Row: {
          body_sha256: string
          created_at: string
          effective_at: string
          url: string
          version: string
        }
        Insert: {
          body_sha256: string
          created_at?: string
          effective_at: string
          url: string
          version: string
        }
        Update: {
          body_sha256?: string
          created_at?: string
          effective_at?: string
          url?: string
          version?: string
        }
        Relationships: []
      }
      programs: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order: number
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
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
          consented_at: string | null
          created_at: string
          id: string
          noa_drive_file_id: string | null
          noa_mime_type: string | null
          noa_size_bytes: number | null
          noa_verified_at: string | null
          payload: Json
          person_id: string
          privacy_notice_version: string | null
          proof_drive_file_id: string | null
          proof_mime_type: string | null
          proof_size_bytes: number | null
          proof_verified_at: string | null
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
          consented_at?: string | null
          created_at?: string
          id?: string
          noa_drive_file_id?: string | null
          noa_mime_type?: string | null
          noa_size_bytes?: number | null
          noa_verified_at?: string | null
          payload?: Json
          person_id: string
          privacy_notice_version?: string | null
          proof_drive_file_id?: string | null
          proof_mime_type?: string | null
          proof_size_bytes?: number | null
          proof_verified_at?: string | null
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
          consented_at?: string | null
          created_at?: string
          id?: string
          noa_drive_file_id?: string | null
          noa_mime_type?: string | null
          noa_size_bytes?: number | null
          noa_verified_at?: string | null
          payload?: Json
          person_id?: string
          privacy_notice_version?: string | null
          proof_drive_file_id?: string | null
          proof_mime_type?: string | null
          proof_size_bytes?: number | null
          proof_verified_at?: string | null
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
            foreignKeyName: "renewal_submissions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renewal_submissions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_email_merge_fields"
            referencedColumns: ["person_id"]
          },
          {
            foreignKeyName: "renewal_submissions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_member_directory"
            referencedColumns: ["person_id"]
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
          {
            foreignKeyName: "rr_region_grants_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "v_membership_region_counts"
            referencedColumns: ["region_id"]
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
      universities: {
        Row: {
          city_municipality: string | null
          created_at: string
          id: string
          is_active: boolean
          kind: string
          name: string
          region_id: string
        }
        Insert: {
          city_municipality?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          kind: string
          name: string
          region_id: string
        }
        Update: {
          city_municipality?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          region_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "universities_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "universities_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "v_membership_region_counts"
            referencedColumns: ["region_id"]
          },
        ]
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
            foreignKeyName: "user_roles_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "v_email_merge_fields"
            referencedColumns: ["person_id"]
          },
          {
            foreignKeyName: "user_roles_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "v_member_directory"
            referencedColumns: ["person_id"]
          },
          {
            foreignKeyName: "user_roles_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "v_membership_region_counts"
            referencedColumns: ["region_id"]
          },
        ]
      }
    }
    Views: {
      pg_all_foreign_keys: {
        Row: {
          fk_columns: unknown[] | null
          fk_constraint_name: unknown
          fk_schema_name: unknown
          fk_table_name: unknown
          fk_table_oid: unknown
          is_deferrable: boolean | null
          is_deferred: boolean | null
          match_type: string | null
          on_delete: string | null
          on_update: string | null
          pk_columns: unknown[] | null
          pk_constraint_name: unknown
          pk_index_name: unknown
          pk_schema_name: unknown
          pk_table_name: unknown
          pk_table_oid: unknown
        }
        Relationships: []
      }
      tap_funky: {
        Row: {
          args: string | null
          is_definer: boolean | null
          is_strict: boolean | null
          is_visible: boolean | null
          kind: unknown
          langoid: unknown
          name: unknown
          oid: unknown
          owner: unknown
          returns: string | null
          returns_set: boolean | null
          schema: unknown
          volatility: string | null
        }
        Relationships: []
      }
      v_email_merge_fields: {
        Row: {
          committee_name: string | null
          department_name: string | null
          family_name: string | null
          given_name: string | null
          island_group: string | null
          join_year: number | null
          member_id: string | null
          person_id: string | null
          region_id: string | null
          region_name: string | null
          status: Database["public"]["Enums"]["membership_status"] | null
          term_id: string | null
          term_label: string | null
          year_level: number | null
        }
        Relationships: [
          {
            foreignKeyName: "memberships_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "v_membership_region_counts"
            referencedColumns: ["region_id"]
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
      v_membership_committee_counts: {
        Row: {
          committee_code: string | null
          committee_id: string | null
          committee_name: string | null
          member_count: number | null
          term_id: string | null
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
      v_membership_region_counts: {
        Row: {
          island_group: Database["public"]["Enums"]["island_group"] | null
          member_count: number | null
          region_code: string | null
          region_id: string | null
          region_name: string | null
          sort_order: number | null
          term_id: string | null
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
      v_membership_status_counts: {
        Row: {
          member_count: number | null
          status: Database["public"]["Enums"]["membership_status"] | null
          term_id: string | null
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
      _cleanup: { Args: never; Returns: boolean }
      _contract_on: { Args: { "": string }; Returns: unknown }
      _currtest: { Args: never; Returns: number }
      _db_privs: { Args: never; Returns: unknown[] }
      _extensions: { Args: never; Returns: unknown[] }
      _get: { Args: { "": string }; Returns: number }
      _get_latest: { Args: { "": string }; Returns: number[] }
      _get_note: { Args: { "": string }; Returns: string }
      _is_verbose: { Args: never; Returns: boolean }
      _prokind: { Args: { p_oid: unknown }; Returns: unknown }
      _query: { Args: { "": string }; Returns: string }
      _refine_vol: { Args: { "": string }; Returns: string }
      _retval: { Args: { "": string }; Returns: string }
      _table_privs: { Args: never; Returns: unknown[] }
      _temptypes: { Args: { "": string }; Returns: string }
      _todo: { Args: never; Returns: string }
      allocate_member_id: { Args: { p_person_id: string }; Returns: string }
      approve_all_pending: { Args: never; Returns: Json }
      approve_application: { Args: { p_app_id: string }; Returns: string }
      approve_renewal: { Args: { p_id: string }; Returns: string }
      assert_confidentiality_ack: { Args: never; Returns: undefined }
      auth_person_id: { Args: never; Returns: string }
      auth_region_id: { Args: never; Returns: string }
      auth_region_ids: { Args: never; Returns: string[] }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["org_role"]
      }
      check_rate_limit: {
        Args: {
          p_bucket: string
          p_key_hash: string
          p_limit: number
          p_window: string
        }
        Returns: boolean
      }
      check_submission_standards: {
        Args: { p_email: string; p_payload: Json }
        Returns: string[]
      }
      claim_campaign_batch: {
        Args: { p_campaign_id: string; p_limit?: number }
        Returns: {
          merge: Json
          recipient_id: string
          to_email: string
        }[]
      }
      col_is_null:
        | {
            Args: {
              column_name: unknown
              description?: string
              schema_name: unknown
              table_name: unknown
            }
            Returns: string
          }
        | {
            Args: {
              column_name: unknown
              description?: string
              table_name: unknown
            }
            Returns: string
          }
      col_not_null:
        | {
            Args: {
              column_name: unknown
              description?: string
              schema_name: unknown
              table_name: unknown
            }
            Returns: string
          }
        | {
            Args: {
              column_name: unknown
              description?: string
              table_name: unknown
            }
            Returns: string
          }
      consume_recovery_code: { Args: { p_code: string }; Returns: boolean }
      current_term_id: { Args: never; Returns: string }
      diag:
        | {
            Args: { msg: unknown }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.diag(msg => text), public.diag(msg => anyelement). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
        | {
            Args: { msg: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.diag(msg => text), public.diag(msg => anyelement). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
      diag_test_name: { Args: { "": string }; Returns: string }
      do_tap:
        | { Args: never; Returns: string[] }
        | { Args: { "": string }; Returns: string[] }
      fail:
        | { Args: never; Returns: string }
        | { Args: { "": string }; Returns: string }
      finalize_application: {
        Args: {
          p_app_id: string
          p_file_ref: string
          p_mime: string
          p_noa_mime: string
          p_noa_ref: string
          p_noa_size: number
          p_size: number
          p_token: string
        }
        Returns: undefined
      }
      finalize_renewal: {
        Args: {
          p_file_ref: string
          p_id: string
          p_mime: string
          p_noa_mime: string
          p_noa_ref: string
          p_noa_size: number
          p_size: number
          p_token: string
        }
        Returns: undefined
      }
      findfuncs: { Args: { "": string }; Returns: string[] }
      finish: { Args: { exception_on_failure?: boolean }; Returns: string[] }
      finish_recipient: {
        Args: {
          p_error?: string
          p_ok: boolean
          p_provider_id?: string
          p_recipient_id: string
        }
        Returns: undefined
      }
      format_type_string: { Args: { "": string }; Returns: string }
      get_application_detail: { Args: { p_app_id: string }; Returns: Json }
      get_member_record: { Args: { p_person_id: string }; Returns: Json }
      get_person_sensitive: { Args: { p_person_id: string }; Returns: Json }
      get_renewal_detail: { Args: { p_id: string }; Returns: Json }
      has_aal2: { Args: never; Returns: boolean }
      has_confidentiality_ack: { Args: never; Returns: boolean }
      has_unique: { Args: { "": string }; Returns: string }
      health_ping: { Args: never; Returns: number }
      in_todo: { Args: never; Returns: boolean }
      is_admin_reader: { Args: never; Returns: boolean }
      is_empty: { Args: { "": string }; Returns: string }
      is_user_roles_writer: { Args: never; Returns: boolean }
      isnt_empty: { Args: { "": string }; Returns: string }
      issue_recovery_codes: { Args: never; Returns: string[] }
      list_audience_candidates: {
        Args: {
          p_filter?: Json
          p_limit?: number
          p_offset?: number
          p_q?: string
        }
        Returns: {
          committee_name: string
          department_name: string
          family_name: string
          given_name: string
          member_id: string
          person_id: string
          position_title: string
          region_name: string
          status: string
          total_count: number
        }[]
      }
      list_pending_standards: {
        Args: { p_term_id?: string }
        Returns: {
          application_id: string
          failures: string[]
        }[]
      }
      list_region_member_contacts: {
        Args: { p_university_id?: string }
        Returns: {
          contact_number: string
          facebook_account: string
          family_name: string
          given_name: string
          member_id: string
          membership_id: string
          person_id: string
          personal_email: string
          region_id: string
          region_name: string
          status: Database["public"]["Enums"]["membership_status"]
          university_id: string
          university_name: string
        }[]
      }
      lives_ok: { Args: { "": string }; Returns: string }
      log_document_view: { Args: { p_app_id: string }; Returns: undefined }
      log_renewal_document_view: { Args: { p_id: string }; Returns: undefined }
      mask_sensitive: { Args: { p_row: Json; p_table: string }; Returns: Json }
      no_plan: { Args: never; Returns: boolean[] }
      num_failed: { Args: never; Returns: number }
      os_name: { Args: never; Returns: string }
      pass:
        | { Args: never; Returns: string }
        | { Args: { "": string }; Returns: string }
      pg_version: { Args: never; Returns: string }
      pg_version_num: { Args: never; Returns: number }
      pgtap_version: { Args: never; Returns: number }
      purge_abandoned_drafts: {
        Args: { p_age?: string }
        Returns: {
          application_id: string
          storage_ref: string
        }[]
      }
      purge_abandoned_renewal_drafts: {
        Args: { p_age?: string }
        Returns: {
          noa_ref: string
          renewal_id: string
          storage_ref: string
        }[]
      }
      reject_application: {
        Args: { p_app_id: string; p_reason: string }
        Returns: undefined
      }
      reject_renewal: {
        Args: { p_id: string; p_note: string }
        Returns: undefined
      }
      resolve_recipients: {
        Args: { p_filter?: Json }
        Returns: {
          email: string
          merge: Json
          person_id: string
        }[]
      }
      runtests:
        | { Args: never; Returns: string[] }
        | { Args: { "": string }; Returns: string[] }
      search_member_directory: {
        Args: {
          p_committee_ids?: string[]
          p_department_ids?: string[]
          p_q?: string
          p_region_ids?: string[]
          p_statuses?: Database["public"]["Enums"]["membership_status"][]
          p_term_id?: string
        }
        Returns: {
          committee_names: string[]
          department_names: string[]
          family_name: string
          given_name: string
          island_group: Database["public"]["Enums"]["island_group"]
          join_year: number
          member_id: string
          membership_id: string
          person_id: string
          region_name: string
          status: Database["public"]["Enums"]["membership_status"]
          term_id: string
          year_level: number
        }[]
      }
      send_campaign: { Args: { p_campaign_id: string }; Returns: number }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      skip:
        | { Args: { "": string }; Returns: string }
        | { Args: { how_many: number; why: string }; Returns: string }
      start_renewal: {
        Args: {
          p_email: string
          p_member_id: string
          p_payload: Json
          p_token_expires_at: string
          p_token_hash: string
        }
        Returns: string
      }
      throws_ok: { Args: { "": string }; Returns: string }
      todo:
        | { Args: { how_many: number }; Returns: boolean[] }
        | { Args: { how_many: number; why: string }; Returns: boolean[] }
        | { Args: { why: string }; Returns: boolean[] }
        | { Args: { how_many: number; why: string }; Returns: boolean[] }
      todo_end: { Args: never; Returns: boolean[] }
      todo_start:
        | { Args: never; Returns: boolean[] }
        | { Args: { "": string }; Returns: boolean[] }
      update_member_record: {
        Args: {
          p_expected_updated_at: string
          p_patch: Json
          p_person_id: string
        }
        Returns: undefined
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
      scholarship_award:
        | "ra_7687"
        | "merit"
        | "jlss_ra_7687"
        | "jlss_merit"
        | "jlss_ra_10612"
      sex_option: "male" | "female" | "prefer_not_to_say"
      term_status: "draft" | "active" | "archived"
    }
    CompositeTypes: {
      _time_trial_type: {
        a_time: number | null
      }
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
      scholarship_award: [
        "ra_7687",
        "merit",
        "jlss_ra_7687",
        "jlss_merit",
        "jlss_ra_10612",
      ],
      sex_option: ["male", "female", "prefer_not_to_say"],
      term_status: ["draft", "active", "archived"],
    },
  },
} as const

