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
          oauth_client_id: string | null
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
          oauth_client_id?: string | null
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
          oauth_client_id?: string | null
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
      fields: {
        Row: {
          created_at: string
          id: string
          item_types: string[] | null
          key: string
          kind: string
          name: string
          options: Json
          position: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_types?: string[] | null
          key: string
          kind: string
          name: string
          options?: Json
          position?: number
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          item_types?: string[] | null
          key?: string
          kind?: string
          name?: string
          options?: Json
          position?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fields_workspace_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
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
          kind: string | null
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
          kind?: string | null
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
          kind?: string | null
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
      item_links: {
        Row: {
          created_at: string
          created_by: string | null
          file_id: string | null
          from_id: string
          id: string
          kind: string
          to_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          file_id?: string | null
          from_id: string
          id?: string
          kind: string
          to_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          file_id?: string | null
          from_id?: string
          id?: string
          kind?: string
          to_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_links_file_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "vault_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_links_from_fkey"
            columns: ["from_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "item_links_to_fkey"
            columns: ["to_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      item_sources: {
        Row: {
          container: string | null
          created_at: string
          external_id: string
          hash: string | null
          item_id: string
          meta: Json
          source: string
          synced_at: string | null
          url: string | null
          workspace_id: string
        }
        Insert: {
          container?: string | null
          created_at?: string
          external_id: string
          hash?: string | null
          item_id: string
          meta?: Json
          source: string
          synced_at?: string | null
          url?: string | null
          workspace_id: string
        }
        Update: {
          container?: string | null
          created_at?: string
          external_id?: string
          hash?: string | null
          item_id?: string
          meta?: Json
          source?: string
          synced_at?: string | null
          url?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_sources_item_fkey"
            columns: ["item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      item_types: {
        Row: {
          parents: string[] | null
          private: boolean
          root_ok: boolean
          type: string
        }
        Insert: {
          parents?: string[] | null
          private?: boolean
          root_ok?: boolean
          type: string
        }
        Update: {
          parents?: string[] | null
          private?: boolean
          root_ok?: boolean
          type?: string
        }
        Relationships: []
      }
      items: {
        Row: {
          archived_at: string | null
          body: string
          color: string | null
          cost_planned: number | null
          cost_spent: number | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          done_at: string | null
          due_on: string | null
          due_time: string | null
          estimate_min: number | null
          id: string
          is_event: boolean
          parent_id: string | null
          planned_on: string | null
          planned_time: string | null
          position: number
          priority: number | null
          progress: number | null
          props: Json
          spent_min: number
          start_on: string | null
          status: string
          target_count: number | null
          title: string
          type: string
          updated_at: string
          url: string | null
          weight: number
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          body?: string
          color?: string | null
          cost_planned?: number | null
          cost_spent?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          done_at?: string | null
          due_on?: string | null
          due_time?: string | null
          estimate_min?: number | null
          id?: string
          is_event?: boolean
          parent_id?: string | null
          planned_on?: string | null
          planned_time?: string | null
          position?: number
          priority?: number | null
          progress?: number | null
          props?: Json
          spent_min?: number
          start_on?: string | null
          status?: string
          target_count?: number | null
          title: string
          type: string
          updated_at?: string
          url?: string | null
          weight?: number
          workspace_id?: string
        }
        Update: {
          archived_at?: string | null
          body?: string
          color?: string | null
          cost_planned?: number | null
          cost_spent?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          done_at?: string | null
          due_on?: string | null
          due_time?: string | null
          estimate_min?: number | null
          id?: string
          is_event?: boolean
          parent_id?: string | null
          planned_on?: string | null
          planned_time?: string | null
          position?: number
          priority?: number | null
          progress?: number | null
          props?: Json
          spent_min?: number
          start_on?: string | null
          status?: string
          target_count?: number | null
          title?: string
          type?: string
          updated_at?: string
          url?: string | null
          weight?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_parent_fkey"
            columns: ["parent_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "items_type_fkey"
            columns: ["type"]
            isOneToOne: false
            referencedRelation: "item_types"
            referencedColumns: ["type"]
          },
          {
            foreignKeyName: "items_workspace_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      money_balances: {
        Row: {
          amount: number
          id: string
          noted_at: string
          user_id: string
        }
        Insert: {
          amount: number
          id?: string
          noted_at?: string
          user_id?: string
        }
        Update: {
          amount?: number
          id?: string
          noted_at?: string
          user_id?: string
        }
        Relationships: []
      }
      money_details: {
        Row: {
          amount: number
          ends_on: string | null
          item_id: string
          period: string | null
          starts_on: string | null
          workspace_id: string
        }
        Insert: {
          amount: number
          ends_on?: string | null
          item_id: string
          period?: string | null
          starts_on?: string | null
          workspace_id: string
        }
        Update: {
          amount?: number
          ends_on?: string | null
          item_id?: string
          period?: string | null
          starts_on?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "money_details_item_fkey"
            columns: ["item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      money_items: {
        Row: {
          amount: number
          created_at: string
          ends_on: string | null
          id: string
          kind: string
          name: string
          note: string
          period: string | null
          position: number
          starts_on: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          ends_on?: string | null
          id?: string
          kind: string
          name: string
          note?: string
          period?: string | null
          position?: number
          starts_on?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          amount?: number
          created_at?: string
          ends_on?: string | null
          id?: string
          kind?: string
          name?: string
          note?: string
          period?: string | null
          position?: number
          starts_on?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      money_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          item_id: string
          month: string | null
          paid_at: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          item_id: string
          month?: string | null
          paid_at?: string | null
          user_id?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          item_id?: string
          month?: string | null
          paid_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "money_payments_item_fkey"
            columns: ["item_id", "user_id"]
            isOneToOne: false
            referencedRelation: "money_items"
            referencedColumns: ["id", "user_id"]
          },
        ]
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
            referencedRelation: "vault_files"
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
      strategy_nodes: {
        Row: {
          color: string | null
          created_at: string
          description: string
          done_at: string | null
          due_date: string | null
          id: string
          kind: string
          parent_id: string | null
          position: number
          progress: number | null
          start_date: string | null
          status: string
          target_count: number | null
          title: string
          updated_at: string
          user_id: string
          weight: number
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string
          done_at?: string | null
          due_date?: string | null
          id?: string
          kind: string
          parent_id?: string | null
          position?: number
          progress?: number | null
          start_date?: string | null
          status?: string
          target_count?: number | null
          title: string
          updated_at?: string
          user_id?: string
          weight?: number
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string
          done_at?: string | null
          due_date?: string | null
          id?: string
          kind?: string
          parent_id?: string | null
          position?: number
          progress?: number | null
          start_date?: string | null
          status?: string
          target_count?: number | null
          title?: string
          updated_at?: string
          user_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "strategy_nodes_parent_fkey"
            columns: ["parent_id", "user_id"]
            isOneToOne: false
            referencedRelation: "strategy_nodes"
            referencedColumns: ["id", "user_id"]
          },
        ]
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
            referencedRelation: "vault_files"
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
          deadline_time: string | null
          deleted_at: string | null
          description: string
          estimated_time: number | null
          execution_date: string | null
          gcal_calendar_id: string | null
          gcal_event_id: string | null
          gcal_hash: string | null
          gtask_hash: string | null
          gtask_id: string | null
          gtask_list_id: string | null
          id: string
          is_event: boolean
          link: string
          linked_note_id: string | null
          node_id: string | null
          position: number
          priority: string
          start_time: string | null
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
          deadline_time?: string | null
          deleted_at?: string | null
          description?: string
          estimated_time?: number | null
          execution_date?: string | null
          gcal_calendar_id?: string | null
          gcal_event_id?: string | null
          gcal_hash?: string | null
          gtask_hash?: string | null
          gtask_id?: string | null
          gtask_list_id?: string | null
          id?: string
          is_event?: boolean
          link?: string
          linked_note_id?: string | null
          node_id?: string | null
          position?: number
          priority?: string
          start_time?: string | null
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
          deadline_time?: string | null
          deleted_at?: string | null
          description?: string
          estimated_time?: number | null
          execution_date?: string | null
          gcal_calendar_id?: string | null
          gcal_event_id?: string | null
          gcal_hash?: string | null
          gtask_hash?: string | null
          gtask_id?: string | null
          gtask_list_id?: string | null
          id?: string
          is_event?: boolean
          link?: string
          linked_note_id?: string | null
          node_id?: string | null
          position?: number
          priority?: string
          start_time?: string | null
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
            referencedRelation: "vault_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_node_fkey"
            columns: ["node_id", "user_id"]
            isOneToOne: false
            referencedRelation: "strategy_nodes"
            referencedColumns: ["id", "user_id"]
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
          time_zone: string
          user_id: string
          username: string | null
        }
        Insert: {
          chat_id: number
          created_at?: string
          time_zone?: string
          user_id: string
          username?: string | null
        }
        Update: {
          chat_id?: number
          created_at?: string
          time_zone?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      time_logs: {
        Row: {
          created_at: string
          ended_at: string | null
          id: string
          item_id: string
          note: string
          started_at: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          id?: string
          item_id: string
          note?: string
          started_at: string
          updated_at?: string
          user_id?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          id?: string
          item_id?: string
          note?: string
          started_at?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_logs_item_fkey"
            columns: ["item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
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
      vault_files: {
        Row: {
          body: string | null
          etag: string
          excerpt: string | null
          id: string
          indexed_at: string
          links: string[]
          modified_at: string
          path: string
          size: number
          tags: string[]
          title: string
          todo_done: number
          todo_open: number
          trash_key: string | null
          trashed_at: string | null
          user_id: string
        }
        Insert: {
          body?: string | null
          etag: string
          excerpt?: string | null
          id?: string
          indexed_at?: string
          links?: string[]
          modified_at: string
          path: string
          size: number
          tags?: string[]
          title: string
          todo_done?: number
          todo_open?: number
          trash_key?: string | null
          trashed_at?: string | null
          user_id: string
        }
        Update: {
          body?: string | null
          etag?: string
          excerpt?: string | null
          id?: string
          indexed_at?: string
          links?: string[]
          modified_at?: string
          path?: string
          size?: number
          tags?: string[]
          title?: string
          todo_done?: number
          todo_open?: number
          trash_key?: string | null
          trashed_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      vault_folders: {
        Row: {
          color: string | null
          path: string
          todos_hidden: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          path: string
          todos_hidden?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          path?: string
          todos_hidden?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      vault_signals: {
        Row: {
          changed_at: string
          user_id: string
        }
        Insert: {
          changed_at?: string
          user_id: string
        }
        Update: {
          changed_at?: string
          user_id?: string
        }
        Relationships: []
      }
      views: {
        Row: {
          config: Json
          created_at: string
          id: string
          layout: string
          name: string
          owner_id: string | null
          page: string
          position: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          layout: string
          name: string
          owner_id?: string | null
          page: string
          position?: number
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          layout?: string
          name?: string
          owner_id?: string | null
          page?: string
          position?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "views_workspace_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          personal_of: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          personal_of?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          personal_of?: string | null
          updated_at?: string
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
      idea_candidates: {
        Args: { p_user: string }
        Returns: {
          body: string
          excerpt: string
          id: string
          modified_at: string
          path: string
          title: string
          whole: boolean
        }[]
      }
      my_workspaces: { Args: never; Returns: string[] }
      my_writable_workspaces: { Args: never; Returns: string[] }
      personal_workspace: { Args: never; Returns: string }
      redeem_telegram_link_code: {
        Args: { p_chat_id: number; p_code: string; p_username: string }
        Returns: string
      }
      v2_copy_from_v1: { Args: never; Returns: Json }
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
