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
      discount_codes: {
        Row: {
          active: boolean
          code: string
          event_id: string
          id: string
          max_uses: number | null
          percent_off: number
          uses: number
        }
        Insert: {
          active?: boolean
          code: string
          event_id: string
          id?: string
          max_uses?: number | null
          percent_off: number
          uses?: number
        }
        Update: {
          active?: boolean
          code?: string
          event_id?: string
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
          emergency_contact_name: string
          emergency_contact_phone: string
          first_name: string
          gender: string
          id: string
          last_name: string
          leg: number | null
          purchase_id: string
        }
        Insert: {
          club?: string | null
          created_at?: string
          date_of_birth: string
          ea_number?: string | null
          emergency_contact_name: string
          emergency_contact_phone: string
          first_name: string
          gender: string
          id?: string
          last_name: string
          leg?: number | null
          purchase_id: string
        }
        Update: {
          club?: string | null
          created_at?: string
          date_of_birth?: string
          ea_number?: string | null
          emergency_contact_name?: string
          emergency_contact_phone?: string
          first_name?: string
          gender?: string
          id?: string
          last_name?: string
          leg?: number | null
          purchase_id?: string
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
          purchaser_email: string
          purchaser_name: string
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
          purchaser_email: string
          purchaser_name: string
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
          purchaser_email?: string
          purchaser_name?: string
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
          minimum_age: number | null
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
          minimum_age?: number | null
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
          minimum_age?: number | null
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
      attach_checkout_session: {
        Args: { p_purchase_id: string; p_session_id: string }
        Returns: boolean
      }
      create_pending_purchase: {
        Args: {
          p_consents: Json
          p_discount_code?: string
          p_entrants: Json
          p_fee_code: string
          p_medical: Json
          p_purchaser_email: string
          p_purchaser_name: string
          p_slug: string
        }
        Returns: Json
      }
      entry_completion_state: { Args: { p_session_id: string }; Returns: Json }
      entry_state: { Args: { p_slug: string }; Returns: Json }
      expire_pending_holds: { Args: never; Returns: Json }
      raise_attention: {
        Args: { p_detail: Json; p_purchase_id: string; p_reason: string }
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
  intake: {
    Enums: {},
  },
} as const

