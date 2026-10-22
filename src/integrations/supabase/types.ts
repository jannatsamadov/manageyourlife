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
      api_audit_log: {
        Row: {
          action: string
          created_at: string
          error: string | null
          id: number
          ok: boolean
          target_id: string | null
          token_id: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          error?: string | null
          id?: never
          ok: boolean
          target_id?: string | null
          token_id?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          error?: string | null
          id?: never
          ok?: boolean
          target_id?: string | null
          token_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_audit_log_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "api_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      api_tokens: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          scopes: string[]
          token_hash: string
          token_prefix: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          scopes: string[]
          token_hash: string
          token_prefix: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          scopes?: string[]
          token_hash?: string
          token_prefix?: string
          user_id?: string
        }
        Relationships: []
      }
      google_connections: {
        Row: {
          calendar_id: string
          connected_at: string
          google_email: string | null
          last_calendar_sync_at: string | null
          last_error: string | null
          last_tasks_import_at: string | null
          scopes: string[]
          user_id: string
        }
        Insert: {
          calendar_id?: string
          connected_at?: string
          google_email?: string | null
          last_calendar_sync_at?: string | null
          last_error?: string | null
          last_tasks_import_at?: string | null
          scopes?: string[]
          user_id: string
        }
        Update: {
          calendar_id?: string
          connected_at?: string
          google_email?: string | null
          last_calendar_sync_at?: string | null
          last_error?: string | null
          last_tasks_import_at?: string | null
          scopes?: string[]
          user_id?: string
        }
        Relationships: []
      }
      google_tokens: {
        Row: {
          access_token_enc: string | null
          access_token_expires_at: string | null
          refresh_token_enc: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token_enc?: string | null
          access_token_expires_at?: string | null
          refresh_token_enc: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token_enc?: string | null
          access_token_expires_at?: string | null
          refresh_token_enc?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      inbox_items: {
        Row: {
          attachments: Json
          content: string
          created_at: string
          id: string
          meta: Json
          result_id: string | null
          result_type: string | null
          sorted_at: string | null
          source: string
          source_ref: string | null
          source_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          attachments?: Json
          content?: string
          created_at?: string
          id?: string
          meta?: Json
          result_id?: string | null
          result_type?: string | null
          sorted_at?: string | null
          source: string
          source_ref?: string | null
          source_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          attachments?: Json
          content?: string
          created_at?: string
          id?: string
          meta?: Json
          result_id?: string | null
          result_type?: string | null
          sorted_at?: string | null
          source?: string
          source_ref?: string | null
          source_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      note_task_links: {
        Row: {
          created_at: string
          id: string
          note_id: string
          task_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note_id: string
          task_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note_id?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_task_links_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_task_links_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          content: string
          created_at: string
          deleted_at: string | null
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      oauth_states: {
        Row: {
          code_verifier: string
          expires_at: string
          redirect_to: string
          state_hash: string
          user_id: string
        }
        Insert: {
          code_verifier: string
          expires_at: string
          redirect_to: string
          state_hash: string
          user_id: string
        }
        Update: {
          code_verifier?: string
          expires_at?: string
          redirect_to?: string
          state_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      opportunities: {
        Row: {
          created_at: string
          deadline: string
          description: string
          estimated_time: number | null
          id: string
          link: string
          name: string
          priority: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deadline: string
          description?: string
          estimated_time?: number | null
          id?: string
          link?: string
          name: string
          priority?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deadline?: string
          description?: string
          estimated_time?: number | null
          id?: string
          link?: string
          name?: string
          priority?: string
          user_id?: string
        }
        Relationships: []
      }
      subtasks: {
        Row: {
          completed: boolean
          created_at: string
          id: string
          note_id: string | null
          parent_task_id: string | null
          position: number
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          id?: string
          note_id?: string | null
          parent_task_id?: string | null
          position?: number
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          id?: string
          note_id?: string | null
          parent_task_id?: string | null
          position?: number
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subtasks_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subtasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_shares: {
        Row: {
          created_at: string
          id: string
          recipient_email: string
          recipient_id: string | null
          sender_id: string
          status: string
          task_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          recipient_email: string
          recipient_id?: string | null
          sender_id: string
          status?: string
          task_id: string
        }
        Update: {
          created_at?: string
          id?: string
          recipient_email?: string
          recipient_id?: string | null
          sender_id?: string
          status?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_shares_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          actual_end: string | null
          actual_start: string | null
          attribute_tag: string
          category: string
          created_at: string
          date: string | null
          deadline: string
          deleted_at: string | null
          description: string
          estimated_time: number | null
          execution_date: string | null
          gcal_calendar_id: string | null
          gcal_event_id: string | null
          gcal_hash: string | null
          id: string
          link: string
          linked_note_id: string | null
          position: number
          priority: string
          status: string
          title: string
          user_id: string
          weight: number
        }
        Insert: {
          actual_end?: string | null
          actual_start?: string | null
          attribute_tag?: string
          category?: string
          created_at?: string
          date?: string | null
          deadline?: string
          deleted_at?: string | null
          description?: string
          estimated_time?: number | null
          execution_date?: string | null
          gcal_calendar_id?: string | null
          gcal_event_id?: string | null
          gcal_hash?: string | null
          id?: string
          link?: string
          linked_note_id?: string | null
          position?: number
          priority?: string
          status?: string
          title: string
          user_id: string
          weight?: number
        }
        Update: {
          actual_end?: string | null
          actual_start?: string | null
          attribute_tag?: string
          category?: string
          created_at?: string
          date?: string | null
          deadline?: string
          deleted_at?: string | null
          description?: string
          estimated_time?: number | null
          execution_date?: string | null
          gcal_calendar_id?: string | null
          gcal_event_id?: string | null
          gcal_hash?: string | null
          id?: string
          link?: string
          linked_note_id?: string | null
          position?: number
          priority?: string
          status?: string
          title?: string
          user_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "tasks_linked_note_id_fkey"
            columns: ["linked_note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_link_codes: {
        Row: {
          code_hash: string
          expires_at: string
          user_id: string
        }
        Insert: {
          code_hash: string
          expires_at: string
          user_id: string
        }
        Update: {
          code_hash?: string
          expires_at?: string
          user_id?: string
        }
        Relationships: []
      }
      telegram_links: {
        Row: {
          chat_id: number
          created_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          chat_id: number
          created_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          chat_id?: number
          created_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      user_attributes: {
        Row: {
          attribute: string
          id: string
          max_value: number
          updated_at: string
          user_id: string
          value: number
        }
        Insert: {
          attribute: string
          id?: string
          max_value?: number
          updated_at?: string
          user_id: string
          value?: number
        }
        Update: {
          attribute?: string
          id?: string
          max_value?: number
          updated_at?: string
          user_id?: string
          value?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_api_token: {
        Args: { p_expires_at?: string; p_name: string; p_scopes: string[] }
        Returns: string
      }
      create_telegram_link_code: { Args: never; Returns: string }
      redeem_telegram_link_code: {
        Args: { p_chat_id: number; p_code: string; p_username: string }
        Returns: string
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
