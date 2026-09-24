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
    PostgrestVersion: "12.2.3 (519615d)"
  }
  public: {
    Tables: {
      account_claim_sessions: {
        Row: {
          claimed_email: string | null
          claimed_user_id: string | null
          completed_at: string | null
          created_at: string
          expiration_date: string | null
          expires_at: string
          id: string
          is_trial: boolean | null
          max_connections: number | null
          panel_host: string
          panel_username: string
          server_label: string | null
          token: string
        }
        Insert: {
          claimed_email?: string | null
          claimed_user_id?: string | null
          completed_at?: string | null
          created_at?: string
          expiration_date?: string | null
          expires_at?: string
          id?: string
          is_trial?: boolean | null
          max_connections?: number | null
          panel_host: string
          panel_username: string
          server_label?: string | null
          token: string
        }
        Update: {
          claimed_email?: string | null
          claimed_user_id?: string | null
          completed_at?: string | null
          created_at?: string
          expiration_date?: string | null
          expires_at?: string
          id?: string
          is_trial?: boolean | null
          max_connections?: number | null
          panel_host?: string
          panel_username?: string
          server_label?: string | null
          token?: string
        }
        Relationships: []
      }
      admin_action_tokens: {
        Row: {
          created_at: string
          device_id: string
          expires_at: string
          id: string
          label: string | null
          last_used_at: string | null
          last_used_ip_hash: string | null
          revoked: boolean
          revoked_at: string | null
          revoked_reason: string | null
          scopes: string[]
          token_hash: string
          token_prefix: string
          updated_at: string
          use_count: number
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          expires_at?: string
          id?: string
          label?: string | null
          last_used_at?: string | null
          last_used_ip_hash?: string | null
          revoked?: boolean
          revoked_at?: string | null
          revoked_reason?: string | null
          scopes?: string[]
          token_hash: string
          token_prefix: string
          updated_at?: string
          use_count?: number
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string
          expires_at?: string
          id?: string
          label?: string | null
          last_used_at?: string | null
          last_used_ip_hash?: string | null
          revoked?: boolean
          revoked_at?: string | null
          revoked_reason?: string | null
          scopes?: string[]
          token_hash?: string
          token_prefix?: string
          updated_at?: string
          use_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_action_tokens_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "admin_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_ai_messages: {
        Row: {
          content: string | null
          conversation_id: string
          created_at: string
          created_by: string | null
          id: number
          role: string
          tool_call_id: string | null
          tool_calls: Json | null
        }
        Insert: {
          content?: string | null
          conversation_id: string
          created_at?: string
          created_by?: string | null
          id?: never
          role: string
          tool_call_id?: string | null
          tool_calls?: Json | null
        }
        Update: {
          content?: string | null
          conversation_id?: string
          created_at?: string
          created_by?: string | null
          id?: never
          role?: string
          tool_call_id?: string | null
          tool_calls?: Json | null
        }
        Relationships: []
      }
      admin_ai_proposals: {
        Row: {
          conversation_id: string
          created_at: string
          created_by: string | null
          decided_at: string | null
          decided_by: string | null
          expires_at: string
          id: string
          kind: string
          params: Json
          preview: Json
          result: Json | null
          status: string
          target_count: number
          targets: Json
          title: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          expires_at?: string
          id?: string
          kind: string
          params?: Json
          preview?: Json
          result?: Json | null
          status?: string
          target_count?: number
          targets?: Json
          title: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          expires_at?: string
          id?: string
          kind?: string
          params?: Json
          preview?: Json
          result?: Json | null
          status?: string
          target_count?: number
          targets?: Json
          title?: string
        }
        Relationships: []
      }
      admin_devices: {
        Row: {
          apns_environment: string
          apns_token: string
          app_version: string | null
          bad_token_strikes: number
          badge_count: number
          bundle_id: string
          created_at: string
          device_model: string | null
          device_name: string | null
          id: string
          last_push_at: string | null
          last_seen_at: string
          os_version: string | null
          platform: string
          revoke_source: string | null
          revoked: boolean
          revoked_at: string | null
          revoked_reason: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          apns_environment: string
          apns_token: string
          app_version?: string | null
          bad_token_strikes?: number
          badge_count?: number
          bundle_id?: string
          created_at?: string
          device_model?: string | null
          device_name?: string | null
          id?: string
          last_push_at?: string | null
          last_seen_at?: string
          os_version?: string | null
          platform?: string
          revoke_source?: string | null
          revoked?: boolean
          revoked_at?: string | null
          revoked_reason?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          apns_environment?: string
          apns_token?: string
          app_version?: string | null
          bad_token_strikes?: number
          badge_count?: number
          bundle_id?: string
          created_at?: string
          device_model?: string | null
          device_name?: string | null
          id?: string
          last_push_at?: string | null
          last_seen_at?: string
          os_version?: string | null
          platform?: string
          revoke_source?: string | null
          revoked?: boolean
          revoked_at?: string | null
          revoked_reason?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      admin_notify_prefs: {
        Row: {
          created_at: string
          enabled: boolean | null
          event_type: string
          id: string
          quiet_hours_enabled: boolean | null
          quiet_hours_end: string | null
          quiet_hours_override: boolean
          quiet_hours_start: string | null
          quiet_hours_tz: string | null
          snoozed_until: string | null
          sound: string | null
          time_sensitive: boolean | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean | null
          event_type: string
          id?: string
          quiet_hours_enabled?: boolean | null
          quiet_hours_end?: string | null
          quiet_hours_override?: boolean
          quiet_hours_start?: string | null
          quiet_hours_tz?: string | null
          snoozed_until?: string | null
          sound?: string | null
          time_sensitive?: boolean | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean | null
          event_type?: string
          id?: string
          quiet_hours_enabled?: boolean | null
          quiet_hours_end?: string | null
          quiet_hours_override?: boolean
          quiet_hours_start?: string | null
          quiet_hours_tz?: string | null
          snoozed_until?: string | null
          sound?: string | null
          time_sensitive?: boolean | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_anon_usage: {
        Row: {
          calls_this_hour: number
          chat_calls: number
          chat_cost_usd: number
          device_id: string
          first_used_at: string
          hour_bucket: string | null
          images_used: number
          last_used_at: string
          total_calls: number
        }
        Insert: {
          calls_this_hour?: number
          chat_calls?: number
          chat_cost_usd?: number
          device_id: string
          first_used_at?: string
          hour_bucket?: string | null
          images_used?: number
          last_used_at?: string
          total_calls?: number
        }
        Update: {
          calls_this_hour?: number
          chat_calls?: number
          chat_cost_usd?: number
          device_id?: string
          first_used_at?: string
          hour_bucket?: string | null
          images_used?: number
          last_used_at?: string
          total_calls?: number
        }
        Relationships: []
      }
      ai_conversations: {
        Row: {
          created_at: string
          id: string
          last_message_at: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_free_config: {
        Row: {
          chat_per_device_limit_usd: number
          chat_spent_usd: number
          chat_total_limit_usd: number
          global_calls_per_hour: number
          global_calls_this_hour: number
          global_hour_bucket: string | null
          global_images_per_hour: number
          global_images_this_hour: number
          id: number
          images_per_device_limit: number
          images_total_limit: number
          images_used: number
          ip_calls_per_hour: number
          ip_chat_per_hour_usd: number
          ip_images_per_hour: number
          rate_limit_per_hour: number
          updated_at: string
        }
        Insert: {
          chat_per_device_limit_usd?: number
          chat_spent_usd?: number
          chat_total_limit_usd?: number
          global_calls_per_hour?: number
          global_calls_this_hour?: number
          global_hour_bucket?: string | null
          global_images_per_hour?: number
          global_images_this_hour?: number
          id?: number
          images_per_device_limit?: number
          images_total_limit?: number
          images_used?: number
          ip_calls_per_hour?: number
          ip_chat_per_hour_usd?: number
          ip_images_per_hour?: number
          rate_limit_per_hour?: number
          updated_at?: string
        }
        Update: {
          chat_per_device_limit_usd?: number
          chat_spent_usd?: number
          chat_total_limit_usd?: number
          global_calls_per_hour?: number
          global_calls_this_hour?: number
          global_hour_bucket?: string | null
          global_images_per_hour?: number
          global_images_this_hour?: number
          id?: number
          images_per_device_limit?: number
          images_total_limit?: number
          images_used?: number
          ip_calls_per_hour?: number
          ip_chat_per_hour_usd?: number
          ip_images_per_hour?: number
          rate_limit_per_hour?: number
          updated_at?: string
        }
        Relationships: []
      }
      ai_generated_images: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          model: string | null
          prompt: string | null
          status: string
          storage_path: string
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          model?: string | null
          prompt?: string | null
          status?: string
          storage_path: string
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          model?: string | null
          prompt?: string | null
          status?: string
          storage_path?: string
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      ai_image_usage: {
        Row: {
          cost_credits: number
          created_at: string
          id: string
          image_url: string | null
          prompt: string
          user_id: string
        }
        Insert: {
          cost_credits?: number
          created_at?: string
          id?: string
          image_url?: string | null
          prompt: string
          user_id: string
        }
        Update: {
          cost_credits?: number
          created_at?: string
          id?: string
          image_url?: string | null
          prompt?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_ip_usage: {
        Row: {
          calls_this_hour: number
          chat_cost_usd: number
          first_seen_at: string
          hour_bucket: string | null
          images_this_hour: number
          ip_hash: string
          last_seen_at: string
        }
        Insert: {
          calls_this_hour?: number
          chat_cost_usd?: number
          first_seen_at?: string
          hour_bucket?: string | null
          images_this_hour?: number
          ip_hash: string
          last_seen_at?: string
        }
        Update: {
          calls_this_hour?: number
          chat_cost_usd?: number
          first_seen_at?: string
          hour_bucket?: string | null
          images_this_hour?: number
          ip_hash?: string
          last_seen_at?: string
        }
        Relationships: []
      }
      ai_messages: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          message: string
          sender_type: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          message: string
          sender_type: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          message?: string
          sender_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_premium_trials: {
        Row: {
          feature: string
          used_at: string
          user_id: string
        }
        Insert: {
          feature: string
          used_at?: string
          user_id: string
        }
        Update: {
          feature?: string
          used_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_safety_state: {
        Row: {
          id: number
          notify_email: string
          pause_reason: string | null
          paused: boolean
          paused_at: string | null
          paused_until: string | null
          token_threshold_per_hour: number
          updated_at: string
        }
        Insert: {
          id?: number
          notify_email?: string
          pause_reason?: string | null
          paused?: boolean
          paused_at?: string | null
          paused_until?: string | null
          token_threshold_per_hour?: number
          updated_at?: string
        }
        Update: {
          id?: number
          notify_email?: string
          pause_reason?: string | null
          paused?: boolean
          paused_at?: string | null
          paused_until?: string | null
          token_threshold_per_hour?: number
          updated_at?: string
        }
        Relationships: []
      }
      ai_tiers: {
        Row: {
          blurb: string | null
          enabled: boolean
          feature: string
          gems: number
          label: string
          model: string
          sort: number
          tier: string
          updated_at: string
        }
        Insert: {
          blurb?: string | null
          enabled?: boolean
          feature: string
          gems?: number
          label: string
          model: string
          sort?: number
          tier: string
          updated_at?: string
        }
        Update: {
          blurb?: string | null
          enabled?: boolean
          feature?: string
          gems?: number
          label?: string
          model?: string
          sort?: number
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_usage_log: {
        Row: {
          completion_tokens: number
          cost_credits: number
          created_at: string
          error_message: string | null
          feature: string
          id: string
          model: string | null
          prompt: string | null
          prompt_tokens: number
          response_preview: string | null
          status: string
          total_tokens: number
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          completion_tokens?: number
          cost_credits?: number
          created_at?: string
          error_message?: string | null
          feature: string
          id?: string
          model?: string | null
          prompt?: string | null
          prompt_tokens?: number
          response_preview?: string | null
          status?: string
          total_tokens?: number
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          completion_tokens?: number
          cost_credits?: number
          created_at?: string
          error_message?: string | null
          feature?: string
          id?: string
          model?: string | null
          prompt?: string | null
          prompt_tokens?: number
          response_preview?: string | null
          status?: string
          total_tokens?: number
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      analytics_crashes: {
        Row: {
          app_version: string | null
          component: string | null
          created_at: string
          device_id: string
          id: string
          message: string | null
          occurred_at: string
          os_version: string | null
          platform: string | null
          reseller_id: string | null
          session_id: string | null
          severity: string | null
          stack: string | null
          user_id: string | null
        }
        Insert: {
          app_version?: string | null
          component?: string | null
          created_at?: string
          device_id: string
          id?: string
          message?: string | null
          occurred_at?: string
          os_version?: string | null
          platform?: string | null
          reseller_id?: string | null
          session_id?: string | null
          severity?: string | null
          stack?: string | null
          user_id?: string | null
        }
        Update: {
          app_version?: string | null
          component?: string | null
          created_at?: string
          device_id?: string
          id?: string
          message?: string | null
          occurred_at?: string
          os_version?: string | null
          platform?: string | null
          reseller_id?: string | null
          session_id?: string | null
          severity?: string | null
          stack?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      analytics_daily_rollup: {
        Row: {
          anonymous_count: number
          created_at: string
          day: string
          event_name: string
          id: string
          platform: string | null
          reseller_id: string | null
          signed_in_count: number
          total_count: number
          unique_devices: number
          unique_users: number
          updated_at: string
        }
        Insert: {
          anonymous_count?: number
          created_at?: string
          day: string
          event_name: string
          id?: string
          platform?: string | null
          reseller_id?: string | null
          signed_in_count?: number
          total_count?: number
          unique_devices?: number
          unique_users?: number
          updated_at?: string
        }
        Update: {
          anonymous_count?: number
          created_at?: string
          day?: string
          event_name?: string
          id?: string
          platform?: string | null
          reseller_id?: string | null
          signed_in_count?: number
          total_count?: number
          unique_devices?: number
          unique_users?: number
          updated_at?: string
        }
        Relationships: []
      }
      analytics_devices: {
        Row: {
          app_version: string | null
          created_at: string
          device_id: string
          device_model: string | null
          first_seen_at: string
          first_user_id: string | null
          form_factor: string | null
          gone_at: string | null
          gone_reason: string | null
          id: string
          last_seen_at: string
          last_user_id: string | null
          os_version: string | null
          platform: string | null
          reseller_id: string | null
          updated_at: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          device_id: string
          device_model?: string | null
          first_seen_at?: string
          first_user_id?: string | null
          form_factor?: string | null
          gone_at?: string | null
          gone_reason?: string | null
          id?: string
          last_seen_at?: string
          last_user_id?: string | null
          os_version?: string | null
          platform?: string | null
          reseller_id?: string | null
          updated_at?: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          device_id?: string
          device_model?: string | null
          first_seen_at?: string
          first_user_id?: string | null
          form_factor?: string | null
          gone_at?: string | null
          gone_reason?: string | null
          id?: string
          last_seen_at?: string
          last_user_id?: string | null
          os_version?: string | null
          platform?: string | null
          reseller_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          app_version: string | null
          created_at: string
          device_id: string
          event_category: string | null
          event_name: string
          id: string
          occurred_at: string
          platform: string | null
          properties: Json
          reseller_id: string | null
          session_id: string | null
          user_id: string | null
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          device_id: string
          event_category?: string | null
          event_name: string
          id?: string
          occurred_at?: string
          platform?: string | null
          properties?: Json
          reseller_id?: string | null
          session_id?: string | null
          user_id?: string | null
        }
        Update: {
          app_version?: string | null
          created_at?: string
          device_id?: string
          event_category?: string | null
          event_name?: string
          id?: string
          occurred_at?: string
          platform?: string | null
          properties?: Json
          reseller_id?: string | null
          session_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      analytics_sessions: {
        Row: {
          app_version: string | null
          created_at: string
          device_id: string
          duration_seconds: number | null
          ended_at: string | null
          id: string
          os_version: string | null
          platform: string | null
          reseller_id: string | null
          session_id: string
          started_at: string
          user_id: string | null
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          device_id: string
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          os_version?: string | null
          platform?: string | null
          reseller_id?: string | null
          session_id: string
          started_at?: string
          user_id?: string | null
        }
        Update: {
          app_version?: string | null
          created_at?: string
          device_id?: string
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          os_version?: string | null
          platform?: string | null
          reseller_id?: string | null
          session_id?: string
          started_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      app_alerts: {
        Row: {
          active: boolean
          app_match: string
          created_at: string
          created_by: string | null
          id: string
          message: string
          severity: string
          source: string
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          app_match: string
          created_at?: string
          created_by?: string | null
          id?: string
          message: string
          severity?: string
          source?: string
          title?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          app_match?: string
          created_at?: string
          created_by?: string | null
          id?: string
          message?: string
          severity?: string
          source?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      apps: {
        Row: {
          category: string
          created_at: string
          description: string
          download_url: string | null
          external_id: string | null
          icon_url: string | null
          id: string
          is_available: boolean
          is_featured: boolean | null
          is_installed: boolean | null
          last_synced_at: string | null
          name: string
          package_name: string | null
          size: string
          source: string
          updated_at: string
          version: string | null
        }
        Insert: {
          category?: string
          created_at?: string
          description: string
          download_url?: string | null
          external_id?: string | null
          icon_url?: string | null
          id?: string
          is_available?: boolean
          is_featured?: boolean | null
          is_installed?: boolean | null
          last_synced_at?: string | null
          name: string
          package_name?: string | null
          size: string
          source?: string
          updated_at?: string
          version?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          download_url?: string | null
          external_id?: string | null
          icon_url?: string | null
          id?: string
          is_available?: boolean
          is_featured?: boolean | null
          is_installed?: boolean | null
          last_synced_at?: string | null
          name?: string
          package_name?: string | null
          size?: string
          source?: string
          updated_at?: string
          version?: string | null
        }
        Relationships: []
      }
      backup_streams: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          ends_at: string | null
          id: string
          kind: string
          notes: string | null
          poster_url: string | null
          reseller_id: string | null
          server_label: string | null
          sort: number
          starts_at: string | null
          subtitle: string | null
          title: string
          updated_at: string
          url: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          kind?: string
          notes?: string | null
          poster_url?: string | null
          reseller_id?: string | null
          server_label?: string | null
          sort?: number
          starts_at?: string | null
          subtitle?: string | null
          title: string
          updated_at?: string
          url: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          kind?: string
          notes?: string | null
          poster_url?: string | null
          reseller_id?: string | null
          server_label?: string | null
          sort?: number
          starts_at?: string | null
          subtitle?: string | null
          title?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      canvas_customer_notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          customer_id: string
          flag: string | null
          id: string
          tenant_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          customer_id: string
          flag?: string | null
          id?: string
          tenant_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          customer_id?: string
          flag?: string | null
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "canvas_customer_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "canvas_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canvas_customer_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      canvas_customers: {
        Row: {
          blocked: boolean
          created_at: string
          device_types: string[]
          email: string | null
          expiration_date: string | null
          id: string
          last_seen_at: string | null
          server_label: string | null
          tenant_id: string
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          blocked?: boolean
          created_at?: string
          device_types?: string[]
          email?: string | null
          expiration_date?: string | null
          id?: string
          last_seen_at?: string | null
          server_label?: string | null
          tenant_id: string
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          blocked?: boolean
          created_at?: string
          device_types?: string[]
          email?: string | null
          expiration_date?: string | null
          id?: string
          last_seen_at?: string | null
          server_label?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "canvas_customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      canvas_support_messages: {
        Row: {
          created_at: string
          id: string
          message: string
          sender_type: string
          tenant_id: string
          ticket_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          sender_type?: string
          tenant_id: string
          ticket_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          sender_type?: string
          tenant_id?: string
          ticket_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "canvas_support_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canvas_support_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "canvas_support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      canvas_support_tickets: {
        Row: {
          created_at: string
          id: string
          last_message_at: string
          priority: string
          status: string
          subject: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string
          priority?: string
          status?: string
          subject: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string
          priority?: string
          status?: string
          subject?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "canvas_support_tickets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_overrides: {
        Row: {
          channel_name: string | null
          expires_at: string | null
          host: string
          note: string | null
          set_by: string | null
          status: string
          stream_id: number
          updated_at: string
        }
        Insert: {
          channel_name?: string | null
          expires_at?: string | null
          host: string
          note?: string | null
          set_by?: string | null
          status: string
          stream_id: number
          updated_at?: string
        }
        Update: {
          channel_name?: string | null
          expires_at?: string | null
          host?: string
          note?: string | null
          set_by?: string | null
          status?: string
          stream_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      channel_signals: {
        Row: {
          channel_name: string | null
          created_at: string
          device_hash: string
          host: string
          id: number
          ip_hash: string | null
          kind: string
          stream_id: number
          trusted: boolean
        }
        Insert: {
          channel_name?: string | null
          created_at?: string
          device_hash: string
          host: string
          id?: number
          ip_hash?: string | null
          kind: string
          stream_id: number
          trusted?: boolean
        }
        Update: {
          channel_name?: string | null
          created_at?: string
          device_hash?: string
          host?: string
          id?: number
          ip_hash?: string | null
          kind?: string
          stream_id?: number
          trusted?: boolean
        }
        Relationships: []
      }
      chip_ledger: {
        Row: {
          change: number
          created_at: string
          game_round_id: number | null
          id: number
          reason: string
          user_id: string
        }
        Insert: {
          change: number
          created_at?: string
          game_round_id?: number | null
          id?: never
          reason: string
          user_id: string
        }
        Update: {
          change?: number
          created_at?: string
          game_round_id?: number | null
          id?: never
          reason?: string
          user_id?: string
        }
        Relationships: []
      }
      community_messages: {
        Row: {
          created_at: string
          id: string
          is_pinned: boolean | null
          message: string
          reply_to: string | null
          room_id: string | null
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_pinned?: boolean | null
          message: string
          reply_to?: string | null
          room_id?: string | null
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_pinned?: boolean | null
          message?: string
          reply_to?: string | null
          room_id?: string | null
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      cosmetics: {
        Row: {
          asset_ref: string | null
          id: number
          name: string
          price_chips: number | null
          price_money_cents: number | null
          type: string
        }
        Insert: {
          asset_ref?: string | null
          id?: never
          name: string
          price_chips?: number | null
          price_money_cents?: number | null
          type: string
        }
        Update: {
          asset_ref?: string | null
          id?: never
          name?: string
          price_chips?: number | null
          price_money_cents?: number | null
          type?: string
        }
        Relationships: []
      }
      credit_packages: {
        Row: {
          created_at: string
          credits: number
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          price: number
        }
        Insert: {
          created_at?: string
          credits: number
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          price: number
        }
        Update: {
          created_at?: string
          credits?: number
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          price?: number
        }
        Relationships: []
      }
      credit_transactions: {
        Row: {
          amount: number
          balance_after: number | null
          created_at: string
          description: string
          id: string
          paypal_transaction_id: string | null
          source: string | null
          transaction_type: string
          user_id: string
        }
        Insert: {
          amount: number
          balance_after?: number | null
          created_at?: string
          description: string
          id?: string
          paypal_transaction_id?: string | null
          source?: string | null
          transaction_type: string
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number | null
          created_at?: string
          description?: string
          id?: string
          paypal_transaction_id?: string | null
          source?: string | null
          transaction_type?: string
          user_id?: string
        }
        Relationships: []
      }
      customer_devices: {
        Row: {
          created_at: string
          customer_id: string
          device_type: string
          id: string
          label: string | null
          notes: string | null
        }
        Insert: {
          created_at?: string
          customer_id: string
          device_type: string
          id?: string
          label?: string | null
          notes?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string
          device_type?: string
          id?: string
          label?: string | null
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_devices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_line_unlinks: {
        Row: {
          customer_id: string
          note: string | null
          panel_host: string | null
          panel_username: string
          unlinked_at: string
          unlinked_by: string | null
        }
        Insert: {
          customer_id: string
          note?: string | null
          panel_host?: string | null
          panel_username: string
          unlinked_at?: string
          unlinked_by?: string | null
        }
        Update: {
          customer_id?: string
          note?: string | null
          panel_host?: string | null
          panel_username?: string
          unlinked_at?: string
          unlinked_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_line_unlinks_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_payments: {
        Row: {
          amount: number
          created_at: string
          customer_id: string
          id: string
          method: string
          notes: string | null
          paid_at: string
          service_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          customer_id: string
          id?: string
          method: string
          notes?: string | null
          paid_at: string
          service_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          customer_id?: string
          id?: string
          method?: string
          notes?: string | null
          paid_at?: string
          service_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_payments_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "customer_services"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_services: {
        Row: {
          connections: number | null
          created_at: string
          customer_id: string
          expiration_date: string | null
          id: string
          is_trial: boolean | null
          line_id: string | null
          max_connections: number | null
          notes: string | null
          panel_host: string | null
          panel_line_id: string | null
          panel_password: string | null
          panel_username: string | null
          plex_device_limit: number | null
          renewal_status: string | null
          service_name: string | null
          service_type: string
          start_date: string | null
          tied_apps: string[]
        }
        Insert: {
          connections?: number | null
          created_at?: string
          customer_id: string
          expiration_date?: string | null
          id?: string
          is_trial?: boolean | null
          line_id?: string | null
          max_connections?: number | null
          notes?: string | null
          panel_host?: string | null
          panel_line_id?: string | null
          panel_password?: string | null
          panel_username?: string | null
          plex_device_limit?: number | null
          renewal_status?: string | null
          service_name?: string | null
          service_type: string
          start_date?: string | null
          tied_apps?: string[]
        }
        Update: {
          connections?: number | null
          created_at?: string
          customer_id?: string
          expiration_date?: string | null
          id?: string
          is_trial?: boolean | null
          line_id?: string | null
          max_connections?: number | null
          notes?: string | null
          panel_host?: string | null
          panel_line_id?: string | null
          panel_password?: string | null
          panel_username?: string | null
          plex_device_limit?: number | null
          renewal_status?: string | null
          service_name?: string | null
          service_type?: string
          start_date?: string | null
          tied_apps?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "customer_services_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          contact_method: string | null
          created_at: string
          email: string | null
          id: string
          name: string | null
          notes: string | null
          payment_handle: string | null
          phone: string | null
          plex_over_limit_allowed: number | null
          plex_over_limit_at: string | null
          plex_over_limit_peak: number | null
          shares_account: boolean
          updated_at: string
          user_id: string | null
          wix_contact_id: string | null
          wix_member_id: string | null
          wix_synced_at: string | null
        }
        Insert: {
          contact_method?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string | null
          notes?: string | null
          payment_handle?: string | null
          phone?: string | null
          plex_over_limit_allowed?: number | null
          plex_over_limit_at?: string | null
          plex_over_limit_peak?: number | null
          shares_account?: boolean
          updated_at?: string
          user_id?: string | null
          wix_contact_id?: string | null
          wix_member_id?: string | null
          wix_synced_at?: string | null
        }
        Update: {
          contact_method?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string | null
          notes?: string | null
          payment_handle?: string | null
          phone?: string | null
          plex_over_limit_allowed?: number | null
          plex_over_limit_at?: string | null
          plex_over_limit_peak?: number | null
          shares_account?: boolean
          updated_at?: string
          user_id?: string | null
          wix_contact_id?: string | null
          wix_member_id?: string | null
          wix_synced_at?: string | null
        }
        Relationships: []
      }
      daily_claims: {
        Row: {
          last_claim_at: string | null
          user_id: string
        }
        Insert: {
          last_claim_at?: string | null
          user_id: string
        }
        Update: {
          last_claim_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      deleted_posts: {
        Row: {
          deleted_at: string
          deleted_by: string | null
          id: string
          kind: string
          post_id: string
          restored_at: string | null
          row_data: Json
          title: string | null
        }
        Insert: {
          deleted_at?: string
          deleted_by?: string | null
          id?: string
          kind: string
          post_id: string
          restored_at?: string | null
          row_data: Json
          title?: string | null
        }
        Update: {
          deleted_at?: string
          deleted_by?: string | null
          id?: string
          kind?: string
          post_id?: string
          restored_at?: string | null
          row_data?: Json
          title?: string | null
        }
        Relationships: []
      }
      demo_catalog_cache: {
        Row: {
          built_at: string
          id: string
          payload: Json
        }
        Insert: {
          built_at?: string
          id?: string
          payload: Json
        }
        Update: {
          built_at?: string
          id?: string
          payload?: Json
        }
        Relationships: []
      }
      email_check_throttle: {
        Row: {
          count: number
          created_at: string
          ip_hash: string
          updated_at: string
          window_start: string
        }
        Insert: {
          count?: number
          created_at?: string
          ip_hash: string
          updated_at?: string
          window_start?: string
        }
        Update: {
          count?: number
          created_at?: string
          ip_hash?: string
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
      expiration_notices: {
        Row: {
          expiration_date: string | null
          id: string
          kind: string
          panel_host: string
          panel_username: string
          sent_at: string
        }
        Insert: {
          expiration_date?: string | null
          id?: string
          kind: string
          panel_host: string
          panel_username: string
          sent_at?: string
        }
        Update: {
          expiration_date?: string | null
          id?: string
          kind?: string
          panel_host?: string
          panel_username?: string
          sent_at?: string
        }
        Relationships: []
      }
      feature_flags: {
        Row: {
          enabled: boolean
          key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      game_leaderboard: {
        Row: {
          best_score: number
          game: string
          game_name: string
          mode: string
          plays: number
          updated_at: string
          user_id: string
          wins: number
        }
        Insert: {
          best_score?: number
          game: string
          game_name: string
          mode?: string
          plays?: number
          updated_at?: string
          user_id: string
          wins?: number
        }
        Update: {
          best_score?: number
          game?: string
          game_name?: string
          mode?: string
          plays?: number
          updated_at?: string
          user_id?: string
          wins?: number
        }
        Relationships: []
      }
      game_profiles: {
        Row: {
          created_at: string
          game_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          game_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          game_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      game_rounds: {
        Row: {
          bet: number
          client_seed: string | null
          created_at: string
          game: string
          id: number
          nonce: number | null
          result: Json | null
          server_seed: string | null
          server_seed_hash: string | null
          user_id: string
        }
        Insert: {
          bet?: number
          client_seed?: string | null
          created_at?: string
          game: string
          id?: never
          nonce?: number | null
          result?: Json | null
          server_seed?: string | null
          server_seed_hash?: string | null
          user_id: string
        }
        Update: {
          bet?: number
          client_seed?: string | null
          created_at?: string
          game?: string
          id?: never
          nonce?: number | null
          result?: Json | null
          server_seed?: string | null
          server_seed_hash?: string | null
          user_id?: string
        }
        Relationships: []
      }
      gem_admin_actions: {
        Row: {
          actor_id: string | null
          created_at: string
          reason: string
          request_id: string
          transaction_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          reason: string
          request_id: string
          transaction_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          reason?: string
          request_id?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gem_admin_actions_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: true
            referencedRelation: "credit_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      gem_alerts: {
        Row: {
          created_at: string
          gems: number
          hold_id: string | null
          id: string
          kind: string
          message: string
          source: string | null
          title: string
          transaction_id: string | null
          usd: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          gems: number
          hold_id?: string | null
          id?: string
          kind: string
          message: string
          source?: string | null
          title: string
          transaction_id?: string | null
          usd?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          gems?: number
          hold_id?: string | null
          id?: string
          kind?: string
          message?: string
          source?: string | null
          title?: string
          transaction_id?: string | null
          usd?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gem_alerts_hold_id_fkey"
            columns: ["hold_id"]
            isOneToOne: false
            referencedRelation: "gem_purchase_holds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gem_alerts_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "credit_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      gem_orders: {
        Row: {
          created_at: string
          credited_at: string | null
          credits: number
          id: string
          order_number: string | null
          package_id: string | null
          package_name: string
          paid_at: string | null
          paid_total: number | null
          paypal_transaction_id: string | null
          price: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credited_at?: string | null
          credits: number
          id?: string
          order_number?: string | null
          package_id?: string | null
          package_name: string
          paid_at?: string | null
          paid_total?: number | null
          paypal_transaction_id?: string | null
          price: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          credited_at?: string | null
          credits?: number
          id?: string
          order_number?: string | null
          package_id?: string | null
          package_name?: string
          paid_at?: string | null
          paid_total?: number | null
          paypal_transaction_id?: string | null
          price?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gem_orders_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "credit_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      gem_purchase_holds: {
        Row: {
          created_at: string
          description: string
          gems: number
          id: string
          order_id: string | null
          paid_total: number | null
          paypal_transaction_id: string
          price: number | null
          reason: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          description: string
          gems: number
          id?: string
          order_id?: string | null
          paid_total?: number | null
          paypal_transaction_id: string
          price?: number | null
          reason: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string
          gems?: number
          id?: string
          order_id?: string | null
          paid_total?: number | null
          paypal_transaction_id?: string
          price?: number | null
          reason?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gem_purchase_holds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "gem_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gem_purchase_holds_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "credit_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      giveaway_audit_log: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          details: Json
          entry_id: string | null
          giveaway_id: string | null
          id: string
          winner_id: string | null
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          details?: Json
          entry_id?: string | null
          giveaway_id?: string | null
          id?: string
          winner_id?: string | null
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          details?: Json
          entry_id?: string | null
          giveaway_id?: string | null
          id?: string
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "giveaway_audit_log_giveaway_id_fkey"
            columns: ["giveaway_id"]
            isOneToOne: false
            referencedRelation: "giveaways"
            referencedColumns: ["id"]
          },
        ]
      }
      giveaway_entries: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          customer_id: string | null
          entry_count: number
          entry_type: string
          giveaway_id: string
          id: string
          invalidated_at: string | null
          invalidation_reason: string | null
          metadata: Json
          source_id: string | null
          source_reference: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          customer_id?: string | null
          entry_count?: number
          entry_type: string
          giveaway_id: string
          id?: string
          invalidated_at?: string | null
          invalidation_reason?: string | null
          metadata?: Json
          source_id?: string | null
          source_reference?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          customer_id?: string | null
          entry_count?: number
          entry_type?: string
          giveaway_id?: string
          id?: string
          invalidated_at?: string | null
          invalidation_reason?: string | null
          metadata?: Json
          source_id?: string | null
          source_reference?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "giveaway_entries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "giveaway_entries_giveaway_id_fkey"
            columns: ["giveaway_id"]
            isOneToOne: false
            referencedRelation: "giveaways"
            referencedColumns: ["id"]
          },
        ]
      }
      giveaway_winners: {
        Row: {
          announced: boolean
          customer_id: string | null
          draw_method: string | null
          draw_round: number
          draw_seed: string | null
          drawn_at: string
          drawn_by: string | null
          entry_id: string | null
          giveaway_id: string
          id: string
          position: number
          prize_delivered_at: string | null
          public_display_name: string | null
          replaced_by: string | null
          status: string
          user_id: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          announced?: boolean
          customer_id?: string | null
          draw_method?: string | null
          draw_round?: number
          draw_seed?: string | null
          drawn_at?: string
          drawn_by?: string | null
          entry_id?: string | null
          giveaway_id: string
          id?: string
          position: number
          prize_delivered_at?: string | null
          public_display_name?: string | null
          replaced_by?: string | null
          status?: string
          user_id?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          announced?: boolean
          customer_id?: string | null
          draw_method?: string | null
          draw_round?: number
          draw_seed?: string | null
          drawn_at?: string
          drawn_by?: string | null
          entry_id?: string | null
          giveaway_id?: string
          id?: string
          position?: number
          prize_delivered_at?: string | null
          public_display_name?: string | null
          replaced_by?: string | null
          status?: string
          user_id?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "giveaway_winners_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "giveaway_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "giveaway_winners_giveaway_id_fkey"
            columns: ["giveaway_id"]
            isOneToOne: false
            referencedRelation: "giveaways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "giveaway_winners_replaced_by_fkey"
            columns: ["replaced_by"]
            isOneToOne: false
            referencedRelation: "giveaway_winners"
            referencedColumns: ["id"]
          },
        ]
      }
      giveaways: {
        Row: {
          announcement_md: string | null
          config: Json
          created_at: string
          created_by: string | null
          description: string | null
          end_at: string | null
          id: string
          included_service_description: string | null
          name: string
          prize_description: string | null
          prize_image_url: string | null
          prize_value_usd: number | null
          rules_md: string | null
          slug: string
          start_at: string | null
          status: string
          updated_at: string
          winner_count: number
        }
        Insert: {
          announcement_md?: string | null
          config?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_at?: string | null
          id?: string
          included_service_description?: string | null
          name: string
          prize_description?: string | null
          prize_image_url?: string | null
          prize_value_usd?: number | null
          rules_md?: string | null
          slug: string
          start_at?: string | null
          status?: string
          updated_at?: string
          winner_count?: number
        }
        Update: {
          announcement_md?: string | null
          config?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_at?: string | null
          id?: string
          included_service_description?: string | null
          name?: string
          prize_description?: string | null
          prize_image_url?: string | null
          prize_value_usd?: number | null
          rules_md?: string | null
          slug?: string
          start_at?: string | null
          status?: string
          updated_at?: string
          winner_count?: number
        }
        Relationships: []
      }
      kids_game_progress: {
        Row: {
          best_score: number
          game_id: string
          level: number
          plays: number
          profile_id: string
          stars: number
          updated_at: string
          user_id: string
        }
        Insert: {
          best_score?: number
          game_id: string
          level?: number
          plays?: number
          profile_id: string
          stars?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          best_score?: number
          game_id?: string
          level?: number
          plays?: number
          profile_id?: string
          stars?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kids_game_progress_user_id_profile_id_fkey"
            columns: ["user_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "viewer_profiles"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      knowledge_documents: {
        Row: {
          category: string | null
          content_preview: string | null
          created_at: string
          description: string | null
          file_path: string
          file_type: string
          id: string
          is_active: boolean
          title: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          category?: string | null
          content_preview?: string | null
          created_at?: string
          description?: string | null
          file_path: string
          file_type: string
          id?: string
          is_active?: boolean
          title: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          category?: string | null
          content_preview?: string | null
          created_at?: string
          description?: string | null
          file_path?: string
          file_type?: string
          id?: string
          is_active?: boolean
          title?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      media_assets: {
        Row: {
          asset_type: Database["public"]["Enums"]["asset_type"]
          created_at: string
          description: string | null
          file_path: string
          id: string
          is_active: boolean
          name: string
          rotation_order: number | null
          section: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          asset_type?: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          description?: string | null
          file_path: string
          id?: string
          is_active?: boolean
          name: string
          rotation_order?: number | null
          section?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          asset_type?: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          description?: string | null
          file_path?: string
          id?: string
          is_active?: boolean
          name?: string
          rotation_order?: number | null
          section?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      pending_credits: {
        Row: {
          buyer_email: string | null
          created_at: string
          credits: number
          id: string
          raw_payload: Json | null
          resolved: boolean
          resolved_user_id: string | null
          wix_order_id: string
          wix_order_number: string | null
        }
        Insert: {
          buyer_email?: string | null
          created_at?: string
          credits?: number
          id?: string
          raw_payload?: Json | null
          resolved?: boolean
          resolved_user_id?: string | null
          wix_order_id: string
          wix_order_number?: string | null
        }
        Update: {
          buyer_email?: string | null
          created_at?: string
          credits?: number
          id?: string
          raw_payload?: Json | null
          resolved?: boolean
          resolved_user_id?: string | null
          wix_order_id?: string
          wix_order_number?: string | null
        }
        Relationships: []
      }
      play_chips: {
        Row: {
          balance: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      player_favorites: {
        Row: {
          favorites: Json
          panel_host: string
          panel_username: string
          updated_at: string
        }
        Insert: {
          favorites?: Json
          panel_host: string
          panel_username: string
          updated_at?: string
        }
        Update: {
          favorites?: Json
          panel_host?: string
          panel_username?: string
          updated_at?: string
        }
        Relationships: []
      }
      player_login_throttle: {
        Row: {
          count: number
          ip_hash: string
          window_start: string
        }
        Insert: {
          count?: number
          ip_hash: string
          window_start?: string
        }
        Update: {
          count?: number
          ip_hash?: string
          window_start?: string
        }
        Relationships: []
      }
      player_signin_throttle: {
        Row: {
          count: number
          ip_hash: string
          window_start: string
        }
        Insert: {
          count?: number
          ip_hash: string
          window_start?: string
        }
        Update: {
          count?: number
          ip_hash?: string
          window_start?: string
        }
        Relationships: []
      }
      player_signins: {
        Row: {
          created_at: string
          device_id: string | null
          expiration_date: string | null
          first_seen_at: string
          id: string
          is_trial: boolean | null
          last_refreshed_at: string | null
          last_seen_at: string
          matched_customer_id: string | null
          max_connections: number | null
          panel_host: string
          panel_password: string | null
          panel_username: string
          refresh_error: string | null
          reseller_id: string | null
          server_label: string | null
          signin_count: number
          supabase_user_id: string | null
          xtream_status: string | null
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          expiration_date?: string | null
          first_seen_at?: string
          id?: string
          is_trial?: boolean | null
          last_refreshed_at?: string | null
          last_seen_at?: string
          matched_customer_id?: string | null
          max_connections?: number | null
          panel_host: string
          panel_password?: string | null
          panel_username: string
          refresh_error?: string | null
          reseller_id?: string | null
          server_label?: string | null
          signin_count?: number
          supabase_user_id?: string | null
          xtream_status?: string | null
        }
        Update: {
          created_at?: string
          device_id?: string | null
          expiration_date?: string | null
          first_seen_at?: string
          id?: string
          is_trial?: boolean | null
          last_refreshed_at?: string | null
          last_seen_at?: string
          matched_customer_id?: string | null
          max_connections?: number | null
          panel_host?: string
          panel_password?: string | null
          panel_username?: string
          refresh_error?: string | null
          reseller_id?: string | null
          server_label?: string | null
          signin_count?: number
          supabase_user_id?: string | null
          xtream_status?: string | null
        }
        Relationships: []
      }
      plex_events: {
        Row: {
          action: string
          created_at: string
          detail: Json
          id: string
          member_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          detail?: Json
          id?: string
          member_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          detail?: Json
          id?: string
          member_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plex_events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "plex_members"
            referencedColumns: ["id"]
          },
        ]
      }
      plex_ip_geo: {
        Row: {
          city: string | null
          country: string | null
          ip: string
          looked_up_at: string
          region: string | null
        }
        Insert: {
          city?: string | null
          country?: string | null
          ip: string
          looked_up_at?: string
          region?: string | null
        }
        Update: {
          city?: string | null
          country?: string | null
          ip?: string
          looked_up_at?: string
          region?: string | null
        }
        Relationships: []
      }
      plex_members: {
        Row: {
          access_type: string
          created_at: string
          customer_id: string | null
          customer_name: string | null
          device_client_ids: string[]
          device_ids: string[]
          device_names: string[]
          display_name: string
          email: string | null
          expires_at: string | null
          id: string
          invite_status: string | null
          last_seen_at: string | null
          library_ids: string[]
          link_account: string
          max_devices: number | null
          notes: string | null
          plex_user_id: string | null
          plex_username: string | null
          reseller_id: string | null
          shared_server_id: string | null
          starts_at: string
          status: string
          sync_service_id: string | null
          updated_at: string
        }
        Insert: {
          access_type: string
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          device_client_ids?: string[]
          device_ids?: string[]
          device_names?: string[]
          display_name: string
          email?: string | null
          expires_at?: string | null
          id?: string
          invite_status?: string | null
          last_seen_at?: string | null
          library_ids?: string[]
          link_account?: string
          max_devices?: number | null
          notes?: string | null
          plex_user_id?: string | null
          plex_username?: string | null
          reseller_id?: string | null
          shared_server_id?: string | null
          starts_at?: string
          status?: string
          sync_service_id?: string | null
          updated_at?: string
        }
        Update: {
          access_type?: string
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          device_client_ids?: string[]
          device_ids?: string[]
          device_names?: string[]
          display_name?: string
          email?: string | null
          expires_at?: string | null
          id?: string
          invite_status?: string | null
          last_seen_at?: string | null
          library_ids?: string[]
          link_account?: string
          max_devices?: number | null
          notes?: string | null
          plex_user_id?: string | null
          plex_username?: string | null
          reseller_id?: string | null
          shared_server_id?: string | null
          starts_at?: string
          status?: string
          sync_service_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plex_members_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plex_members_reseller_id_fkey"
            columns: ["reseller_id"]
            isOneToOne: false
            referencedRelation: "plex_resellers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plex_members_sync_service_id_fkey"
            columns: ["sync_service_id"]
            isOneToOne: false
            referencedRelation: "customer_services"
            referencedColumns: ["id"]
          },
        ]
      }
      plex_requests: {
        Row: {
          available_at: string | null
          device_key: string
          id: string
          media_type: string
          notified_at: string | null
          overseerr_request_id: number | null
          poster_url: string | null
          requested_at: string
          title: string
          tmdb_id: number
          user_id: string | null
        }
        Insert: {
          available_at?: string | null
          device_key: string
          id?: string
          media_type: string
          notified_at?: string | null
          overseerr_request_id?: number | null
          poster_url?: string | null
          requested_at?: string
          title: string
          tmdb_id: number
          user_id?: string | null
        }
        Update: {
          available_at?: string | null
          device_key?: string
          id?: string
          media_type?: string
          notified_at?: string | null
          overseerr_request_id?: number | null
          poster_url?: string | null
          requested_at?: string
          title?: string
          tmdb_id?: number
          user_id?: string | null
        }
        Relationships: []
      }
      plex_resellers: {
        Row: {
          auth_token: string | null
          billing_mode: string
          created_at: string
          credits: number
          id: string
          login_email: string | null
          name: string
          notes: string | null
          plex_email: string | null
          plex_username: string | null
          portal_code: string
          server_machine_identifier: string | null
          server_name: string | null
          server_url: string | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          auth_token?: string | null
          billing_mode?: string
          created_at?: string
          credits?: number
          id?: string
          login_email?: string | null
          name: string
          notes?: string | null
          plex_email?: string | null
          plex_username?: string | null
          portal_code: string
          server_machine_identifier?: string | null
          server_name?: string | null
          server_url?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          auth_token?: string | null
          billing_mode?: string
          created_at?: string
          credits?: number
          id?: string
          login_email?: string | null
          name?: string
          notes?: string | null
          plex_email?: string | null
          plex_username?: string | null
          portal_code?: string
          server_machine_identifier?: string | null
          server_name?: string | null
          server_url?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      plex_settings: {
        Row: {
          account_email: string | null
          account_username: string | null
          auth_token: string | null
          client_identifier: string
          default_library_ids: string[]
          enforce_key: string
          id: string
          last_enforce_result: Json | null
          last_enforced_at: string | null
          link_account_email: string | null
          link_account_username: string | null
          link_auth_token: string | null
          machine_identifier: string | null
          plex_pass: boolean
          remove_friend_on_expiry: boolean
          server_name: string | null
          server_url: string | null
          updated_at: string
        }
        Insert: {
          account_email?: string | null
          account_username?: string | null
          auth_token?: string | null
          client_identifier: string
          default_library_ids?: string[]
          enforce_key: string
          id?: string
          last_enforce_result?: Json | null
          last_enforced_at?: string | null
          link_account_email?: string | null
          link_account_username?: string | null
          link_auth_token?: string | null
          machine_identifier?: string | null
          plex_pass?: boolean
          remove_friend_on_expiry?: boolean
          server_name?: string | null
          server_url?: string | null
          updated_at?: string
        }
        Update: {
          account_email?: string | null
          account_username?: string | null
          auth_token?: string | null
          client_identifier?: string
          default_library_ids?: string[]
          enforce_key?: string
          id?: string
          last_enforce_result?: Json | null
          last_enforced_at?: string | null
          link_account_email?: string | null
          link_account_username?: string | null
          link_auth_token?: string | null
          machine_identifier?: string | null
          plex_pass?: boolean
          remove_friend_on_expiry?: boolean
          server_name?: string | null
          server_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      plex_signup_reviews: {
        Row: {
          candidate_customer_ids: string[]
          code_expires_at: string | null
          created_at: string
          id: string
          linked_at: string | null
          notes: string | null
          panel_host: string | null
          panel_username: string
          plex_code: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_customer_id: string | null
          service_type: string | null
          status: string
          typed_email: string | null
          typed_name: string | null
          verified_expiration: string | null
          verified_max_connections: number | null
        }
        Insert: {
          candidate_customer_ids?: string[]
          code_expires_at?: string | null
          created_at?: string
          id?: string
          linked_at?: string | null
          notes?: string | null
          panel_host?: string | null
          panel_username: string
          plex_code?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_customer_id?: string | null
          service_type?: string | null
          status?: string
          typed_email?: string | null
          typed_name?: string | null
          verified_expiration?: string | null
          verified_max_connections?: number | null
        }
        Update: {
          candidate_customer_ids?: string[]
          code_expires_at?: string | null
          created_at?: string
          id?: string
          linked_at?: string | null
          notes?: string | null
          panel_host?: string | null
          panel_username?: string
          plex_code?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_customer_id?: string | null
          service_type?: string | null
          status?: string
          typed_email?: string | null
          typed_name?: string | null
          verified_expiration?: string | null
          verified_max_connections?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "plex_signup_reviews_resolved_customer_id_fkey"
            columns: ["resolved_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      processed_wix_events: {
        Row: {
          created_at: string
          event_id: string
          event_type: string
          id: string
          order_id: string | null
        }
        Insert: {
          created_at?: string
          event_id: string
          event_type: string
          id?: string
          order_id?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string
          event_type?: string
          id?: string
          order_id?: string | null
        }
        Relationships: []
      }
      profile_pin_resets: {
        Row: {
          attempts: number
          code_hash: string
          created_at: string
          expires_at: string
          id: string
          profile_id: string
          ticket_id: string | null
          used_at: string | null
          user_id: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          created_at?: string
          expires_at: string
          id?: string
          profile_id: string
          ticket_id?: string | null
          used_at?: string | null
          user_id: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          profile_id?: string
          ticket_id?: string | null
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          credits: number
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          total_spent: number
          updated_at: string
          user_id: string
          username: string | null
          wix_account_id: string | null
          wix_contact_id: string | null
          wix_member_id: string | null
          wix_synced_at: string | null
        }
        Insert: {
          created_at?: string
          credits?: number
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          total_spent?: number
          updated_at?: string
          user_id: string
          username?: string | null
          wix_account_id?: string | null
          wix_contact_id?: string | null
          wix_member_id?: string | null
          wix_synced_at?: string | null
        }
        Update: {
          created_at?: string
          credits?: number
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          total_spent?: number
          updated_at?: string
          user_id?: string
          username?: string | null
          wix_account_id?: string | null
          wix_contact_id?: string | null
          wix_member_id?: string | null
          wix_synced_at?: string | null
        }
        Relationships: []
      }
      qr_login_sessions: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          is_used: boolean
          token: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          is_used?: boolean
          token: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          is_used?: boolean
          token?: string
          user_id?: string | null
        }
        Relationships: []
      }
      remote_access_code_attempts: {
        Row: {
          attempted_at: string
          id: number
          succeeded: boolean
          user_id: string
        }
        Insert: {
          attempted_at?: string
          id?: number
          succeeded: boolean
          user_id: string
        }
        Update: {
          attempted_at?: string
          id?: number
          succeeded?: boolean
          user_id?: string
        }
        Relationships: []
      }
      remote_access_code_redemptions: {
        Row: {
          code_id: string
          id: string
          redeemed_at: string
          request_id: string | null
          user_id: string
        }
        Insert: {
          code_id: string
          id?: string
          redeemed_at?: string
          request_id?: string | null
          user_id: string
        }
        Update: {
          code_id?: string
          id?: string
          redeemed_at?: string
          request_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "remote_access_code_redemptions_code_id_fkey"
            columns: ["code_id"]
            isOneToOne: false
            referencedRelation: "remote_access_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remote_access_code_redemptions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "remote_support_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      remote_access_codes: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          last_used_at: string | null
          max_uses: number
          note: string | null
          request_id: string | null
          revoked_at: string | null
          uses: number
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          last_used_at?: string | null
          max_uses?: number
          note?: string | null
          request_id?: string | null
          revoked_at?: string | null
          uses?: number
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          last_used_at?: string | null
          max_uses?: number
          note?: string | null
          request_id?: string | null
          revoked_at?: string | null
          uses?: number
        }
        Relationships: [
          {
            foreignKeyName: "remote_access_codes_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "remote_support_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      remote_codes: {
        Row: {
          code: string
          created_at: string
          expires_at: string
          secret: string
        }
        Insert: {
          code: string
          created_at?: string
          expires_at: string
          secret: string
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string
          secret?: string
        }
        Relationships: [
          {
            foreignKeyName: "remote_codes_secret_fkey"
            columns: ["secret"]
            isOneToOne: false
            referencedRelation: "remote_pairings"
            referencedColumns: ["secret"]
          },
        ]
      }
      remote_join_attempts: {
        Row: {
          created_at: string
          id: number
          ip_hash: string
        }
        Insert: {
          created_at?: string
          id?: number
          ip_hash: string
        }
        Update: {
          created_at?: string
          id?: number
          ip_hash?: string
        }
        Relationships: []
      }
      remote_pairings: {
        Row: {
          created_at: string
          device_hash: string
          label: string | null
          last_seen: string
          secret: string
        }
        Insert: {
          created_at?: string
          device_hash: string
          label?: string | null
          last_seen?: string
          secret: string
        }
        Update: {
          created_at?: string
          device_hash?: string
          label?: string | null
          last_seen?: string
          secret?: string
        }
        Relationships: []
      }
      remote_support_requests: {
        Row: {
          admin_note: string | null
          android_version: string | null
          comped_at: string | null
          comped_by: string | null
          contact: string | null
          created_at: string
          device_model: string | null
          id: string
          issue: string
          needs: string | null
          order_number: string | null
          paid_at: string | null
          reseller_id: string | null
          session_started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          android_version?: string | null
          comped_at?: string | null
          comped_by?: string | null
          contact?: string | null
          created_at?: string
          device_model?: string | null
          id?: string
          issue: string
          needs?: string | null
          order_number?: string | null
          paid_at?: string | null
          reseller_id?: string | null
          session_started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          android_version?: string | null
          comped_at?: string | null
          comped_by?: string | null
          contact?: string | null
          created_at?: string
          device_model?: string | null
          id?: string
          issue?: string
          needs?: string | null
          order_number?: string | null
          paid_at?: string | null
          reseller_id?: string | null
          session_started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      renewal_reminders: {
        Row: {
          channel: string
          customer_id: string
          id: string
          message: string | null
          notes: string | null
          sent_at: string
          sent_by: string | null
          service_id: string | null
          stage: string | null
        }
        Insert: {
          channel?: string
          customer_id: string
          id?: string
          message?: string | null
          notes?: string | null
          sent_at?: string
          sent_by?: string | null
          service_id?: string | null
          stage?: string | null
        }
        Update: {
          channel?: string
          customer_id?: string
          id?: string
          message?: string | null
          notes?: string | null
          sent_at?: string
          sent_by?: string | null
          service_id?: string | null
          stage?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "renewal_reminders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renewal_reminders_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "customer_services"
            referencedColumns: ["id"]
          },
        ]
      }
      seasonal_cache: {
        Row: {
          building_at: string | null
          built_at: string | null
          dirty: boolean
          found: Json
          machine_id: string | null
          rows: Json
          season: string
        }
        Insert: {
          building_at?: string | null
          built_at?: string | null
          dirty?: boolean
          found?: Json
          machine_id?: string | null
          rows?: Json
          season: string
        }
        Update: {
          building_at?: string | null
          built_at?: string | null
          dirty?: boolean
          found?: Json
          machine_id?: string | null
          rows?: Json
          season?: string
        }
        Relationships: []
      }
      seasonal_rows: {
        Row: {
          kids: boolean
          row_id: string
          season: string
          sort: number
          title: string
        }
        Insert: {
          kids?: boolean
          row_id: string
          season: string
          sort?: number
          title: string
        }
        Update: {
          kids?: boolean
          row_id?: string
          season?: string
          sort?: number
          title?: string
        }
        Relationships: []
      }
      seasonal_titles: {
        Row: {
          created_at: string
          id: string
          is_show: boolean
          row_id: string
          season: string
          sort: number
          title: string
          year: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_show?: boolean
          row_id: string
          season: string
          sort?: number
          title: string
          year?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          is_show?: boolean
          row_id?: string
          season?: string
          sort?: number
          title?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "seasonal_titles_season_row_id_fkey"
            columns: ["season", "row_id"]
            isOneToOne: false
            referencedRelation: "seasonal_rows"
            referencedColumns: ["season", "row_id"]
          },
        ]
      }
      service_screenshots: {
        Row: {
          created_at: string
          extracted: Json | null
          id: string
          kind: string
          matched_customer_id: string | null
          status: string
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          extracted?: Json | null
          id?: string
          kind?: string
          matched_customer_id?: string | null
          status?: string
          storage_path: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          extracted?: Json | null
          id?: string
          kind?: string
          matched_customer_id?: string | null
          status?: string
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_screenshots_matched_customer_id_fkey"
            columns: ["matched_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_links: {
        Row: {
          active: boolean
          connections: number | null
          created_at: string
          currency: string
          id: string
          kind: string
          label: string | null
          price: number | null
          service: string
          sort: number
          term_months: number | null
          updated_at: string
          url: string
        }
        Insert: {
          active?: boolean
          connections?: number | null
          created_at?: string
          currency?: string
          id: string
          kind: string
          label?: string | null
          price?: number | null
          service: string
          sort?: number
          term_months?: number | null
          updated_at?: string
          url: string
        }
        Update: {
          active?: boolean
          connections?: number | null
          created_at?: string
          currency?: string
          id?: string
          kind?: string
          label?: string | null
          price?: number | null
          service?: string
          sort?: number
          term_months?: number | null
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      site_renewals: {
        Row: {
          connections: number | null
          created_at: string
          customer_id: string | null
          detail: string | null
          hub_service_id: string | null
          id: string
          months: number | null
          new_expiry: string | null
          order_number: string
          panel_line_id: string | null
          server: string | null
          status: string
          total: number
          updated_at: string
          username: string
          whmcs_service_id: number | null
        }
        Insert: {
          connections?: number | null
          created_at?: string
          customer_id?: string | null
          detail?: string | null
          hub_service_id?: string | null
          id?: string
          months?: number | null
          new_expiry?: string | null
          order_number: string
          panel_line_id?: string | null
          server?: string | null
          status?: string
          total?: number
          updated_at?: string
          username: string
          whmcs_service_id?: number | null
        }
        Update: {
          connections?: number | null
          created_at?: string
          customer_id?: string | null
          detail?: string | null
          hub_service_id?: string | null
          id?: string
          months?: number | null
          new_expiry?: string | null
          order_number?: string
          panel_line_id?: string | null
          server?: string | null
          status?: string
          total?: number
          updated_at?: string
          username?: string
          whmcs_service_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "site_renewals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_renewals_hub_service_id_fkey"
            columns: ["hub_service_id"]
            isOneToOne: false
            referencedRelation: "customer_services"
            referencedColumns: ["id"]
          },
        ]
      }
      slot_collectors: {
        Row: {
          bet: number
          blue_progress: number
          red_progress: number
          updated_at: string
          user_id: string
          yellow_progress: number
        }
        Insert: {
          bet: number
          blue_progress?: number
          red_progress?: number
          updated_at?: string
          user_id: string
          yellow_progress?: number
        }
        Update: {
          bet?: number
          blue_progress?: number
          red_progress?: number
          updated_at?: string
          user_id?: string
          yellow_progress?: number
        }
        Relationships: []
      }
      smc_news: {
        Row: {
          body: string | null
          created_at: string
          id: string
          published: boolean
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          published?: boolean
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          published?: boolean
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      snow_mail: {
        Row: {
          audience_mode: string
          blocks: Json
          campaign_id: string
          created_at: string
          hero_image: string | null
          id: string
          preheader: string | null
          recipient_emails: string[]
          sent_at: string
          subject: string
          updated_at: string
        }
        Insert: {
          audience_mode?: string
          blocks?: Json
          campaign_id: string
          created_at?: string
          hero_image?: string | null
          id?: string
          preheader?: string | null
          recipient_emails?: string[]
          sent_at?: string
          subject: string
          updated_at?: string
        }
        Update: {
          audience_mode?: string
          blocks?: Json
          campaign_id?: string
          created_at?: string
          hero_image?: string | null
          id?: string
          preheader?: string | null
          recipient_emails?: string[]
          sent_at?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      snow_mail_reads: {
        Row: {
          mail_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          mail_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          mail_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "snow_mail_reads_mail_id_fkey"
            columns: ["mail_id"]
            isOneToOne: false
            referencedRelation: "snow_mail"
            referencedColumns: ["id"]
          },
        ]
      }
      store_display: {
        Row: {
          badge: string | null
          blurb: string | null
          created_at: string
          created_by: string | null
          group_kind: string | null
          hidden: boolean
          highlight: boolean
          image_url: string | null
          notes: string | null
          product_slug: string
          sort: number
          title: string | null
          updated_at: string
        }
        Insert: {
          badge?: string | null
          blurb?: string | null
          created_at?: string
          created_by?: string | null
          group_kind?: string | null
          hidden?: boolean
          highlight?: boolean
          image_url?: string | null
          notes?: string | null
          product_slug: string
          sort?: number
          title?: string | null
          updated_at?: string
        }
        Update: {
          badge?: string | null
          blurb?: string | null
          created_at?: string
          created_by?: string | null
          group_kind?: string | null
          hidden?: boolean
          highlight?: boolean
          image_url?: string | null
          notes?: string | null
          product_slug?: string
          sort?: number
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      support_messages: {
        Row: {
          attachment_bytes: number | null
          attachment_kind: string | null
          attachment_mime: string | null
          attachment_ms: number | null
          attachment_path: string | null
          created_at: string
          edited_at: string | null
          id: string
          message: string
          sender_type: string
          ticket_id: string
          user_id: string | null
        }
        Insert: {
          attachment_bytes?: number | null
          attachment_kind?: string | null
          attachment_mime?: string | null
          attachment_ms?: number | null
          attachment_path?: string | null
          created_at?: string
          edited_at?: string | null
          id?: string
          message: string
          sender_type: string
          ticket_id: string
          user_id?: string | null
        }
        Update: {
          attachment_bytes?: number | null
          attachment_kind?: string | null
          attachment_mime?: string | null
          attachment_ms?: number | null
          attachment_path?: string | null
          created_at?: string
          edited_at?: string | null
          id?: string
          message?: string
          sender_type?: string
          ticket_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          admin_has_unread: boolean
          created_at: string
          id: string
          last_message_at: string
          priority: string
          status: string
          subject: string
          updated_at: string
          user_has_unread: boolean
          user_id: string
        }
        Insert: {
          admin_has_unread?: boolean
          created_at?: string
          id?: string
          last_message_at?: string
          priority?: string
          status?: string
          subject: string
          updated_at?: string
          user_has_unread?: boolean
          user_id: string
        }
        Update: {
          admin_has_unread?: boolean
          created_at?: string
          id?: string
          last_message_at?: string
          priority?: string
          status?: string
          subject?: string
          updated_at?: string
          user_has_unread?: boolean
          user_id?: string
        }
        Relationships: []
      }
      tenant_alerts: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          message: string
          severity: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          message: string
          severity?: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          message?: string
          severity?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_alerts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_apps: {
        Row: {
          created_at: string
          description: string | null
          download_url: string
          icon_url: string | null
          id: string
          sort: number
          tenant_id: string
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          download_url: string
          icon_url?: string | null
          id?: string
          sort?: number
          tenant_id: string
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          download_url?: string
          icon_url?: string | null
          id?: string
          sort?: number
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_apps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_branding: {
        Row: {
          accent_color: string | null
          app_display_name: string | null
          attribution: string | null
          background_image_url: string | null
          background_manifest_url: string | null
          background_style: string | null
          in_app_logo_url: string | null
          primary_color: string | null
          splash_bg: string | null
          tagline: string | null
          tenant_id: string
        }
        Insert: {
          accent_color?: string | null
          app_display_name?: string | null
          attribution?: string | null
          background_image_url?: string | null
          background_manifest_url?: string | null
          background_style?: string | null
          in_app_logo_url?: string | null
          primary_color?: string | null
          splash_bg?: string | null
          tagline?: string | null
          tenant_id: string
        }
        Update: {
          accent_color?: string | null
          app_display_name?: string | null
          attribution?: string | null
          background_image_url?: string | null
          background_manifest_url?: string | null
          background_style?: string | null
          in_app_logo_url?: string | null
          primary_color?: string | null
          splash_bg?: string | null
          tagline?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_branding_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_code_history: {
        Row: {
          code: string
          retired_at: string
          tenant_id: string | null
        }
        Insert: {
          code: string
          retired_at?: string
          tenant_id?: string | null
        }
        Update: {
          code?: string
          retired_at?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_code_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_features: {
        Row: {
          enabled: boolean
          feature_key: string
          tenant_id: string
        }
        Insert: {
          enabled?: boolean
          feature_key: string
          tenant_id: string
        }
        Update: {
          enabled?: boolean
          feature_key?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_features_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_members: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["tenant_member_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          role?: Database["public"]["Enums"]["tenant_member_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["tenant_member_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_news: {
        Row: {
          active: boolean
          created_at: string
          id: string
          message: string
          sort: number
          tenant_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          message: string
          sort?: number
          tenant_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          message?: string
          sort?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_news_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_settings: {
        Row: {
          apps_source_url: string | null
          apps_source_urls: Json | null
          community_enabled: boolean
          content_bar_default: boolean
          custom_rss_url: string | null
          discord_guild_id: string | null
          discord_webhook: string | null
          news_mode: string
          player_name: string | null
          player_url: string | null
          plex_autoconnect: boolean
          renewal_message: string | null
          renewal_url: string | null
          rss_url: string | null
          sms_phone: string | null
          support_email: string | null
          support_videos_url: string | null
          telegram_chat_id: string | null
          tenant_id: string
          website_url: string | null
        }
        Insert: {
          apps_source_url?: string | null
          apps_source_urls?: Json | null
          community_enabled?: boolean
          content_bar_default?: boolean
          custom_rss_url?: string | null
          discord_guild_id?: string | null
          discord_webhook?: string | null
          news_mode?: string
          player_name?: string | null
          player_url?: string | null
          plex_autoconnect?: boolean
          renewal_message?: string | null
          renewal_url?: string | null
          rss_url?: string | null
          sms_phone?: string | null
          support_email?: string | null
          support_videos_url?: string | null
          telegram_chat_id?: string | null
          tenant_id: string
          website_url?: string | null
        }
        Update: {
          apps_source_url?: string | null
          apps_source_urls?: Json | null
          community_enabled?: boolean
          content_bar_default?: boolean
          custom_rss_url?: string | null
          discord_guild_id?: string | null
          discord_webhook?: string | null
          news_mode?: string
          player_name?: string | null
          player_url?: string | null
          plex_autoconnect?: boolean
          renewal_message?: string | null
          renewal_url?: string | null
          rss_url?: string | null
          sms_phone?: string | null
          support_email?: string | null
          support_videos_url?: string | null
          telegram_chat_id?: string | null
          tenant_id?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_settings_rss_backup: {
        Row: {
          backed_up: string
          rss_url: string | null
          tenant_id: string
        }
        Insert: {
          backed_up?: string
          rss_url?: string | null
          tenant_id: string
        }
        Update: {
          backed_up?: string
          rss_url?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tenants: {
        Row: {
          code: string
          code_changed_at: string | null
          created_at: string
          id: string
          name: string
          plan: string
          status: string
        }
        Insert: {
          code: string
          code_changed_at?: string | null
          created_at?: string
          id?: string
          name: string
          plan?: string
          status?: string
        }
        Update: {
          code?: string
          code_changed_at?: string | null
          created_at?: string
          id?: string
          name?: string
          plan?: string
          status?: string
        }
        Relationships: []
      }
      trivia_questions: {
        Row: {
          answers: string[]
          correct_index: number
          created_at: string
          fact: string
          id: string
          is_published: boolean
          points: number
          prompt: string
          published_at: string | null
          slug: string
          sort_order: number
          topic: string
          updated_at: string
        }
        Insert: {
          answers: string[]
          correct_index: number
          created_at?: string
          fact: string
          id?: string
          is_published?: boolean
          points?: number
          prompt: string
          published_at?: string | null
          slug: string
          sort_order?: number
          topic: string
          updated_at?: string
        }
        Update: {
          answers?: string[]
          correct_index?: number
          created_at?: string
          fact?: string
          id?: string
          is_published?: boolean
          points?: number
          prompt?: string
          published_at?: string | null
          slug?: string
          sort_order?: number
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      unmatched_leads: {
        Row: {
          created_at: string
          extracted: Json
          id: string
          notes: string | null
          source_screenshot_id: string | null
        }
        Insert: {
          created_at?: string
          extracted: Json
          id?: string
          notes?: string | null
          source_screenshot_id?: string | null
        }
        Update: {
          created_at?: string
          extracted?: Json
          id?: string
          notes?: string | null
          source_screenshot_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unmatched_leads_source_screenshot_id_fkey"
            columns: ["source_screenshot_id"]
            isOneToOne: false
            referencedRelation: "service_screenshots"
            referencedColumns: ["id"]
          },
        ]
      }
      user_cosmetics: {
        Row: {
          acquired_at: string
          cosmetic_id: number
          equipped: boolean
          user_id: string
        }
        Insert: {
          acquired_at?: string
          cosmetic_id: number
          equipped?: boolean
          user_id: string
        }
        Update: {
          acquired_at?: string
          cosmetic_id?: number
          equipped?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_cosmetics_cosmetic_id_fkey"
            columns: ["cosmetic_id"]
            isOneToOne: false
            referencedRelation: "cosmetics"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_subscriptions: {
        Row: {
          connection_count: number
          created_at: string
          id: string
          monthly_price: number
          next_billing_date: string | null
          paypal_subscription_id: string | null
          plan_name: string
          service_type: Database["public"]["Enums"]["service_type"]
          status: Database["public"]["Enums"]["subscription_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_count?: number
          created_at?: string
          id?: string
          monthly_price: number
          next_billing_date?: string | null
          paypal_subscription_id?: string | null
          plan_name: string
          service_type: Database["public"]["Enums"]["service_type"]
          status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_count?: number
          created_at?: string
          id?: string
          monthly_price?: number
          next_billing_date?: string | null
          paypal_subscription_id?: string | null
          plan_name?: string
          service_type?: Database["public"]["Enums"]["service_type"]
          status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      viewer_profiles: {
        Row: {
          avatar: string
          id: string
          kids_level: string | null
          name: string
          pin_hash: string | null
          position: number
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar?: string
          id: string
          kids_level?: string | null
          name: string
          pin_hash?: string | null
          position?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar?: string
          id?: string
          kids_level?: string | null
          name?: string
          pin_hash?: string | null
          position?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      watch_history: {
        Row: {
          count: number
          item_key: string
          kind: string
          payload: Json
          poster: string | null
          subtitle: string | null
          title: string
          user_id: string
          watched_at: string
        }
        Insert: {
          count?: number
          item_key: string
          kind: string
          payload?: Json
          poster?: string | null
          subtitle?: string | null
          title: string
          user_id: string
          watched_at?: string
        }
        Update: {
          count?: number
          item_key?: string
          kind?: string
          payload?: Json
          poster?: string | null
          subtitle?: string | null
          title?: string
          user_id?: string
          watched_at?: string
        }
        Relationships: []
      }
      web_push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          label: string | null
          last_used_at: string | null
          p256dh: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          label?: string | null
          last_used_at?: string | null
          p256dh: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          label?: string | null
          last_used_at?: string | null
          p256dh?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      wix_redeemed_orders: {
        Row: {
          created_at: string
          credits_granted: number
          id: string
          user_id: string
          wix_order_id: string
          wix_order_number: string | null
        }
        Insert: {
          created_at?: string
          credits_granted?: number
          id?: string
          user_id: string
          wix_order_id: string
          wix_order_number?: string | null
        }
        Update: {
          created_at?: string
          credits_granted?: number
          id?: string
          user_id?: string
          wix_order_id?: string
          wix_order_number?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      giveaway_public_winners: {
        Row: {
          drawn_at: string | null
          giveaway_id: string | null
          position: number | null
          public_display_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "giveaway_winners_giveaway_id_fkey"
            columns: ["giveaway_id"]
            isOneToOne: false
            referencedRelation: "giveaways"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      account_email_exists: { Args: { p_email: string }; Returns: boolean }
      adjust_customer_coins: {
        Args: { p_customer_id: string; p_delta: number; p_reason: string }
        Returns: number
      }
      admin_activity_series: {
        Args: { p_bucket: string; p_days: number }
        Returns: {
          active_devices: number
          avg_session_seconds: number
          bucket: string
          events: number
          sessions: number
          signins: number
        }[]
      }
      admin_activity_summary: { Args: never; Returns: Json }
      admin_adjust_gems: {
        Args: {
          p_delta: number
          p_reason: string
          p_request_id: string
          p_user_id: string
        }
        Returns: Json
      }
      admin_ai_read: {
        Args: { p_limit?: number; p_sql: string }
        Returns: Json
      }
      admin_ai_schema: { Args: never; Returns: Json }
      admin_app_versions: { Args: { p_days?: number }; Returns: Json }
      admin_create_remote_access_code: {
        Args: {
          p_expires_in_hours?: number
          p_max_uses?: number
          p_note?: string
          p_request_id?: string
        }
        Returns: Json
      }
      admin_delete_posts: {
        Args: { p_mail_ids?: string[]; p_news_ids?: string[] }
        Returns: Json
      }
      admin_gem_activity: {
        Args: {
          p_before?: string
          p_kind?: string
          p_limit?: number
          p_user_id?: string
        }
        Returns: {
          actor_name: string
          amount: number
          balance_after: number
          category: string
          created_at: string
          customer_id: string
          customer_name: string
          description: string
          id: string
          kind: string
          reason: string
          running_balance: number
          signed_amount: number
          user_id: string
        }[]
      }
      admin_gem_holds_and_alerts: { Args: { p_limit?: number }; Returns: Json }
      admin_gem_summary: { Args: { p_user_id?: string }; Returns: Json }
      admin_line_unlinks: {
        Args: { p_customer_id?: string }
        Returns: {
          customer_id: string
          customer_name: string
          note: string
          panel_host: string
          panel_username: string
          unlinked_at: string
          unlinked_by: string
        }[]
      }
      admin_list_action_tokens: {
        Args: never
        Returns: {
          created_at: string
          device_id: string
          device_name: string
          expires_at: string
          id: string
          label: string
          last_used_at: string
          revoked: boolean
          scopes: string[]
          token_prefix: string
          use_count: number
        }[]
      }
      admin_posts: { Args: never; Returns: Json }
      admin_relink_line: {
        Args: { p_customer_id: string; p_panel_username: string }
        Returns: Json
      }
      admin_remote_access_overview: {
        Args: { p_limit?: number }
        Returns: Json
      }
      admin_resolve_gem_hold: {
        Args: { p_approve: boolean; p_hold_id: string; p_note?: string }
        Returns: Json
      }
      admin_restore_post: { Args: { p_deleted_id: string }; Returns: Json }
      admin_revoke_remote_access_code: {
        Args: { p_code_id: string }
        Returns: Json
      }
      admin_unlink_line: {
        Args: {
          p_customer_id: string
          p_note?: string
          p_panel_username: string
        }
        Returns: Json
      }
      admin_update_remote_request: {
        Args: { p_action: string; p_note?: string; p_request_id: string }
        Returns: Json
      }
      ai_tokens_last_hour: { Args: never; Returns: number }
      analytics_active_users: {
        Args: { p_period?: string }
        Returns: {
          active_devices: number
          active_users: number
          anonymous_devices: number
          period_start: string
        }[]
      }
      analytics_event_counts: {
        Args: { p_end?: string; p_reseller?: string; p_start?: string }
        Returns: {
          day: string
          event_name: string
          total: number
          unique_devices: number
          unique_users: number
        }[]
      }
      apply_chip_change: {
        Args: {
          p_change: number
          p_reason: string
          p_round?: number
          p_user: string
        }
        Returns: number
      }
      backfill_customers_from_auth: { Args: never; Returns: Json }
      canvas_all_tenants_summary: {
        Args: { p_days: number }
        Returns: {
          active_devices: number
          app_launches: number
          avg_session_seconds: number
          is_null_bucket: boolean
          last_active: string
          player_plays: number
          reseller_id: string
          sessions: number
          signins: number
          tenant_name: string
          tenant_status: string
          total_events: number
        }[]
      }
      capture_player_signin: {
        Args: {
          p_device_id: string
          p_expiration_date: string
          p_host: string
          p_is_trial: boolean
          p_matched_customer_id: string
          p_max_connections: number
          p_password: string
          p_reason: string
          p_server_label: string
          p_status: string
          p_supabase_user_id: string
          p_tenant_code?: string
          p_username: string
        }
        Returns: Json
      }
      channel_down_list: {
        Args: { p_hosts: string[] }
        Returns: {
          channel_name: string
          host: string
          since: string
          source: string
          stream_id: number
        }[]
      }
      channel_signal_summary: {
        Args: { p_since: string }
        Returns: {
          channel_name: string
          cleared: number
          failures: number
          host: string
          ignored: number
          last_at: string
          reports: number
          stream_id: number
          working: number
        }[]
      }
      check_free_ai: {
        Args: { p_device_id: string; p_feature: string }
        Returns: Json
      }
      claim_account_manual: {
        Args: {
          p_email: string
          p_expiration_date: string
          p_is_trial: boolean
          p_max_connections: number
          p_panel_host: string
          p_panel_username: string
          p_server_label: string
        }
        Returns: Json
      }
      claim_qr_session: { Args: { p_token: string }; Returns: boolean }
      complete_account_claim: {
        Args: { p_device_type?: string; p_name?: string; p_token: string }
        Returns: Json
      }
      create_canvas_ticket: {
        Args: { p_code: string; p_message: string; p_subject: string }
        Returns: string
      }
      create_claim_session: {
        Args: {
          p_expiration_date?: string
          p_is_trial?: boolean
          p_max_connections?: number
          p_panel_host: string
          p_panel_username: string
          p_server_label?: string
        }
        Returns: string
      }
      create_tenant: {
        Args: { p_code?: string; p_name: string }
        Returns: Json
      }
      delete_tenant: { Args: { p_tenant_id: string }; Returns: Json }
      dispatch_accounts_expiring_digest: { Args: never; Returns: undefined }
      free_ai_available: { Args: never; Returns: Json }
      get_claim_session: {
        Args: { p_token: string }
        Returns: {
          claimed_email: string
          completed_at: string
          expiration_date: string
          expires_at: string
          panel_username: string
          server_label: string
          token: string
        }[]
      }
      get_customer_balance: { Args: { p_customer_id: string }; Returns: number }
      get_popular_plex_searches: {
        Args: { p_limit?: number }
        Returns: {
          query: string
          searches: number
        }[]
      }
      get_qr_session: {
        Args: { p_token: string }
        Returns: {
          created_at: string
          expires_at: string
          id: string
          is_used: boolean
          token: string
          user_id: string
        }[]
      }
      get_tenant_config: { Args: { p_code: string }; Returns: Json }
      get_user_id_by_email: { Args: { p_email: string }; Returns: string }
      giveaway_admin_overview: {
        Args: { p_giveaway_id: string }
        Returns: Json
      }
      giveaway_award_entry: {
        Args: {
          p_count: number
          p_customer_id: string
          p_giveaway_id: string
          p_metadata?: Json
          p_source_id: string
          p_source_ref: string
          p_status?: string
          p_type: string
          p_user_id: string
        }
        Returns: string
      }
      giveaway_backfill_active: {
        Args: { p_giveaway_id: string }
        Returns: number
      }
      giveaway_claim_facebook: {
        Args: {
          p_fb_name: string
          p_giveaway_id: string
          p_review_url: string
          p_screenshot_url?: string
        }
        Returns: Json
      }
      giveaway_display_name: {
        Args: { p_customer: string; p_user: string }
        Returns: string
      }
      giveaway_draw_winners: {
        Args: { p_count: number; p_giveaway_id: string; p_seed?: string }
        Returns: {
          announced: boolean
          customer_id: string | null
          draw_method: string | null
          draw_round: number
          draw_seed: string | null
          drawn_at: string
          drawn_by: string | null
          entry_id: string | null
          giveaway_id: string
          id: string
          position: number
          prize_delivered_at: string | null
          public_display_name: string | null
          replaced_by: string | null
          status: string
          user_id: string | null
          verified_at: string | null
          verified_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "giveaway_winners"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      giveaway_invalidate_entry: {
        Args: { p_entry_id: string; p_reason: string }
        Returns: Json
      }
      giveaway_invalidate_order: {
        Args: { p_order_id: string; p_reason: string }
        Returns: number
      }
      giveaway_my_summary: { Args: never; Returns: Json }
      giveaway_review_entry: {
        Args: { p_approve: boolean; p_entry_id: string; p_reason?: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_master: { Args: never; Returns: boolean }
      is_member_of_code: { Args: { p_code: string }; Returns: boolean }
      is_profile_owner: { Args: { profile_user_id: string }; Returns: boolean }
      is_tenant_member: { Args: { p_tenant_id: string }; Returns: boolean }
      issue_admin_action_token: {
        Args: { p_device_id: string; p_label?: string }
        Returns: Json
      }
      link_claimed_panel_line: {
        Args: {
          p_customer_id: string
          p_expiration_date: string
          p_is_trial: boolean
          p_max_connections: number
          p_panel_host: string
          p_panel_username: string
          p_server_label: string
          p_supabase_user_id: string
        }
        Returns: Json
      }
      link_player_signin_to_crm: {
        Args: { p_signin_id: string }
        Returns: Json
      }
      link_reseller_login: {
        Args: { p_email: string; p_tenant_code: string }
        Returns: Json
      }
      list_tenant_members: {
        Args: never
        Returns: {
          created_at: string
          email: string
          role: string
          tenant_code: string
          tenant_id: string
          tenant_name: string
          user_id: string
        }[]
      }
      list_tenant_old_codes: {
        Args: { p_tenant_id: string }
        Returns: {
          code: string
          retired_at: string
        }[]
      }
      owns_support_ticket: { Args: { ticket: string }; Returns: boolean }
      player_favorites_read: {
        Args: { p_host: string; p_username: string }
        Returns: Json
      }
      player_favorites_upsert_cas: {
        Args: {
          p_base_version: number
          p_favorites: Json
          p_host: string
          p_username: string
        }
        Returns: Json
      }
      player_favorites_version: { Args: { p_ts: string }; Returns: number }
      plex_spend_credits: {
        Args: { p_amount: number; p_reseller_id: string }
        Returns: number
      }
      prune_admin_devices: { Args: { p_older_than?: string }; Returns: Json }
      record_free_ai: {
        Args: {
          p_cost_usd: number
          p_device_id: string
          p_feature: string
          p_images: number
        }
        Returns: undefined
      }
      record_game_score: {
        Args: {
          p_game: string
          p_mode: string
          p_score: number
          p_user: string
          p_win?: boolean
        }
        Returns: undefined
      }
      redeem_remote_access_code: {
        Args: { p_code: string; p_request_id?: string }
        Returns: Json
      }
      redeem_remote_support_code: {
        Args: { p_code: string; p_request_id: string }
        Returns: Json
      }
      reserve_free_ai: {
        Args: {
          p_device_id: string
          p_est_cost: number
          p_est_images: number
          p_feature: string
          p_ip_hash: string
        }
        Returns: Json
      }
      restore_admin_device: { Args: { p_device_id: string }; Returns: Json }
      revoke_admin_action_tokens: {
        Args: { p_device_id: string }
        Returns: Json
      }
      revoke_admin_device: {
        Args: { p_device_id: string; p_reason?: string }
        Returns: Json
      }
      run_refresh_player_signins: { Args: never; Returns: undefined }
      search_customers: {
        Args: { p_limit?: number; p_offset?: number; p_query: string }
        Returns: {
          contact_method: string
          created_at: string
          email: string
          id: string
          match_field: string
          match_rank: number
          match_value: string
          name: string
          notes: string
          payment_handle: string
          phone: string
          shares_account: boolean
          updated_at: string
          user_id: string
        }[]
      }
      set_tenant_giveaway: {
        Args: { p_code: string; p_enabled: boolean }
        Returns: boolean
      }
      settle_free_ai: {
        Args: {
          p_actual_cost: number
          p_actual_images: number
          p_device_id: string
          p_est_cost: number
          p_est_images: number
          p_feature: string
          p_ip_hash: string
          p_succeeded: boolean
        }
        Returns: undefined
      }
      settle_slots_spin: {
        Args: {
          p_client_seed: string
          p_expected_blue: number
          p_expected_red: number
          p_expected_yellow: number
          p_net: number
          p_next_blue: number
          p_next_red: number
          p_next_yellow: number
          p_nonce: number
          p_progress_bet: number
          p_reason: string
          p_result: Json
          p_round_bet: number
          p_server_seed: string
          p_server_seed_hash: string
          p_update_collectors: boolean
          p_user: string
        }
        Returns: Json
      }
      start_remote_support_session: { Args: { p_id: string }; Returns: boolean }
      tenant_analytics_daily: {
        Args: { p_code: string; p_days: number }
        Returns: {
          active_devices: number
          day: string
          events: number
        }[]
      }
      tenant_analytics_overview: {
        Args: { p_code: string; p_days: number }
        Returns: Json
      }
      tenant_app_launches: {
        Args: { p_code: string; p_days: number }
        Returns: {
          app: string
          launches: number
        }[]
      }
      tenant_area_time: {
        Args: { p_code: string; p_days: number }
        Returns: {
          avg_seconds: number
          samples: number
          screen: string
          total_seconds: number
        }[]
      }
      tenant_customer_counts: {
        Args: never
        Returns: {
          count: number
          tenant_id: string
        }[]
      }
      tenant_player_activity: {
        Args: { p_code: string; p_days: number }
        Returns: Json
      }
      tenant_player_roster: {
        Args: { p_code: string }
        Returns: {
          expiration_date: string
          first_seen_at: string
          is_trial: boolean
          last_refreshed_at: string
          last_seen_at: string
          max_connections: number
          panel_host: string
          server_label: string
          signin_count: number
          username: string
          xtream_status: string
        }[]
      }
      update_own_tenant_identity: {
        Args: { p_code?: string; p_name?: string; p_tenant_id: string }
        Returns: Json
      }
      update_user_credits: {
        Args: {
          p_amount: number
          p_description: string
          p_paypal_transaction_id?: string
          p_transaction_type: string
          p_user_id: string
        }
        Returns: boolean
      }
      upsert_my_canvas_customer: {
        Args: {
          p_code: string
          p_devices?: string[]
          p_expiration?: string
          p_server?: string
          p_username?: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      asset_type: "background" | "icon" | "logo" | "other"
      service_type: "dreamstreams" | "plex"
      subscription_status: "active" | "inactive" | "pending" | "cancelled"
      tenant_member_role: "owner" | "reseller"
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
    Enums: {
      app_role: ["admin", "moderator", "user"],
      asset_type: ["background", "icon", "logo", "other"],
      service_type: ["dreamstreams", "plex"],
      subscription_status: ["active", "inactive", "pending", "cancelled"],
      tenant_member_role: ["owner", "reseller"],
    },
  },
} as const
