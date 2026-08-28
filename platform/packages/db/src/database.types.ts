export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  club: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  entries: {
    Tables: {
      admin_audit: {
        Row: {
          action: string
          actor: string
          at: string
          detail: Json
          id: string
        }
        Insert: {
          action: string
          actor: string
          at?: string
          detail?: Json
          id?: string
        }
        Update: {
          action?: string
          actor?: string
          at?: string
          detail?: Json
          id?: string
        }
        Relationships: []
      }
      admin_keys: {
        Row: {
          issued_at: string
          key_sha256: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
        }
        Insert: {
          issued_at?: string
          key_sha256: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
        }
        Update: {
          issued_at?: string
          key_sha256?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
        }
        Relationships: []
      }
      discount_codes: {
        Row: {
          active: boolean
          code: string
          event_id: string
          fee_id: string | null
          id: string
          max_uses: number | null
          percent_off: number
          uses: number
        }
        Insert: {
          active?: boolean
          code: string
          event_id: string
          fee_id?: string | null
          id?: string
          max_uses?: number | null
          percent_off: number
          uses?: number
        }
        Update: {
          active?: boolean
          code?: string
          event_id?: string
          fee_id?: string | null
          id?: string
          max_uses?: number | null
          percent_off?: number
          uses?: number
        }
        Relationships: [
          {
            foreignKeyName: "discount_codes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_codes_fee_id_fkey"
            columns: ["fee_id"]
            isOneToOne: false
            referencedRelation: "fees"
            referencedColumns: ["id"]
          },
        ]
      }
      email_outbox: {
        Row: {
          attempts: number
          created_at: string
          dedupe_key: string
          id: string
          last_attempt_at: string | null
          last_error: string | null
          provider_message_id: string | null
          purchase_id: string
          recipient: string
          sent_at: string | null
          status: string
          template: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          dedupe_key: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          provider_message_id?: string | null
          purchase_id: string
          recipient: string
          sent_at?: string | null
          status?: string
          template: string
        }
        Update: {
          attempts?: number
          created_at?: string
          dedupe_key?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          provider_message_id?: string | null
          purchase_id?: string
          recipient?: string
          sent_at?: string | null
          status?: string
          template?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_outbox_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "entry_purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      entrant_medical: {
        Row: {
          created_at: string
          entrant_id: string
          notes: string
        }
        Insert: {
          created_at?: string
          entrant_id: string
          notes: string
        }
        Update: {
          created_at?: string
          entrant_id?: string
          notes?: string
        }
        Relationships: [
          {
            foreignKeyName: "entrant_medical_entrant_id_fkey"
            columns: ["entrant_id"]
            isOneToOne: true
            referencedRelation: "entrants"
            referencedColumns: ["id"]
          },
        ]
      }
      entrants: {
        Row: {
          club: string | null
          created_at: string
          date_of_birth: string
          ea_number: string | null
          email: string | null
          emergency_contact_name: string
          emergency_contact_phone: string
          first_name: string
          gender: string | null
          gender_identity: string | null
          id: string
          last_name: string
          leg: number | null
          purchase_id: string
          role: string
        }
        Insert: {
          club?: string | null
          created_at?: string
          date_of_birth: string
          ea_number?: string | null
          email?: string | null
          emergency_contact_name: string
          emergency_contact_phone: string
          first_name: string
          gender?: string | null
          gender_identity?: string | null
          id?: string
          last_name: string
          leg?: number | null
          purchase_id: string
          role?: string
        }
        Update: {
          club?: string | null
          created_at?: string
          date_of_birth?: string
          ea_number?: string | null
          email?: string | null
          emergency_contact_name?: string
          emergency_contact_phone?: string
          first_name?: string
          gender?: string | null
          gender_identity?: string | null
          id?: string
          last_name?: string
          leg?: number | null
          purchase_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "entrants_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "entry_purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      entry_purchases: {
        Row: {
          amount_pence: number
          attention: string | null
          attention_at: string | null
          attention_detail: Json | null
          attention_resolved_at: string | null
          consent_version: string
          consents: Json
          created_at: string
          discount_code_id: string | null
          event_id: string
          fee_id: string
          hold_expires_at: string | null
          id: string
          paid_at: string | null
          person_id: string | null
          purchaser_email: string
          purchaser_name: string
          request_reason: string | null
          request_resolved_at: string | null
          requested_action: string | null
          requested_at: string | null
          revived_at: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_event_id: string | null
          stripe_payment_intent_id: string | null
        }
        Insert: {
          amount_pence: number
          attention?: string | null
          attention_at?: string | null
          attention_detail?: Json | null
          attention_resolved_at?: string | null
          consent_version: string
          consents: Json
          created_at?: string
          discount_code_id?: string | null
          event_id: string
          fee_id: string
          hold_expires_at?: string | null
          id?: string
          paid_at?: string | null
          person_id?: string | null
          purchaser_email: string
          purchaser_name: string
          request_reason?: string | null
          request_resolved_at?: string | null
          requested_action?: string | null
          requested_at?: string | null
          revived_at?: string | null
          status: string
          stripe_checkout_session_id?: string | null
          stripe_event_id?: string | null
          stripe_payment_intent_id?: string | null
        }
        Update: {
          amount_pence?: number
          attention?: string | null
          attention_at?: string | null
          attention_detail?: Json | null
          attention_resolved_at?: string | null
          consent_version?: string
          consents?: Json
          created_at?: string
          discount_code_id?: string | null
          event_id?: string
          fee_id?: string
          hold_expires_at?: string | null
          id?: string
          paid_at?: string | null
          person_id?: string | null
          purchaser_email?: string
          purchaser_name?: string
          request_reason?: string | null
          request_resolved_at?: string | null
          requested_action?: string | null
          requested_at?: string | null
          revived_at?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_event_id?: string | null
          stripe_payment_intent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entry_purchases_discount_code_id_fkey"
            columns: ["discount_code_id"]
            isOneToOne: false
            referencedRelation: "discount_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_purchases_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_purchases_fee_id_fkey"
            columns: ["fee_id"]
            isOneToOne: false
            referencedRelation: "fees"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          active: boolean
          capacity: number
          consent_version: string
          display_name: string
          entrants_per_entry: number
          entries_close_at: string | null
          entries_open_at: string | null
          event_date: string
          from_address: string
          id: string
          medical_retention: string
          minimum_age: number | null
          race_slug: string
          required_consents: string[]
          requires_dob: boolean
          slug: string
          start_time: string
        }
        Insert: {
          active?: boolean
          capacity: number
          consent_version: string
          display_name: string
          entrants_per_entry?: number
          entries_close_at?: string | null
          entries_open_at?: string | null
          event_date: string
          from_address: string
          id?: string
          medical_retention?: string
          minimum_age?: number | null
          race_slug: string
          required_consents?: string[]
          requires_dob?: boolean
          slug: string
          start_time: string
        }
        Update: {
          active?: boolean
          capacity?: number
          consent_version?: string
          display_name?: string
          entrants_per_entry?: number
          entries_close_at?: string | null
          entries_open_at?: string | null
          event_date?: string
          from_address?: string
          id?: string
          medical_retention?: string
          minimum_age?: number | null
          race_slug?: string
          required_consents?: string[]
          requires_dob?: boolean
          slug?: string
          start_time?: string
        }
        Relationships: []
      }
      fees: {
        Row: {
          active: boolean
          code: string
          event_id: string
          id: string
          label: string
          price_pence: number
          requires_ea_number: boolean
          requires_permission: string | null
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          active?: boolean
          code: string
          event_id: string
          id?: string
          label: string
          price_pence: number
          requires_ea_number?: boolean
          requires_permission?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          event_id?: string
          id?: string
          label?: string
          price_pence?: number
          requires_ea_number?: boolean
          requires_permission?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fees_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_secrets: {
        Row: {
          key_sha256: string | null
          name: string
          updated_at: string
        }
        Insert: {
          key_sha256?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          key_sha256?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_entrant_medical: {
        Args: { p_actor: string; p_entrant_id: string; p_key: string }
        Returns: Json
      }
      admin_entry_list: {
        Args: { p_event_slug: string; p_key: string }
        Returns: Json
      }
      admin_export: {
        Args: {
          p_actor: string
          p_event_slug: string
          p_key: string
          p_kind: string
        }
        Returns: Json
      }
      admin_interest_list: { Args: { p_key: string }; Returns: Json }
      admin_key_ok: { Args: { p_key: string }; Returns: boolean }
      admin_outbox_list: { Args: { p_limit?: number }; Returns: Json }
      admin_outbox_resend: { Args: { p_id: string }; Returns: Json }
      admin_sign_in: {
        Args: { p_key: string; p_person_key: string }
        Returns: Json
      }
      attach_checkout_session: {
        Args: { p_purchase_id: string; p_session_id: string }
        Returns: boolean
      }
      cancel_entry: {
        Args: { p_purchase_id: string; p_refund_reference?: string }
        Returns: Json
      }
      cancellable_purchase: { Args: { p_purchase_id: string }; Returns: Json }
      claim_outbox_batch: {
        Args: { p_key: string; p_limit?: number }
        Returns: Json
      }
      create_manual_entry: {
        Args: {
          p_consents: Json
          p_entrants: Json
          p_medical: Json
          p_purchaser_email: string
          p_purchaser_name: string
          p_reason?: string
          p_slug: string
        }
        Returns: Json
      }
      create_pending_purchase: {
        Args: {
          p_consents: Json
          p_discount_code?: string
          p_entrants: Json
          p_fee_code: string
          p_medical: Json
          p_preview?: boolean
          p_purchaser_email: string
          p_purchaser_name: string
          p_slug: string
        }
        Returns: Json
      }
      current_entry_state: { Args: { p_race_slug: string }; Returns: Json }
      delete_expired_medical_notes: { Args: never; Returns: Json }
      entrant_medical: { Args: { p_entrant_id: string }; Returns: Json }
      entry_completion_state: { Args: { p_session_id: string }; Returns: Json }
      entry_list: { Args: { p_event_slug: string }; Returns: Json }
      entry_state: { Args: { p_slug: string }; Returns: Json }
      expire_pending_holds: { Args: never; Returns: Json }
      export: { Args: { p_event_slug: string; p_kind: string }; Returns: Json }
      interest_list: { Args: never; Returns: Json }
      my_entries: { Args: never; Returns: Json }
      raise_attention: {
        Args: { p_detail: Json; p_purchase_id: string; p_reason: string }
        Returns: undefined
      }
      read_entrant_medical: {
        Args: { p_actor: string; p_entrant_id: string }
        Returns: Json
      }
      read_entry_list: { Args: { p_event_slug: string }; Returns: Json }
      read_export: {
        Args: { p_actor: string; p_event_slug: string; p_kind: string }
        Returns: Json
      }
      read_interest_list: { Args: never; Returns: Json }
      record_admin_action: {
        Args: { p_action: string; p_actor: string; p_detail: Json }
        Returns: undefined
      }
      record_checkout_event: {
        Args: {
          p_amount_total?: number
          p_client_reference_id?: string
          p_currency?: string
          p_event_type: string
          p_key: string
          p_payment_intent_id?: string
          p_session_id?: string
          p_stripe_event_id?: string
        }
        Returns: Json
      }
      record_send_result: {
        Args: {
          p_error?: string
          p_id: string
          p_key: string
          p_ok: boolean
          p_provider_message_id?: string
          p_rate_limited?: boolean
        }
        Returns: Json
      }
      request_entry_action:
        | { Args: { p_action: string; p_purchase_id: string }; Returns: Json }
        | {
            Args: { p_action: string; p_purchase_id: string; p_reason: string }
            Returns: Json
          }
      transfer_entry:
        | {
            Args: {
              p_club: string
              p_date_of_birth: string
              p_email: string
              p_emergency_contact_name: string
              p_emergency_contact_phone: string
              p_first_name: string
              p_gender: string
              p_last_name: string
              p_purchase_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_club: string
              p_date_of_birth: string
              p_ea_number: string
              p_email: string
              p_emergency_contact_name: string
              p_emergency_contact_phone: string
              p_first_name: string
              p_gender: string
              p_last_name: string
              p_purchase_id: string
            }
            Returns: Json
          }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  identity: {
    Tables: {
      audit: {
        Row: {
          action: string
          actor: string | null
          at: string
          detail: Json
          id: string
          subject: string
        }
        Insert: {
          action: string
          actor?: string | null
          at?: string
          detail?: Json
          id?: string
          subject: string
        }
        Update: {
          action?: string
          actor?: string | null
          at?: string
          detail?: Json
          id?: string
          subject?: string
        }
        Relationships: []
      }
      people: {
        Row: {
          address: string | null
          created_at: string
          date_of_birth: string | null
          gender: string | null
          id: string
          name: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          date_of_birth?: string | null
          gender?: string | null
          id: string
          name?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          date_of_birth?: string | null
          gender?: string | null
          id?: string
          name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      permissions: {
        Row: {
          description: string
          slug: string
        }
        Insert: {
          description: string
          slug: string
        }
        Update: {
          description?: string
          slug?: string
        }
        Relationships: []
      }
      reserved_grants: {
        Row: {
          email: string
          role: string
        }
        Insert: {
          email: string
          role: string
        }
        Update: {
          email?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "reserved_grants_role_fkey"
            columns: ["role"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["slug"]
          },
        ]
      }
      role_grants: {
        Row: {
          granted_at: string
          granted_by: string | null
          id: string
          person_id: string
          revoked_at: string | null
          role: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          person_id: string
          revoked_at?: string | null
          role: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          person_id?: string
          revoked_at?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_grants_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_grants_role_fkey"
            columns: ["role"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["slug"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission: string
          role: string
        }
        Insert: {
          permission: string
          role: string
        }
        Update: {
          permission?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_fkey"
            columns: ["permission"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "role_permissions_role_fkey"
            columns: ["role"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["slug"]
          },
        ]
      }
      roles: {
        Row: {
          description: string
          slug: string
        }
        Insert: {
          description: string
          slug: string
        }
        Update: {
          description?: string
          slug?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_me: { Args: never; Returns: Json }
      export_me: { Args: never; Returns: Json }
      grant_role: { Args: { p_person: string; p_role: string }; Returns: Json }
      grantable_roles: { Args: never; Returns: Json }
      has_permission: { Args: { p_permission: string }; Returns: boolean }
      has_role: { Args: { p_role: string }; Returns: boolean }
      list_people: { Args: never; Returns: Json }
      my_permissions: { Args: never; Returns: Json }
      my_roles: { Args: never; Returns: Json }
      record_identity_audit: {
        Args: {
          p_action: string
          p_actor: string
          p_detail: Json
          p_subject: string
        }
        Returns: undefined
      }
      revoke_role: { Args: { p_person: string; p_role: string }; Returns: Json }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  intake: {
    Tables: {
      nn_interest: {
        Row: {
          consent: boolean
          created_at: string
          email: string
          id: string
          name: string
        }
        Insert: {
          consent: boolean
          created_at?: string
          email: string
          id?: string
          name: string
        }
        Update: {
          consent?: boolean
          created_at?: string
          email?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      health: { Args: never; Returns: string }
      ping: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
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
  club: {
    Enums: {},
  },
  entries: {
    Enums: {},
  },
  identity: {
    Enums: {},
  },
  intake: {
    Enums: {},
  },
} as const

