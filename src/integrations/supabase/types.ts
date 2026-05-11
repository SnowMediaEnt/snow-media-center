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
          created_at: string
          description: string
          id: string
          paypal_transaction_id: string | null
          transaction_type: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description: string
          id?: string
          paypal_transaction_id?: string | null
          transaction_type: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          paypal_transaction_id?: string | null
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
          created_at: string
          customer_id: string
          expiration_date: string | null
          id: string
          line_id: string | null
          notes: string | null
          panel_username: string | null
          renewal_status: string | null
          service_type: string
          start_date: string | null
        }
        Insert: {
          created_at?: string
          customer_id: string
          expiration_date?: string | null
          id?: string
          line_id?: string | null
          notes?: string | null
          panel_username?: string | null
          renewal_status?: string | null
          service_type: string
          start_date?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string
          expiration_date?: string | null
          id?: string
          line_id?: string | null
          notes?: string | null
          panel_username?: string | null
          renewal_status?: string | null
          service_type?: string
          start_date?: string | null
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
          created_at: string
          email: string
          id: string
          name: string | null
          notes: string | null
          payment_handle: string | null
          phone: string | null
          updated_at: string
          user_id: string | null
          wix_contact_id: string | null
          wix_member_id: string | null
          wix_synced_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          name?: string | null
          notes?: string | null
          payment_handle?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string | null
          wix_contact_id?: string | null
          wix_member_id?: string | null
          wix_synced_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string | null
          notes?: string | null
          payment_handle?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string | null
          wix_contact_id?: string | null
          wix_member_id?: string | null
          wix_synced_at?: string | null
        }
        Relationships: []
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
      renewal_reminders: {
        Row: {
          channel: string
          customer_id: string
          id: string
          notes: string | null
          sent_at: string
          sent_by: string | null
          service_id: string | null
        }
        Insert: {
          channel?: string
          customer_id: string
          id?: string
          notes?: string | null
          sent_at?: string
          sent_by?: string | null
          service_id?: string | null
        }
        Update: {
          channel?: string
          customer_id?: string
          id?: string
          notes?: string | null
          sent_at?: string
          sent_by?: string | null
          service_id?: string | null
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
      support_messages: {
        Row: {
          created_at: string
          id: string
          message: string
          sender_type: string
          ticket_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          sender_type: string
          ticket_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
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
      [_ in never]: never
    }
    Functions: {
      ai_tokens_last_hour: { Args: never; Returns: number }
      backfill_customers_from_auth: { Args: never; Returns: Json }
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_profile_owner: { Args: { profile_user_id: string }; Returns: boolean }
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
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      asset_type: "background" | "icon" | "logo" | "other"
      service_type: "dreamstreams" | "plex"
      subscription_status: "active" | "inactive" | "pending" | "cancelled"
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
      app_role: ["admin", "moderator", "user"],
      asset_type: ["background", "icon", "logo", "other"],
      service_type: ["dreamstreams", "plex"],
      subscription_status: ["active", "inactive", "pending", "cancelled"],
    },
  },
} as const
